import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAsset, isSea } from 'node:sea';
import { z } from 'zod';
import { AccountProfiles } from '../core/account-profiles.ts';
import { AccountLogin } from '../core/account-login.ts';
import { AccountUsageService } from '../core/account-usage.ts';
import { DomainError } from '../core/errors.ts';
import { providers } from '../core/providers.ts';
import { executable, status } from '../core/cli.ts';
import { DefaultLogin } from '../core/default-login.ts';
import { AutoSwitch } from '../core/auto-switch.ts';

// A local web app on 127.0.0.1 only. The page gets a session cookie from the one-time token in
// its launch link (#token); every API call needs that cookie and, for writes, this origin.

/**
 * A file of the built page: embedded in the executable when installed (asset "ui/<path>"),
 * else read from dist/ui. Undefined when there is no such file.
 */
async function webFile(pathname: string) {
  const name = pathname === '/' ? 'index.html' : pathname;
  if (isSea()) {
    const key = posix.normalize(name).replace(/^\/+/, '');
    if (key.split('/').includes('..')) return undefined;
    try {
      return Buffer.from(getAsset('ui/' + key));
    } catch {
      return undefined;
    }
  }
  // Worked out only here: a bundled executable has no module address.
  const web = fileURLToPath(new URL('../../dist/ui/', import.meta.url));
  const path = normalize(join(web, name));
  if (!path.startsWith(normalize(web))) return undefined;
  return readFile(path).catch(() => undefined);
}
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  JSON_REQUIRED: 400,
  INPUT_TOO_LARGE: 413,
};
const provider = z.enum(providers);
const equal = (a: unknown, b: string) =>
  typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function body(request: IncomingMessage) {
  if (!String(request.headers['content-type']).startsWith('application/json'))
    throw new DomainError('JSON_REQUIRED');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new DomainError('INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('INVALID_INPUT');
  }
}

export interface Options {
  /** Where account folders and settings live. */
  directory: string;
  port?: number;
}

export async function startServer({ directory, port = 0 }: Options) {
  const accountLogin = new AccountLogin();
  const profiles = new AccountProfiles(join(directory, 'profiles'), (p) => accountLogin.busy(p));
  const accountUsage = new AccountUsageService({
    profiles,
    file: join(directory, 'profiles', 'usage-settings.json'),
  });
  const defaultLogin = new DefaultLogin({ root: join(directory, 'profiles') });
  const bootstrap = randomBytes(32).toString('base64url');
  const session = randomBytes(32).toString('base64url');
  let authority = '';
  const accountStatus = (p: z.infer<typeof provider>, id: string) =>
    status(p, executable(p), profiles.directory(p, id));
  /**
   * Make an account the login of the terminal and VS Code (the 사용 button and auto switch), also
   * while the CLI runs (see DefaultLogin.lock).
   */
  const switchTo = async (p: z.infer<typeof provider>, id: string) => {
    if (accountLogin.busy(p)) throw new DomainError('PROFILE_LOGIN_IN_PROGRESS');
    if (profiles.selected(p) === id) return;
    if (!(await accountStatus(p, id)).available)
      throw new DomainError('SUBSCRIPTION_LOGIN_REQUIRED');
    defaultLogin.assertReady(p);
    const release = await defaultLogin.lock(p);
    try {
      profiles.select(p, id, (from, to) => defaultLogin.swap(p, from, to));
    } finally {
      release();
    }
  };
  const autoSwitch = new AutoSwitch({ usage: accountUsage, profiles, switchTo });
  autoSwitch.start();
  /** An added account's own folder, to sign in or out; the active one's login is the default. */
  const ownFolder = (p: z.infer<typeof provider>, id: string) => {
    if (id === 'default') throw new DomainError('INVALID_INPUT');
    const folder = profiles.directory(p, id);
    if (!folder) throw new DomainError('PROFILE_ACTIVE');
    return folder;
  };

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const send = (code: number, data: unknown) => {
      response.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(data));
    };
    try {
      // Only this address, never another site's page (DNS rebinding, cross-site requests).
      if (request.headers.host !== authority) throw new DomainError('FORBIDDEN');
      const origin = 'http://' + authority;
      if (request.headers.origin && request.headers.origin !== origin)
        throw new DomainError('FORBIDDEN');
      const url = new URL(request.url || '/', origin);
      if (!url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET') throw new DomainError('NOT_FOUND');
        const path = url.pathname === '/' ? 'index.html' : url.pathname;
        const file = await webFile(url.pathname);
        if (!file) throw new DomainError('NOT_FOUND');
        response.writeHead(200, {
          'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          ...(path.endsWith('.html')
            ? {
                'Content-Security-Policy':
                  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
              }
            : {}),
        });
        response.end(file);
        return;
      }
      if (request.method !== 'GET' && request.headers.origin !== origin)
        throw new DomainError('FORBIDDEN');
      if (url.pathname === '/api/v1/session' && request.method === 'POST') {
        const input = await body(request);
        if (!equal(input?.token, bootstrap)) throw new DomainError('UNAUTHORIZED');
        response.setHeader(
          'Set-Cookie',
          `accountswitch_${url.port}=${session}; HttpOnly; SameSite=Strict; Path=/`,
        );
        send(200, { authenticated: true });
        return;
      }
      const cookie = request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`accountswitch_${url.port}=`))
        ?.split('=')[1];
      if (!equal(cookie, session)) throw new DomainError('UNAUTHORIZED');

      if (url.pathname === '/api/v1/accounts' && request.method === 'GET') {
        send(200, profiles.list());
        return;
      }
      if (url.pathname === '/api/v1/accounts' && request.method === 'POST') {
        const input = z
          .object({ provider, label: z.string() })
          .strict()
          .parse(await body(request));
        send(201, profiles.add(input.provider, input.label));
        return;
      }
      // Per-account sign-in, usage and reset times; the usage settings.
      if (url.pathname === '/api/v1/accounts/usage' && request.method === 'GET') {
        send(200, {
          settings: accountUsage.settings(),
          accounts: await accountUsage.all(url.searchParams.get('refresh') === '1'),
          autoSwitch: { last: autoSwitch.last, failure: autoSwitch.failure },
        });
        return;
      }
      if (url.pathname === '/api/v1/accounts/usage-settings' && request.method === 'POST') {
        const input = z
          .object({
            usageLookup: z.boolean().optional(),
            autoSwitch: z.boolean().optional(),
            threshold: z.number().int().min(50).max(100).optional(),
          })
          .strict()
          .parse(await body(request));
        const settings = accountUsage.setSettings(input);
        // Turned on or retuned: check now instead of within the minute.
        if (settings.autoSwitch) void autoSwitch.tick().catch(() => {});
        send(200, { settings });
        return;
      }
      if (url.pathname === '/api/v1/accounts/remove' && request.method === 'POST') {
        const input = z
          .object({ provider, id: z.string().uuid(), deleteLocalData: z.literal(true) })
          .strict()
          .parse(await body(request));
        profiles.assertIdle(input.provider);
        ownFolder(input.provider, input.id);
        const now = await accountStatus(input.provider, input.id);
        if (now.available || now.reason !== 'SUBSCRIPTION_LOGIN_REQUIRED')
          throw new DomainError('PROFILE_LOGOUT_REQUIRED');
        send(200, profiles.remove(input.provider, input.id));
        return;
      }
      if (url.pathname === '/api/v1/accounts/order' && request.method === 'POST') {
        const input = z
          .object({ provider, ids: z.array(z.string()).max(31) })
          .strict()
          .parse(await body(request));
        send(200, profiles.reorder(input.provider, input.ids));
        return;
      }
      if (url.pathname === '/api/v1/accounts/rename' && request.method === 'POST') {
        const input = z
          .object({ provider, id: z.string(), label: z.string().max(80) })
          .strict()
          .parse(await body(request));
        send(200, profiles.rename(input.provider, input.id, input.label));
        return;
      }
      if (url.pathname === '/api/v1/accounts/select' && request.method === 'POST') {
        const input = z
          .object({ provider, id: z.string() })
          .strict()
          .parse(await body(request));
        await switchTo(input.provider, input.id);
        send(200, profiles.list());
        return;
      }
      if (url.pathname === '/api/v1/accounts/login-command' && request.method === 'POST') {
        const input = z
          .object({ provider, id: z.string() })
          .strict()
          .parse(await body(request));
        profiles.assertIdle(input.provider);
        const folder = ownFolder(input.provider, input.id);
        const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
        const key = input.provider === 'codex-cli' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
        send(200, {
          command: `$env:${key}=${quote(folder)}; & ${quote(executable(input.provider) ?? '')} ${input.provider === 'codex-cli' ? 'login -c \'cli_auth_credentials_store="file"\' -c \'forced_login_method="chatgpt"\'' : 'auth login --claudeai'}`,
        });
        return;
      }
      if (url.pathname === '/api/v1/accounts/login' && request.method === 'GET') {
        send(200, accountLogin.list());
        return;
      }
      if (url.pathname === '/api/v1/accounts/login/code' && request.method === 'POST') {
        const input = z
          .object({ provider, code: z.string().max(2048) })
          .strict()
          .parse(await body(request));
        send(200, accountLogin.submitCode(input.provider, input.code));
        return;
      }
      if (
        ['/api/v1/accounts/login', '/api/v1/accounts/logout'].includes(url.pathname) &&
        request.method === 'POST'
      ) {
        const input = z
          .object({ provider, id: z.string(), browser: z.boolean().optional() })
          .strict()
          .parse(await body(request));
        profiles.assertIdle(input.provider);
        const folder = ownFolder(input.provider, input.id);
        const program = executable(input.provider);
        if (!program) throw new DomainError('CLI_UNAVAILABLE');
        send(
          202,
          accountLogin.start({
            operation: url.pathname.endsWith('/logout') ? 'logout' : 'login',
            provider: input.provider,
            profileId: input.id,
            directory: folder,
            executable: program,
            browser: input.browser,
            verify: () => accountStatus(input.provider, input.id),
          }),
        );
        return;
      }
      if (url.pathname === '/api/v1/accounts/login/cancel' && request.method === 'POST') {
        const input = z
          .object({ provider })
          .strict()
          .parse(await body(request));
        send(200, accountLogin.cancel(input.provider));
        return;
      }
      if (url.pathname === '/api/v1/providers' && request.method === 'GET') {
        send(
          200,
          await Promise.all(
            providers.map(async (p) => ({
              id: p,
              installed: !!executable(p),
              ...(await status(p, executable(p))),
            })),
          ),
        );
        return;
      }
      throw new DomainError('NOT_FOUND');
    } catch (error) {
      if (error instanceof DomainError) send(STATUS[error.code] ?? 409, { code: error.code });
      else if (error instanceof z.ZodError) send(400, { code: 'INVALID_INPUT' });
      else {
        console.error(error);
        send(500, { code: 'INTERNAL_ERROR' });
      }
    }
  }

  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_ADDRESS');
  authority = `127.0.0.1:${address.port}`;
  return {
    url: `http://${authority}/`,
    /** The link that signs the page in; open it once. */
    launchUrl: `http://${authority}/#${bootstrap}`,
    close: async () => {
      autoSwitch.stop();
      await accountLogin.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
