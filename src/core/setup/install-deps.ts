import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { CheckDeps } from './checks.ts';
import { runCommand } from './commands.ts';
import type { SetupLog } from './install-log.ts';

// What an install needs from the outside world. Everything that can change this PC comes through
// here, so tests hand in fakes, and buildInstallDeps refuses to go on under `node --test` when one
// of the real ones would be used.

/** Same shape as `fetch`; the downloader always asks for `redirect: 'manual'`. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface InstallFiles {
  /**
   * Undefined only when the file does not exist. Any other read error throws: a file that could not
   * be read this moment is not an empty file, and writing on that belief would lose it.
   */
  read: (path: string) => Buffer | undefined;
  /** Replaces the file in one step, creating folders. A symbolic link stays one. */
  write: (path: string, data: Buffer | string) => void;
  copy: (from: string, to: string) => void;
  /** Missing is fine. Can still throw, so a cleanup goes through `cleanUp`. */
  remove: (path: string) => void;
  /** SHA-256 in lower-case hex of the file as it is on disk now. Throws when it cannot be read. */
  hash: (path: string) => Promise<string>;
  save: (
    path: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    maxBytes: number,
  ) => Promise<void>;
  append: (path: string, text: string) => void;
  /** The last bytes of a file; empty when it cannot be read. */
  tail: (path: string, maxBytes: number) => Buffer;
}

export interface InstallDeps {
  /** The same programs, environment and lock the checks use. */
  check: CheckDeps;
  /** The data folder. */
  directory: string;
  fetch: Fetcher;
  files: InstallFiles;
  now: () => Date;
  /** SPEC 3.4: 15 minutes. */
  itemTimeoutMs: number;
  /** SPEC 3.4: after a cancel, how long the current command may go on. */
  cancelGraceMs: number;
  /** SPEC 3.4: when the engine closes, how long the current command may go on. */
  stopGraceMs: number;
}

export type InstallOverrides = Partial<Omit<InstallDeps, 'check' | 'directory'>>;

export const ITEM_TIMEOUT_MS = 15 * 60 * 1000;
export const CANCEL_GRACE_MS = 30 * 1000;
export const STOP_GRACE_MS = 10 * 1000;

/**
 * Ends a step. `fallback`: the next step may still try. Otherwise the item ends here, like a declined
 * elevation prompt (SPEC 3.6).
 */
export class StepStop extends Error {
  status: 'failed' | 'needs-user';
  reason: string;
  userMessage: string;
  fallback: boolean;
  constructor(
    status: 'failed' | 'needs-user',
    reason: string,
    userMessage: string,
    fallback = false,
  ) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.userMessage = userMessage;
    this.fallback = fallback;
  }
}

/**
 * A file left behind is logged and nothing more: after a timeout or a kill the installer can still
 * hold it, and that must not turn the item's real result into something else.
 */
export function cleanUp(files: InstallFiles, log: SetupLog, path: string) {
  try {
    files.remove(path);
  } catch (error) {
    log.line(
      `임시 파일을 지우지 못했어요: ${path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
    );
  }
}

export const realInstallFiles: InstallFiles = {
  read: (path) => {
    try {
      return readFileSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  write: (path, data) => {
    let target = path;
    try {
      target = realpathSync(path);
    } catch {
      // Not there yet.
    }
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, target);
  },
  copy: (from, to) => copyFileSync(from, to),
  // `maxRetries` is ignored without `recursive`. An installer that was just killed can hold its
  // file a moment longer. Only ever given a file this code wrote.
  remove: (path) => rmSync(path, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 }),
  hash: async (path) => {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  },
  save: async (path, body, signal, maxBytes) => {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.part`;
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        done(size > maxBytes ? new Error('DOWNLOAD_TOO_LARGE') : null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(body as WebReadableStream<Uint8Array>),
        limit,
        createWriteStream(temporary),
        { signal },
      );
      renameSync(temporary, path);
    } catch (error) {
      try {
        rmSync(temporary, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Why the download stopped is what counts; the next one replaces this file.
      }
      throw error;
    }
  },
  append: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text);
  },
  tail: (path, maxBytes) => {
    let handle: number | undefined;
    try {
      handle = openSync(path, 'r');
      const { size } = fstatSync(handle);
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      readSync(handle, buffer, 0, length, size - length);
      return buffer;
    } catch {
      return Buffer.alloc(0);
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
  },
};

/** `node --test` sets this in every test process. */
export function underNodeTest(env: NodeJS.ProcessEnv = process.env) {
  return !!env.NODE_TEST_CONTEXT;
}

/**
 * The one place install dependencies are put together. Under `node --test` it throws rather than
 * hand out anything real: no real command runner, no real network, no real home or environment. Real
 * files are allowed there only because every path they get comes from the fake home and environment.
 */
export function buildInstallDeps(
  check: CheckDeps,
  directory: string,
  overrides: InstallOverrides = {},
): InstallDeps {
  if (underNodeTest()) {
    const real = [
      check.run === runCommand && 'run',
      !overrides.fetch && 'fetch',
      check.env === process.env && 'env',
      check.home === homedir() && 'home',
    ].filter(Boolean);
    if (real.length) throw new Error(`REAL_INSTALL_IN_TEST: ${real.join(', ')}`);
  }
  return {
    check,
    directory,
    fetch: (url, init) => globalThis.fetch(url, init),
    files: realInstallFiles,
    now: () => new Date(),
    itemTimeoutMs: ITEM_TIMEOUT_MS,
    cancelGraceMs: CANCEL_GRACE_MS,
    stopGraceMs: STOP_GRACE_MS,
    ...overrides,
  };
}
