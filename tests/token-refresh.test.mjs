import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
import { DefaultLogin } from '../src/core/default-login.ts';
import { claudeKeychainService } from '../src/core/keychain.ts';
import { LoginExpired } from '../src/core/token-refresh.ts';

const NOW = Date.parse('2026-10-03T00:00:00Z');
const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const put = (file, value) => writeFileSync(file, JSON.stringify(value));
const get = (file) => JSON.parse(readFileSync(file, 'utf8'));

function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'accountswitch-refresh-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const data = join(root, 'profiles');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  const profiles = new AccountProfiles(data, () => false);
  const login = new DefaultLogin({
    root: data,
    home,
    now: () => NOW,
    lockWaitMs: 400,
    platform: 'win32',
    ...options,
  });
  return { root, home, data, profiles, login };
}
/** A token endpoint that records requests and answers as told. */
function endpoint(answer) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const [status, body] = await answer(url, init);
    return new Response(JSON.stringify(body), { status });
  };
  return { fetcher, requests };
}

test('Claude: an expired login is renewed in its folder, other keys kept, under its locks', async (t) => {
  const { data, profiles, login } = fixture(t);
  const p = profiles.add('claude-cli', 'P');
  const folder = join(data, p.id);
  const file = join(folder, '.credentials.json');
  put(file, {
    claudeAiOauth: {
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: NOW - 1,
      subscriptionType: 'max',
    },
    mcpOAuth: { server: 'keep' },
  });
  let locked;
  const { fetcher, requests } = endpoint(async () => {
    locked = [
      join(folder, '.oauth_refresh.lock'),
      folder + '.lock',
      join(folder, '.claude.json.lock'),
    ].map((path) => existsSync(path));
    return [
      200,
      {
        access_token: 'new',
        refresh_token: 'r2',
        expires_in: 3600,
        scope: 'user:inference user:profile',
      },
    ];
  });
  assert.equal(await login.refresh('claude-cli', folder, fetcher), 'refreshed');
  assert.deepEqual(requests, [
    {
      url: 'https://platform.claude.com/v1/oauth/token',
      body: {
        grant_type: 'refresh_token',
        refresh_token: 'r1',
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      },
    },
  ]);
  // The credential locks, not the settings one, were held during the request; all released after.
  assert.deepEqual(locked, [true, true, false]);
  assert.equal(existsSync(join(folder, '.oauth_refresh.lock')), false);
  assert.equal(existsSync(folder + '.lock'), false);
  assert.deepEqual(get(file), {
    claudeAiOauth: {
      accessToken: 'new',
      refreshToken: 'r2',
      expiresAt: NOW + 3600_000,
      subscriptionType: 'max',
      scopes: ['user:inference', 'user:profile'],
    },
    mcpOAuth: { server: 'keep' },
  });
  // Still valid: nothing is sent.
  assert.equal(await login.refresh('claude-cli', folder, fetcher), 'current');
  assert.equal(requests.length, 1);
});

test('Codex: auth.json gets the new tokens and the refresh time; the account stays', async (t) => {
  const { data, profiles, login } = fixture(t);
  const q = profiles.add('codex-cli', 'Q');
  const file = join(data, q.id, 'auth.json');
  put(file, {
    OPENAI_API_KEY: null,
    tokens: {
      access_token: jwt({ exp: NOW / 1000 - 10 }),
      refresh_token: 'c1',
      id_token: 'id-old',
      account_id: 'acct-q',
    },
    last_refresh: '2026-09-01T00:00:00Z',
  });
  const { fetcher, requests } = endpoint(async () => [
    200,
    { access_token: jwt({ exp: NOW / 1000 + 3600 }), refresh_token: 'c2', id_token: 'id-new' },
  ]);
  assert.equal(await login.refresh('codex-cli', join(data, q.id), fetcher), 'refreshed');
  assert.deepEqual(requests[0], {
    url: 'https://auth.openai.com/oauth/token',
    body: {
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      grant_type: 'refresh_token',
      refresh_token: 'c1',
    },
  });
  const saved = get(file);
  assert.equal(saved.tokens.refresh_token, 'c2');
  assert.equal(saved.tokens.id_token, 'id-new');
  assert.equal(saved.tokens.account_id, 'acct-q');
  assert.equal(saved.OPENAI_API_KEY, null);
  assert.equal(saved.last_refresh, new Date(NOW).toISOString());
});

test('a refused or failed refresh changes nothing; a refused one says to sign in again', async (t) => {
  const { data, profiles, login } = fixture(t);
  const p = profiles.add('claude-cli', 'P');
  const folder = join(data, p.id);
  const before = { claudeAiOauth: { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 } };
  put(join(folder, '.credentials.json'), before);
  for (const [status, body, expected] of [
    [400, { error: 'invalid_grant' }, LoginExpired],
    [403, { error: 'invalid_grant' }, LoginExpired],
    [400, { error: 'invalid_client' }, /HTTP_400/],
    [400, { error: { code: 'refresh_token_reused' } }, LoginExpired],
    [500, { error: 'server_error' }, /HTTP_500/],
    [429, {}, /HTTP_429/],
  ]) {
    const { fetcher } = endpoint(async () => [status, body]);
    await assert.rejects(login.refresh('claude-cli', folder, fetcher), expected);
    assert.deepEqual(get(join(folder, '.credentials.json')), before);
  }
});

test('macOS: the renewed login goes back into the keychain item; a failed save is kept aside', async (t) => {
  const items = new Map();
  let failing = false;
  const keychain = {
    get: (service) => items.get(service),
    set: (service, value) => {
      if (failing) throw new Error('KEYCHAIN_UNAVAILABLE');
      items.set(service, value);
    },
    delete: (service) => items.delete(service),
  };
  const { data, profiles, login } = fixture(t, { platform: 'darwin', keychain });
  const p = profiles.add('claude-cli', 'P');
  const folder = join(data, p.id);
  const service = claudeKeychainService(folder);
  const item = (token, refresh) =>
    JSON.stringify({
      claudeAiOauth: { accessToken: token, refreshToken: refresh, expiresAt: NOW - 1 },
    });
  items.set(service, item('old', 'r1'));
  const first = endpoint(async () => [
    200,
    { access_token: 'new', refresh_token: 'r2', expires_in: 60 },
  ]);
  assert.equal(await login.refresh('claude-cli', folder, first.fetcher), 'refreshed');
  assert.equal(JSON.parse(items.get(service)).claudeAiOauth.refreshToken, 'r2');
  assert.equal(existsSync(join(folder, '.credentials.json')), false);

  // The provider already rotated the token when the save fails: the new login must survive.
  items.set(service, item('new', 'r2'));
  failing = true;
  const second = endpoint(async () => [
    200,
    { access_token: 'newer', refresh_token: 'r3', expires_in: 60 },
  ]);
  await assert.rejects(login.refresh('claude-cli', folder, second.fetcher), /KEYCHAIN_UNAVAILABLE/);
  const rescue = readdirSync(data).find((name) => name.startsWith('refresh-rescue-claude-cli-'));
  assert.equal(get(join(data, rescue)).login.claudeAiOauth.refreshToken, 'r3');
});

test('a switch waits for a refresh of the same service, so the renewed login is what moves', async (t) => {
  const { home, data, profiles, login } = fixture(t);
  const auth = join(home, '.codex', 'auth.json');
  put(auth, {
    tokens: {
      access_token: jwt({ exp: NOW / 1000 + 3600 }),
      refresh_token: 'mine',
      account_id: 'acct-mine',
    },
  });
  const q = profiles.add('codex-cli', 'Q');
  const folder = join(data, q.id);
  put(join(folder, 'auth.json'), {
    tokens: {
      access_token: jwt({ exp: NOW / 1000 - 10 }),
      refresh_token: 'q1',
      account_id: 'acct-q',
    },
  });
  let respond;
  const answer = () =>
    new Promise((resolve) => {
      respond = () =>
        resolve([200, { access_token: jwt({ exp: NOW / 1000 + 3600 }), refresh_token: 'q2' }]);
    });
  const { fetcher } = endpoint(answer);
  const order = [];
  const refreshing = login
    .exclusive('codex-cli', () => login.refresh('codex-cli', folder, fetcher))
    .then(() => order.push('refresh'));
  const switching = login
    .exclusive('codex-cli', async () =>
      profiles.select('codex-cli', q.id, (from, to) => login.swap('codex-cli', from, to)),
    )
    .then(() => order.push('switch'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(order, []);
  respond();
  await Promise.all([refreshing, switching]);
  assert.deepEqual(order, ['refresh', 'switch']);
  assert.equal(get(auth).tokens.refresh_token, 'q2');
});

test('an answer missing fields still keeps the new refresh token (the old one no longer works)', async (t) => {
  const { data, profiles, login } = fixture(t);
  const p = profiles.add('claude-cli', 'P');
  const q = profiles.add('codex-cli', 'Q');
  const claude = join(data, p.id, '.credentials.json');
  const codex = join(data, q.id, 'auth.json');
  put(claude, { claudeAiOauth: { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 } });
  put(codex, {
    tokens: { access_token: jwt({ exp: NOW / 1000 - 10 }), refresh_token: 'c1', account_id: 'a' },
  });
  const odd = endpoint(async () => [200, { refresh_token: 'rotated' }]);
  await login.refresh('claude-cli', join(data, p.id), odd.fetcher);
  await login.refresh('codex-cli', join(data, q.id), odd.fetcher);
  assert.equal(get(claude).claudeAiOauth.refreshToken, 'rotated');
  assert.equal(get(codex).tokens.refresh_token, 'rotated');
});
