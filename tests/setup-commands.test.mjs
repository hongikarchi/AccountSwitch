import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, shimCommandLine } from '../src/core/setup/commands.ts';

// The real runner against this Node itself, so nothing depends on what the PC has installed.
const node = process.execPath;

test('a command that exits gives its code and output', async () => {
  const result = await runCommand({
    program: node,
    args: ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
    timeoutMs: 20000,
  });
  assert.equal(result.code, 3);
  assert.equal(result.stdout.trim(), 'out');
  assert.equal(result.stderr.trim(), 'err');
  assert.equal(result.timedOut, false);
});

test('a hanging command is killed at its timeout and never hangs the caller', async () => {
  const started = Date.now();
  const result = await runCommand({
    program: node,
    args: ['-e', 'console.log("started"); setInterval(() => {}, 1000)'],
    timeoutMs: 1500,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
  assert.ok(Date.now() - started < 10000);
});

test('a grandchild that keeps the output open does not hold the answer back', async () => {
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', windowsHide: true });
    child.unref();
    process.exit(0);`;
  const started = Date.now();
  const result = await runCommand({ program: node, args: ['-e', script], timeoutMs: 20000 });
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.ok(Date.now() - started < 7000);
});

test('a program that is not there says so instead of throwing', async () => {
  const result = await runCommand({
    program: join(tmpdir(), 'accountswitch-no-such-program.exe'),
    args: [],
    timeoutMs: 5000,
  });
  assert.equal(result.spawnError, 'ENOENT');
  assert.equal(result.code, null);
});

test('huge output is capped', async () => {
  const result = await runCommand({
    program: node,
    args: ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'],
    timeoutMs: 20000,
  });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.length < 1024 * 1024);
});

test('shim command lines quote the path, and anything cmd could read differently is refused', () => {
  assert.deepEqual(shimCommandLine('C:\\Program Files\\a&b\\x.cmd', ['--version', '-3.13']), [
    '/d',
    '/s',
    '/c',
    '""C:\\Program Files\\a&b\\x.cmd" --version -3.13"',
  ]);
  assert.deepEqual(shimCommandLine('C:\\x.cmd', []), ['/d', '/s', '/c', '""C:\\x.cmd""']);
  assert.equal(shimCommandLine('C:\\%TEMP%\\x.cmd', []), undefined);
  assert.equal(shimCommandLine('C:\\a!b\\x.cmd', []), undefined);
  assert.equal(shimCommandLine('C:\\x".cmd', []), undefined);
  for (const bad of ['a&b', 'a|b', 'a b', '"a"', '%PATH%', '^a', '>a'])
    assert.equal(shimCommandLine('C:\\x.cmd', [bad]), undefined, bad);
});

test(
  'a .cmd runs through cmd safely, also in a folder with spaces, & and Korean',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'accountswitch-shim-'));
    try {
      const folder = join(root, 'a b&c 한글');
      await mkdir(folder);
      const shim = join(folder, 'tool.cmd');
      await writeFile(shim, '@echo off\r\necho version 1.2.3 %1\r\nexit /b 4\r\n');
      const result = await runCommand({ program: shim, args: ['--version'], timeoutMs: 20000 });
      assert.equal(result.spawnError, undefined);
      assert.equal(result.code, 4);
      assert.equal(result.stdout.trim(), 'version 1.2.3 --version');
      const refused = await runCommand({ program: shim, args: ['a&calc'], timeoutMs: 20000 });
      assert.equal(refused.spawnError, 'UNSAFE_SHIM');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
