import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoSwitch } from '../src/core/auto-switch.ts';
import { DomainError } from '../src/core/errors.ts';

// Usage and accounts are stand-ins: what matters here is when a switch happens.
function fixture({ settings = { autoSwitch: true, usageLookup: true }, fail } = {}) {
  let now = 0;
  const active = { 'claude-cli': 'default', 'codex-cli': 'default' };
  const choices = { 'claude-cli': undefined, 'codex-cli': undefined };
  const switches = [];
  const auto = new AutoSwitch({
    usage: {
      settings: () => settings,
      choose: async (provider, current) => choices[provider] ?? { id: current, switched: false },
    },
    profiles: { selected: (provider) => active[provider] },
    switchTo: async (provider, id) => {
      if (fail) throw new DomainError(fail);
      switches.push([provider, id]);
      active[provider] = id;
    },
    now: () => now,
  });
  return { auto, choices, switches, active, advance: (ms) => (now += ms) };
}

test('auto switch moves an account at the threshold, then waits ten minutes', async () => {
  const { auto, choices, switches, advance } = fixture();
  assert.deepEqual(await auto.tick(), []);
  choices['claude-cli'] = { id: 'b', switched: true, from: 'default', limited: false };
  const [made] = await auto.tick();
  assert.deepEqual(made, { provider: 'claude-cli', from: 'default', to: 'b', at: made.at });
  assert.deepEqual(auto.last, made);
  // B soon reaches the threshold too: no ping-pong within the cooldown...
  choices['claude-cli'] = { id: 'default', switched: true, from: 'b', limited: false };
  advance(5 * 60_000);
  assert.deepEqual(await auto.tick(), []);
  // ...unless B cannot be used at all.
  choices['claude-cli'] = { id: 'default', switched: true, from: 'b', limited: true };
  assert.equal((await auto.tick()).length, 1);
  advance(11 * 60_000);
  choices['claude-cli'] = { id: 'b', switched: true, from: 'default', limited: false };
  assert.equal((await auto.tick()).length, 1);
  assert.deepEqual(switches, [
    ['claude-cli', 'b'],
    ['claude-cli', 'default'],
    ['claude-cli', 'b'],
  ]);
});

test('auto switch needs both switches on, and reports a switch that failed', async () => {
  const off = fixture({ settings: { autoSwitch: true, usageLookup: false } });
  off.choices['codex-cli'] = { id: 'b', switched: true, from: 'default', limited: true };
  assert.deepEqual(await off.auto.tick(), []);
  assert.deepEqual(off.switches, []);

  const failing = fixture({ fail: 'CLI_LOCK_TIMEOUT' });
  failing.choices['codex-cli'] = { id: 'b', switched: true, from: 'default', limited: false };
  assert.deepEqual(await failing.auto.tick(), []);
  assert.equal(failing.auto.failure.code, 'CLI_LOCK_TIMEOUT');
  assert.equal(failing.auto.failure.provider, 'codex-cli');
  assert.equal(failing.active['codex-cli'], 'default');
  // Usage went back under the threshold: the failure is no longer shown.
  failing.choices['codex-cli'] = undefined;
  await failing.auto.tick();
  assert.equal(failing.auto.failure, undefined);
});
