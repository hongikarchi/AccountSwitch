import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AccountLogin } from '../src/core/account-login.ts';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(options = {}) {
  const children = [],
    calls = [];
  let kills = 0;
  const login = new AccountLogin({
    spawnProcess: (file, args, settings) => {
      calls.push({ file, args, settings });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = settings.stdio?.[0] === 'pipe' ? new PassThrough() : null;
      children.push(child);
      return child;
    },
    kill: async () => {
      kills++;
      return true;
    },
    ...options,
  });
  const input = {
    provider: 'codex-cli',
    profileId: 'second',
    directory: 'C:/synthetic/profile',
    executable: 'codex.exe',
    verify: async () => ({ available: true }),
  };
  return { login, input, calls, children, kills: () => kills };
}
test('official login keeps its lease until exit and auth verification, discarding raw output', async () => {
  const { login, input, calls, children } = fixture();
  let verify;
  login.start({
    ...input,
    verify: () =>
      new Promise((resolve) => {
        verify = resolve;
      }),
  });
  assert.equal(calls[0].settings.env.CODEX_HOME, input.directory);
  assert.equal(calls[0].settings.shell, false);
  assert.ok(calls[0].args.includes('cli_auth_credentials_store="file"'));
  children[0].stdout.write('SENSITIVE_TEST_OUTPUT');
  assert.equal(JSON.stringify(login.list()).includes('SENSITIVE_TEST_OUTPUT'), false);
  assert.throws(() => login.start(input), { code: 'PROFILE_LOGIN_IN_PROGRESS' });
  children[0].emit('close', 0);
  assert.equal(login.busy('codex-cli'), true);
  verify({ available: true });
  await tick();
  assert.equal(login.list()[0].state, 'succeeded');
  assert.equal(login.busy('codex-cli'), false);
  await login.close();
});
for (const mode of ['cancel', 'timeout', 'failure', 'auth-failure'])
  test('login ' + mode + ' never selects an account or releases before process exit', async () => {
    const { login, input, children, kills } = fixture({
      timeoutMs: mode === 'timeout' ? 5 : 300000,
    });
    login.start({ ...input, verify: async () => ({ available: mode !== 'auth-failure' }) });
    if (mode === 'cancel') login.cancel('codex-cli');
    if (mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 20));
    if (['cancel', 'timeout'].includes(mode)) {
      assert.equal(login.list()[0].state, 'stopping');
      assert.equal(login.busy('codex-cli'), true);
      assert.equal(kills(), 1);
    }
    children[0].emit('close', mode === 'failure' ? 1 : 0);
    await tick();
    assert.equal(login.list()[0].state, mode === 'cancel' ? 'cancelled' : 'failed');
    assert.equal(login.busy('codex-cli'), false);
    await login.close();
  });
test('server close waits for its login process, while providers have separate leases', async () => {
  const { login, input, children, kills } = fixture();
  login.start(input);
  login.start({ ...input, provider: 'claude-cli' });
  let done = false;
  const closing = login.close().then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false);
  assert.equal(kills(), 2);
  for (const child of children) child.emit('close', null);
  await closing;
  assert.equal(done, true);
});

for (const provider of ['codex-cli', 'claude-cli'])
  for (const reason of ['SUBSCRIPTION_LOGIN_REQUIRED', 'AUTH_TIMEOUT', 'CLI_UNAVAILABLE'])
    test(`official ${provider} logout requires confirmed unauthenticated status: ${reason}`, async () => {
      const { login, input, calls, children } = fixture();
      let complete;
      const status = login.start({
        ...input,
        provider,
        operation: 'logout',
        verify: () => new Promise((resolve) => (complete = resolve)),
      });
      assert.equal(status.operation, 'logout');
      assert.equal(
        calls[0].settings.env[provider === 'codex-cli' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'],
        input.directory,
      );
      assert.ok(calls[0].args.includes('logout'));
      assert.equal(calls[0].args.includes('--claudeai'), false);
      children[0].emit('close', 0);
      assert.equal(login.busy(provider), true);
      complete({ available: false, reason });
      await tick();
      assert.equal(
        login.list()[0].state,
        reason === 'SUBSCRIPTION_LOGIN_REQUIRED' ? 'succeeded' : 'failed',
      );
      await login.close();
    });

test('Codex address mode shows the device link and one-time code, and nothing else', async () => {
  const { login, input, calls, children } = fixture();
  login.start(input);
  assert.ok(calls[0].args.includes('--device-auth'));
  children[0].stdout.write(
    '\x1b[1mWelcome\x1b[0m SENSITIVE_TEST_OUTPUT\n1. Open this link\n   https://auth.openai.com/codex/device\n',
  );
  children[0].stdout.write('2. Enter this one-time code\n   ABCD-12345\n');
  await tick();
  const [status] = login.list();
  assert.equal(status.mode, 'address');
  assert.deepEqual(status.prompt, {
    url: 'https://auth.openai.com/codex/device',
    code: 'ABCD-12345',
    needsCode: false,
  });
  assert.equal(JSON.stringify(status).includes('SENSITIVE_TEST_OUTPUT'), false);
  assert.ok(Date.parse(status.expiresAt) - Date.parse(status.startedAt) >= 599000);
  assert.throws(() => login.submitCode('codex-cli', 'x-1234'), { code: 'LOGIN_NOT_WAITING' });
  children[0].emit('close', 0);
  await tick();
  // The address and code are gone once the login ends.
  assert.equal(login.list()[0].state, 'succeeded');
  assert.equal(login.list()[0].prompt, undefined);
});

test('Claude address mode opens no browser, shows the address and passes the pasted code', async () => {
  const { login, input, calls, children } = fixture({ systemRoot: 'C:\\Win' });
  login.start({ ...input, provider: 'claude-cli' });
  assert.equal(
    calls[0].settings.env.BROWSER,
    process.platform === 'win32' ? 'C:\\Win\\System32\\where.exe' : '/usr/bin/true',
  );
  assert.equal(calls[0].settings.stdio[0], 'pipe');
  const written = [];
  children[0].stdin.on('data', (chunk) => written.push(String(chunk)));
  // The address arrives wrapped in a terminal hyperlink; a foreign address is never shown.
  children[0].stdout.write('see https://evil.example/login\n');
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s';
  children[0].stdout.write(
    `If the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\nPaste code here if prompted > `,
  );
  await tick();
  assert.equal(login.list()[0].prompt.url, url);
  assert.equal(login.list()[0].prompt.needsCode, true);
  assert.throws(() => login.submitCode('claude-cli', 'has space'), { code: 'INVALID_INPUT' });
  assert.equal(login.submitCode('claude-cli', '  abcDEF123#state  ').prompt.codeSent, true);
  await tick();
  assert.deepEqual(written, ['abcDEF123#state\n']);
  children[0].emit('close', 0);
  await tick();
  assert.equal(login.list()[0].prompt, undefined);
});

test('browser mode is the earlier way; a closed device login says so', async () => {
  const { login, input, calls, children } = fixture();
  login.start({ ...input, provider: 'claude-cli', browser: true });
  assert.equal(calls[0].settings.env.BROWSER, undefined);
  assert.equal(calls[0].settings.stdio[0], 'ignore');
  assert.equal(login.list()[0].mode, 'browser');
  children[0].emit('close', 0);
  await tick();
  login.start({ ...input, verify: async () => ({ available: false }) });
  children[1].stderr.write('device code login is not enabled for this Codex server.');
  await tick();
  children[1].emit('close', 1);
  await tick();
  const codex = login.list().find((row) => row.provider === 'codex-cli');
  assert.equal(codex.reason, 'DEVICE_LOGIN_DISABLED');
  await login.close();
});
