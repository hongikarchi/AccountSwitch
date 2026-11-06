import { join } from 'node:path';
import type { CommandResult } from './commands.ts';
import type { InstallFiles } from './install-deps.ts';

// logs\setup-YYYY-MM-DD.log in the data folder (SPEC 3.4). Never a token and never an environment
// dump: the environment is not logged at all, and everything written passes through redactLog.

const MAX_OUTPUT_LOGGED = 16 * 1024;
const MAX_LOG_ANSWER = 64 * 1024;

const pad = (value: number) => String(value).padStart(2, '0');

export function logFile(directory: string, now: Date) {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return join(directory, 'logs', `setup-${day}.log`);
}

const SECRET_NAMES = 'token|secret|password|passwd|api[_-]?key|authorization|credential|cookie';

/** Remove what must never reach a log file. Text only; it does not know where it came from. */
export function redactLog(text: string) {
  return (
    text
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '***')
      .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}/g, '***')
      .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '***')
      .replace(
        new RegExp(
          `(["']?[\\w-]*(?:${SECRET_NAMES})[\\w-]*["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|\\S+)`,
          'gi',
        ),
        '$1***',
      )
      // A line that reads NAME=value is how an environment dump looks.
      .replace(/^(\s*[A-Za-z_][\w()]*=).*$/gm, '$1***')
  );
}

/** One line for a command. A value given with `-e` may be anyone's, so only its name is kept. */
export function describeCommand(program: string, args: string[]) {
  const shown = args.map((arg, index) =>
    index > 0 && ['-e', '--env'].includes(args[index - 1]) ? arg.replace(/=.*$/s, '=***') : arg,
  );
  return redactLog([program, ...shown].join(' ')).replace(/\n/g, ' ');
}

export class SetupLog {
  private files: InstallFiles;
  private directory: string;
  private now: () => Date;

  constructor(files: InstallFiles, directory: string, now: () => Date) {
    this.files = files;
    this.directory = directory;
    this.now = now;
  }

  line(text: string) {
    const now = this.now();
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    try {
      this.files.append(logFile(this.directory, now), `[${stamp}] ${redactLog(text).trimEnd()}\n`);
    } catch {
      // A log that cannot be written never stops an install.
    }
  }

  /** `quiet`: only how it ended. For commands whose output can hold env values (`claude mcp`). */
  result(result: CommandResult, { quiet = false }: { quiet?: boolean } = {}) {
    const ended = result.spawnError
      ? `시작하지 못함: ${result.spawnError}`
      : result.cancelled
        ? '취소로 중단됨'
        : result.timedOut
          ? '시간 초과로 중단됨'
          : `종료 코드 ${result.code}`;
    this.line(ended);
    if (quiet) return;
    for (const output of [result.stdout, result.stderr]) {
      const text = output.trim();
      if (text) this.line(text.length > MAX_OUTPUT_LOGGED ? text.slice(-MAX_OUTPUT_LOGGED) : text);
    }
  }
}

/** The end of today's log, cut where a character starts. */
export function readLogTail(files: InstallFiles, directory: string, now: Date) {
  const bytes = files.tail(logFile(directory, now), MAX_LOG_ANSWER);
  let start = 0;
  // UTF-8 continuation bytes are 10xxxxxx.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
