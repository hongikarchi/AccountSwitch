import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PaseoLauncher,
  agentLink,
  desktopEnvironment,
  paseoEnvironment,
  paseoJson,
} from '../src/core/launcher-paseo.ts';

// SPEC 4.1. Paseo's CLI is a fake here: the real Paseo is never touched by these tests.

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
  // A folder name with brackets on the line before is not where the answer starts.
  assert.deepEqual(paseoJson('Created workspace w - [최종] {x}\n{"agentId":"a"}'), {
    agentId: 'a',
  });
  assert.equal(paseoJson('no json'), undefined);
  assert.equal(paseoJson('{broken'), undefined);
});

test('the agent link', () => {
  assert.equal(agentLink('srv_A', 'id-1'), 'paseo://h/srv_A/agent/id-1');
  assert.equal(agentLink('a/b', 'c d'), 'paseo://h/a%2Fb/agent/c%20d');
});

const CREATE = (folder) => [
  'workspace',
  'create',
  '--isolation',
  'local',
  '--path',
  folder,
  '--no-background',
  '--json',
];

test(
  'open: registers the folder, makes no agent, and asks for the window to come forward',
  windowsOnly,
  async (t) => {
    const root = scratch(t);
    const folder = join(root, "한글 폴더 & echo X %PATH% !x! (1) ';=,");
    mkdirSync(folder);
    const paseo = fakePaseo({
      status: JSON.stringify({ serverId: 'srv_A' }),
      'workspace ls': JSON.stringify([
        { workspaceId: 'w-worktree', isolation: 'worktree', cwd: folder, background: false },
        { workspaceId: 'w-hidden', isolation: 'local', cwd: folder, background: true },
        { workspaceId: 'w-other', isolation: 'local', cwd: root, background: false },
      ]),
      'workspace create': `Created workspace w - [x]\n${JSON.stringify({ workspaceId: 'w-new' })}`,
      ls: JSON.stringify([{ id: 'elsewhere', workspaceId: 'w-other', background: false }]),
    });
    const launcher = new PaseoLauncher({
      run: paseo.run,
      cli: () => fakeCli,
      env: { PATH: 'x', PASEO_AGENT_ID: 'mine', PASEO_WORKSPACE_ID: 'mine' },
      startDesktop: () => assert.fail('no agent to show'),
    });
    assert.deepEqual(await launcher.open(folder), {
      folder,
      workspaceId: 'w-new',
      shown: 'window',
    });
    assert.deepEqual(
      paseo.calls.map((c) => c.args),
      [
        ['status', '--json'],
        ['workspace', 'ls', '--json'],
        CREATE(folder),
        ['ls', '--global', '--json'],
      ],
    );
    for (const call of paseo.calls) {
      assert.equal(call.program, PROGRAM);
      assert.equal(call.env.PASEO_AGENT_ID, undefined);
      assert.equal(call.env.PASEO_WORKSPACE_ID, undefined);
      assert.equal(call.env.ELECTRON_RUN_AS_NODE, '1');
    }
    // Nothing that would make an agent or send a message.
    assert.ok(!paseo.calls.some((c) => ['run', 'send', 'agent'].includes(c.args[0])));
  },
);

test(
  "open: reuses the folder's workspace and shows an agent it already has",
  windowsOnly,
  async (t) => {
    const root = scratch(t);
    const folder = join(root, 'Project');
    mkdirSync(folder);
    const started = [];
    const paseo = fakePaseo({
      status: JSON.stringify({ serverId: 'srv_A' }),
      'workspace ls': JSON.stringify([
        { workspaceId: 'w-1', isolation: 'local', cwd: folder.toUpperCase(), background: false },
      ]),
      ls: JSON.stringify([
        { id: 'helper', workspaceId: 'w-1', background: true },
        { id: 'agent-2', workspaceId: 'w-1', background: false },
      ]),
    });
    const launcher = new PaseoLauncher({
      run: paseo.run,
      cli: () => fakeCli,
      env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1', PASEO_AGENT_ID: 'mine' },
      startDesktop: (program, args, env) => started.push({ program, args, env }),
    });
    assert.deepEqual(await launcher.open(folder), {
      folder,
      workspaceId: 'w-1',
      shown: 'agent',
    });
    assert.ok(!paseo.calls.some((c) => c.args[1] === 'create'));
    assert.deepEqual(started, [
      { program: PROGRAM, args: ['paseo://h/srv_A/agent/agent-2'], env: { PATH: 'x' } },
    ]);
  },
);

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
      'workspace create': '{"workspaceId":"w-3"}',
      ls: '[{"id":"agent-3","workspaceId":"w-3"}]',
    });
    const options = {
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
    await waking.open(folder);
    assert.deepEqual(started, [[], ['paseo://h/srv_B/agent/agent-3']]);

    up = false;
    now = 0;
    started.length = 0;
    const asleep = new PaseoLauncher({ ...options, sleep: async (ms) => void (now += ms) });
    await assert.rejects(asleep.open(folder), { code: 'PASEO_FAILED' });
    assert.deepEqual(started, [[]]);
  },
);

test('open: refuses before Paseo is asked anything', async (t) => {
  const root = scratch(t);
  const paseo = fakePaseo({});
  const make = (extra) =>
    new PaseoLauncher({
      run: paseo.run,
      cli: () => fakeCli,
      platform: 'win32',
      startDesktop: () => assert.fail('nothing to show'),
      ...extra,
    });
  await assert.rejects(make({ platform: 'darwin' }).open(root), {
    code: 'UNSUPPORTED_PLATFORM',
  });
  if (process.platform === 'win32') {
    await assert.rejects(make().open(join(root, 'nothing')), { code: 'FOLDER_NOT_FOUND' });
    await assert.rejects(make().open('\\\\server\\share'), { code: 'FOLDER_NETWORK' });
    await assert.rejects(make({ cli: () => undefined }).open(root), {
      code: 'PASEO_UNAVAILABLE',
    });
  }
  assert.equal(paseo.calls.length, 0);
});

test(
  'open: no workspace in the answer is a failure, and nothing is shown',
  windowsOnly,
  async (t) => {
    const root = scratch(t);
    const paseo = fakePaseo({
      status: '{"serverId":"srv_A"}',
      'workspace ls': '[]',
      'workspace create': '{"error":{"code":"UNKNOWN_ERROR"}}',
    });
    const launcher = new PaseoLauncher({
      run: paseo.run,
      cli: () => fakeCli,
      startDesktop: () => assert.fail('nothing to show'),
    });
    await assert.rejects(launcher.open(root), { code: 'PASEO_FAILED' });
  },
);
