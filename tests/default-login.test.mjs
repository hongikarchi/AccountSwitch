import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
import { DefaultLogin } from '../src/core/default-login.ts';
import { restoreDefaultLogins } from '../src/core/restore.ts';

// Everything runs in a temporary home; the real ~/.claude and ~/.codex are never touched.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-default-login-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const data = join(root, 'profiles');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  const profiles = new AccountProfiles(data, () => false);
  const login = new DefaultLogin({ root: data, home, now: () => 7, lockWaitMs: 400 });
  const select = (provider, id) =>
    profiles.select(provider, id, (from, to) => login.swap(provider, from, to));
  return { root, home, data, profiles, login, select };
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

test('no switch with a keyring store or an unreadable file', (t) => {
  const { home, data, profiles, login } = fixture(t);
  writeFileSync(join(home, '.codex', 'config.toml'), 'cli_auth_credentials_store = "keyring"\n');
  assert.throws(() => login.assertReady('codex-cli'), { code: 'CODEX_KEYRING' });
  writeFileSync(join(home, '.codex', 'config.toml'), 'cli_auth_credentials_store = "file"\n');
  login.assertReady('codex-cli');

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

test("a switch holds Claude Code's own locks: waits for a live one, takes over a stale one", async (t) => {
  const { home, login } = fixture(t);
  const locks = [
    join(home, '.claude', '.oauth_refresh.lock'),
    join(home, '.claude.lock'),
    join(home, '.claude.json.lock'),
  ];
  const release = await login.lock('claude-cli');
  assert.deepEqual(locks.map(existsSync), [true, true, true]);
  release();
  assert.deepEqual(locks.map(existsSync), [false, false, false]);

  // Claude Code is refreshing its token: wait, then give up without touching anything.
  mkdirSync(locks[1]);
  await assert.rejects(login.lock('claude-cli'), { code: 'CLI_LOCK_TIMEOUT' });
  assert.deepEqual(locks.map(existsSync), [false, true, false]);
  // Left by a Claude Code that ended while holding it (older than 60 s): taken over.
  const old = new Date(Date.now() - 120_000);
  utimesSync(locks[1], old, old);
  (await login.lock('claude-cli'))();
  assert.deepEqual(locks.map(existsSync), [false, false, false]);

  // Codex takes no lock.
  (await login.lock('codex-cli'))();
  assert.deepEqual(readdirSync(home).sort(), ['.claude', '.codex']);
});

test('uninstalling gives both CLIs their original logins back and keeps the accounts', async (t) => {
  const { home, data, profiles, select } = fixture(t);
  const credentials = join(home, '.claude', '.credentials.json');
  const auth = join(home, '.codex', 'auth.json');
  put(credentials, { claudeAiOauth: { accessToken: 'mine' } });
  put(join(home, '.claude.json'), { oauthAccount: { accountUuid: 'mine' } });
  put(auth, { tokens: { access_token: 'mine', account_id: 'acct-mine' } });
  const p = profiles.add('claude-cli', 'P');
  const q = profiles.add('codex-cli', 'Q');
  claudeLogin(join(data, p.id), 'p-1', 'p');
  put(join(data, q.id, 'auth.json'), { tokens: { access_token: 'q', account_id: 'acct-q' } });
  select('claude-cli', p.id);
  select('codex-cli', q.id);
  // Used (refreshed) since the switch: that login must go back to P.
  put(credentials, { claudeAiOauth: { accessToken: 'p-2' } });

  const result = await restoreDefaultLogins(data, home);
  assert.deepEqual(result, { restored: ['claude-cli', 'codex-cli'], failed: [] });
  assert.equal(get(credentials).claudeAiOauth.accessToken, 'mine');
  assert.equal(get(auth).tokens.access_token, 'mine');
  assert.equal(get(join(data, p.id, '.credentials.json')).claudeAiOauth.accessToken, 'p-2');
  const after = new AccountProfiles(data, () => false);
  assert.deepEqual(after.list().active, { 'claude-cli': 'default', 'codex-cli': 'default' });
  assert.equal(after.list().profiles.length, 2);
  // Nothing to do the second time, or without any data.
  assert.deepEqual(await restoreDefaultLogins(data, home), { restored: [], failed: [] });
  assert.deepEqual(await restoreDefaultLogins(join(data, 'none'), home), {
    restored: [],
    failed: [],
  });
});
