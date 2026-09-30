import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  renameSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountProfiles } from '../src/core/account-profiles.ts';
const swaps = [];
const swap = (from, to) => swaps.push([from, to]);
test('profile metadata persists, provider identities stay separate and a switch moves the login', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-profiles-'));
  let busy = true;
  try {
    const profiles = new AccountProfiles(root, () => busy);
    const a = profiles.add('codex-cli', 'Personal');
    const b = profiles.add('claude-cli', 'Claude');
    assert.throws(() => profiles.directory('codex-cli', b.id), /NOT_FOUND/);
    assert.throws(() => profiles.directory('codex-cli', '../outside'), /NOT_FOUND/);
    swaps.length = 0;
    assert.throws(() => profiles.select('codex-cli', a.id, swap), { code: 'PROFILE_IN_USE' });
    assert.equal(swaps.length, 0);
    busy = false;
    profiles.select('codex-cli', a.id, swap);
    assert.deepEqual(swaps, [[join(root, 'default-codex-cli'), join(root, a.id)]]);
    profiles.select('codex-cli', a.id, swap);
    assert.equal(swaps.length, 1);
    const restored = new AccountProfiles(root, () => false);
    assert.equal(restored.selected('codex-cli'), a.id);
    // The active login is the default one; the original one rests in its own folder.
    assert.equal(restored.directory('codex-cli', a.id), undefined);
    assert.equal(restored.directory('codex-cli', 'default'), join(root, 'default-codex-cli'));
    assert.equal(restored.directory('claude-cli', 'default'), undefined);
    assert.equal(restored.directory('claude-cli', b.id), join(root, b.id));
    assert.equal(readFileSync(join(root, 'profiles.json'), 'utf8').includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed swap keeps the choice, and a version 1 choice goes back to the default login', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-profiles-v1-'));
  try {
    const profiles = new AccountProfiles(root, () => false);
    const a = profiles.add('claude-cli', 'A');
    assert.throws(() =>
      profiles.select('claude-cli', a.id, () => {
        throw new Error('DEFAULT_LOGIN_LOCKED');
      }),
    );
    assert.equal(profiles.selected('claude-cli'), 'default');
    const file = join(root, 'profiles.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      file,
      JSON.stringify({
        ...data,
        version: 1,
        active: { 'claude-cli': a.id, 'codex-cli': 'default' },
        pending: { 'claude-cli': null, 'codex-cli': null },
      }),
    );
    const migrated = new AccountProfiles(root, () => false);
    assert.equal(migrated.selected('claude-cli'), 'default');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.version, 2);
    assert.equal('pending' in saved, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removal cleans only an idle managed profile and persists default selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-remove-profile-'));
  let busy = false;
  try {
    const profiles = new AccountProfiles(root, () => busy);
    const row = profiles.add('codex-cli', 'Remove');
    const keep = profiles.add('claude-cli', 'Keep');
    const directory = profiles.directory('codex-cli', row.id);
    mkdirSync(join(directory, 'history'));
    writeFileSync(join(directory, 'history', 'synthetic.txt'), 'test');
    profiles.select('codex-cli', row.id, swap);
    assert.throws(() => profiles.remove('codex-cli', row.id), { code: 'PROFILE_ACTIVE' });
    profiles.select('codex-cli', 'default', swap);
    busy = true;
    assert.throws(() => profiles.remove('codex-cli', row.id), { code: 'PROFILE_IN_USE' });
    assert.equal(existsSync(directory), true);
    busy = false;
    assert.throws(() => profiles.remove('codex-cli', 'default'), { code: 'PROFILE_NOT_FOUND' });
    assert.throws(() => profiles.remove('codex-cli', keep.id), { code: 'PROFILE_NOT_FOUND' });
    profiles.remove('codex-cli', row.id);
    assert.equal(existsSync(directory), false);
    const restored = new AccountProfiles(root, () => false);
    assert.equal(restored.selected('codex-cli'), 'default');
    assert.deepEqual(
      restored.list().profiles.map((p) => p.id),
      [keep.id],
    );
    assert.equal(existsSync(restored.directory('claude-cli', keep.id)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removal refuses nested junctions before deleting any profile content', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-remove-junction-'));
  try {
    const profiles = new AccountProfiles(join(root, 'profiles'), () => false);
    const row = profiles.add('codex-cli', 'Nested');
    const directory = profiles.directory('codex-cli', row.id);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'untouched');
    symlinkSync(
      outside,
      join(directory, 'nested'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => profiles.remove('codex-cli', row.id), { code: 'PROFILE_PATH_INVALID' });
    assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'untouched');
    assert.equal(profiles.list().profiles.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed profile rejects junction redirection and malformed metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-profile-path-'));
  try {
    const profiles = new AccountProfiles(join(root, 'profiles'), () => false);
    const row = profiles.add('codex-cli', 'Test');
    const target = profiles.directory('codex-cli', row.id);
    renameSync(target, target + '-original');
    mkdirSync(join(root, 'outside'));
    symlinkSync(join(root, 'outside'), target, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => profiles.directory('codex-cli', row.id), /PROFILE_PATH_INVALID/);
    writeFileSync(join(root, 'profiles', 'profiles.json'), '{}');
    assert.throws(() => new AccountProfiles(join(root, 'profiles'), () => false));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accounts can be renamed, including the existing CLI login, even while busy', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-profiles-'));
  try {
    const profiles = new AccountProfiles(root, () => true);
    const work = profiles.add('claude-cli', 'Claude 2');
    // Renaming changes only the shown name; it never touches logins or running work.
    assert.equal(
      profiles.rename('claude-cli', work.id, ' 회사 Claude ').profiles[0].label,
      '회사 Claude',
    );
    assert.equal(
      profiles.rename('claude-cli', 'default', '개인 Claude').defaultLabels['claude-cli'],
      '개인 Claude',
    );
    assert.equal(profiles.list().defaultLabels['codex-cli'], undefined);
    const restored = new AccountProfiles(root, () => false);
    assert.equal(restored.list().defaultLabels['claude-cli'], '개인 Claude');
    assert.equal(restored.list().profiles[0].label, '회사 Claude');
    // An empty name gives the default login its standard name back; a profile needs a name.
    assert.equal(
      restored.rename('claude-cli', 'default', '').defaultLabels['claude-cli'],
      undefined,
    );
    assert.throws(() => restored.rename('claude-cli', work.id, '  '), /INVALID_INPUT/);
    assert.throws(() => restored.rename('codex-cli', work.id, 'x'), /NOT_FOUND/);
    assert.throws(() => restored.rename('claude-cli', 'default', 'x'.repeat(81)), /INVALID_INPUT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accounts keep the order they were given; a removed one leaves it', () => {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-order-'));
  try {
    const profiles = new AccountProfiles(root, () => false);
    const a = profiles.add('claude-cli', 'A');
    const b = profiles.add('claude-cli', 'B');
    const other = profiles.add('codex-cli', 'Other');
    profiles.reorder('claude-cli', [b.id, 'default', a.id]);
    for (const wrong of [
      [b.id, a.id],
      [b.id, 'default', a.id, a.id],
      [b.id, 'default', other.id],
    ])
      assert.throws(() => profiles.reorder('claude-cli', wrong), { code: 'INVALID_INPUT' });
    const restored = new AccountProfiles(root, () => false);
    assert.deepEqual(restored.list().order, { 'claude-cli': [b.id, 'default', a.id] });
    restored.remove('claude-cli', b.id);
    assert.deepEqual(restored.list().order, { 'claude-cli': ['default', a.id] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
