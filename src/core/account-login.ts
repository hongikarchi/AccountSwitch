import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DomainError } from './errors.ts';
import type { Provider } from './providers.ts';
import { subscriptionEnvironment, codexEnvironment, killOwnedProcess } from './cli.ts';

type State = 'running' | 'stopping' | 'succeeded' | 'failed' | 'cancelled';
/**
 * What the user needs to finish a login in a browser of their choice (address mode): the sign-in
 * address, Codex's one-time code, and whether Claude waits for the code shown after approval.
 * Held in memory only while the login runs; never written to files or logs.
 */
export interface LoginPrompt {
  url?: string;
  code?: string;
  needsCode: boolean;
  codeSent?: boolean;
}
export interface LoginStatus {
  id: string;
  provider: Provider;
  profileId: string;
  state: State;
  startedAt: string;
  operation: 'login' | 'logout';
  /** 'address': the app shows the address to copy; 'browser': the CLI opens the default browser. */
  mode?: 'address' | 'browser';
  expiresAt?: string;
  prompt?: LoginPrompt;
  reason?: string;
}
interface Job {
  status: LoginStatus;
  child: ChildProcess;
  timer: ReturnType<typeof setTimeout>;
  done: Promise<void>;
  stopped?: 'LOGIN_CANCELLED' | 'LOGIN_TIMEOUT';
  deviceDisabled?: boolean;
}
interface Options {
  spawnProcess?: (executable: string, args: string[], options: SpawnOptions) => ChildProcess;
  kill?: (child: ChildProcess) => Promise<boolean>;
  timeoutMs?: number;
  /** Windows folder holding where.exe (the no-op "browser" of address mode); tests override it. */
  systemRoot?: string;
}
// Addresses the app may show: the official sign-in hosts only.
const signInHosts = /^https:\/\/(claude\.com|claude\.ai|platform\.claude\.com|auth\.openai\.com)\//;
// Terminal colours and OSC 8 hyperlinks wrap the printed address.
const plain = (text: string) =>
  text.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
/** Owns only login processes started by this app. Raw CLI output never crosses this boundary. */
export class AccountLogin {
  private jobs = new Map<Provider, Job>();
  private options: Options;
  constructor(options: Options = {}) {
    this.options = options;
  }
  busy(provider: Provider) {
    const state = this.jobs.get(provider)?.status.state;
    return state === 'running' || state === 'stopping';
  }
  list() {
    return [...this.jobs.values()].map((job) => ({
      ...job.status,
      ...(job.status.prompt ? { prompt: { ...job.status.prompt } } : {}),
    }));
  }
  start(input: {
    provider: Provider;
    profileId: string;
    directory: string;
    executable: string;
    verify: () => Promise<{ available: boolean; reason?: string }>;
    operation?: 'login' | 'logout';
    /** true: the CLI opens the default browser (the earlier way). Default: address mode. */
    browser?: boolean;
  }) {
    if (this.busy(input.provider)) throw new DomainError('PROFILE_LOGIN_IN_PROGRESS');
    const codex = input.provider === 'codex-cli';
    const logout = input.operation === 'logout';
    const address = !logout && !input.browser;
    const env = codex ? codexEnvironment() : subscriptionEnvironment();
    env[codex ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = input.directory;
    // Claude opens the program named by BROWSER instead of the default browser; a harmless one
    // keeps any browser from opening and Claude prints the address to finish elsewhere.
    if (address && !codex)
      env.BROWSER =
        (this.options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows') +
        '\\System32\\where.exe';
    const child = (this.options.spawnProcess ?? spawn)(
      input.executable,
      codex
        ? [
            logout ? 'logout' : 'login',
            // Device code: an address and a one-time code for any browser; no browser opens.
            ...(address ? ['--device-auth'] : []),
            '-c',
            'cli_auth_credentials_store="file"',
            '-c',
            'forced_login_method="chatgpt"',
          ]
        : logout
          ? ['auth', 'logout']
          : ['auth', 'login', '--claudeai'],
      {
        env,
        shell: false,
        windowsHide: true,
        // Claude reads the code shown after approval from its input.
        stdio: [address && !codex ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      },
    );
    // Only the sign-in address and one-time code are taken from the output (in memory, while
    // running); everything else is dropped unread.
    let seen = '';
    const read = (chunk: Buffer | string) => {
      if (logout || seen.length > 16384) return;
      seen += plain(String(chunk));
      const prompt = job.status.prompt;
      if (!prompt || job.status.state !== 'running') return;
      const url = seen
        .match(/https:\/\/[^\s"'<>\x07\x1b]+/g)
        ?.find((item) => signInHosts.test(item));
      if (url && !prompt.url) prompt.url = url;
      if (codex && address && !prompt.code)
        prompt.code = seen.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
      if (codex && /device code login is not enabled/i.test(seen)) job.deviceDisabled = true;
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    let resolve!: () => void;
    const done = new Promise<void>((finish) => {
      resolve = finish;
    });
    // Signing in may wait for an email link, so a login gets ten minutes.
    const timeout = this.options.timeoutMs ?? 600000;
    const job: Job = {
      status: {
        id: randomUUID(),
        provider: input.provider,
        profileId: input.profileId,
        state: 'running',
        startedAt: new Date().toISOString(),
        operation: input.operation ?? 'login',
        ...(logout
          ? {}
          : {
              mode: address ? ('address' as const) : ('browser' as const),
              expiresAt: new Date(Date.now() + timeout).toISOString(),
              prompt: { needsCode: address && !codex },
            }),
      },
      child,
      done,
      timer: setTimeout(() => this.stop(input.provider, 'LOGIN_TIMEOUT'), timeout),
    };
    this.jobs.set(input.provider, job);
    let finishing = false;
    const finish = async (code: number | null) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(job.timer);
      let authenticated = false;
      if (code === 0 && !job.stopped) {
        try {
          const status = await input.verify();
          authenticated = logout
            ? !status.available && status.reason === 'SUBSCRIPTION_LOGIN_REQUIRED'
            : status.available;
        } catch {
          authenticated = false;
        }
      }
      job.status.state = job.stopped
        ? job.stopped === 'LOGIN_CANCELLED'
          ? 'cancelled'
          : 'failed'
        : authenticated
          ? 'succeeded'
          : 'failed';
      job.status.reason =
        job.stopped ??
        (authenticated ? undefined : job.deviceDisabled ? 'DEVICE_LOGIN_DISABLED' : 'LOGIN_FAILED');
      // The address and code are useless (and sensitive) once the login has ended.
      delete job.status.prompt;
      child.stdin?.destroy();
      resolve();
    };
    child.once('error', () => {
      void finish(null);
    });
    child.once('close', (code) => {
      void finish(code);
    });
    return this.list().find((row) => row.provider === input.provider)!;
  }
  private stop(provider: Provider, reason: 'LOGIN_CANCELLED' | 'LOGIN_TIMEOUT') {
    const job = this.jobs.get(provider);
    if (!job || !this.busy(provider)) return;
    job.stopped ??= reason;
    job.status.state = 'stopping';
    clearTimeout(job.timer);
    void (this.options.kill ?? killOwnedProcess)(job.child).catch(() => false);
  }
  /** Give Claude the code shown in the browser after approval (address mode). */
  submitCode(provider: Provider, code: string) {
    const job = this.jobs.get(provider);
    const value = code.trim();
    if (!job || job.status.state !== 'running' || !job.status.prompt?.needsCode || !job.child.stdin)
      throw new DomainError('LOGIN_NOT_WAITING');
    if (!/^[\x21-\x7e]{4,2048}$/.test(value)) throw new DomainError('INVALID_INPUT');
    job.child.stdin.write(value + '\n');
    job.status.prompt.codeSent = true;
    return { ...job.status, prompt: { ...job.status.prompt } };
  }
  cancel(provider: Provider) {
    this.stop(provider, 'LOGIN_CANCELLED');
    return this.list();
  }
  async close() {
    const active = [...this.jobs.values()].filter((job) => this.busy(job.status.provider));
    for (const job of active) this.stop(job.status.provider, 'LOGIN_CANCELLED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(active.map((job) => job.done)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('LOGIN_TERMINATION_UNCONFIRMED')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
