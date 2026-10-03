import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
import { AccountUsageService } from '../src/core/account-usage.ts';
import { LoginExpired } from '../src/core/token-refresh.ts';

const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'accountswitch-usage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(
    join(home, '.claude', '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'claude-a',
        expiresAt: Date.now() + 3600_000,
        subscriptionType: 'max',
      },
    }),
  );
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com' } }),
  );
  const codexAuth = (token, email, plan) =>
    JSON.stringify({
      tokens: {
        access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600, token }),
        account_id: 'acct-' + token,
        id_token: jwt({ email, 'https://api.openai.com/auth': { chatgpt_plan_type: plan } }),
      },
    });
  await writeFile(join(home, '.codex', 'auth.json'), codexAuth('one', 'one@example.com', 'pro'));
  const profiles = new AccountProfiles(join(root, 'profiles'), () => false);
  const second = profiles.add('codex-cli', 'Second');
  await writeFile(
    join(profiles.directory('codex-cli', second.id), 'auth.json'),
    codexAuth('two', 'two@example.com', 'plus'),
  );
  const calls = [];
  const usage = { one: 95, two: 10 };
  const service = new AccountUsageService({
    profiles,
    file: join(root, 'usage-settings.json'),
    home,
    ...extra,
    fetch: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      if (url.includes('anthropic'))
        return Response.json({
          five_hour: { utilization: 12, resets_at: '2026-09-29T05:00:00Z' },
          seven_day: { utilization: 40, resets_at: '2026-10-01T00:00:00Z' },
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 55,
              resets_at: '2026-10-02T00:00:00Z',
              scope: { model: { display_name: 'Fable' } },
            },
            { kind: 'weekly', percent: 40 },
            'unexpected',
          ],
        });
      const who = JSON.parse(
        Buffer.from(init.headers.Authorization.split(' ')[1].split('.')[1], 'base64url'),
      ).token;
      return Response.json({
        email: who + '@example.com',
        plan_type: who === 'one' ? 'pro' : 'plus',
        rate_limit: {
          limit_reached: false,
          primary_window: {
            used_percent: usage[who],
            limit_window_seconds: 604800,
            reset_at: 1791066305,
          },
          secondary_window: null,
        },
      });
    },
  });
  return { service, second, calls, profiles, usage, home };
}

test('accounts show who is signed in, and tokens are never returned', async (t) => {
  const { service } = await fixture(t);
  // A saved "usage lookup: off" from an earlier version is ignored.
  service.setSettings({ usageLookup: false });
  assert.equal('usageLookup' in service.settings(), false);
  const rows = await service.all();
  assert.deepEqual(
    rows.map((row) => [row.provider, row.email, row.plan, row.state]),
    [
      ['claude-cli', 'a@example.com', 'max', 'ok'],
      ['codex-cli', 'one@example.com', 'pro', 'ok'],
      ['codex-cli', 'two@example.com', 'plus', 'ok'],
    ],
  );
  assert.ok(!JSON.stringify(rows).includes('claude-a'), 'tokens are never returned');
});

test('an expired login is renewed before its usage is looked up; a refused one waits', async (t) => {
  let renewals = 0;
  let answer = 'refreshed';
  let clock = Date.now();
  const credentials = (home, token, expiresAt) =>
    writeFile(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt, subscriptionType: 'max' } }),
    );
  const { service, calls, home } = await fixture(t, {
    now: () => clock,
    refresh: async (provider, id) => {
      renewals++;
      assert.deepEqual([provider, id], ['claude-cli', 'default']);
      if (answer === 'refused') throw new LoginExpired('invalid_grant');
      await credentials(home, 'claude-new', Date.now() + 3600_000);
      return 'refreshed';
    },
  });
  await credentials(home, 'claude-old', Date.now() - 1000);
  const renewed = await service.get('claude-cli', 'default');
  assert.equal(renewed.state, 'ok');
  assert.equal(renewals, 1);
  assert.equal(calls.at(-1).auth, 'Bearer claude-new');

  // Refused (the login itself expired): say so, touch nothing, and do not ask again for an hour.
  await credentials(home, 'claude-dead', Date.now() - 1000);
  answer = 'refused';
  clock += 4 * 60_000;
  const refused = await service.get('claude-cli', 'default', true);
  assert.deepEqual([refused.state, refused.error], ['token-expired', 'LOGIN_EXPIRED']);
  clock += 4 * 60_000;
  await service.get('claude-cli', 'default', true);
  assert.equal(renewals, 2);
});

test('usage lookup reads each account once per interval and auto-switch picks the most headroom', async (t) => {
  const { service, second, calls } = await fixture(t);
  service.setSettings({ autoSwitch: true, threshold: 90 });
  const [claude, one, two] = await service.all();
  assert.deepEqual(claude.session, { percent: 12, resetsAt: '2026-09-29T05:00:00.000Z' });
  assert.equal(claude.weekly.percent, 40);
  // Per-model weekly limits (Fable) from the `limits` list; other entries are skipped.
  assert.deepEqual(claude.models, [
    { name: 'Fable', percent: 55, resetsAt: '2026-10-02T00:00:00.000Z' },
  ]);
  assert.equal(one.weekly.percent, 95);
  assert.equal(two.weekly.percent, 10);
  assert.equal(calls.length, 3);
  await service.all();
  assert.equal(calls.length, 3, 'cached within the interval');
  // The selected ChatGPT account is at 95% (over 90%): the next request goes to the second one.
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: second.id,
    switched: true,
    from: 'default',
    limited: false,
  });
  assert.deepEqual(await service.choose('claude-cli', 'default'), {
    id: 'default',
    switched: false,
  });
  service.setSettings({ autoSwitch: false });
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: 'default',
    switched: false,
  });
});

test('auto-switch never moves to an account within 10 points of the threshold', async (t) => {
  const { service, usage } = await fixture(t);
  usage.two = 85;
  service.setSettings({ autoSwitch: true, threshold: 90 });
  // The ChatGPT account in use is at 95%, the other at 85%: too close to 90% to be worth it.
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: 'default',
    switched: false,
  });
});

test('auto switch never moves to a login the provider refused', async (t) => {
  let clock = Date.now();
  const { service, profiles, second, usage } = await fixture(t, {
    now: () => clock,
    refresh: async () => {
      throw new LoginExpired('invalid_grant');
    },
  });
  service.setSettings({ autoSwitch: true, threshold: 90 });
  await service.all();
  // The second ChatGPT login (10%) expires and cannot be renewed: it keeps its last values.
  await writeFile(
    join(profiles.directory('codex-cli', second.id), 'auth.json'),
    JSON.stringify({
      tokens: {
        access_token: jwt({ exp: Math.floor(Date.now() / 1000) - 60 }),
        account_id: 'acct-two',
        id_token: jwt({ email: 'two@example.com' }),
      },
    }),
  );
  usage.two = 10;
  clock += 4 * 60_000;
  const rows = await service.all();
  const two = rows.find((row) => row.id === second.id);
  assert.deepEqual(
    [two.state, two.error, two.weekly.percent],
    ['token-expired', 'LOGIN_EXPIRED', 10],
  );
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: 'default',
    switched: false,
  });
});
