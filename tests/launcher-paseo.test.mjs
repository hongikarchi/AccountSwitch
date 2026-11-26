import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIRST_MESSAGE,
  PaseoLauncher,
  agentLink,
  agentTitle,
  desktopEnvironment,
  paseoEnvironment,
  paseoJson,
} from '../src/core/launcher-paseo.ts';

// SPEC 4.1. Paseo's CLI is a fake here: no agent is ever made by these tests.

const windowsOnly = { skip: process.platform !== 'win32' };
const PROGRAM = 'C:\\Program Files\\Paseo\\Paseo.exe';
const fakeCli = (args) => ({
  program: PROGRAM,
  args: ['runner', 'cli', ...args],
  env: { ELECTRON_RUN_AS_NODE: '1', PASEO_NODE_ENV: 'production' },
});

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'accountswitch-paseo-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return root;
}

/** A fake Paseo answering by subcommand; `answers[key]` is the stdout, or a function of the call. */
function fakePaseo(answers) {
  const calls = [];
  const run = async (request) => {
    const args = request.args.slice(2);
    calls.push({ ...request, args });
    const key = args
      .filter((a) => !a.startsWith('-'))
      .slice(0, 2)
      .join(' ');
    const answer = answers[key] ?? answers[args[0]];
    const stdout = typeof answer === 'function' ? answer(args, calls) : (answer ?? '');
    return { code: 0, stdout, stderr: '', timedOut: false };
  };
  return { run, calls };
}

const PROVIDERS = JSON.stringify([
  { provider: 'claude', status: 'available' },
  { provider: 'codex', status: 'unavailable' },
]);
const CLAUDE_MODELS = JSON.stringify([
  { model: 'Opus 5.5', id: 'claude-opus-5-5' },
  { model: 'Haiku 5.5', id: 'claude-haiku-5-5' },
  { model: 'Odd', id: 'bad id; rm' },
]);

test('the CLI runs without the marks of a Paseo agent the engine was started from', () => {
  const env = paseoEnvironment(
    {
      PATH: 'x',
      PASEO_AGENT_ID: 'a',
      PASEO_AGENT_CWD: 'b',
      PASEO_WORKSPACE_ID: 'c',
      PASEO_CLI: 'd',
      PASEO_DESKTOP_CLI: '1',
      PASEO_HOME: 'h',
    },
    { ELECTRON_RUN_AS_NODE: '1' },
  );
  assert.deepEqual(env, { PATH: 'x', PASEO_HOME: 'h', ELECTRON_RUN_AS_NODE: '1' });
  const desktop = desktopEnvironment({
    PATH: 'x',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    PASEO_NODE_ENV: 'production',
    PASEO_AGENT_ID: 'a',
  });
  assert.deepEqual(desktop, { PATH: 'x' });
});

test('answers are read from their first JSON, past the lines Paseo prints before it', () => {
  assert.deepEqual(paseoJson('Created workspace w - x\nTip: y\n{"agentId":"a"}'), {
    agentId: 'a',
  });
  assert.deepEqual(paseoJson('[1]'), [1]);
  assert.equal(paseoJson('no json'), undefined);
  assert.equal(paseoJson('{broken'), undefined);
});

test('the link and the title', () => {
  assert.equal(agentLink('srv_A', 'id-1'), 'paseo://h/srv_A/agent/id-1');
  assert.equal(agentLink('a/b', 'c d'), 'paseo://h/a%2Fb/agent/c%20d');
  assert.equal(agentTitle('C:\\작업\\내 프로젝트 & 2'), '관제탑 - 내 프로젝트 & 2');
  assert.equal(agentTitle('D:\\'), '관제탑 - D:\\');
});

test('models: from Paseo, only available services, kept a while, choice saved', async (t) => {
  const root = scratch(t);
  const file = join(root, 'launcher.json');
  let now = 0;
  const paseo = fakePaseo({ 'provider ls': PROVIDERS, 'provider models': CLAUDE_MODELS });
  const launcher = new PaseoLauncher({ file, run: paseo.run, cli: () => fakeCli, now: () => now });
  const first = await launcher.models();
  assert.deepEqual(first['claude-cli'], {
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    ],
    chosen: 'claude-opus-5-5',
  });
  assert.deepEqual(first['codex-cli'], { models: [], chosen: null });
  assert.equal(paseo.calls.length, 2);
  for (const call of paseo.calls) {
    assert.equal(call.program, PROGRAM);
    assert.equal(call.env.ELECTRON_RUN_AS_NODE, '1');
  }

  launcher.choose('claude-cli', 'claude-haiku-5-5');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    version: 1,
    models: { 'claude-cli': 'claude-haiku-5-5' },
  });
  assert.equal((await launcher.models())['claude-cli'].chosen, 'claude-haiku-5-5');
  assert.equal(paseo.calls.length, 2, 'kept for 10 minutes');
  assert.throws(() => launcher.choose('claude-cli', 'bad id; rm'));

  now = 11 * 60_000;
  await launcher.models();
  assert.equal(paseo.calls.length, 4);

  // A saved model Paseo no longer lists falls back to the first.
  writeFileSync(file, JSON.stringify({ version: 1, models: { 'claude-cli': 'gone' } }));
  assert.equal((await launcher.models())['claude-cli'].chosen, 'claude-opus-5-5');
});

test('models: none without Paseo, and a failed lookup is asked again', async (t) => {
  const root = scratch(t);
  const none = new PaseoLauncher({ file: join(root, 'a.json'), cli: () => undefined });
  assert.equal(none.available(), false);
  assert.deepEqual(await none.models(), {
    'claude-cli': { models: [], chosen: null },
    'codex-cli': { models: [], chosen: null },
  });
  const paseo = fakePaseo({ 'provider ls': PROVIDERS, 'provider models': 'error' });
  const failing = new PaseoLauncher({
    file: join(root, 'b.json'),
    run: paseo.run,
    cli: () => fakeCli,
  });
  await failing.models();
  await failing.models();
  assert.equal(paseo.calls.length, 4);
});

test('open: makes the agent in the folder and shows it in Paseo', windowsOnly, async (t) => {
  const root = scratch(t);
  const folder = join(root, "한글 폴더 & echo X %PATH% !x! (1) ';=,");
  mkdirSync(folder);
  const started = [];
  const paseo = fakePaseo({
    status: JSON.stringify({ serverId: 'srv_A' }),
    'workspace ls': JSON.stringify([
      { workspaceId: 'w-worktree', isolation: 'worktree', cwd: folder, background: false },
      { workspaceId: 'w-hidden', isolation: 'local', cwd: folder, background: true },
      { workspaceId: 'w-other', isolation: 'local', cwd: root, background: false },
    ]),
    run: 'Created workspace w\n{"agentId":"agent-1","status":"running"}',
  });
  const launcher = new PaseoLauncher({
    file: join(root, 'launcher.json'),
    run: paseo.run,
    cli: () => fakeCli,
    env: {
      PATH: 'x',
      PASEO_AGENT_ID: 'mine',
      PASEO_WORKSPACE_ID: 'mine',
      ELECTRON_RUN_AS_NODE: '1',
    },
    startDesktop: (program, args, env) => started.push({ program, args, env }),
  });
  assert.deepEqual(await launcher.open('claude-cli', folder, 'claude-opus-5-5'), {
    folder,
    agentId: 'agent-1',
  });
  const run = paseo.calls.find((c) => c.args[0] === 'run');
  // No usable workspace for the folder: Paseo makes one.
  assert.deepEqual(run.args, [
    'run',
    '--cwd',
    folder,
    '--provider',
    'claude/claude-opus-5-5',
    '--title',
    agentTitle(folder),
    '--no-wait',
    '--json',
    FIRST_MESSAGE,
  ]);
  assert.equal(run.env.PASEO_AGENT_ID, undefined);
  assert.equal(run.env.PASEO_WORKSPACE_ID, undefined);
  assert.deepEqual(started, [
    { program: PROGRAM, args: ['paseo://h/srv_A/agent/agent-1'], env: { PATH: 'x' } },
  ]);
});

test('open: reuses the visible local workspace of the folder', windowsOnly, async (t) => {
  const root = scratch(t);
  const folder = join(root, 'Project');
  mkdirSync(folder);
  const paseo = fakePaseo({
    status: JSON.stringify({ serverId: 'srv_A' }),
    'workspace ls': JSON.stringify([
      { workspaceId: 'w-1', isolation: 'local', cwd: folder.toUpperCase(), background: false },
    ]),
    run: '{"agentId":"agent-2"}',
  });
  const launcher = new PaseoLauncher({
    file: join(root, 'launcher.json'),
    run: paseo.run,
    cli: () => fakeCli,
    startDesktop: () => {},
  });
  await launcher.open('codex-cli', folder, 'gpt-6.2-sol');
  const run = paseo.calls.find((c) => c.args[0] === 'run');
  assert.deepEqual(run.args.slice(0, 7), [
    'run',
    '--cwd',
    folder,
    '--workspace',
    'w-1',
    '--provider',
    'codex/gpt-6.2-sol',
  ]);
});

test(
  'open: starts Paseo when its daemon does not answer, and gives up after a while',
  windowsOnly,
  async (t) => {
    const root = scratch(t);
    const folder = join(root, 'Project');
    mkdirSync(folder);
    let now = 0;
    let up = false;
    const started = [];
    const paseo = fakePaseo({
      status: () => (up ? '{"serverId":"srv_B"}' : '{"error":{"code":"DAEMON_UNREACHABLE"}}'),
      'workspace ls': '[]',
      run: '{"agentId":"agent-3"}',
    });
    const options = {
      file: join(root, 'launcher.json'),
      run: paseo.run,
      cli: () => fakeCli,
      now: () => now,
      startDesktop: (program, args) => started.push(args),
    };
    const waking = new PaseoLauncher({
      ...options,
      sleep: async (ms) => {
        now += ms;
        if (now >= 3000) up = true;
      },
    });
    await waking.open('claude-cli', folder, 'claude-opus-5-5');
    assert.deepEqual(started, [[], ['paseo://h/srv_B/agent/agent-3']]);

    up = false;
    now = 0;
    started.length = 0;
    const asleep = new PaseoLauncher({ ...options, sleep: async (ms) => void (now += ms) });
    await assert.rejects(asleep.open('claude-cli', folder, 'claude-opus-5-5'), {
      code: 'PASEO_FAILED',
    });
    assert.deepEqual(started, [[]]);
  },
);

test('open: refuses before Paseo is asked anything', async (t) => {
  const root = scratch(t);
  const paseo = fakePaseo({ run: '{}' });
  const make = (extra) =>
    new PaseoLauncher({
      file: join(root, 'launcher.json'),
      run: paseo.run,
      cli: () => fakeCli,
      platform: 'win32',
      startDesktop: () => assert.fail('nothing to show'),
      ...extra,
    });
  await assert.rejects(make({ platform: 'darwin' }).open('claude-cli', root, 'm'), {
    code: 'UNSUPPORTED_PLATFORM',
  });
  if (process.platform === 'win32') {
    await assert.rejects(make().open('claude-cli', join(root, 'nothing'), 'm'), {
      code: 'FOLDER_NOT_FOUND',
    });
    await assert.rejects(make().open('claude-cli', '\\\\server\\share', 'm'), {
      code: 'FOLDER_NETWORK',
    });
    await assert.rejects(make().open('claude-cli', root, '--evil'), (e) => e.name === 'ZodError');
    await assert.rejects(make({ cli: () => undefined }).open('claude-cli', root, 'm'), {
      code: 'PASEO_UNAVAILABLE',
    });
  }
  assert.equal(paseo.calls.length, 0);
});

test('open: no agent in the answer is a failure, and nothing is shown', windowsOnly, async (t) => {
  const root = scratch(t);
  const paseo = fakePaseo({
    status: '{"serverId":"srv_A"}',
    'workspace ls': '[]',
    run: '{"error":{"code":"UNKNOWN_ERROR"}}',
  });
  const launcher = new PaseoLauncher({
    file: join(root, 'launcher.json'),
    run: paseo.run,
    cli: () => fakeCli,
    startDesktop: () => assert.fail('nothing to show'),
  });
  await assert.rejects(launcher.open('claude-cli', root, 'claude-opus-5-5'), {
    code: 'PASEO_FAILED',
  });
});
