import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { realCheckDeps } from '../src/core/setup/checks.ts';
import { runCommand } from '../src/core/setup/commands.ts';
import {
  buildInstallDeps,
  CANCEL_GRACE_MS,
  ITEM_TIMEOUT_MS,
  underNodeTest,
} from '../src/core/setup/install-deps.ts';
import { readLogTail } from '../src/core/setup/install-log.ts';
import { readSetupState } from '../src/core/setup/state.ts';
import { catalog, PINS } from '../src/core/setup/manifest.ts';
import { SetupService } from '../src/core/setup/service.ts';
import {
  APPDATA,
  BIN,
  CLAUDE_CONFIG,
  commandName,
  exit,
  fakePc,
  HOME,
  itemOf,
  LOCAL,
  NOTE,
  notThere,
  ok,
  PROGRAMS,
  SECRET,
  SETTINGS,
  statusOf,
  until,
  WINGET,
  withRunner,
} from './setup-install-helpers.mjs';

const GIT = `${PROGRAMS}\\Git\\cmd\\git.exe`;
const NODE = `${PROGRAMS}\\nodejs\\node.exe`;
const NPM_CLI = `${PROGRAMS}\\nodejs\\node_modules\\npm\\bin\\npm-cli.js`;
const UV = `${BIN}\\uv.exe`;
const UVX = `${BIN}\\uvx.exe`;
const PY = `${LOCAL}\\Programs\\Python\\Launcher\\py.exe`;
const CLAUDE = `${BIN}\\claude.exe`;
const CODEX = `${APPDATA}\\npm\\codex.cmd`;
const RHINO = `${PROGRAMS}\\Rhino 8\\System\\Rhino.exe`;
const YAK = `${PROGRAMS}\\Rhino 8\\System\\Yak.exe`;
const BLENDER = `${PROGRAMS}\\Blender Foundation\\Blender 5.2\\blender.exe`;
const DECLINED = 2316632332;

const auto = (...items) => ({ items, mode: 'auto' });

// --- Nothing real can run

test('the guard is on in this suite', () => {
  assert.equal(underNodeTest(), true);
});

test('a default real runner refuses to exist under node --test', () => {
  const fake = fakePc();
  const fakes = { run: fake.check.run, env: fake.check.env, home: fake.check.home };
  const real = (over) => realCheckDeps({ exclusive: (task) => task(), ...fakes, ...over });
  const fetch = async () => new Response('');
  assert.throws(() => buildInstallDeps(real({ run: runCommand }), 'x', { fetch }), /REAL_INSTALL/);
  assert.throws(() => buildInstallDeps(real({}), 'x', {}), /REAL_INSTALL.*fetch/);
  assert.throws(() => buildInstallDeps(real({ env: process.env }), 'x', { fetch }), /REAL_INSTALL/);
  assert.throws(() => buildInstallDeps(real({ home: homedir() }), 'x', { fetch }), /REAL_INSTALL/);
  assert.equal(buildInstallDeps(real({}), 'x', { fetch }).check.run, fakes.run);
});

test('a service with no fakes refuses to start a run, and asking about runs builds nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-guard-'));
  try {
    const service = new SetupService(directory, (task) => task());
    assert.equal(service.runProgress(), null);
    assert.equal(service.log(), '');
    assert.throws(
      () => service.cancelRun(),
      (error) => error.code === 'SETUP_RUN_NOT_ACTIVE',
    );
    assert.throws(
      () => service.skipItem('git'),
      (error) => error.code === 'SETUP_RUN_NOT_WAITING',
    );
    assert.throws(
      () => service.retryItem('nope'),
      (error) => error.code === 'INVALID_INPUT',
    );
    assert.throws(() => service.startRun(auto('git')), /REAL_INSTALL/);
    assert.equal(service.runProgress(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the defaults are the ones in the SPEC', () => {
  assert.equal(ITEM_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(CANCEL_GRACE_MS, 30 * 1000);
});

test('no setup source stops a program by name or writes PATH through setx', () => {
  const folder = new URL('../src/core/setup/', import.meta.url);
  for (const file of readdirSync(folder)) {
    const text = readFileSync(new URL(file, folder), 'utf8');
    for (const banned of [
      /taskkill/i,
      /Stop-Process/i,
      /\/IM\b/,
      /--factory-startup['"]/,
      /'setx'/,
    ])
      assert.doesNotMatch(text, banned, file);
  }
});

// --- Starting

test('a run goes in catalog order, once per item, whatever order was asked', () =>
  withRunner({ present: [GIT, NODE, UV, UVX, PY] }, async ({ runner }) => {
    const run = runner.start({ items: ['python', 'git', 'uv', 'git', 'node'], mode: 'auto' });
    assert.deepEqual(
      run.items.map((item) => item.id),
      ['git', 'node', 'uv', 'python'],
    );
    assert.equal(run.phase, 'running');
    assert.equal(run.mode, 'auto');
    assert.equal(run.cancelling, false);
    await runner.settled();
    assert.equal(runner.progress().phase, 'finished');
    assert.ok(runner.progress().finishedAt);
  }));

test('the catalog puts every dependency before what depends on it', () => {
  const seen = new Set();
  for (const item of catalog.items) {
    for (const id of item.dependsOn) assert.ok(seen.has(id), `${item.id} after ${id}`);
    seen.add(item.id);
  }
});

test('unknown items, an empty list and a replace that is no MCP item are refused', () =>
  withRunner({}, async ({ runner, pc }) => {
    for (const request of [
      auto('nope'),
      auto('git', 'nope'),
      auto(),
      { items: ['git'], mode: 'auto', replace: ['git'] },
      { items: ['git'], mode: 'auto', replace: ['nope'] },
    ])
      assert.throws(
        () => runner.start(request),
        (error) => error.code === 'INVALID_INPUT',
        JSON.stringify(request),
      );
    assert.equal(pc.calls.length, 0);
    assert.equal(runner.progress(), null);
  }));

test('one run at a time; after it ends another may start', async () => {
  let release;
  const hold = new Promise((resolve) => (release = resolve));
  await withRunner(
    {
      on: async (_request, name) => {
        if (name === 'winget') {
          await hold;
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      assert.equal(runner.active(), true);
      await until(() => pc.named('winget').length === 1, 'winget started');
      assert.throws(
        () => runner.start(auto('node')),
        (error) => error.code === 'SETUP_RUN_ACTIVE',
      );
      pc.add(GIT);
      release();
      await runner.settled();
      assert.equal(runner.active(), false);
      runner.start(auto('git'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
    },
  );
});

test('elsewhere than Windows no run starts', async () => {
  const pc = fakePc();
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-mac-'));
  try {
    const service = new SetupService(
      directory,
      (task) => task(),
      { ...pc.check, platform: 'darwin' },
      pc.overrides,
    );
    assert.throws(
      () => service.startRun(auto('git')),
      (error) => error.code === 'UNSUPPORTED_PLATFORM',
    );
    assert.equal(pc.calls.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// --- One item

test('an item already installed is done and installs nothing', () =>
  withRunner({ present: [GIT] }, async ({ runner, pc }) => {
    runner.start(auto('git'));
    await runner.settled();
    const item = itemOf(runner.progress(), 'git');
    assert.equal(item.status, 'done');
    assert.equal(item.foundVersion, '2.50.0');
    assert.equal(pc.named('winget').length, 0);
    assert.equal(pc.downloads.length, 0);
    assert.ok(item.startedAt && item.finishedAt);
  }));

test('an item that reports installed after its install is done, with the version found', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return ok();
        }
      },
    },
    async ({ runner, pc, directory }) => {
      runner.start(auto('git'));
      await runner.settled();
      const run = runner.progress();
      assert.equal(statusOf(run, 'git'), 'done');
      assert.equal(itemOf(run, 'git').foundVersion, '2.50.0');
      const [install] = pc.named('winget');
      assert.equal(install.program, WINGET);
      assert.deepEqual(install.args, [
        'install',
        '--id',
        'Git.Git',
        '-e',
        '--source',
        'winget',
        '--accept-source-agreements',
        '--accept-package-agreements',
        '--disable-interactivity',
      ]);
      assert.equal(install.timeoutMs <= ITEM_TIMEOUT_MS, true);
      assert.equal(pc.downloads.length, 0);
      const { state } = readSetupState(directory);
      assert.equal(state.items.git.status, 'done');
      assert.equal(state.items.git.version, '2.50.0');
      assert.equal(state.mode, 'auto');
      assert.ok(state.finishedAt);
    },
  ));

test('a mayElevate item tells the user about the prompt while it runs, and not afterwards', async () => {
  let during;
  let current;
  await withRunner(
    {
      on: (_request, name, pc) => {
        if (name === 'winget') {
          during = current.progress();
          pc.add(GIT);
          return ok();
        }
      },
    },
    async ({ runner }) => {
      current = runner;
      runner.start(auto('git'));
      await runner.settled();
      assert.equal(
        itemOf(during, 'git').message,
        "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요.",
      );
      assert.equal(itemOf(during, 'git').status, 'running');
      assert.equal(itemOf(runner.progress(), 'git').message, undefined);
    },
  );
});

test('every program gets the fresh PATH, no keys and no account folder', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await runner.settled();
      assert.ok(!pc.env.PATH.includes('stale'));
      const [install] = pc.named('winget');
      assert.ok(install.env.PATH.includes('C:\\Windows\\System32'));
      for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CONFIG_DIR', 'CLAUDECODE'])
        assert.equal(install.env[name], undefined, name);
    },
  ));

// --- winget, then the fallback (T-041)

test('a failing winget moves to the fallback, and the download is the pinned file', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(1);
        if (name === 'msiexec') {
          pc.add(NODE);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'node'), 'done');
      assert.deepEqual(pc.downloads, [
        `https://nodejs.org/dist/v${PINS.node}/node-v${PINS.node}-x64.msi`,
      ]);
      const [msi] = pc.named('msiexec');
      assert.equal(msi.program, 'C:\\Windows\\System32\\msiexec.exe');
      assert.equal(msi.args[0], '/i');
      assert.ok(msi.args[1].endsWith(`node-v${PINS.node}-x64.msi`));
      assert.deepEqual(msi.args.slice(2), ['/passive', '/norestart']);
      // The installer is gone once it ran.
      assert.equal(pc.files.read(msi.args[1]), undefined);
    },
  ));

test('a winget that cannot start moves to the fallback; the file itself is what runs', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return notThere();
        if (name.startsWith('git-')) {
          pc.add(GIT);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
      const installer = pc.calls.find((call) => commandName(call).startsWith('git-'));
      assert.deepEqual(installer.args, ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
      assert.ok(pc.downloads[0].startsWith('https://github.com/git-for-windows/git/'));
    },
  ));

test('winget says done but the program is not there: the fallback still gets its turn', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'msiexec') {
          pc.add(NODE);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(pc.named('winget').length, 1);
      assert.equal(pc.named('msiexec').length, 1);
      assert.equal(statusOf(runner.progress(), 'node'), 'done');
    },
  ));

test('an installer exit code does not matter once the program is there', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(1);
        if (name === 'msiexec') {
          // 3010: installed, a restart is wanted.
          pc.add(NODE);
          return exit(3010);
        }
      },
    },
    async ({ runner }) => {
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'node'), 'done');
    },
  ));

test('a download from a host off the list ends in failed and runs nothing', () =>
  withRunner(
    {
      on: (request, name) => (name === 'winget' ? exit(1) : undefined),
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com/x.msi' } }),
    },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'failed');
      assert.equal(item.reason, 'DOWNLOAD_BLOCKED');
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

// --- Elevation (T-047, SPEC 3.6)

for (const [label, code] of [
  ['as the unsigned number', DECLINED],
  ['as the signed number', DECLINED | 0],
])
  test(`a declined winget prompt ends the item, ${label}, and no fallback starts`, () =>
    withRunner(
      { on: (request, name) => (name === 'winget' ? exit(code) : undefined) },
      async ({ runner, pc }) => {
        runner.start(auto('git', 'uv'));
        await until(() => runner.progress().phase === 'waiting');
        const item = itemOf(runner.progress(), 'git');
        assert.equal(item.status, 'failed');
        assert.equal(item.reason, 'ELEVATION_DECLINED');
        assert.equal(item.message, "권한 확인에서 '아니요'를 눌렀어요");
        assert.equal(pc.downloads.length, 0);
        assert.equal(statusOf(runner.progress(), 'uv'), 'pending');
      },
    ));

for (const code of [1602, 1223])
  test(`msiexec exit ${code} is a declined prompt`, () =>
    withRunner(
      {
        on: (request, name) =>
          name === 'winget' ? notThere() : name === 'msiexec' ? exit(code) : undefined,
      },
      async ({ runner }) => {
        runner.start(auto('node'));
        await until(() => runner.progress().phase === 'waiting');
        assert.equal(itemOf(runner.progress(), 'node').reason, 'ELEVATION_DECLINED');
      },
    ));

test('Inno Setup exit 2 is a declined prompt for the Git fallback', () =>
  withRunner(
    {
      on: (request, name) =>
        name === 'winget' ? notThere() : name.startsWith('git-') ? exit(2) : undefined,
    },
    async ({ runner }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'git').reason, 'ELEVATION_DECLINED');
    },
  ));

test('exit 2 from winget or 1602 from Git are ordinary failures, not a decline', () =>
  withRunner(
    {
      on: (request, name) =>
        name === 'winget' ? exit(2) : name.startsWith('git-') ? exit(1602) : undefined,
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(pc.downloads.length, 1);
      assert.equal(itemOf(runner.progress(), 'git').reason, 'INSTALL_FAILED');
    },
  ));

// --- Failed, skip, retry (SPEC 3.4)

test('a failed item stops the run, and skip marks it and goes on', () =>
  withRunner(
    {
      present: [UV, UVX],
      on: (request, name) => (['winget', 'msiexec'].includes(name) ? exit(1) : undefined),
    },
    async ({ runner, directory }) => {
      runner.start(auto('node', 'uv'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(runner.active(), true);
      assert.equal(statusOf(runner.progress(), 'node'), 'failed');
      assert.equal(statusOf(runner.progress(), 'uv'), 'pending');
      assert.equal(readSetupState(directory).state.items.node.status, 'failed');
      assert.equal(readSetupState(directory).state.finishedAt, undefined);

      const answer = runner.skip('node');
      assert.equal(statusOf(answer, 'node'), 'skipped');
      await runner.settled();
      const run = runner.progress();
      assert.equal(run.phase, 'finished');
      assert.equal(statusOf(run, 'uv'), 'done');
      assert.equal(readSetupState(directory).state.items.node.status, 'skipped');
    },
  ));

test('retry runs the failed item again and goes on', () => {
  let attempts = 0;
  return withRunner(
    {
      on: (request, name, pc) => {
        if (name !== 'winget') return undefined;
        attempts++;
        if (attempts === 1) return exit(2316632332);
        pc.add(GIT);
        return ok();
      },
    },
    async ({ runner }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      const answer = runner.retry('git');
      assert.equal(answer.phase, 'running');
      assert.equal(statusOf(answer, 'git'), 'pending');
      assert.equal(itemOf(answer, 'git').reason, undefined);
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
      assert.equal(attempts, 2);
    },
  );
});

test('skip and retry are refused unless the run waits on that item', () =>
  withRunner(
    { present: [UV, UVX], on: (request, name) => (name === 'winget' ? exit(DECLINED) : undefined) },
    async ({ runner }) => {
      const notWaiting = (error) => error.code === 'SETUP_RUN_NOT_WAITING';
      assert.throws(() => runner.skip('git'), notWaiting);
      runner.start(auto('git', 'uv'));
      await until(() => runner.progress().phase === 'waiting');
      assert.throws(() => runner.retry('uv'), notWaiting);
      assert.throws(() => runner.skip('codex'), notWaiting);
      assert.throws(
        () => runner.retry('nope'),
        (error) => error.code === 'INVALID_INPUT',
      );
      runner.skip('git');
      await runner.settled();
      assert.throws(() => runner.retry('git'), notWaiting);
    },
  ));

// --- Dependencies and needs-user (end of SPEC 3.4)

test('Rhino missing is needs-user, does not stop the run, and its items wait with a message', () =>
  withRunner({ present: [CLAUDE, UV, UVX], on: registers }, async ({ runner, pc }) => {
    runner.start(
      auto('rhino', 'rhinomcp-plugin', 'cordyceps-plugin', 'rhino-settings', 'cordyceps-mcp'),
    );
    await runner.settled();
    const run = runner.progress();
    assert.equal(run.phase, 'finished');
    const rhino = itemOf(run, 'rhino');
    assert.equal(rhino.status, 'needs-user');
    assert.equal(rhino.message, 'Rhino 8을 먼저 설치하세요');
    for (const id of ['rhinomcp-plugin', 'cordyceps-plugin', 'rhino-settings']) {
      const item = itemOf(run, id);
      assert.equal(item.status, 'skipped', id);
      assert.equal(item.reason, 'WAITING_FOR');
      assert.match(item.message, /Rhino 8/);
    }
    assert.equal(pc.named('yak').length, 0);
    // cordyceps-mcp does not need Rhino to be registered.
    assert.equal(statusOf(run, 'cordyceps-mcp'), 'done');
  }));

test('a dependency failed and skipped makes what needs it skipped too; the rest continue', () =>
  withRunner(
    {
      present: [UV, UVX],
      on: (request, name) => (['winget', 'msiexec'].includes(name) ? exit(1) : undefined),
    },
    async ({ runner, pc }) => {
      runner.start(auto('node', 'uv', 'codex'));
      await until(() => runner.progress().phase === 'waiting');
      runner.skip('node');
      await runner.settled();
      const run = runner.progress();
      assert.equal(statusOf(run, 'uv'), 'done');
      assert.equal(statusOf(run, 'codex'), 'skipped');
      assert.match(itemOf(run, 'codex').message, /Node\.js 24/);
      assert.equal(pc.calls.filter((call) => call.args.includes('@openai/codex')).length, 0);
    },
  ));

test('a dependency outside the run is checked instead', () =>
  withRunner({}, async ({ runner, pc }) => {
    runner.start(auto('codex'));
    await runner.settled();
    assert.equal(statusOf(runner.progress(), 'codex'), 'skipped');
    assert.equal(pc.calls.filter((call) => call.args.includes('@openai/codex')).length, 0);
    pc.add(NODE);
    pc.add(NPM_CLI);
    pc.on = undefined;
    runner.start(auto('codex'));
    await until(() => runner.progress().phase === 'waiting');
    assert.equal(pc.calls.filter((call) => call.args.includes('@openai/codex')).length, 1);
  }));

test('a check that cannot answer is failed, and nothing installs over the unknown', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: '{ broken' },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhinomcp-mcp'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'rhinomcp-mcp');
      assert.equal(item.reason, 'CHECK_FAILED');
      assert.equal(
        pc.calls.filter((call) => commandName(call) === 'claude' && call.args[1] === 'add').length,
        0,
      );
      assert.equal(pc.files.read(CLAUDE_CONFIG).toString(), '{ broken');
    },
  ));

// --- Timeouts and cancel (SPEC 3.4)

test('a timeout ends the item and starts no fallback', () =>
  withRunner(
    {
      on: (request, name) =>
        name === 'winget' ? { code: null, stdout: '', stderr: '', timedOut: true } : undefined,
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'git').reason, 'TIMEOUT');
      assert.equal(pc.downloads.length, 0);
    },
  ));

test('each command gets only what is left of the item time', () =>
  withRunner(
    { itemTimeoutMs: 60000, on: (request, name) => (name === 'winget' ? exit(1) : undefined) },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      assert.ok(pc.named('winget')[0].timeoutMs <= 60000);
    },
  ));

function hanging(pc, request) {
  return new Promise((resolve) => {
    pc.finishCommand = () => resolve(ok());
    request.signal.addEventListener('abort', () =>
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true }),
    );
  });
}

test('cancel lets the current command end, and starts nothing after it', () =>
  withRunner(
    { on: (request, name, pc) => (name === 'winget' ? hanging(pc, request) : undefined) },
    async ({ runner, pc, directory }) => {
      runner.start(auto('git', 'uv'));
      await until(() => pc.finishCommand, 'winget started');
      const answer = runner.cancel();
      assert.equal(answer.cancelling, true);
      assert.equal(answer.phase, 'running');
      assert.equal(pc.named('winget')[0].signal.aborted, false);

      pc.finishCommand();
      await runner.settled();
      const run = runner.progress();
      assert.equal(run.phase, 'cancelled');
      assert.equal(run.cancelling, false);
      assert.equal(runner.active(), false);
      assert.equal(itemOf(run, 'git').reason, 'CANCELLED');
      assert.equal(itemOf(run, 'uv').status, 'skipped');
      assert.equal(itemOf(run, 'uv').reason, 'CANCELLED');
      assert.equal(pc.downloads.length, 0);
      // An item never reached is not recorded as if it had run.
      assert.equal(readSetupState(directory).state.items.uv, undefined);
      assert.ok(readSetupState(directory).state.finishedAt);
    },
  ));

test('a command that outlasts the grace period is killed through its own signal', () =>
  withRunner(
    {
      cancelGraceMs: 5,
      on: (request, name, pc) => (name === 'winget' ? hanging(pc, request) : undefined),
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => pc.finishCommand, 'winget started');
      runner.cancel();
      await runner.settled();
      assert.equal(pc.named('winget')[0].signal.aborted, true);
      assert.equal(runner.progress().phase, 'cancelled');
      assert.equal(itemOf(runner.progress(), 'git').reason, 'CANCELLED');
      // Killing went through the signal alone: no command was started to do it.
      assert.equal(pc.calls.filter((call) => /taskkill|tskill/i.test(call.program)).length, 0);
    },
  ));

test('a program that finished installing just as cancel came still counts as done', () =>
  withRunner(
    { on: (request, name, pc) => (name === 'winget' ? hanging(pc, request) : undefined) },
    async ({ runner, pc }) => {
      runner.start(auto('git', 'uv'));
      await until(() => pc.finishCommand, 'winget started');
      runner.cancel();
      pc.add(GIT);
      pc.finishCommand();
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
      assert.equal(statusOf(runner.progress(), 'uv'), 'skipped');
      // Git's folder is off PATH, but no new write starts after a cancel.
      assert.deepEqual(pc.pathWrites, []);
    },
  ));

test('cancel stops a download at once', () => {
  const started = [];
  return withRunner(
    {
      on: (request, name) => (name === 'winget' ? notThere() : undefined),
      fetch: (url, init) =>
        new Promise((_resolve, reject) => {
          started.push(url);
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => started.length === 1, 'download started');
      runner.cancel();
      await runner.settled();
      assert.equal(runner.progress().phase, 'cancelled');
      assert.equal(itemOf(runner.progress(), 'git').reason, 'CANCELLED');
      assert.equal(pc.calls.filter((call) => commandName(call).startsWith('git-')).length, 0);
    },
  );
});

test('cancel while waiting on a failed item ends the run', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(DECLINED) : undefined) },
    async ({ runner }) => {
      runner.start(auto('git', 'uv'));
      await until(() => runner.progress().phase === 'waiting');
      runner.cancel();
      await runner.settled();
      assert.equal(runner.progress().phase, 'cancelled');
      assert.equal(statusOf(runner.progress(), 'git'), 'failed');
      assert.equal(statusOf(runner.progress(), 'uv'), 'skipped');
    },
  ));

test('cancel without an active run is refused; twice is the same as once', () =>
  withRunner(
    { on: (request, name, pc) => (name === 'winget' ? hanging(pc, request) : undefined) },
    async ({ runner, pc }) => {
      const none = (error) => error.code === 'SETUP_RUN_NOT_ACTIVE';
      assert.throws(() => runner.cancel(), none);
      runner.start(auto('git'));
      await until(() => pc.finishCommand, 'winget started');
      runner.cancel();
      assert.equal(runner.cancel().cancelling, true);
      pc.finishCommand();
      await runner.settled();
      assert.throws(() => runner.cancel(), none);
    },
  ));

// --- PATH after an install (SPEC 3.5)

test('a program whose folder is on no PATH gets the folder appended, then the broadcast', () =>
  withRunner(
    {
      userPath: 'C:\\Mine;%USERPROFILE%\\own',
      on: (request, name, pc) => {
        if (name === 'powershell' && request.args.at(-1).includes('install.ps1')) return undefined;
        if (name === 'powershell' && request.args.at(-1).includes('ACCOUNTSWITCH_SCRIPT')) {
          pc.add(UV);
          pc.add(UVX);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('uv'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'uv'), 'done');
      assert.deepEqual(pc.pathWrites, ['C:\\Mine;%USERPROFILE%\\own;%USERPROFILE%\\.local\\bin']);
      assert.equal(pc.broadcasts, 1);
      const names = pc.calls.map(commandName);
      assert.ok(!names.includes('setx'));
      assert.ok(!names.includes('reg'));
    },
  ));

test('a folder already on either PATH is left alone', () =>
  withRunner(
    {
      present: [GIT, UV, UVX],
      machinePath: `C:\\Windows\\System32;${PROGRAMS}\\Git\\cmd`,
      userPath: '%USERPROFILE%\\.local\\bin',
    },
    async ({ runner, pc }) => {
      runner.start(auto('git', 'uv'));
      await runner.settled();
      assert.deepEqual(pc.pathWrites, []);
      assert.equal(pc.broadcasts, 0);
    },
  ));

test('when the user PATH cannot be read nothing is written, and the program still counts', () =>
  withRunner(
    {
      present: [UV, UVX],
      userPath: 'C:\\Mine',
      on: (request, name) =>
        name === 'powershell' && request.args.at(-1).includes('OpenSubKey') ? exit(1) : undefined,
    },
    async ({ runner, pc }) => {
      runner.start(auto('uv'));
      await runner.settled();
      assert.deepEqual(pc.pathWrites, []);
      assert.equal(statusOf(runner.progress(), 'uv'), 'done');
      assert.match(pc.log(), /PATH에 추가하지 못했어요/);
    },
  ));

test('nothing is appended for a program that is not in that folder', () =>
  withRunner(
    {
      userPath: 'C:\\Mine',
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(`${LOCAL}\\Programs\\Git\\cmd\\git.exe`);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await runner.settled();
      assert.deepEqual(pc.pathWrites, ['C:\\Mine;%LOCALAPPDATA%\\Programs\\Git\\cmd']);
    },
  ));

// --- Base items (T-042, T-044)

test('uv and Claude Code: the script is fetched through the host list, then run', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'powershell' && request.args.at(-1).includes('ACCOUNTSWITCH_SCRIPT')) {
          assert.equal(
            pc.files.read(request.env.ACCOUNTSWITCH_SCRIPT).toString(),
            'installer bytes',
          );
          if (request.env.ACCOUNTSWITCH_SCRIPT.includes('claude-install')) pc.add(CLAUDE);
          else {
            pc.add(UV);
            pc.add(UVX);
          }
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('uv', 'claude'));
      await runner.settled();
      assert.deepEqual(pc.downloads, [
        'https://astral.sh/uv/install.ps1',
        'https://claude.ai/install.ps1',
      ]);
      assert.equal(statusOf(runner.progress(), 'uv'), 'done');
      assert.equal(statusOf(runner.progress(), 'claude'), 'done');
      assert.equal(pc.calls.filter((call) => call.env?.ACCOUNTSWITCH_SCRIPT).length, 2);
    },
  ));

test('the Claude Code install runs inside the account lock, uv outside it', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'powershell' && request.env?.ACCOUNTSWITCH_SCRIPT) {
          if (pc.files.read(request.env.ACCOUNTSWITCH_SCRIPT)) {
            if (request.env.ACCOUNTSWITCH_SCRIPT.includes('claude-install')) pc.add(CLAUDE);
            else {
              pc.add(UV);
              pc.add(UVX);
            }
          }
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('uv', 'claude'));
      await runner.settled();
      const scripts = pc.insideLock.filter((call) => call.env?.ACCOUNTSWITCH_SCRIPT);
      assert.equal(scripts.length, 1);
      assert.ok(scripts[0].env.ACCOUNTSWITCH_SCRIPT.includes('claude-install'));
      assert.equal(scripts[0].env.CLAUDE_CONFIG_DIR, undefined);
      // The script file is cleaned up afterwards.
      assert.equal(pc.files.read(scripts[0].env.ACCOUNTSWITCH_SCRIPT), undefined);
    },
  ));

test('a script declined by the host list never reaches PowerShell', () =>
  withRunner(
    {
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com/a.ps1' } }),
    },
    async ({ runner, pc }) => {
      runner.start(auto('uv'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'uv').reason, 'DOWNLOAD_BLOCKED');
      assert.equal(pc.calls.filter((call) => call.env?.ACCOUNTSWITCH_SCRIPT).length, 0);
    },
  ));

test('codex: npm runs through node and npm-cli.js, not npm.cmd', () =>
  withRunner(
    {
      present: [NODE, NPM_CLI],
      on: (request, name, pc) => {
        if (name === 'node' && request.args.includes('install')) {
          pc.add(CODEX);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('codex'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'codex'), 'done');
      const install = pc.calls.find((call) => call.args.includes('@openai/codex'));
      assert.equal(install.program, NODE);
      assert.equal(install.args[0], NPM_CLI);
      assert.deepEqual(install.args.slice(1, 4), ['install', '-g', '@openai/codex']);
      assert.equal(pc.calls.filter((call) => /npm(\.cmd)?$/i.test(call.program)).length, 0);
      assert.deepEqual(pc.pathWrites.at(-1).split(';').at(-1), '%APPDATA%\\npm');
    },
  ));

test('python: the user scope winget, known folders count before PATH knows them', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(PY);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('python'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'python'), 'done');
      assert.deepEqual(pc.named('winget')[0].args.slice(-2), ['--scope', 'user']);
      assert.equal(itemOf(runner.progress(), 'python').foundVersion, '3.13.5');
      assert.ok(pc.pathWrites.at(-1).includes('%LOCALAPPDATA%\\Programs\\Python\\Launcher'));
    },
  ));

test('py-base installs only what the check found missing', () =>
  withRunner(
    {
      present: [PY],
      pip: ['openpyxl', 'pypdf', 'pdfplumber', 'pymupdf', 'pillow', 'numpy', 'requests'],
      on: (request, name, pc) => {
        if (name === 'py' && request.args.includes('install')) {
          pc.pip.add('beautifulsoup4');
          pc.pip.add('python-dotenv');
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('py-base'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'py-base'), 'done');
      const install = pc.calls.find((call) => call.args.includes('install'));
      assert.equal(install.program, PY);
      assert.deepEqual(install.args.slice(0, 3), ['-3.13', '-m', 'pip']);
      assert.deepEqual(install.args.slice(-2), ['beautifulsoup4', 'python-dotenv']);
    },
  ));

test('the optional Python bundles need Python, and install when it is there', () =>
  withRunner(
    {
      present: [PY],
      on: (request, name, pc) => {
        if (name === 'py' && request.args.includes('install')) {
          for (const package_ of request.args.slice(request.args.indexOf('install') + 1))
            pc.pip.add(package_);
          return ok();
        }
      },
    },
    async ({ runner }) => {
      runner.start(auto('py-gis', 'py-3d', 'py-hwp'));
      await runner.settled();
      for (const id of ['py-gis', 'py-3d', 'py-hwp'])
        assert.equal(statusOf(runner.progress(), id), 'done', id);
    },
  ));

// --- env (T-043)

const envItem = (over, body) =>
  withRunner(
    {
      userPath: 'C:\\Mine',
      pythonUtf8: null,
      policy: { MachinePolicy: 'Undefined', UserPolicy: 'Undefined', CurrentUser: 'Undefined' },
      ...over,
    },
    async (context) => {
      context.runner.start(auto('env'));
      await context.runner.settled();
      await body(context);
    },
  );

test('env sets what is missing, keeps REG_EXPAND_SZ through its own script, and broadcasts', () =>
  envItem({}, async ({ runner, pc }) => {
    assert.equal(statusOf(runner.progress(), 'env'), 'done');
    assert.deepEqual(pc.pathWrites, ['C:\\Mine;%USERPROFILE%\\.local\\bin']);
    assert.equal(pc.pythonUtf8, '1');
    assert.equal(pc.policy.CurrentUser, 'RemoteSigned');
    assert.equal(pc.broadcasts, 2);
    const write = pc.calls.find((call) => call.args.at(-1)?.includes("SetValue('Path'"));
    assert.ok(write.args.at(-1).includes('ExpandString'));
    // The value travels in the environment, not on a command line.
    assert.ok(!write.args.join(' ').includes('C:\\Mine'));
    assert.ok(!pc.log().includes('C:\\Mine'), 'PATH stays out of the log');
    const policy = pc.calls.find((call) => call.args.at(-1)?.includes('Set-ExecutionPolicy'));
    assert.ok(policy.args.at(-1).includes('-Scope CurrentUser'));
  }));

test('env with everything in place changes nothing', () =>
  envItem(
    {
      userPath: BIN,
      pythonUtf8: '1',
      policy: { CurrentUser: 'RemoteSigned' },
    },
    async ({ runner, pc }) => {
      assert.equal(statusOf(runner.progress(), 'env'), 'done');
      assert.equal(itemOf(runner.progress(), 'env').message, '이미 설치되어 있어요.');
      assert.deepEqual(pc.pathWrites, []);
      assert.equal(pc.broadcasts, 0);
    },
  ));

test('a group policy over the execution policy is needs-user; the rest is still set', () =>
  envItem(
    { policy: { MachinePolicy: 'AllSigned', UserPolicy: 'Undefined', CurrentUser: 'Undefined' } },
    async ({ runner, pc }) => {
      const item = itemOf(runner.progress(), 'env');
      assert.equal(item.status, 'needs-user');
      assert.equal(item.reason, 'POLICY_BLOCKED');
      assert.equal(pc.pythonUtf8, '1');
      assert.equal(pc.pathWrites.length, 1);
      assert.equal(
        pc.calls.filter((c) => c.args.at(-1)?.includes('Set-ExecutionPolicy')).length,
        0,
      );
      assert.equal(runner.progress().phase, 'finished');
    },
  ));

test('a policy the user chose is left alone', () =>
  envItem({ policy: { CurrentUser: 'AllSigned' } }, async ({ runner, pc }) => {
    assert.equal(itemOf(runner.progress(), 'env').reason, 'POLICY_LEFT_ALONE');
    assert.equal(pc.policy.CurrentUser, 'AllSigned');
    assert.equal(pc.calls.filter((c) => c.args.at(-1)?.includes('Set-ExecutionPolicy')).length, 0);
  }));

// --- MCP (T-046, SPEC 3.3, 3.7)

const claudeCalls = (pc) => pc.calls.filter((call) => commandName(call) === 'claude');
const mcpWrites = (pc) => claudeCalls(pc).filter((call) => call.args[0] === 'mcp');

function registers(request, name, pc) {
  if (name !== 'claude' || request.args[0] !== 'mcp') return undefined;
  if (request.args[1] === 'add') {
    const config = JSON.parse(pc.files.read(CLAUDE_CONFIG)?.toString() ?? '{}');
    const args = request.args;
    const separator = args.indexOf('--');
    const server =
      separator > 0
        ? { command: args[separator + 1], args: args.slice(separator + 2) }
        : { type: 'http', url: args.at(-1) };
    const index = args.findIndex((arg) => arg === 'user') + 1;
    const nameAt = args[index] === '--transport' ? index + 2 : index;
    config.mcpServers = { ...config.mcpServers, [args[nameAt]]: server };
    pc.files.write(CLAUDE_CONFIG, JSON.stringify(config));
  }
  if (request.args[1] === 'remove') {
    const config = JSON.parse(pc.files.read(CLAUDE_CONFIG).toString());
    delete config.mcpServers[request.args.at(-1)];
    pc.files.write(CLAUDE_CONFIG, JSON.stringify(config));
  }
  return { code: 0, stdout: `registered with ${SECRET}`, stderr: `env ${SECRET}`, timedOut: false };
}

test('every MCP write runs inside the lock, without CLAUDE_CONFIG_DIR, and is not logged raw', () =>
  withRunner(
    { present: [CLAUDE, UV, UVX, RHINO, BLENDER], on: registers },
    async ({ runner, pc }) => {
      runner.start(auto('rhinomcp-mcp', 'cordyceps-mcp', 'blender-mcp'));
      await runner.settled();
      const run = runner.progress();
      for (const id of ['rhinomcp-mcp', 'cordyceps-mcp', 'blender-mcp'])
        assert.equal(statusOf(run, id), 'done', id);
      const writes = mcpWrites(pc);
      assert.equal(writes.length, 3);
      for (const call of writes) {
        assert.ok(pc.insideLock.includes(call), call.args.join(' '));
        assert.equal(call.env.CLAUDE_CONFIG_DIR, undefined);
        assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
      }
      assert.deepEqual(writes[0].args, [
        'mcp',
        'add',
        '-s',
        'user',
        'rhino',
        '-e',
        'RHINO_MCP_HOST=127.0.0.1',
        '--',
        'uvx',
        `rhinomcp@${PINS.rhinomcp}`,
      ]);
      assert.deepEqual(writes[1].args.slice(4), [
        '--transport',
        'http',
        'cordyceps',
        'http://127.0.0.1:26929/mcp',
      ]);
      assert.deepEqual(writes[2].args.slice(4), [
        'blender',
        '-e',
        'DISABLE_TELEMETRY=true',
        '--',
        'uvx',
        `blender-mcp@${PINS.blenderMcp}`,
      ]);
      const log = pc.log();
      assert.ok(log.length > 0);
      assert.ok(!log.includes(SECRET), 'the output of claude mcp stays out of the log');
      assert.ok(!log.includes('RHINO_MCP_HOST=127.0.0.1'));
    },
  ));

test('nothing in a run ever writes ~/.claude.json outside the lock', () =>
  withRunner({ present: [CLAUDE, UV, UVX], on: registers }, async ({ runner, pc }) => {
    runner.start(auto('rhinomcp-mcp'));
    await runner.settled();
    assert.equal(mcpWrites(pc).length, 1);
    assert.ok(pc.insideLock.includes(mcpWrites(pc)[0]));
  }));

const oldRhino = {
  mcpServers: { rhino: { command: 'uvx', args: ['rhinomcp@0.1.0'], env: { TOKEN: SECRET } } },
};

test('registered differently: left alone until the user confirms', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: JSON.stringify(oldRhino) },
      on: registers,
    },
    async ({ runner, pc }) => {
      for (const mode of ['auto', 'check']) {
        runner.start({ items: ['rhinomcp-mcp'], mode });
        await runner.settled();
        const item = itemOf(runner.progress(), 'rhinomcp-mcp');
        assert.equal(item.status, 'needs-user');
        assert.equal(item.reason, 'REPLACE_NOT_CONFIRMED');
        assert.equal(item.foundVersion, '0.1.0');
        assert.ok(!item.message.includes(SECRET));
      }
      assert.equal(mcpWrites(pc).length, 0);
      assert.equal(runner.progress().phase, 'finished');
    },
  ));

test('named in replace: removed and added again, inside one lock', () => {
  const held = [];
  let holder = 0;
  const pcHolder = {};
  return withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: JSON.stringify(oldRhino) },
      on: (request, name, pc) => {
        if (name === 'claude' && request.args[0] === 'mcp') held.push(holder);
        return registers(request, name, pc);
      },
      exclusive: async (task) => {
        holder++;
        pcHolder.pc.lockHolders++;
        try {
          return await task();
        } finally {
          pcHolder.pc.lockHolders--;
        }
      },
    },
    async ({ runner, pc }) => {
      pcHolder.pc = pc;
      runner.start({ items: ['rhinomcp-mcp'], mode: 'auto', replace: ['rhinomcp-mcp'] });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'rhinomcp-mcp'), 'done');
      assert.equal(itemOf(runner.progress(), 'rhinomcp-mcp').foundVersion, PINS.rhinomcp);
      const writes = mcpWrites(pc);
      assert.deepEqual(writes[0].args, ['mcp', 'remove', '-s', 'user', 'rhino']);
      assert.equal(writes[1].args[1], 'add');
      assert.equal(held[0], held[1], 'the same lock turn');
    },
  );
});

test('replace does nothing to a registration that is already right', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: {
        [CLAUDE_CONFIG]: JSON.stringify({
          mcpServers: { rhino: { command: 'uvx', args: [`rhinomcp@${PINS.rhinomcp}`] } },
        }),
      },
      on: registers,
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['rhinomcp-mcp'], mode: 'auto', replace: ['rhinomcp-mcp'] });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'rhinomcp-mcp'), 'done');
      assert.equal(mcpWrites(pc).length, 0);
    },
  ));

test('a failed add is failed, and claude mcp output still stays out of the log', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      on: (request, name) =>
        name === 'claude' && request.args[1] === 'add'
          ? { code: 1, stdout: SECRET, stderr: SECRET, timedOut: false }
          : undefined,
    },
    async ({ runner, pc }) => {
      runner.start(auto('cordyceps-mcp'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'cordyceps-mcp');
      assert.equal(item.reason, 'MCP_FAILED');
      assert.ok(!pc.log().includes(SECRET));
    },
  ));

test('a lock that never comes ends in a timeout rather than a hang', () => {
  const never = new Promise(() => {});
  return withRunner(
    {
      present: [CLAUDE],
      itemTimeoutMs: 20,
      // The check of the item reads under the same lock, so only the second turn hangs.
      exclusive: (() => {
        let turn = 0;
        return async (task) => (++turn === 1 ? task() : never);
      })(),
    },
    async ({ runner, pc }) => {
      runner.start(auto('cordyceps-mcp'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'cordyceps-mcp').reason, 'TIMEOUT');
      assert.equal(mcpWrites(pc).length, 0);
    },
  );
});

test('cancel while waiting for the lock ends the wait, and nothing runs when the lock comes', () => {
  let turn = 0;
  let letGo;
  let waiting = false;
  return withRunner(
    {
      present: [CLAUDE],
      exclusive: async (task) => {
        if (++turn === 1) return task();
        waiting = true;
        await new Promise((resolve) => (letGo = resolve));
        return task();
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('cordyceps-mcp'));
      await until(() => waiting, 'waiting for the lock');
      runner.cancel();
      await runner.settled();
      assert.equal(runner.progress().phase, 'cancelled');
      assert.equal(itemOf(runner.progress(), 'cordyceps-mcp').reason, 'CANCELLED');
      letGo();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(mcpWrites(pc).length, 0);
    },
  );
});

// --- Rhino plugins (T-046)

test('Yak installs the pinned plugin versions by full path', () =>
  withRunner(
    {
      present: [RHINO, YAK],
      on: (request, name, pc) => {
        if (name === 'yak') {
          const [, package_, version] = request.args;
          pc.add(`${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0\\${package_}\\${version}`);
          pc.add(
            `${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0\\${package_}\\${version}\\Cordyceps.gha`,
          );
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhinomcp-plugin', 'cordyceps-plugin'));
      await runner.settled();
      const run = runner.progress();
      assert.equal(statusOf(run, 'rhino'), 'done');
      assert.equal(statusOf(run, 'rhinomcp-plugin'), 'done');
      assert.equal(statusOf(run, 'cordyceps-plugin'), 'done');
      const calls = pc.named('yak');
      assert.equal(calls[0].program, YAK);
      assert.deepEqual(calls[0].args, ['install', 'rhinomcp', PINS.rhinomcp]);
      assert.deepEqual(calls[1].args, ['install', 'cordyceps', PINS.cordyceps]);
    },
  ));

test('another plugin version: auto mode keeps it; the item button installs next to it', () =>
  withRunner(
    {
      present: [RHINO, YAK],
      folders: { [`${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0\\rhinomcp`]: ['0.3.0'] },
      on: (request, name, pc) => {
        if (name === 'yak') {
          pc.add(`${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0\\rhinomcp\\${PINS.rhinomcp}`);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhinomcp-plugin'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'rhinomcp-plugin');
      assert.equal(item.status, 'skipped');
      assert.equal(item.reason, 'OTHER_VERSION_KEPT');
      assert.equal(item.foundVersion, '0.3.0');
      assert.equal(pc.named('yak').length, 0);

      runner.start({ items: ['rhinomcp-plugin'], mode: 'check' });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'rhinomcp-plugin'), 'done');
      assert.equal(pc.named('yak').length, 1);
    },
  ));

test('auto mode keeps an older Node, and what needs Node still goes ahead', () =>
  withRunner(
    {
      present: [NODE, NPM_CLI],
      on: (request, name, pc) => {
        if (name === 'node' && request.args.includes('install')) {
          pc.add(CODEX);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      pc.versions.node = 'v22.1.0';
      runner.start(auto('node', 'codex'));
      await runner.settled();
      const run = runner.progress();
      assert.equal(itemOf(run, 'node').reason, 'OTHER_VERSION_KEPT');
      assert.equal(itemOf(run, 'node').foundVersion, '22.1.0');
      assert.match(itemOf(run, 'node').message, /22\.1\.0/);
      assert.equal(pc.named('winget').length, 0);
      assert.equal(statusOf(run, 'codex'), 'done');
    },
  ));

test('after an install the old version still answering is reported, not called done', () =>
  withRunner(
    { present: [NODE], on: (request, name) => (name === 'msiexec' ? notThere() : undefined) },
    async ({ runner, pc }) => {
      pc.versions.node = 'v22.1.0';
      runner.start({ items: ['node'], mode: 'check' });
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'failed');
      assert.equal(pc.named('winget').length, 1);
      assert.equal(item.foundVersion, '22.1.0');
    },
  ));

// --- Blender (T-045)

const ADDON_BYTES = Buffer.from('# the add-on\n');
const addonSha = createHash('sha256').update(ADDON_BYTES).digest('hex');
const ADDON_FILE = `${APPDATA}\\Blender Foundation\\Blender\\5.2\\scripts\\addons\\blender_mcp_addon.py`;
const USER_PREFS = `${APPDATA}\\Blender Foundation\\Blender\\5.2\\config\\userpref.blend`;

/** The catalog's hash is the real add-on's, so a test matching it swaps the item's step. */
async function withPinnedAddon(body) {
  const item = catalog.items.find((entry) => entry.id === 'blender-mcp-addon');
  const step = item.install.steps[0];
  const original = step.sha256;
  step.sha256 = addonSha;
  try {
    await body();
  } finally {
    step.sha256 = original;
  }
}

const blenderFolders = {
  [`${PROGRAMS}\\Blender Foundation`]: ['Blender 5.2'],
};

test('the add-on: hash first, then Blender without --factory-startup, telemetry off', () =>
  withPinnedAddon(() =>
    withRunner(
      {
        present: [BLENDER],
        folders: blenderFolders,
        fetch: async () => new Response(ADDON_BYTES),
        on: (request, name, pc) => {
          if (name === 'blender' && request.args.includes('--python-expr')) {
            assert.deepEqual(
              pc.files.read(request.env.ACCOUNTSWITCH_ADDON_FILE),
              ADDON_BYTES,
              'saved before Blender runs',
            );
            pc.add(ADDON_FILE);
            pc.files.write(USER_PREFS, Buffer.from('BLENDER-v502\0blender_mcp_addon\0'));
            return ok();
          }
        },
      },
      async ({ runner, pc }) => {
        runner.start(auto('blender', 'blender-mcp-addon'));
        await runner.settled();
        const run = runner.progress();
        assert.equal(statusOf(run, 'blender'), 'done');
        assert.equal(statusOf(run, 'blender-mcp-addon'), 'done');
        const call = pc.calls.find((entry) => entry.args.includes('--python-expr'));
        assert.equal(call.program, BLENDER);
        assert.ok(!call.args.includes('--factory-startup'));
        assert.ok(call.args[4].includes('telemetry_consent = False'));
        assert.ok(call.env.ACCOUNTSWITCH_ADDON_FILE.endsWith('blender_mcp_addon.py'));
        assert.ok(!pc.log().includes('telemetry_consent'), 'the script stays out of the log');
        // The add-on file holds a third party's key: it does not stay in the data folder.
        assert.equal(pc.files.read(call.env.ACCOUNTSWITCH_ADDON_FILE), undefined);
      },
    ),
  ));

test('a wrong hash saves nothing and starts nothing', () =>
  withRunner(
    {
      present: [BLENDER],
      folders: blenderFolders,
      fetch: async () => new Response('tampered'),
    },
    async ({ runner, pc }) => {
      runner.start(auto('blender-mcp-addon'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'blender-mcp-addon');
      assert.equal(item.reason, 'HASH_MISMATCH');
      assert.equal(pc.calls.filter((call) => call.args.includes('--python-expr')).length, 0);
      assert.equal([...pc.files.store.keys()].filter((path) => path.endsWith('.py')).length, 0);
    },
  ));

test('Blender open: the add-on waits, and Blender is only looked at', () =>
  withRunner(
    { present: [BLENDER], folders: blenderFolders, running: ['blender.exe'] },
    async ({ runner, pc }) => {
      runner.start(auto('blender-mcp-addon'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'blender-mcp-addon');
      assert.equal(item.status, 'needs-user');
      assert.equal(item.reason, 'BLENDER_RUNNING');
      assert.equal(pc.downloads.length, 0);
      assert.equal(pc.calls.filter((call) => call.args.includes('--python-expr')).length, 0);
    },
  ));

test('Blender 5.1 kept by auto mode: the add-on says what it needs instead of failing', () =>
  withRunner(
    {
      present: [`${PROGRAMS}\\Blender Foundation\\Blender 5.1\\blender.exe`],
      folders: { [`${PROGRAMS}\\Blender Foundation`]: ['Blender 5.1'] },
    },
    async ({ runner, pc }) => {
      pc.versions.blender = 'Blender 5.1.0';
      runner.start(auto('blender', 'blender-mcp-addon'));
      await runner.settled();
      const run = runner.progress();
      assert.equal(itemOf(run, 'blender').reason, 'OTHER_VERSION_KEPT');
      assert.equal(itemOf(run, 'blender-mcp-addon').status, 'needs-user');
      assert.equal(itemOf(run, 'blender-mcp-addon').reason, 'BLENDER_NOT_FOUND');
      assert.equal(pc.named('winget').length, 0);
    },
  ));

test('Blender: the pinned winget version, then the MSI', () =>
  withRunner(
    {
      folders: {},
      on: (request, name) => (name === 'winget' ? exit(1) : undefined),
    },
    async ({ runner, pc }) => {
      runner.start(auto('blender'));
      await until(() => runner.progress().phase === 'waiting');
      assert.deepEqual(pc.named('winget')[0].args.slice(-2), ['--version', PINS.blender]);
      assert.deepEqual(pc.downloads, [
        `https://download.blender.org/release/Blender5.2/blender-${PINS.blender}-windows-x64.msi`,
      ]);
    },
  ));

// --- Rhino settings (T-049)

const settingsXml = (value) =>
  `\uFEFF<settings id="2.0">\r\n  <settings>\r\n    <child key="Options">\r\n      <child key="FileSettings">\r\n        <entry key="EnableFileLockingOpenWarning">${value}</entry>\r\n      </child>\r\n    </child>\r\n  </settings>\r\n</settings>\r\n`;

test('Rhino open: nothing changes, and Rhino is only looked at', () =>
  withRunner(
    {
      present: [RHINO],
      running: ['Rhino.exe'],
      files: { [SETTINGS]: settingsXml('False'), [NOTE]: 'mine\n' },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'rhino-settings');
      assert.equal(item.status, 'needs-user');
      assert.equal(item.reason, 'RHINO_RUNNING');
      assert.equal(item.message, 'Rhino를 닫고 다시 시도하세요');
      assert.equal(pc.files.read(SETTINGS).toString(), settingsXml('False'));
      assert.equal(pc.files.read(NOTE).toString(), 'mine\n');
      assert.equal(pc.files.read(`${SETTINGS}.accountswitch-bak`), undefined);
      assert.deepEqual(
        [...new Set(pc.calls.map(commandName))].sort(),
        ['powershell', 'tasklist'],
        'nothing else was started, and nothing was stopped',
      );
      assert.equal(pc.calls.filter((call) => call.program.includes('Rhino.exe')).length, 0);
    },
  ));

test('when Windows does not say whether Rhino runs, nothing changes either', () =>
  withRunner(
    {
      present: [RHINO],
      files: { [SETTINGS]: settingsXml('False') },
      on: (request, name) => (name === 'tasklist' ? exit(1) : undefined),
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(itemOf(runner.progress(), 'rhino-settings').reason, 'RHINO_STATE_UNKNOWN');
      assert.equal(pc.files.read(SETTINGS).toString(), settingsXml('False'));
    },
  ));

test('Rhino closed: backup, warning on, note between markers; the open parts are said plainly', () =>
  withRunner(
    {
      present: [RHINO],
      files: { [SETTINGS]: settingsXml('False'), [NOTE]: '# Mine\nkeep this\n' },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'rhino-settings');
      assert.equal(item.status, 'needs-user');
      assert.equal(item.reason, 'SETTINGS_PARTS_OPEN');
      assert.match(item.message, /mcpstart/);
      assert.match(item.message, /Grasshopper/);
      assert.equal(pc.files.read(SETTINGS).toString(), settingsXml('True'));
      assert.equal(pc.files.read(`${SETTINGS}.accountswitch-bak`).toString(), settingsXml('False'));
      const note = pc.files.read(NOTE).toString();
      assert.ok(note.startsWith('# Mine\nkeep this\n\n<!-- accountswitch:start -->\n'));
      assert.ok(note.endsWith('<!-- accountswitch:end -->\n'));
      assert.ok(note.includes(`${HOME}\\Documents\\AccountSwitch\\cordyceps-start.gh`));
      // Nothing guessed: no start-up command written, no starter file made.
      assert.ok(!pc.files.read(SETTINGS).toString().includes('mcpstart'));
      assert.equal([...pc.files.store.keys()].filter((path) => path.endsWith('.gh')).length, 0);
      assert.equal(runner.progress().phase, 'finished');
    },
  ));

test('a second run keeps the first backup and does not touch what is already right', () =>
  withRunner(
    {
      present: [RHINO],
      files: { [SETTINGS]: settingsXml('False') },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      const firstNote = pc.files.read(NOTE);
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(pc.files.read(`${SETTINGS}.accountswitch-bak`).toString(), settingsXml('False'));
      assert.equal(pc.files.read(SETTINGS).toString(), settingsXml('True'));
      assert.equal(pc.files.read(NOTE), firstNote, 'the very same bytes: not written again');
    },
  ));

test('no settings file yet: the note still goes in, and the message says what to do', () =>
  withRunner({ present: [RHINO] }, async ({ runner, pc }) => {
    runner.start(auto('rhino', 'rhino-settings'));
    await runner.settled();
    const item = itemOf(runner.progress(), 'rhino-settings');
    assert.equal(item.reason, 'SETTINGS_PARTS_OPEN');
    assert.match(item.message, /켰다가 끄면/);
    assert.ok(pc.files.read(NOTE));
    assert.equal(pc.files.read(SETTINGS), undefined);
  }));

test('a settings file that is not clean UTF-8 is left alone, byte for byte', () => {
  const bytes = Buffer.concat([Buffer.from(settingsXml('False')), Buffer.from([0xff, 0xfe])]);
  return withRunner({ present: [RHINO] }, async ({ runner, pc }) => {
    pc.files.write(SETTINGS, bytes);
    runner.start(auto('rhino', 'rhino-settings'));
    await runner.settled();
    assert.match(itemOf(runner.progress(), 'rhino-settings').message, /예상과 달라서/);
    assert.deepEqual(pc.files.read(SETTINGS), bytes);
    assert.equal(pc.files.read(`${SETTINGS}.accountswitch-bak`), undefined);
  });
});

test('broken markers in the note: the note file is left alone', () => {
  const broken = '<!-- accountswitch:start -->\nmine\n';
  return withRunner(
    { present: [RHINO], files: { [SETTINGS]: settingsXml('False'), [NOTE]: broken } },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.match(itemOf(runner.progress(), 'rhino-settings').message, /표시가 어긋나/);
      assert.equal(pc.files.read(NOTE).toString(), broken);
      assert.equal(pc.files.read(SETTINGS).toString(), settingsXml('True'));
    },
  );
});

test('all four parts in place by hand: done without changing a thing', () => {
  const xml = settingsXml('True').replace(
    '</child>\r\n    </child>',
    '</child>\r\n    </child>\r\n    <child key="Startup"><entry key="StartupCommands">_mcpstart</entry></child>',
  );
  const note = '<!-- accountswitch:start -->\nx\n<!-- accountswitch:end -->\n';
  return withRunner(
    {
      present: [RHINO, `${HOME}\\Documents\\AccountSwitch\\cordyceps-start.gh`],
      files: { [SETTINGS]: xml, [NOTE]: note },
    },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'rhino-settings'), 'done');
      assert.equal(pc.files.read(NOTE).toString(), note);
      assert.equal(pc.named('tasklist').length, 0);
    },
  );
});

// --- State and log (SPEC 3.4, 3.9)

test('the state file is written after each item, before the next starts', () => {
  const seen = [];
  let directory_;
  return withRunner(
    {
      present: [GIT],
      on: (request, name, pc) => {
        if (name === 'powershell' && request.env?.ACCOUNTSWITCH_SCRIPT) {
          seen.push(readSetupState(directory_).state?.items.git?.status);
          pc.add(UV);
          pc.add(UVX);
          return ok();
        }
      },
    },
    async ({ runner, directory }) => {
      directory_ = directory;
      runner.start(auto('git', 'uv'));
      await runner.settled();
      assert.deepEqual(seen, ['done']);
      const { state } = readSetupState(directory);
      assert.equal(state.version, 1);
      assert.deepEqual(Object.keys(state.items), ['git', 'uv']);
      assert.ok(state.items.uv.at);
    },
  );
});

test('a state file that cannot be written does not stop the run', () =>
  withRunner({ present: [GIT] }, async ({ runner, directory, pc }) => {
    // A folder where the file should go makes the rename fail.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(directory, 'setup-state.json'));
    runner.start(auto('git'));
    await runner.settled();
    assert.equal(statusOf(runner.progress(), 'git'), 'done');
    assert.equal(runner.progress().phase, 'finished');
    assert.match(pc.log(), /setup-state\.json/);
  }));

test('the log goes to the file of the day, in the data folder, with no secret in it', () =>
  withRunner(
    {
      now: () => new Date(2026, 10, 6, 9, 30, 15),
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return {
            code: 0,
            stdout: `Found Git\nANTHROPIC_API_KEY=${SECRET}\nAuthorization: Bearer ${SECRET}\n`,
            stderr: `sk-ant-oat01-${SECRET}`,
            timedOut: false,
          };
        }
      },
    },
    async ({ runner, pc, directory }) => {
      runner.start(auto('git'));
      await runner.settled();
      const path = join(directory, 'logs', 'setup-2026-11-06.log');
      const log = pc.files.read(path).toString();
      assert.match(log, /\[09:30:15\] git: 시작/);
      assert.ok(log.includes('Found Git'));
      assert.ok(log.includes('winget.exe install --id Git.Git'));
      assert.ok(!log.includes(SECRET));
      assert.equal(readLogTail(pc.files, directory, new Date(2026, 10, 6)), log);
      assert.equal(existsSync(path), false, 'in the fake files, not on this disk');
    },
  ));

test('environment values given to a command never reach the log', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await runner.settled();
      const log = pc.log();
      assert.ok(!log.includes(SECRET));
      assert.ok(!log.includes('C:\\some\\account'));
    },
  ));

// --- All of it

test('a fresh PC in auto mode: base group, in order, nothing but the planned programs', () =>
  withRunner(
    {
      userPath: '',
      pythonUtf8: null,
      policy: { CurrentUser: 'Undefined' },
      on: (request, name, pc) => {
        if (name === 'winget') {
          const id = request.args[2];
          if (id === 'Git.Git') pc.add(GIT);
          if (id === 'OpenJS.NodeJS.LTS') {
            pc.add(NODE);
            pc.add(NPM_CLI);
          }
          if (id === 'Python.Python.3.13') pc.add(PY);
          return ok();
        }
        if (name === 'powershell' && request.env?.ACCOUNTSWITCH_SCRIPT) {
          if (request.env.ACCOUNTSWITCH_SCRIPT.includes('claude-install')) pc.add(CLAUDE);
          else {
            pc.add(UV);
            pc.add(UVX);
          }
          return ok();
        }
        if (name === 'node' && request.args.includes('install')) {
          pc.add(CODEX);
          return ok();
        }
        if (name === 'py' && request.args.includes('install')) {
          for (const package_ of request.args.slice(request.args.indexOf('install') + 1))
            pc.pip.add(package_);
          return ok();
        }
      },
    },
    async ({ runner, pc, directory }) => {
      const base = catalog.items.filter((item) => item.group === 'base').map((item) => item.id);
      runner.start({ items: base, mode: 'auto' });
      await runner.settled();
      const run = runner.progress();
      assert.equal(run.phase, 'finished');
      for (const id of base) assert.equal(statusOf(run, id), 'done', id);
      const allowed = new Set([
        'powershell',
        'winget',
        'node',
        'py',
        'git',
        'uv',
        'uvx',
        'claude',
        'codex',
      ]);
      for (const call of pc.calls) assert.ok(allowed.has(commandName(call)), call.program);
      for (const banned of ['taskkill', 'setx', 'reg', 'cmd'])
        assert.equal(pc.named(banned).length, 0, banned);
      const { state } = readSetupState(directory);
      assert.ok(state.finishedAt);
      assert.deepEqual(Object.keys(state.items), base);
      assert.ok(!pc.log().includes(SECRET));
      assert.ok(!pc.log().includes('ANTHROPIC'));
    },
  ));

test('a pretend home is all the fakes know', () => {
  const pc = fakePc();
  assert.notEqual(pc.check.home, homedir());
  assert.notEqual(pc.check.env, process.env);
  assert.notEqual(pc.check.run, runCommand);
});
