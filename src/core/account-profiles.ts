import { DomainError } from './errors.ts';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  realpathSync,
  lstatSync,
  existsSync,
  unlinkSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { providers } from './providers.ts';
import type { Provider } from './providers.ts';
const profile = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(providers),
    label: z.string().trim().min(1).max(80),
  })
  .strict();
const schema = z
  .object({
    /** 1: `active` was only a choice inside the app. 2: it is the login in ~/.claude / ~/.codex. */
    version: z.union([z.literal(1), z.literal(2)]),
    profiles: z.array(profile).max(30),
    active: z.object({ 'claude-cli': z.string(), 'codex-cli': z.string() }).strict(),
    pending: z
      .object({ 'claude-cli': z.string().nullable(), 'codex-cli': z.string().nullable() })
      .strict()
      .optional(),
    /** User-chosen names of the default (existing CLI) logins. */
    defaultLabels: z
      .object({
        'claude-cli': z.string().trim().min(1).max(80).optional(),
        'codex-cli': z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
type Data = z.infer<typeof schema>;
const fail = (code: string): never => {
  throw new DomainError(code);
};
/** Local-only metadata. Credentials remain in CLI-owned child directories, never in this manifest. */
export class AccountProfiles {
  private root: string;
  private data: Data;
  private saved: Data;
  private busy: (provider: Provider) => boolean;
  constructor(root: string, busy: (provider: Provider) => boolean) {
    this.busy = busy;
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) fail('PROFILE_PATH_INVALID');
    this.root = realpathSync(root);
    const file = join(this.root, 'profiles.json');
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 65536))
      fail('PROFILE_PATH_INVALID');
    this.data = existsSync(file)
      ? schema.parse(JSON.parse(readFileSync(file, 'utf8')))
      : {
          version: 2,
          profiles: [],
          active: { 'claude-cli': 'default', 'codex-cli': 'default' },
        };
    this.saved = structuredClone(this.data);
    if (new Set(this.data.profiles.map((p) => p.id)).size !== this.data.profiles.length)
      fail('INVALID_PROFILE_DATA');
    for (const provider of providers)
      if (this.data.active[provider] !== 'default') this.find(provider, this.data.active[provider]);
    if (this.data.version === 1) {
      // A version 1 choice never changed the default login, which is still the CLI's own one.
      this.data = {
        ...this.data,
        version: 2,
        active: { 'claude-cli': 'default', 'codex-cli': 'default' },
      };
      delete this.data.pending;
      this.save();
    }
  }
  private save() {
    const temporary = join(this.root, 'profiles-' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(this.root, 'profiles.json'));
      this.saved = structuredClone(this.data);
    } catch (error) {
      this.data = structuredClone(this.saved);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }
  private find(provider: Provider, id: string) {
    return (
      this.data.profiles.find((p) => p.provider === provider && p.id === id) ??
      fail('PROFILE_NOT_FOUND')
    );
  }
  list() {
    return structuredClone(this.data);
  }
  assertIdle(provider: Provider) {
    if (this.busy(provider)) fail('PROFILE_IN_USE');
  }
  add(provider: Provider, label: string) {
    if (this.data.profiles.length >= 30) fail('PROFILE_LIMIT');
    const row = profile.parse({ id: randomUUID(), provider, label });
    mkdirSync(join(this.root, row.id));
    this.data.profiles.push(row);
    this.save();
    return row;
  }
  /** Rename an account; an empty name gives the default login its standard name back. */
  rename(provider: Provider, id: string, label: string) {
    const name = label.trim();
    if (name.length > 80) fail('INVALID_INPUT');
    if (id === 'default') {
      const labels = { ...this.data.defaultLabels };
      if (name) labels[provider] = name;
      else delete labels[provider];
      this.data.defaultLabels = labels;
    } else {
      if (!name) fail('INVALID_INPUT');
      this.find(provider, id).label = name;
    }
    this.save();
    return this.list();
  }
  /**
   * Make an account the default login: `swap` moves the installed login back to the folder of
   * `from` and installs the one in `to`, then the choice is saved.
   */
  select(provider: Provider, id: string, swap: (from: string, to: string) => void) {
    if (id !== 'default') this.find(provider, id);
    const current = this.data.active[provider];
    if (current === id) return this.list();
    this.assertIdle(provider);
    swap(this.folder(provider, current), this.folder(provider, id));
    this.data.active[provider] = id;
    this.save();
    return this.list();
  }
  selected(provider: Provider) {
    return this.data.active[provider];
  }
  remove(provider: Provider, id: string) {
    this.assertIdle(provider);
    this.find(provider, id); // Never remove the compatible default login.
    if (this.data.active[provider] === id) fail('PROFILE_ACTIVE');
    const directory = this.folder(provider, id);
    const inspect = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (lstatSync(child).isSymbolicLink()) fail('PROFILE_PATH_INVALID');
        if (entry.isDirectory()) {
          if (
            !realpathSync(child)
              .toLowerCase()
              .startsWith(directory.toLowerCase() + sep)
          )
            fail('PROFILE_PATH_INVALID');
          inspect(child);
        }
      }
    };
    inspect(directory);
    try {
      rmSync(directory, { recursive: true, force: false });
    } catch {
      fail('PROFILE_CLEANUP_FAILED');
    }
    this.data.profiles = this.data.profiles.filter((row) => row.id !== id);
    this.save();
    return this.list();
  }
  /**
   * The CLI folder an account's login is in now: undefined for the active one (the default
   * ~/.claude / ~/.codex), else its own folder, where the original login rests while another
   * account is active.
   */
  directory(provider: Provider, id: string) {
    if (id !== 'default') this.find(provider, id);
    return this.data.active[provider] === id ? undefined : this.folder(provider, id);
  }
  /** An account's own folder, active or not. */
  private folder(provider: Provider, id: string) {
    if (id !== 'default') this.find(provider, id);
    const path = join(this.root, id === 'default' ? 'default-' + provider : id);
    if (!existsSync(path)) mkdirSync(path);
    if (
      lstatSync(path).isSymbolicLink() ||
      realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
    )
      fail('PROFILE_PATH_INVALID');
    return path;
  }
}
