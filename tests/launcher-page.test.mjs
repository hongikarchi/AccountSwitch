import test from 'node:test';
import assert from 'node:assert/strict';
import {
  failureMessage,
  shellReplySchema,
  statusSchema,
  typedFolder,
} from '../src/ui/launcher-logic.ts';
import { showsSession, windowLabel } from '../src/ui/usage-logic.ts';

test('a typed path loses the spaces and quotes that copying leaves around it', () => {
  assert.equal(typedFolder('  "C:\\작업\\모델링"  '), 'C:\\작업\\모델링');
  assert.equal(typedFolder('C:\\작업 폴더'), 'C:\\작업 폴더');
  assert.equal(typedFolder('   '), '');
  assert.equal(typedFolder('""'), '');
});

test('every reason of SPEC 4 has its own plain sentence, and nothing unknown leaks through', () => {
  const reasons = [
    'CLI_UNAVAILABLE',
    'FOLDER_NOT_FOUND',
    'FOLDER_INVALID',
    'FOLDER_NETWORK',
    'LAUNCH_FAILED',
    'UNSUPPORTED_PLATFORM',
    'DIALOG_FAILED',
    'BUSY',
  ];
  const sentences = reasons.map((reason) => failureMessage(reason, 'claude-cli'));
  assert.equal(new Set(sentences).size, reasons.length);
  for (const sentence of sentences) assert.match(sentence, /[가-힣]/);
  const unknown = failureMessage('SOMETHING_NEW', 'claude-cli');
  assert.doesNotMatch(unknown, /SOMETHING_NEW/);
  assert.equal(failureMessage('constructor', 'claude-cli'), unknown);
  assert.equal(failureMessage(undefined, 'claude-cli'), unknown);
});

test('a failure names the program of the button that was pressed', () => {
  for (const reason of ['CLI_UNAVAILABLE', 'LAUNCH_FAILED', 'SOMETHING_NEW']) {
    assert.match(failureMessage(reason, 'claude-cli'), /Claude Code/);
    assert.match(failureMessage(reason, 'codex-cli'), /Codex CLI/);
  }
  assert.equal(failureMessage('BUSY', 'claude-cli'), failureMessage('BUSY', 'codex-cli'));
});

test('only the failure the shell can send is understood', () => {
  const good = { type: 'launcher.failed', provider: 'codex-cli', reason: 'BUSY' };
  assert.equal(shellReplySchema.safeParse(good).success, true);
  const bad = [
    undefined,
    'launcher.failed',
    { type: 'launcher.failed', reason: 'BUSY' },
    { type: 'launcher.failed', provider: 'other', reason: 'BUSY' },
    { type: 'other', provider: 'codex-cli', reason: 'BUSY' },
  ];
  for (const reply of bad) assert.equal(shellReplySchema.safeParse(reply).success, false);
});

test('the status says for each service whether its button can open', () => {
  const good = { platform: 'win32', installed: { 'claude-cli': true, 'codex-cli': false } };
  assert.equal(statusSchema.parse(good).installed['codex-cli'], false);
  assert.equal(statusSchema.safeParse({ platform: 'win32', installed: true }).success, false);
});

test('a usage line is named by the length the service reports', () => {
  assert.equal(windowLabel({ windowSeconds: 18000 }), '5시간');
  assert.equal(windowLabel({ windowSeconds: 604800 }), '7일');
  assert.equal(windowLabel({ windowSeconds: 1800 }), '30분');
  assert.equal(windowLabel({}), '한도');
  assert.equal(windowLabel(undefined), '한도');
});

test('ChatGPT with only a weekly window has no empty line above it', () => {
  const shows = (provider, session, weekly) => showsSession({ provider, session, weekly });
  assert.equal(shows('codex-cli', undefined, { percent: 75 }), false);
  assert.equal(shows('codex-cli', { percent: 8 }, { percent: 75 }), true);
  // No answer yet, so nothing says the window does not exist.
  assert.equal(shows('codex-cli', undefined, undefined), true);
  assert.equal(shows('claude-cli', undefined, { percent: 75 }), true);
});
