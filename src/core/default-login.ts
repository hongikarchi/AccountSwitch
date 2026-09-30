import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DomainError } from './errors.ts';
import type { Provider } from './providers.ts';

// The default login is what a plain `claude` / `codex` (terminal, VS Code) uses: ~/.claude and
// ~/.codex. Choosing an account moves its login there. Refresh tokens rotate, so one login may
// live in only one place at a time: a switch first puts the installed login (maybe refreshed
// since) back in its owner's folder, then installs the chosen one. Only the login entries (and
// what the CLI caches about that account) move; settings, history and other keys stay.

/** One piece of a login: a whole file, or some keys of a JSON file shared with other settings. */
interface Part {
  /** Where the default login keeps it. */
  home: (home: string) => string;
  /** Its file name inside an account folder (CLAUDE_CONFIG_DIR / CODEX_HOME). */
  name: string;
  keys?: string[];
}
/**
 * The signed-in account and what Claude caches about that account or its organization (usage,
 * models, plan and privacy settings); left behind, another account would show them until refetched.
 */
const CLAUDE_ACCOUNT = [
  'oauthAccount',
  'cachedUsageUtilization',
  'cachedExtraUsageDisabledReason',
  'passesEligibilityCache',
  'modelAccessCache',
  'orgModelDefaultCache',
  'additionalModelOptionsCache',
  'additionalModelOptionsAnsweredAt',
  'additionalModelCostsCache',
  'penguinModeOrgEnabled',
  'groveConfigCache',
  'metricsStatusCache',
  'githubWebConnectionStatusCache',
  'cachedArtifactRoster',
];
const PARTS: Record<Provider, Part[]> = {
  'claude-cli': [
    {
      home: (home) => join(home, '.claude', '.credentials.json'),
      name: '.credentials.json',
      keys: ['claudeAiOauth'],
    },
    // Claude keeps the signed-in account next to its folder by default, inside it when relocated.
    { home: (home) => join(home, '.claude.json'), name: '.claude.json', keys: CLAUDE_ACCOUNT },
  ],
  'codex-cli': [{ home: (home) => join(home, '.codex', 'auth.json'), name: 'auth.json' }],
};
/**
 * Claude Code's own advisory locks (npm proper-lockfile: a directory whose creation is the mutex,
 * touched every 5 s while held). Its token refresh takes the first two (stale after 60 s), its
 * ~/.claude.json writes the third (10 s). Holding them while swapping keeps a running Claude Code
 * from saving a refreshed old-account token over the new login: under the lock it re-reads the
 * file, finds the new login and stops, and it uses the new account from its next message.
 * Codex needs none: before a refresh it re-reads auth.json and gives up when the account changed
 * (a running Codex keeps its account until restarted).
 */
const CLAUDE_LOCKS = [
  { path: (home: string) => join(home, '.claude', '.oauth_refresh.lock'), stale: 60_000 },
  { path: (home: string) => join(home, '.claude.lock'), stale: 60_000 },
  { path: (home: string) => join(home, '.claude.json.lock'), stale: 10_000 },
];

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
  if (!part.keys || !data) return data;
  return Object.fromEntries(part.keys.filter((key) => key in data).map((key) => [key, data[key]]));
}
/** Write one part, keeping every other key of a shared file; a missing key or file is removed. */
function write(part: Part, file: string, value: Record<string, unknown> | undefined) {
  let next = value;
  if (part.keys) {
    const data = { ...readFile(file) };
    for (const key of part.keys)
      if (value && key in value) data[key] = value[key];
      else delete data[key];
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
  const account = record(record(values[1])?.oauthAccount);
  const id = account?.accountUuid ?? account?.emailAddress;
  return typeof id === 'string' ? id : undefined;
}

interface Options {
  /** Where the app keeps its data: the first original login and set-aside logins go here. */
  root: string;
  home?: string;
  now?: () => number;
  /** How long to wait for a lock Claude Code holds (it holds one for a network round trip). */
  lockWaitMs?: number;
}
export class DefaultLogin {
  private options: Required<Options>;
  constructor(options: Options) {
    this.options = { home: homedir(), now: Date.now, lockWaitMs: 9000, ...options };
  }
  /** Refuse a switch that cannot be done with files. */
  assertReady(provider: Provider) {
    if (provider === 'codex-cli') {
      const config = join(this.options.home, '.codex', 'config.toml');
      const store = existsSync(config)
        ? readFileSync(config, 'utf8').match(
            /^\s*cli_auth_credentials_store\s*=\s*["']([a-z]+)["']/m,
          )?.[1]
        : undefined;
      if (store && store !== 'file') fail('CODEX_KEYRING');
    }
  }
  /** Take the CLI's own locks for a swap (Claude Code only); call the result to release them. */
  async lock(provider: Provider) {
    const held: string[] = [];
    let touch: ReturnType<typeof setInterval> | undefined;
    const release = () => {
      clearInterval(touch);
      for (const folder of held.reverse())
        try {
          rmdirSync(folder);
        } catch {
          /* Already gone. */
        }
    };
    if (provider !== 'claude-cli') return release;
    try {
      for (const lock of CLAUDE_LOCKS)
        held.push(await this.acquire(lock.path(this.options.home), lock.stale));
    } catch (error) {
      release();
      throw error;
    }
    // Live holders keep their lock fresh so it is never taken as stale.
    touch = setInterval(() => {
      const now = new Date();
      for (const folder of held)
        try {
          utimesSync(folder, now, now);
        } catch {
          /* Released. */
        }
    }, 3000);
    return release;
  }
  private async acquire(folder: string, stale: number) {
    mkdirSync(dirname(folder), { recursive: true });
    const deadline = Date.now() + this.options.lockWaitMs;
    for (;;) {
      try {
        mkdirSync(folder);
        return folder;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      // Checked on every path, so a lock that cannot be read or removed never spins forever.
      if (Date.now() > deadline) fail('CLI_LOCK_TIMEOUT');
      try {
        // Left behind by a process that ended while holding it.
        if (Date.now() - statSync(folder).mtimeMs > stale) {
          rmdirSync(folder);
          continue;
        }
      } catch {
        /* Released meanwhile, or not removable: try again after the pause. */
      }
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
    }
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
