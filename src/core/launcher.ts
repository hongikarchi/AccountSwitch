import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve, win32 } from 'node:path';
import { codexEnvironment, executable, subscriptionEnvironment } from './cli.ts';
import { DomainError } from './errors.ts';
import { providers, type Provider } from './providers.ts';

// "Claude 열기" and "GPT 열기" (SPEC 4): the browser fallback that opens the terminal when
// there is no desktop window. src/desktop/shell/CliLauncher.cs is the same launch for the window;
// change both together.

const TITLE_VARIABLE = 'ACCOUNTSWITCH_LAUNCH_TITLE';
const PROGRAM_VARIABLE = 'ACCOUNTSWITCH_LAUNCH_PROGRAM';

/**
 * The whole command line, one fixed string: the folder and the program travel outside it, so
 * nothing a folder is called can reach cmd's parser as a command.
 *
 * The hidden outer cmd expands the title and ComSpec itself, inside quotes, where a value is not
 * parsed again. `%^NAME%` is a variable no one has, so the outer cmd leaves it and only drops the
 * caret; the inner cmd then gets `%NAME%` and expands the program path inside its own quotes. Each
 * `^"` is a literal quote for the inner command line and does not end a quoted part of the outer
 * one. /S makes the inner cmd strip exactly the outermost pair, whatever the path holds.
 */
export const LAUNCH_ARGUMENTS = `/D /S /V:OFF /C "start "%${TITLE_VARIABLE}%" "%ComSpec%" /D /S /V:OFF /K ^"^"%^${PROGRAM_VARIABLE}%^"^""`;

/** Why a folder cannot be used, or undefined when it can. */
export function folderProblem(folder: string) {
  if (/[\0-\x1f]/.test(folder)) return 'FOLDER_INVALID';
  if (process.platform === 'win32') {
    // cmd cannot start in a UNC path: it would silently run in the Windows folder instead.
    if (/^[\\/]{2}/.test(folder)) return 'FOLDER_NETWORK';
    if (!/^[A-Za-z]:[\\/][^<>:"|?*]*$/.test(folder)) return 'FOLDER_INVALID';
  } else if (!isAbsolute(folder)) return 'FOLDER_INVALID';
  try {
    if (!statSync(folder).isDirectory()) return 'FOLDER_NOT_FOUND';
  } catch {
    return 'FOLDER_NOT_FOUND';
  }
  return undefined;
}

/** `Claude Code - <folder name>`; a drive root has no name of its own. */
export function launchTitle(folder: string, provider: Provider = 'claude-cli') {
  const name = provider === 'codex-cli' ? 'Codex' : 'Claude Code';
  return `${name} - ${win32.basename(folder) || folder}`;
}

/** The absolute cmd.exe: never found by name, since the chosen folder is searched first. */
export function commandProcessor(source: NodeJS.ProcessEnv = process.env) {
  return win32.join(source.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
}

/** The npm package a codex.exe lies in, or undefined when it came some other way. */
export function codexPackageRoot(program: string) {
  return /^(.*[\\/]node_modules[\\/]@openai[\\/]codex)[\\/]node_modules[\\/]/i.exec(program)?.[1];
}

/**
 * The terminal's environment: the subscription login in use, never a folder or key inherited from
 * another session (CLAUDECODE would make Claude Code refuse to start, as if nested).
 */
export function launchEnvironment(
  folder: string,
  program: string,
  source: NodeJS.ProcessEnv = process.env,
  provider: Provider = 'claude-cli',
) {
  const env = provider === 'codex-cli' ? codexEnvironment(source) : subscriptionEnvironment(source);
  for (const key of Object.keys(env)) if (/^(CLAUDECODE|ComSpec)$/i.test(key)) delete env[key];
  env.ComSpec = commandProcessor(source);
  env[TITLE_VARIABLE] = launchTitle(folder, provider);
  env[PROGRAM_VARIABLE] = program;
  if (provider === 'claude-cli') {
    // Claude Code would otherwise replace the window title with its own.
    env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1';
  } else {
    // What npm's wrapper script would set; the binary finds its own tools through these.
    const root = codexPackageRoot(program);
    if (root) {
      env.CODEX_MANAGED_BY_NPM = '1';
      env.CODEX_MANAGED_PACKAGE_ROOT = root;
    }
  }
  return env;
}

export interface LauncherOptions {
  spawnProcess?: typeof spawn;
  program?: (provider: Provider) => string | undefined;
  platform?: NodeJS.Platform;
}

export class Launcher {
  options: LauncherOptions;

  constructor(options: LauncherOptions = {}) {
    this.options = options;
  }

  private program(provider: Provider) {
    return (this.options.program ?? executable)(provider);
  }

  private platform() {
    return this.options.platform ?? process.platform;
  }

  /** What the page needs for its buttons. */
  status() {
    return {
      platform: this.platform(),
      installed: Object.fromEntries(providers.map((p) => [p, !!this.program(p)])),
    };
  }

  /** Open the terminal in a folder (browser fallback; the desktop window does this itself). */
  async open(provider: Provider, folder: string) {
    if (this.platform() !== 'win32') throw new DomainError('UNSUPPORTED_PLATFORM');
    const problem = folderProblem(folder);
    if (problem) throw new DomainError(problem);
    const program = this.program(provider);
    if (!program || program.includes('"') || !existsSync(program))
      throw new DomainError('CLI_UNAVAILABLE');
    const directory = resolve(folder);
    await new Promise<void>((done, fail) => {
      const failed = () => fail(new DomainError('LAUNCH_FAILED'));
      let child: ChildProcess;
      try {
        child = (this.options.spawnProcess ?? spawn)(commandProcessor(), [LAUNCH_ARGUMENTS], {
          cwd: directory,
          env: launchEnvironment(directory, program, process.env, provider),
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: 'ignore',
        });
      } catch {
        return failed();
      }
      // `start` returns as soon as the terminal has its window; the hidden cmd ends with it.
      const timer = setTimeout(() => {
        child.kill();
        failed();
      }, 10000);
      child.once('error', () => {
        clearTimeout(timer);
        failed();
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) done();
        else failed();
      });
    });
    return { folder: directory };
  }
}
