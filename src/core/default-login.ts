import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError } from './errors.ts';
import type { Provider } from './providers.ts';

// The default login is what a plain `claude` / `codex` (terminal, VS Code) uses: ~/.claude and
// ~/.codex. Choosing an account moves its login there. Refresh tokens rotate, so one login may
// live in only one place at a time: a switch first puts the installed login (maybe refreshed
// since) back in its owner's folder, then installs the chosen one. Only the login entries move;
// settings, history and other keys of these files stay where they are.

/** One piece of a login: a whole file, or one key of a JSON file shared with other settings. */
interface Part {
  /** Where the default login keeps it. */
  home: (home: string) => string;
  /** Its file name inside an account folder (CLAUDE_CONFIG_DIR / CODEX_HOME). */
  name: string;
  key?: string;
}
const PARTS: Record<Provider, Part[]> = {
  'claude-cli': [
    {
      home: (home) => join(home, '.claude', '.credentials.json'),
      name: '.credentials.json',
      key: 'claudeAiOauth',
    },
    // Claude keeps the signed-in account next to its folder by default, inside it when relocated.
    { home: (home) => join(home, '.claude.json'), name: '.claude.json', key: 'oauthAccount' },
  ],
  'codex-cli': [{ home: (home) => join(home, '.codex', 'auth.json'), name: 'auth.json' }],
};
const IMAGE: Record<Provider, string> = { 'claude-cli': 'claude.exe', 'codex-cli': 'codex.exe' };

const fail = (code: string): never => {
  throw new DomainError(code);
};
const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function readFile(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 16 * 1024 * 1024)
    fail('DEFAULT_LOGIN_UNREADABLE');
  try {
    return record(JSON.parse(readFileSync(file, 'utf8'))) ?? fail('DEFAULT_LOGIN_UNREADABLE');
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return fail('DEFAULT_LOGIN_UNREADABLE');
  }
}
function read(part: Part, file: string) {
  const data = readFile(file);
  return part.key ? data?.[part.key] : data;
}
/** Write one part, keeping every other key of a shared file; undefined removes it. */
function write(part: Part, file: string, value: unknown) {
  let next: unknown = value;
  if (part.key) {
    const data = { ...readFile(file) };
    if (value === undefined) delete data[part.key];
    else data[part.key] = value;
    next = data;
  }
  if (next === undefined) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } catch {
    if (existsSync(temporary)) unlinkSync(temporary);
    fail('DEFAULT_LOGIN_LOCKED');
  }
}
/** Which account a login belongs to, when the files say so. */
function owner(provider: Provider, values: unknown[]) {
  if (provider === 'codex-cli') {
    const id = record(record(values[0])?.tokens)?.account_id;
    return typeof id === 'string' ? id : undefined;
  }
  const account = record(values[1]);
  const id = account?.accountUuid ?? account?.emailAddress;
  return typeof id === 'string' ? id : undefined;
}

/** Whether the service's CLI runs anywhere (terminal, VS Code); it would write its old login back. */
export function cliRunning(provider: Provider) {
  return new Promise<boolean>((resolve, reject) =>
    execFile(
      'tasklist.exe',
      ['/FI', `IMAGENAME eq ${IMAGE[provider]}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 10_000 },
      (error, output) =>
        error
          ? reject(new DomainError('CLI_CHECK_FAILED'))
          : resolve(output.toLowerCase().includes(`"${IMAGE[provider]}"`)),
    ),
  );
}

interface Options {
  /** Where the app keeps its data: the first original login and set-aside logins go here. */
  root: string;
  home?: string;
  running?: (provider: Provider) => Promise<boolean>;
  now?: () => number;
}
export class DefaultLogin {
  private options: Required<Options>;
  constructor(options: Options) {
    this.options = { home: homedir(), running: cliRunning, now: Date.now, ...options };
  }
  /** Refuse a switch the CLI would undo or that cannot be done with files. */
  async assertReady(provider: Provider) {
    if (provider === 'codex-cli') {
      const config = join(this.options.home, '.codex', 'config.toml');
      const store = existsSync(config)
        ? readFileSync(config, 'utf8').match(
            /^\s*cli_auth_credentials_store\s*=\s*["']([a-z]+)["']/m,
          )?.[1]
        : undefined;
      if (store && store !== 'file') fail('CODEX_KEYRING');
    }
    if (await this.options.running(provider)) fail('CLI_RUNNING');
  }
  /**
   * Put the installed login back in `from` (its owner's folder) and install the one in `to`.
   * Account folders use the CLI's own layout, so the CLI can still use and refresh them there.
   */
  swap(provider: Provider, from: string, to: string) {
    const parts = PARTS[provider];
    const { home, root } = this.options;
    const installed = parts.map((part) => read(part, part.home(home)));
    const target = parts.map((part) => read(part, join(to, part.name)));
    // The login found at the very first switch is kept once, untouched, to restore by hand.
    const original = join(root, 'original-' + provider);
    if (!existsSync(original)) {
      mkdirSync(original);
      parts.forEach((part, i) => write(part, join(original, part.name), installed[i]));
    }
    // Signed in to another account outside the app: set it aside instead of overwriting the owner.
    const now = owner(provider, installed);
    const before = owner(
      provider,
      parts.map((part) => read(part, join(from, part.name))),
    );
    let keep = from;
    if (now && before && now !== before) {
      keep = join(root, `set-aside-${provider}-${this.options.now()}`);
      mkdirSync(keep);
    }
    parts.forEach((part, i) => write(part, join(keep, part.name), installed[i]));
    try {
      parts.forEach((part, i) => write(part, part.home(home), target[i]));
    } catch (error) {
      // Put back what was there; the owner's folder already has it too.
      try {
        parts.forEach((part, i) => write(part, part.home(home), installed[i]));
      } catch {
        /* Reported as the first failure. */
      }
      throw error;
    }
  }
}
