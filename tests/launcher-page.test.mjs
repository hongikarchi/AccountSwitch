import test from 'node:test';
import assert from 'node:assert/strict';
import {
  failureMessage,
  folderName,
  parentFolder,
  shellReplySchema,
  typedFolder,
} from '../src/ui/launcher-logic.ts';

test('a path shows as the folder name and where it lives', () => {
  const cases = [
    ['C:\\작업\\모델링 A', '모델링 A', 'C:\\작업'],
    ['C:\\작업', '작업', 'C:\\'],
    ['C:\\', 'C:\\', ''],
    ['D:/projects/site/', 'site', 'D:/projects'],
  ];
  for (const [path, name, parent] of cases) {
    assert.equal(folderName(path), name, path);
    assert.equal(parentFolder(path), parent, path);
  }
});

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
  const sentences = reasons.map((reason) => failureMessage(reason));
  assert.equal(new Set(sentences).size, reasons.length);
  for (const sentence of sentences) assert.match(sentence, /[가-힣]/);
  const unknown = failureMessage('SOMETHING_NEW');
  assert.doesNotMatch(unknown, /SOMETHING_NEW/);
  assert.equal(failureMessage('constructor'), unknown);
  assert.equal(failureMessage(undefined), unknown);
});

test('a recent folder that went away says so; a typed one asks to check the path', () => {
  assert.match(failureMessage('FOLDER_NOT_FOUND', true), /최근 목록/);
  assert.doesNotMatch(failureMessage('FOLDER_NOT_FOUND', false), /최근 목록/);
  assert.equal(failureMessage('BUSY', true), failureMessage('BUSY', false));
});

test('only the replies the shell can send are understood', () => {
  const good = [
    { type: 'claude.opened', folder: 'C:\\작업' },
    { type: 'claude.cancelled' },
    { type: 'claude.failed', reason: 'BUSY' },
  ];
  for (const reply of good) assert.equal(shellReplySchema.safeParse(reply).success, true);
  const bad = [undefined, 'claude.opened', { type: 'claude.opened' }, { type: 'other' }];
  for (const reply of bad) assert.equal(shellReplySchema.safeParse(reply).success, false);
});
