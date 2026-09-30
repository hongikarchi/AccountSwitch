import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
import { DefaultLogin, isCli } from '../src/core/default-login.ts';

// Everything runs in a temporary home; the real ~/.claude and ~/.codex are never touched.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-default-login-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const data = join(root, 'profiles');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  const profiles = new AccountProfiles(data, () => false);
  let running = false;
  const login = new DefaultLogin({ root: data, home, running: async () => running, now: () => 7 });
  const select = (provider, id) =>
    profiles.select(provider, id, (from, to) => login.swap(provider, from, to));
  return { root, home, data, profiles, login, select, setRunning: (value) => (running = value) };
}
const put = (file, value) => writeFileSync(file, JSON.stringify(value));
const get = (file) => JSON.parse(readFileSync(file, 'utf8'));
const claudeLogin = (folder, token, account, extra = {}) => {
  put(join(folder, '.credentials.json'), { claudeAiOauth: { accessToken: token }, ...extra });
  put(join(folder, '.claude.json'), { oauthAccount: { accountUuid: account }, ...extra });
};

test('Claude: a switch moves only the login, and a refreshed login goes back to its owner', (t) => {
  const { home, data, profiles, select } = fixture(t);
  const credentials = join(home, '.claude', '.credentials.json');
  const account = join(home, '.claude.json');
  put(credentials, { claudeAiOauth: { accessToken: 'mine-1' }, mcpOAuth: { server: 'keep' } });
  put(account, {
    oauthAccount: { accountUuid: 'mine' },
    cachedUsageUtilization: 'mine-usage',
    numStartups: 5,
  });
  const p = profiles.add('claude-cli', 'P');
  const q = profiles.add('claude-cli', 'Q');
  claudeLogin(join(data, p.id), 'p-1', 'p', { projects: 'p-own' });
  claudeLogin(join(data, q.id), 'q-1', 'q');

  select('claude-cli', p.id);
  assert.deepEqual(get(credentials), {
    claudeAiOauth: { accessToken: 'p-1' },
    mcpOAuth: { server: 'keep' },
  });
  // Account caches follow the account: P has none, so none stays behind for it.
  assert.deepEqual(get(account), { oauthAccount: { accountUuid: 'p' }, numStartups: 5 });
  assert.equal(
    get(join(data, 'default-claude-cli', '.claude.json')).cachedUsageUtilization,
    'mine-usage',
  );
  assert.equal(
    get(join(data, 'default-claude-cli', '.credentials.json')).claudeAiOauth.accessToken,
    'mine-1',
  );
  assert.equal(profiles.directory('claude-cli', p.id), undefined);

  // The CLI refreshes the installed login; the refreshed one must go back to P, not the old one.
  put(credentials, { claudeAiOauth: { accessToken: 'p-2' }, mcpOAuth: { server: 'keep' } });
  select('claude-cli', q.id);
  assert.equal(get(credentials).claudeAiOauth.accessToken, 'q-1');
  assert.deepEqual(get(join(data, p.id, '.credentials.json')), {
    claudeAiOauth: { accessToken: 'p-2' },
    projects: 'p-own',
  });
  assert.equal(get(join(data, p.id, '.claude.json')).projects, 'p-own');

  select('claude-cli', 'default');
  assert.deepEqual(get(credentials), {
    claudeAiOauth: { accessToken: 'mine-1' },
    mcpOAuth: { server: 'keep' },
  });
  assert.deepEqual(get(account), {
    oauthAccount: { accountUuid: 'mine' },
    cachedUsageUtilization: 'mine-usage',
    numStartups: 5,
  });
  assert.equal(get(join(data, q.id, '.credentials.json')).claudeAiOauth.accessToken, 'q-1');
  // The login found at the first switch is kept as it was.
  assert.deepEqual(get(join(data, 'original-claude-cli', '.credentials.json')), {
    claudeAiOauth: { accessToken: 'mine-1' },
  });
});

test('Codex: auth.json moves whole; a login changed outside the app is set aside', (t) => {
  const { home, data, profiles, select } = fixture(t);
  const auth = join(home, '.codex', 'auth.json');
  const codex = (token) => ({ tokens: { access_token: token, account_id: 'acct-' + token } });
  put(auth, codex('mine'));
  const p = profiles.add('codex-cli', 'P');
  put(join(data, p.id, 'auth.json'), codex('p'));

  select('codex-cli', p.id);
  assert.deepEqual(get(auth), codex('p'));
  assert.deepEqual(get(join(data, 'default-codex-cli', 'auth.json')), codex('mine'));

  // Signed in to another account in the terminal: P's own login must not be overwritten.
  put(auth, codex('other'));
  select('codex-cli', 'default');
  assert.deepEqual(get(auth), codex('mine'));
  assert.deepEqual(get(join(data, p.id, 'auth.json')), codex('p'));
  assert.deepEqual(get(join(data, 'set-aside-codex-cli-7', 'auth.json')), codex('other'));
});

test('no switch while the CLI runs, with a keyring store, or with an unreadable file', async (t) => {
  const { home, data, profiles, login, setRunning } = fixture(t);
  setRunning(true);
  await assert.rejects(login.assertReady('claude-cli'), { code: 'CLI_RUNNING' });
  setRunning(false);
  await login.assertReady('claude-cli');
  writeFileSync(join(home, '.codex', 'config.toml'), 'cli_auth_credentials_store = "keyring"\n');
  await assert.rejects(login.assertReady('codex-cli'), { code: 'CODEX_KEYRING' });
  writeFileSync(join(home, '.codex', 'config.toml'), 'cli_auth_credentials_store = "file"\n');
  await login.assertReady('codex-cli');

  writeFileSync(join(home, '.claude.json'), '{ broken');
  const p = profiles.add('claude-cli', 'P');
  claudeLogin(join(data, p.id), 'p-1', 'p');
  assert.throws(
    () => profiles.select('claude-cli', p.id, (from, to) => login.swap('claude-cli', from, to)),
    { code: 'DEFAULT_LOGIN_UNREADABLE' },
  );
  assert.equal(profiles.selected('claude-cli'), 'default');
  assert.equal(readFileSync(join(home, '.claude.json'), 'utf8'), '{ broken');
  assert.deepEqual(readdirSync(join(home, '.claude')), []);
});

test('the Claude desktop app is not the Claude CLI', () => {
  const store = String.raw`C:\Program Files\WindowsApps\Claude_1.30096.1.0_x64__abc\app\Claude.exe`;
  const squirrel = String.raw`C:\Users\u\AppData\Local\AnthropicClaude\app-1.2.3\claude.exe`;
  const npm = String.raw`C:\Users\u\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`;
  assert.equal(isCli('claude-cli', [store, squirrel]), false);
  assert.equal(isCli('claude-cli', [store, npm]), true);
  assert.equal(isCli('claude-cli', [String.raw`C:\Users\u\.local\bin\claude.exe`]), true);
  // A program whose path cannot be read might be the CLI.
  assert.equal(isCli('claude-cli', ['']), true);
  assert.equal(isCli('claude-cli', []), false);
});
