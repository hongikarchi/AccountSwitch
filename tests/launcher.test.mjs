import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LAUNCH_ARGUMENTS,
  Launcher,
  codexPackageRoot,
  commandProcessor,
  folderProblem,
  launchEnvironment,
  launchTitle,
} from '../src/core/launcher.ts';

const windowsOnly = { skip: process.platform !== 'win32' };
// Every character a Windows folder may have that cmd treats specially, with Korean and a space.
const HOSTILE = "한글 폴더 A & echo INJECTED ^ %PATH% %^X% !USERNAME! (x) ';=,";

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-launcher-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const folder = (name) => {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  return { root, folder };
}

/** A spawn that opens nothing and records its call; `exit` is what the hidden cmd reports. */
function fakeSpawn(exit = 0) {
  const calls = [];
  const fake = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() =>
      exit === 'error' ? child.emit('error', new Error('ENOENT')) : child.emit('exit', exit),
    );
    return child;
  };
  fake.calls = calls;
  return fake;
}

test('folders: only an existing local folder is accepted', windowsOnly, (t) => {
  const { root, folder } = workspace(t);
  const file = join(root, 'a-file.txt');
  writeFileSync(file, '');
  assert.equal(folderProblem(folder('ok')), undefined);
  assert.equal(folderProblem(folder(HOSTILE)), undefined);
  assert.equal(folderProblem(join(root, 'nothing')), 'FOLDER_NOT_FOUND');
  assert.equal(folderProblem(file), 'FOLDER_NOT_FOUND');
  assert.equal(folderProblem('\\\\server\\share'), 'FOLDER_NETWORK');
  assert.equal(folderProblem('//server/share'), 'FOLDER_NETWORK');
  assert.equal(folderProblem('\\\\?\\C:\\Windows'), 'FOLDER_NETWORK');
  for (const bad of [
    '',
    'relative\\path',
    'C:relative',
    '\\Windows',
    'C:\\a"b',
    'C:\\a|b',
    'C:\\a<b',
    'C:\\a?',
    'C:\\a*',
    'C:\\file.txt:stream',
    'C:\\a\nb',
    'C:\\a\0b',
  ])
    assert.equal(folderProblem(bad), 'FOLDER_INVALID', JSON.stringify(bad));
});

test('the window title is the folder name; a drive root has only its path', () => {
  assert.equal(launchTitle('C:\\work\\내 프로젝트 & 2'), 'Claude Code - 내 프로젝트 & 2');
  assert.equal(launchTitle('C:\\'), 'Claude Code - C:\\');
  assert.equal(launchTitle('C:\\work\\site', 'codex-cli'), 'Codex - site');
});

test('the terminal cannot inherit an account folder, a key or another session', () => {
  const env = launchEnvironment('C:\\work', 'C:\\bin\\claude.exe', {
    PATH: 'C:\\bin',
    SystemRoot: 'D:\\Win',
    comspec: 'C:\\planted\\cmd.exe',
    CLAUDE_CONFIG_DIR: 'C:\\profiles\\one',
    claude_config_dir: 'C:\\profiles\\two',
    ANTHROPIC_API_KEY: 'x',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
  });
  assert.deepEqual(env, {
    PATH: 'C:\\bin',
    SystemRoot: 'D:\\Win',
    ComSpec: 'D:\\Win\\System32\\cmd.exe',
    ACCOUNTSWITCH_LAUNCH_TITLE: 'Claude Code - work',
    ACCOUNTSWITCH_LAUNCH_PROGRAM: 'C:\\bin\\claude.exe',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  });
});

test('the Codex terminal cannot inherit an API key, an account folder or another session', () => {
  const env = launchEnvironment(
    'C:\\work',
    'C:\\bin\\codex.exe',
    {
      PATH: 'C:\\bin',
      SystemRoot: 'D:\\Win',
      OPENAI_API_KEY: 'x',
      openai_base_url: 'x',
      CODEX_API_KEY: 'x',
      CODEX_HOME: 'C:\\profiles\\one',
      CODEX_THREAD_ID: 'x',
      CLAUDECODE: '1',
    },
    'codex-cli',
  );
  assert.deepEqual(env, {
    PATH: 'C:\\bin',
    SystemRoot: 'D:\\Win',
    ComSpec: 'D:\\Win\\System32\\cmd.exe',
    ACCOUNTSWITCH_LAUNCH_TITLE: 'Codex - work',
    ACCOUNTSWITCH_LAUNCH_PROGRAM: 'C:\\bin\\codex.exe',
  });
});

test('Codex from its npm package gets what npm wrapper script would set', () => {
  const root = 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex';
  const program = root + '\\node_modules\\@openai\\codex-win32-x64\\vendor\\bin\\codex.exe';
  assert.equal(codexPackageRoot(program), root);
  assert.equal(codexPackageRoot('C:\\bin\\codex.exe'), undefined);
  const env = launchEnvironment('C:\\work', program, {}, 'codex-cli');
  assert.equal(env.CODEX_MANAGED_BY_NPM, '1');
  assert.equal(env.CODEX_MANAGED_PACKAGE_ROOT, root);
});

test('the folder and the program never appear on the command line', windowsOnly, async (t) => {
  const { folder, root } = workspace(t);
  const claude = join(folder('bin & co'), 'claude.exe');
  writeFileSync(claude, '');
  const fake = fakeSpawn();
  const launcher = new Launcher({ spawnProcess: fake, program: () => claude });
  const target = folder(HOSTILE);
  assert.deepEqual(await launcher.open('claude-cli', target + '\\'), { folder: target });
  assert.equal(fake.calls.length, 1);
  const { command, args, options } = fake.calls[0];
  assert.equal(command, commandProcessor());
  assert.deepEqual(args, [LAUNCH_ARGUMENTS]);
  assert.ok(!LAUNCH_ARGUMENTS.includes(root));
  assert.equal(options.cwd, target);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.env.ACCOUNTSWITCH_LAUNCH_PROGRAM, claude);
  assert.equal(options.env.ACCOUNTSWITCH_LAUNCH_TITLE, launchTitle(target));
  assert.equal(options.env.ComSpec, commandProcessor());
  assert.equal(options.env.CLAUDE_CONFIG_DIR, undefined);
});

test('each button opens its own program', windowsOnly, async (t) => {
  const { folder, root } = workspace(t);
  const programs = { 'claude-cli': join(root, 'claude.exe'), 'codex-cli': join(root, 'codex.exe') };
  for (const file of Object.values(programs)) writeFileSync(file, '');
  const fake = fakeSpawn();
  const launcher = new Launcher({ spawnProcess: fake, program: (p) => programs[p] });
  const target = folder('p');
  await launcher.open('codex-cli', target);
  await launcher.open('claude-cli', target);
  const [codex, claude] = fake.calls.map((call) => call.options.env);
  assert.equal(codex.ACCOUNTSWITCH_LAUNCH_PROGRAM, programs['codex-cli']);
  assert.equal(codex.ACCOUNTSWITCH_LAUNCH_TITLE, 'Codex - p');
  assert.equal(codex.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, undefined);
  assert.equal(claude.ACCOUNTSWITCH_LAUNCH_PROGRAM, programs['claude-cli']);
  assert.equal(claude.ACCOUNTSWITCH_LAUNCH_TITLE, 'Claude Code - p');
});

test('open: refused before anything starts', async (t) => {
  const { root, folder } = workspace(t);
  const claude = join(root, 'claude.exe');
  writeFileSync(claude, '');
  const fake = fakeSpawn();
  const open = (target, program = () => claude, platform = 'win32') =>
    new Launcher({ spawnProcess: fake, program, platform }).open('claude-cli', target);
  await assert.rejects(open(folder('a'), undefined, 'darwin'), { code: 'UNSUPPORTED_PLATFORM' });
  await assert.rejects(open(join(root, 'nothing')), { code: 'FOLDER_NOT_FOUND' });
  await assert.rejects(
    open(folder('b'), () => undefined),
    { code: 'CLI_UNAVAILABLE' },
  );
  await assert.rejects(
    open(folder('c'), () => join(root, 'not-there.exe')),
    { code: 'CLI_UNAVAILABLE' },
  );
  await assert.rejects(
    open(folder('d'), () => claude + '"'),
    { code: 'CLI_UNAVAILABLE' },
  );
  assert.equal(fake.calls.length, 0);
});

test('open: a start that fails is reported', windowsOnly, async (t) => {
  const { root, folder } = workspace(t);
  const claude = join(root, 'claude.exe');
  writeFileSync(claude, '');
  for (const exit of [1, 'error']) {
    const launcher = new Launcher({ spawnProcess: fakeSpawn(exit), program: () => claude });
    await assert.rejects(launcher.open('claude-cli', folder('p')), { code: 'LAUNCH_FAILED' });
  }
  const throwing = () => {
    throw new Error('bad argument');
  };
  const launcher = new Launcher({ spawnProcess: throwing, program: () => claude });
  await assert.rejects(launcher.open('claude-cli', folder('p')), { code: 'LAUNCH_FAILED' });
});

test('status: whether each CLI resolves, for the disabled buttons', () => {
  const here = (program) => new Launcher({ program, platform: 'win32' }).status();
  assert.deepEqual(
    here((p) => (p === 'claude-cli' ? 'claude.exe' : undefined)),
    { platform: 'win32', installed: { 'claude-cli': true, 'codex-cli': false } },
  );
});

// The real cmd, in a hidden console, through the same fixed command line. `start /B` is the only
// difference: it stays in that console, so no window can open. A copy of hostname.exe plays
// Claude Code, in a folder with every special character, and /K ends when its input runs out.
test(
  'real cmd: nothing in the names is parsed, and it runs in the folder',
  windowsOnly,
  async (t) => {
    const { folder } = workspace(t);
    const target = folder(HOSTILE);
    const claude = join(folder(HOSTILE + ' bin'), 'claude.exe');
    copyFileSync(join(process.env.SystemRoot, 'System32', 'hostname.exe'), claude);
    const hidden = LAUNCH_ARGUMENTS.replace('"start "', '"start /B "');
    assert.notEqual(hidden, LAUNCH_ARGUMENTS);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(commandProcessor(), [hidden], {
        cwd: target,
        env: launchEnvironment(target, claude),
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      // cmd writes the ANSI code page; the assertions read only the ASCII part.
      child.stdout.on('data', (data) => (text += data.toString('latin1')));
      child.stderr.on('data', (data) => (text += data.toString('latin1')));
      child.once('error', reject);
      child.once('close', () => resolve(text));
    });
    const name = await new Promise((resolve, reject) => {
      const child = spawn('hostname.exe', {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let text = '';
      child.stdout.on('data', (data) => (text += data));
      child.once('error', reject);
      child.once('close', () => resolve(text.trim()));
    });
    const lines = output.split(/\r?\n/);
    assert.ok(lines.includes(name), 'the program ran: ' + output);
    // /K kept cmd open at a prompt showing the folder, with %PATH% and !USERNAME! left as written.
    assert.ok(
      output.trimEnd().endsWith("A & echo INJECTED ^ %PATH% %^X% !USERNAME! (x) ';=,>"),
      'the prompt: ' + output,
    );
    assert.ok(!lines.some((line) => line.trim().startsWith('INJECTED')), 'nothing ran: ' + output);
  },
);
