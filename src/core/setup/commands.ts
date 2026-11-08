import { spawn, type ChildProcess } from 'node:child_process';
import { killOwnedProcess } from '../cli.ts';
import { getEnv } from './environment.ts';

// Every program the setup code starts goes through a CommandRunner, so tests use fakes.

export interface CommandRequest {
  program: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Aborting kills this command's own process tree, by its process id, and nothing else. */
  signal?: AbortSignal;
}
export interface CommandResult {
  /** Exit code; null when it timed out or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why it never started (`ENOENT`, `UNSAFE_SHIM`, ...). */
  spawnError?: string;
  /** `signal` stopped it. */
  cancelled?: boolean;
}
export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

const MAX_OUTPUT = 256 * 1024;
/** After exit, how long to wait for a grandchild that kept the output pipes open. */
const AFTER_EXIT_MS = 1000;

/**
 * How to start a `.cmd` or `.bat`: Node refuses them with `shell: false` (CVE-2024-27980), so they
 * go through `cmd.exe /d /s /c "..."` with the line written out here. Inside double quotes only `%`
 * and `!` keep a special meaning and `"` ends the quote, so a path holding one is refused, and
 * arguments may only be plain words. Undefined: not safe to start.
 */
export function shimCommandLine(program: string, args: string[]) {
  if (/["%!\r\n]/.test(program)) return undefined;
  if (!args.every((arg) => /^[\w.@:=+\\/-]+$/.test(arg))) return undefined;
  return ['/d', '/s', '/c', `""${program}" ${args.join(' ')}"`.replace(/ "$/, '"')];
}

/** The real runner: no shell, no window, a timeout, and it never waits past that timeout. */
export const runCommand: CommandRunner = ({ program, args, timeoutMs, env, cwd, signal }) =>
  new Promise((resolve) => {
    const failed = (spawnError: string) =>
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError });
    if (signal?.aborted)
      return resolve({ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true });
    let file = program;
    let argv = args;
    let verbatim = false;
    if (/\.(cmd|bat)$/i.test(program)) {
      const line = shimCommandLine(program, args);
      if (!line) return failed('UNSAFE_SHIM');
      file = getEnv(env ?? process.env, 'ComSpec') || 'cmd.exe';
      argv = line;
      verbatim = true;
    }
    let child: ChildProcess;
    try {
      child = spawn(file, argv, {
        env,
        cwd,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      return failed((error as NodeJS.ErrnoException).code ?? 'SPAWN_FAILED');
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let afterExit: NodeJS.Timeout | undefined;
    const finish = (
      result: Pick<CommandResult, 'code' | 'timedOut' | 'spawnError' | 'cancelled'>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(afterExit);
      signal?.removeEventListener('abort', cancel);
      resolve({ stdout, stderr, ...result });
    };
    const stop = () => {
      void killOwnedProcess(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };
    const cancel = () => {
      stop();
      finish({ code: null, timedOut: false, cancelled: true });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      stop();
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
    });
    child.once('error', (error: NodeJS.ErrnoException) =>
      finish({ code: null, timedOut: false, spawnError: error.code ?? 'SPAWN_FAILED' }),
    );
    child.once('exit', (code) => {
      afterExit = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ code, timedOut: false });
      }, AFTER_EXIT_MS);
    });
    child.once('close', (code) => finish({ code, timedOut: false }));
  });
