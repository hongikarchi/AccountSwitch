import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, win32 } from 'node:path';
import { z } from 'zod';
import { executable, subscriptionEnvironment } from './cli.ts';
import { DomainError } from './errors.ts';

// "Claude Code 열기" (SPEC 4): the recent folders, and the browser fallback that opens the terminal
// when there is no desktop window. src/desktop/shell/ClaudeLauncher.cs is the same launch for the
// window; change both together.

const MAX_RECENT = 8;
const TITLE_VARIABLE = 'ACCOUNTSWITCH_LAUNCH_TITLE';
const CLAUDE_VARIABLE = 'ACCOUNTSWITCH_LAUNCH_CLAUDE';

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
export const LAUNCH_ARGUMENTS = `/D /S /V:OFF /C "start "%${TITLE_VARIABLE}%" "%ComSpec%" /D /S /V:OFF /K ^"^"%^${CLAUDE_VARIABLE}%^"^""`;

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
export function launchTitle(folder: string) {
  return `Claude Code - ${win32.basename(folder) || folder}`;
}

/** The absolute cmd.exe: never found by name, since the chosen folder is searched first. */
export function commandProcessor(source: NodeJS.ProcessEnv = process.env) {
  return win32.join(source.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
}

/**
 * The terminal's environment: the subscription login in use, never a folder or key inherited from
 * another session (CLAUDECODE would make Claude Code refuse to start, as if nested).
 */
export function launchEnvironment(
  folder: string,
  program: string,
  source: NodeJS.ProcessEnv = process.env,
) {
  const env = subscriptionEnvironment(source);
  for (const key of Object.keys(env)) if (/^(CLAUDECODE|ComSpec)$/i.test(key)) delete env[key];
  env.ComSpec = commandProcessor(source);
  env[TITLE_VARIABLE] = launchTitle(folder);
  env[CLAUDE_VARIABLE] = program;
  // Claude Code would otherwise replace the window title with its own.
  env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1';
  return env;
}

const stored = z.object({ recent: z.array(z.string()) });
const sameFolder = (folder: string) =>
  process.platform === 'win32' ? folder.toLowerCase() : folder;

export interface LauncherOptions {
  /** launcher.json in the data folder. */
  file: string;
  spawnProcess?: typeof spawn;
  program?: () => string | undefined;
  platform?: NodeJS.Platform;
}

export class Launcher {
  options: LauncherOptions;

  constructor(options: LauncherOptions) {
    this.options = options;
  }

  private program() {
    return (this.options.program ?? (() => executable('claude-cli')))();
  }

  private platform() {
    return this.options.platform ?? process.platform;
  }

  /** Up to 8 folders, most recent first; a folder that is gone is left out. */
  recent() {
    let list: string[] = [];
    try {
      list = stored.parse(JSON.parse(readFileSync(this.options.file, 'utf8'))).recent;
    } catch {
      // No file yet, or one this version cannot read: start over.
    }
    return this.distinct(list);
  }

  private distinct(list: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of list) {
      if (folderProblem(entry)) continue;
      const folder = resolve(entry);
      if (seen.has(sameFolder(folder))) continue;
      seen.add(sameFolder(folder));
      result.push(folder);
    }
    return result.slice(0, MAX_RECENT);
  }

  remember(folder: string) {
    const problem = folderProblem(folder);
    if (problem) throw new DomainError(problem);
    const recent = this.distinct([folder, ...this.recent()]);
    const temporary = `${this.options.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, recent }), { mode: 0o600 });
    renameSync(temporary, this.options.file);
    return recent;
  }

  /** What the page needs for its button. */
  status() {
    return { platform: this.platform(), installed: !!this.program(), recent: this.recent() };
  }

  /** Open the terminal in a folder (browser fallback; the desktop window does this itself). */
  async open(folder: string) {
    if (this.platform() !== 'win32') throw new DomainError('UNSUPPORTED_PLATFORM');
    const problem = folderProblem(folder);
    if (problem) throw new DomainError(problem);
    const program = this.program();
    if (!program || program.includes('"') || !existsSync(program))
      throw new DomainError('CLI_UNAVAILABLE');
    const directory = resolve(folder);
    await new Promise<void>((done, fail) => {
      const failed = () => fail(new DomainError('LAUNCH_FAILED'));
      let child: ChildProcess;
      try {
        child = (this.options.spawnProcess ?? spawn)(commandProcessor(), [LAUNCH_ARGUMENTS], {
          cwd: directory,
          env: launchEnvironment(directory, program),
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
