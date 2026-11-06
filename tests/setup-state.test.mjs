import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finishSetupState,
  readSetupState,
  recordCheck,
  recordSetupItem,
  setupStateFile,
  shouldAutoOpen,
  writeSetupState,
} from '../src/core/setup/state.ts';

async function withFolder(body) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-state-'));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const AT = '2026-11-06T00:00:00.000Z';

test('the wizard opens by itself only with no state file and no Claude Code, on Windows', () => {
  const open = (platform, stateFileExists, claudeInstalled) =>
    shouldAutoOpen({ platform, stateFileExists, claudeInstalled }).open;
  assert.equal(open('win32', false, false), true);
  assert.equal(open('win32', true, false), false);
  assert.equal(open('win32', false, true), false);
  assert.equal(open('win32', true, true), false);
  assert.equal(open('darwin', false, false), false);
  assert.deepEqual(
    shouldAutoOpen({ platform: 'win32', stateFileExists: true, claudeInstalled: false }),
    { open: false, stateFileExists: true, claudeInstalled: false },
  );
});

test('no file reads as missing, and reading creates nothing', () =>
  withFolder((directory) => {
    assert.deepEqual(readSetupState(directory), { file: 'missing', state: null });
    assert.equal(existsSync(setupStateFile(directory)), false);
  }));

test('a damaged file reads as corrupt, which still counts as existing', () =>
  withFolder((directory) => {
    for (const text of ['{ not json', '{"version":2,"mode":"check","items":{}}', '[]']) {
      writeFileSync(setupStateFile(directory), text);
      assert.deepEqual(readSetupState(directory), { file: 'corrupt', state: null });
    }
  }));

test('what is written reads back, in the format of the spec, with no temporary left', () =>
  withFolder((directory) => {
    const state = {
      version: 1,
      mode: 'auto',
      finishedAt: AT,
      items: { git: { status: 'done', version: '2.56.0', at: AT } },
    };
    writeSetupState(directory, state);
    assert.deepEqual(readSetupState(directory), { file: 'ok', state });
    assert.deepEqual(JSON.parse(readFileSync(setupStateFile(directory), 'utf8')), state);
    assert.deepEqual(readdirSync(directory), ['setup-state.json']);
  }));

test('a state that breaks the format is refused and the old file stays', () =>
  withFolder((directory) => {
    const good = { version: 1, mode: 'check', items: {} };
    writeSetupState(directory, good);
    assert.throws(() => writeSetupState(directory, { version: 1, mode: 'other', items: {} }));
    assert.deepEqual(readSetupState(directory).state, good);
  }));

test('the folder is created when it is not there yet', () =>
  withFolder((directory) => {
    const inner = join(directory, 'new', 'folder');
    writeSetupState(inner, { version: 1, mode: 'check', items: {} });
    assert.equal(readSetupState(inner).file, 'ok');
  }));

test('a run writes after each item, keeps earlier ones, and finishes at the end', () =>
  withFolder((directory) => {
    recordSetupItem(directory, 'auto', 'git', { status: 'done', version: '2', at: AT });
    assert.equal(readSetupState(directory).state.finishedAt, undefined);
    recordSetupItem(directory, 'auto', 'node', { status: 'failed', at: AT });
    assert.deepEqual(Object.keys(readSetupState(directory).state.items), ['git', 'node']);
    finishSetupState(directory, 'auto', AT);
    const { state } = readSetupState(directory);
    assert.equal(state.finishedAt, AT);
    assert.equal(state.mode, 'auto');
    assert.equal(state.items.git.version, '2');
  }));

test('recording a check keeps a result per item, with its version when there is one', () =>
  withFolder((directory) => {
    recordCheck(directory, {
      platform: 'win32',
      supported: true,
      startedAt: AT,
      finishedAt: AT,
      pathSource: 'registry',
      results: [
        { id: 'git', status: 'installed', foundVersion: '2.56.0', pinnedVersion: 'latest' },
        { id: 'uv', status: 'missing', pinnedVersion: 'latest' },
      ],
    });
    assert.deepEqual(readSetupState(directory).state, {
      version: 1,
      mode: 'check',
      finishedAt: AT,
      items: {
        git: { status: 'installed', version: '2.56.0', at: AT },
        uv: { status: 'missing', at: AT },
      },
    });
  }));
