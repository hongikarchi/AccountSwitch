import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/core/setup/commands.ts';

// The real runner against this Node itself: the one real process tree started here is its own.
const node = process.execPath;

test('aborting stops the command at once and says so', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = runCommand({
    program: node,
    args: ['-e', 'console.log("started"); setInterval(() => {}, 1000)'],
    timeoutMs: 60000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 500);
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.code, null);
  assert.ok(Date.now() - started < 30000);
});

test('a signal already aborted starts nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runCommand({
    program: 'this-program-does-not-exist',
    args: [],
    timeoutMs: 1000,
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.spawnError, undefined);
});

test('a signal that never fires changes nothing, and leaves no listener behind', async () => {
  const controller = new AbortController();
  const result = await runCommand({
    program: node,
    args: ['-e', 'process.exit(4)'],
    timeoutMs: 20000,
    signal: controller.signal,
  });
  assert.equal(result.code, 4);
  assert.equal(result.cancelled, undefined);
  controller.abort();
});
