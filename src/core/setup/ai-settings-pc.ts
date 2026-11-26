import { join, posix, win32 } from 'node:path';
import type { CheckDeps } from './checks.ts';
import type { CommandRequest, CommandResult } from './commands.ts';
import { expandPath, getEnv } from './environment.ts';
import {
  DEFAULT_PREFS,
  parsePrefs,
  PREFS_FILE,
  type AiPrefs,
  type AiReader,
  type PaseoState,
} from './ai-settings.ts';

// SPEC 3.11: what the AI work settings need from this PC: the saved choices, Codex CLI, and
// Paseo's config through Paseo's own CLI. Shared by the check, the step and the plan route.

const PASEO_TIMEOUT_MS = 30_000;

/** How to run Paseo's CLI without a shell, or undefined when Paseo is not installed. */
export function paseoCli(deps: Pick<CheckDeps, 'platform' | 'env' | 'home' | 'exists'>) {
  if (deps.platform === 'win32') {
    // `paseo.cmd` only runs Paseo.exe as Node; a .cmd cannot take JSON arguments safely.
    for (const template of ['%ProgramFiles%\\Paseo', '%LOCALAPPDATA%\\Programs\\Paseo']) {
      const folder = expandPath(template, deps.env, deps.home);
      const program = win32.join(folder, 'Paseo.exe');
      const resources = win32.join(folder, 'resources');
      const runner = win32.join(
        resources,
        'app.asar.unpacked',
        'dist',
        'daemon',
        'node-entrypoint-runner.js',
      );
      if (!deps.exists(program) || !deps.exists(runner)) continue;
      const cli = win32.join(
        resources,
        'app.asar',
        'node_modules',
        '@getpaseo',
        'cli',
        'dist',
        'index.js',
      );
      return (args: string[]) => ({
        program,
        args: ['--disable-warning=DEP0040', runner, 'node-script', cli, ...args],
        env: { ELECTRON_RUN_AS_NODE: '1', PASEO_NODE_ENV: 'production' },
      });
    }
    return undefined;
  }
  if (deps.platform === 'darwin')
    for (const app of ['/Applications', posix.join(deps.home, 'Applications')]) {
      const program = posix.join(app, 'Paseo.app', 'Contents', 'Resources', 'bin', 'paseo');
      if (deps.exists(program)) return (args: string[]) => ({ program, args, env: {} });
    }
  return undefined;
}

export type PaseoCli = NonNullable<ReturnType<typeof paseoCli>>;

/** The config Paseo has set, from `paseo daemon config get --json`; read only. */
export async function readPaseo(
  cli: PaseoCli | undefined,
  run: (
    request: Omit<CommandRequest, 'timeoutMs'> & { timeoutMs?: number },
  ) => Promise<CommandResult>,
): Promise<PaseoState> {
  if (!cli) return { kind: 'missing' };
  const request = cli(['daemon', 'config', 'get', '--json']);
  const result = await run({ ...request, timeoutMs: PASEO_TIMEOUT_MS });
  if (result.code !== 0) return { kind: 'unreadable' };
  try {
    const answer = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as {
      value?: unknown;
    };
    const value = answer.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { kind: 'ok', config: value as Record<string, unknown> }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** `PASEO_HOME`, when set, moves Paseo's config like it moves Paseo. */
export const paseoHome = (deps: Pick<CheckDeps, 'env'>) =>
  getEnv(deps.env, 'PASEO_HOME') || undefined;

/**
 * The data folder is a folder of the computer the engine runs on, so its path is joined the way
 * that computer joins paths, as the step and the save do (`node:path`'s own `join`).
 */
export function readPrefs(deps: Pick<CheckDeps, 'readFile' | 'dataDirectory'>): AiPrefs {
  if (!deps.dataDirectory) return { ...DEFAULT_PREFS };
  return parsePrefs(deps.readFile(join(deps.dataDirectory, PREFS_FILE)));
}

/** The plan's view of this PC. */
export async function aiReader(
  deps: CheckDeps,
  run: Parameters<typeof readPaseo>[1],
): Promise<AiReader> {
  return {
    platform: deps.platform,
    home: deps.home,
    read: deps.readFile,
    exists: deps.exists,
    codex: !!deps.executable('codex-cli'),
    paseo: await readPaseo(paseoCli(deps), run),
  };
}
