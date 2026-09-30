import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { Provider } from './providers.ts';

// The official CLIs are the only thing that touches credentials: an account is a CLI folder
// (CLAUDE_CONFIG_DIR / CODEX_HOME), and sign-in state is asked from the CLI itself.

/** Ordinary OS/proxy settings plus the subscription login; never API-key fallbacks. */
export function subscriptionEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDE_AGENT_SDK_|CLAUDE_ENV_FILE$)/i.test(key)
    )
      delete env[key];
  return env;
}
export function codexEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      /^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|CODEX_AUTH_|CODEX_THREAD_ID$|CODEX_INTERNAL_|CODEX_HOME$|CODEX_CONFIG_)/i.test(
        key,
      )
    )
      delete env[key];
  return env;
}
/** The environment for one account folder (undefined = the user's own CLI login). */
export function accountEnvironment(provider: Provider, directory?: string) {
  if (directory !== undefined && (!isAbsolute(directory) || directory.includes('\0')))
    throw new Error('INVALID_PROFILE_DIRECTORY');
  const env = provider === 'codex-cli' ? codexEnvironment() : subscriptionEnvironment();
  if (directory) env[provider === 'codex-cli' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = directory;
  return env;
}

export function killOwnedProcess(child: ChildProcess): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    if (!child.pid) return resolve(false);
    if (process.platform !== 'win32') return resolve(child.kill('SIGTERM'));
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => resolve(false));
    killer.once('exit', (code) => resolve(code === 0));
  });
}

function onPath(name: string) {
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    const file = folder && join(folder, name);
    if (file && existsSync(file)) return file;
  }
  return undefined;
}
function installedCodex() {
  const npm = join(
    process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe',
  );
  if (existsSync(npm)) return npm;
  const directory = join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'OpenAI',
    'Codex',
    'bin',
  );
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9._-]+$/.test(entry.name))
      .slice(0, 200)
      .map((entry) => join(directory, entry.name, 'codex.exe'))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}
/** The CLI program of a service, or undefined when it is not installed. */
export function executable(provider: Provider) {
  if (provider === 'claude-cli') {
    // The native installer's copy, or the one the npm package ships (npm i -g @anthropic-ai/claude-code).
    const native = join(homedir(), '.local', 'bin', 'claude.exe');
    const npm = join(
      process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    );
    return (
      process.env.ACCOUNTSWITCH_CLAUDE_PATH ||
      [native, npm].find((file) => existsSync(file)) ||
      onPath('claude.exe')
    );
  }
  return process.env.ACCOUNTSWITCH_CODEX_PATH || installedCodex() || onPath('codex.exe');
}

export type Status =
  | { available: true; method: 'subscription' }
  | { available: false; reason: string };

/** Ask the CLI whether this account is signed in with a subscription (10 s at most). */
export function status(
  provider: Provider,
  program: string | undefined,
  directory?: string,
  spawnProcess: typeof spawn = spawn,
): Promise<Status> {
  if (!program) return Promise.resolve({ available: false, reason: 'CLI_UNAVAILABLE' });
  const codex = provider === 'codex-cli';
  const child = spawnProcess(
    program,
    codex
      ? ['login', 'status', ...(directory ? ['-c', 'cli_auth_credentials_store="file"'] : [])]
      : ['auth', 'status', '--json'],
    {
      env: accountEnvironment(provider, directory),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return new Promise<Status>((resolve) => {
    let output = '',
      settled = false;
    const finish = (value: Status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      void killOwnedProcess(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish({ available: false, reason: 'AUTH_TIMEOUT' });
    }, 10000);
    const receive = (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString('utf8');
      if (output.length > 65536) {
        void killOwnedProcess(child);
        finish({ available: false, reason: 'AUTH_INVALID' });
      }
    };
    child.stdout?.on('data', receive);
    // Codex prints its status on stderr; Claude's JSON is on stdout only.
    child.stderr?.on('data', codex ? receive : () => {});
    child.once('error', () => finish({ available: false, reason: 'CLI_UNAVAILABLE' }));
    child.once('close', (code) => {
      if (codex)
        return finish(
          code === 0 && /^Logged in using ChatGPT\s*$/m.test(output)
            ? { available: true, method: 'subscription' }
            : { available: false, reason: 'SUBSCRIPTION_LOGIN_REQUIRED' },
        );
      let auth;
      try {
        auth = z
          .object({ loggedIn: z.boolean(), authMethod: z.string().optional() })
          .parse(JSON.parse(output));
      } catch {
        return finish({ available: false, reason: 'AUTH_INVALID' });
      }
      finish(
        code === 0 && auth.loggedIn && auth.authMethod === 'claude.ai'
          ? { available: true, method: 'subscription' }
          : { available: false, reason: 'SUBSCRIPTION_LOGIN_REQUIRED' },
      );
    });
  });
}
