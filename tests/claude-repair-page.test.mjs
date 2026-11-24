// SPEC 3.10: how the 계정 tab's 고치기 reads the setup run it started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPAIR_BUSY,
  REPAIR_FAILED,
  REPAIR_REQUEST,
  repairOutcome,
  startFailure,
} from '../src/ui/claude-repair-logic.ts';

const run = (phase, status) => ({
  phase,
  mode: 'auto',
  cancelling: false,
  startedAt: '2026-11-24T02:00:00.000Z',
  items: [{ id: 'claude', status }],
});

test('고치기 asks for the claude item only, in auto mode', () => {
  assert.deepEqual(REPAIR_REQUEST, { items: ['claude'], mode: 'auto' });
});

test('a run still on its way is followed, a done item is fixed', () => {
  assert.equal(repairOutcome(run('running', 'pending')), 'running');
  assert.equal(repairOutcome(run('running', 'running')), 'running');
  assert.equal(repairOutcome(run('finished', 'done')), 'done');
  // The item can be done a moment before the run says finished.
  assert.equal(repairOutcome(run('running', 'done')), 'done');
});

test('every other end is a failure, the 설치 tab shows the rest', () => {
  assert.equal(repairOutcome(run('waiting', 'failed')), 'failed');
  assert.equal(repairOutcome(run('cancelled', 'skipped')), 'failed');
  assert.equal(repairOutcome(run('finished', 'needs-user')), 'failed');
  // A run that stopped before the item began will not go on.
  assert.equal(repairOutcome(run('cancelled', 'pending')), 'failed');
  // The engine restarted, or the run is another one.
  assert.equal(repairOutcome(null), 'failed');
  assert.equal(
    repairOutcome({ ...run('running', 'running'), items: [{ id: 'git', status: 'running' }] }),
    'failed',
  );
});

test('a run already going in the 설치 tab gets its own sentence', () => {
  assert.equal(
    startFailure(Object.assign(new Error('x'), { code: 'SETUP_RUN_ACTIVE' })),
    REPAIR_BUSY,
  );
  assert.equal(
    startFailure(Object.assign(new Error('x'), { code: 'UNSUPPORTED_PLATFORM' })),
    REPAIR_FAILED,
  );
  assert.equal(startFailure(new Error('network')), REPAIR_FAILED);
  assert.equal(startFailure(undefined), REPAIR_FAILED);
});
