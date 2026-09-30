import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
import { AccountUsageService } from '../src/core/account-usage.ts';
import { USAGE_LIMIT } from '../src/core/cli.ts';

const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

async function fixture(t) {
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
    fetch: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      if (url.includes('anthropic'))
        return Response.json({
          five_hour: { utilization: 12, resets_at: '2026-09-29T05:00:00Z' },
          seven_day: { utilization: 40, resets_at: '2026-10-01T00:00:00Z' },
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
  return { service, second, calls, profiles };
}

test('usage lookup is on by default; turned off, accounts show who is signed in with no network call', async (t) => {
  const { service, calls } = await fixture(t);
  assert.equal(service.settings().usageLookup, true);
  service.setSettings({ usageLookup: false });
  const rows = await service.all();
  assert.equal(calls.length, 0);
  assert.deepEqual(
    rows.map((row) => [row.provider, row.email, row.plan, row.state]),
    [
      ['claude-cli', 'a@example.com', 'max', 'off'],
      ['codex-cli', 'one@example.com', 'pro', 'off'],
      ['codex-cli', 'two@example.com', 'plus', 'off'],
    ],
  );
  assert.ok(!JSON.stringify(rows).includes('claude-a'), 'tokens are never returned');
});

test('usage lookup reads each account once per interval and auto-switch picks the most headroom', async (t) => {
  const { service, second, calls } = await fixture(t);
  service.setSettings({ usageLookup: true, autoSwitch: true, threshold: 90 });
  const [claude, one, two] = await service.all();
  assert.deepEqual(claude.session, { percent: 12, resetsAt: '2026-09-29T05:00:00.000Z' });
  assert.equal(claude.weekly.percent, 40);
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
  });
  assert.deepEqual(await service.choose('claude-cli', 'default'), {
    id: 'default',
    switched: false,
  });
  // A request that stopped on the second account's limit makes it skipped too; with nowhere
  // better to go the current account stays.
  service.markLimited('codex-cli', second.id);
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: 'default',
    switched: false,
  });
  service.setSettings({ autoSwitch: false });
  assert.deepEqual(await service.choose('codex-cli', 'default'), {
    id: 'default',
    switched: false,
  });
});

test('subscription limit messages of both CLIs are recognised', () => {
  for (const text of [
    'Claude AI usage limit reached|1791066305',
    "You've hit your usage limit. Upgrade to Pro",
    '5-hour limit reached ∙ resets 3pm',
    'usage_limit_reached',
    'Rate limit exceeded (429)',
  ])
    assert.match(text, USAGE_LIMIT);
  assert.doesNotMatch('Compilation failed: unexpected token', USAGE_LIMIT);
});
