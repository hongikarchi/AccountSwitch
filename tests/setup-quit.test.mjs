import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildInstallDeps,
  CANCEL_GRACE_MS,
  STOP_GRACE_MS,
} from '../src/core/setup/install-deps.ts';
import { runMarkerFile } from '../src/core/setup/run-marker.ts';
import { CLOSE_WAIT_MS, SetupService } from '../src/core/setup/service.ts';
import { readSetupState, setupStateFile } from '../src/core/setup/state.ts';
import { startServer } from '../src/server/server.ts';
import {
  exit,
  fakePc,
  itemOf,
  PROGRAMS,
  statusOf,
  until,
  withRunner,
} from './setup-install-helpers.mjs';

// Quitting during an install run (SPEC 3.4). Every command here is a fake; nothing real starts.

const GIT = `${PROGRAMS}\\Git\\cmd\\git.exe`;
const auto = (...items) => ({ items, mode: 'auto' });
const FOREVER = 60 * 60 * 1000;

/** A winget that ends when told, or when its own signal kills it. */
function hanging(pc, request) {
  return new Promise((resolve) => {
    pc.finishCommand = () => resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
    request.signal.addEventListener('abort', () =>
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true }),
    );
  });
}
const hangingWinget = (request, name, pc) => (name === 'winget' ? hanging(pc, request) : undefined);

const stateItems = (directory) => readSetupState(directory).state?.items ?? {};
const markerThere = (directory) => existsSync(runMarkerFile(directory));

/** A service on a pretend PC, the way the engine makes one, in the given data folder. */
function serviceOn(directory, pc) {
  return new SetupService(directory, (task) => task(), pc.check, pc.overrides);
}

async function withFolder(body) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-quit-'));
  try {
    await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// --- The marker

test('the marker exists from the start of a run until it ends, and holds nothing', () =>
  withRunner({ on: hangingWinget }, async ({ runner, pc, directory }) => {
    assert.equal(markerThere(directory), false);
    runner.start(auto('git'));
    assert.equal(markerThere(directory), true);
    await until(() => pc.finishCommand, 'winget started');
    assert.equal(markerThere(directory), true);
    assert.equal(readFileSync(runMarkerFile(directory), 'utf8'), '');
    pc.add(GIT);
    pc.finishCommand();
    await runner.settled();
    assert.equal(runner.progress().phase, 'finished');
    assert.equal(markerThere(directory), false);
  }));

test('a run waiting on a failed item is still active, so the marker stays', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(1) : undefined) },
    async ({ runner, directory }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting', 'waiting');
      assert.equal(markerThere(directory), true);
      runner.skip('git');
      await runner.settled();
      assert.equal(markerThere(directory), false);
    },
  ));

test('a user cancel removes the marker too', () =>
  withRunner({ on: hangingWinget, cancelGraceMs: 5 }, async ({ runner, pc, directory }) => {
    runner.start(auto('git'));
    await until(() => pc.finishCommand, 'winget started');
    runner.cancel();
    await runner.settled();
    assert.equal(runner.progress().phase, 'cancelled');
    assert.equal(markerThere(directory), false);
  }));

test('a marker that cannot be written is logged and the run goes on', () =>
  withRunner({ present: [GIT] }, async ({ runner, pc, directory }) => {
    // A folder where the file should be: writing and removing the marker both fail.
    await rm(directory, { recursive: true, force: true });
    await mkdir(runMarkerFile(directory), { recursive: true });
    runner.start(auto('git'));
    await runner.settled();
    assert.equal(runner.progress().phase, 'finished');
    assert.equal(statusOf(runner.progress(), 'git'), 'done');
    assert.match(pc.log(), /setup-running 쓰기 실패/);
  }));

// --- Stopping gently

test('stop lets the current command end, starts nothing after it, and does not kill', () =>
  withRunner({ on: hangingWinget, stopGraceMs: FOREVER }, async ({ runner, pc, directory }) => {
    runner.start(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    runner.stop();
    const during = runner.progress();
    assert.equal(during.phase, 'running');
    assert.equal(during.cancelling, true);
    assert.equal(pc.named('winget')[0].signal.aborted, false);
    assert.equal(markerThere(directory), true);

    pc.add(GIT);
    pc.finishCommand();
    await runner.settled();
    const run = runner.progress();
    assert.equal(run.phase, 'cancelled');
    assert.equal(statusOf(run, 'git'), 'done');
    assert.equal(itemOf(run, 'uv').reason, 'CANCELLED');
    assert.equal(pc.named('winget').length, 1);
    assert.equal(pc.named('winget')[0].signal.aborted, false);
    assert.equal(markerThere(directory), false);
  }));

test('what outlasts the grace period is killed through its own signal, not by a new command', () =>
  withRunner({ on: hangingWinget, stopGraceMs: 5 }, async ({ runner, pc, directory }) => {
    runner.start(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    runner.stop();
    await runner.settled();
    assert.equal(pc.named('winget')[0].signal.aborted, true);
    assert.equal(pc.calls.filter((call) => /taskkill|tskill/i.test(call.program)).length, 0);
    const run = runner.progress();
    assert.equal(run.phase, 'cancelled');
    assert.equal(itemOf(run, 'git').reason, 'CANCELLED');
    const items = stateItems(directory);
    assert.equal(items.git.status, 'failed');
    assert.equal(items.uv.status, 'cancelled');
    assert.ok(readSetupState(directory).state.finishedAt);
    assert.equal(markerThere(directory), false);
  }));

test('a stop during a cancel replaces its long grace period with the short one', () =>
  withRunner(
    { on: hangingWinget, cancelGraceMs: FOREVER, stopGraceMs: 5 },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => pc.finishCommand, 'winget started');
      runner.cancel();
      runner.stop();
      await runner.settled();
      assert.equal(pc.named('winget')[0].signal.aborted, true);
    },
  ));

test('a second stop changes nothing: the engine hears both end and close of its input', () =>
  withRunner({ on: hangingWinget, stopGraceMs: FOREVER }, async ({ runner, pc }) => {
    runner.start(auto('git'));
    await until(() => pc.finishCommand, 'winget started');
    runner.stop();
    runner.stop();
    assert.equal(pc.log().match(/프로그램을 끝내는 중/g).length, 1);
    pc.finishCommand();
    await runner.settled();
  }));

test('a stop while waiting on a failed item ends the run at once', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(1) : undefined), stopGraceMs: FOREVER },
    async ({ runner, directory }) => {
      runner.start(auto('git', 'uv'));
      await until(() => runner.progress().phase === 'waiting', 'waiting');
      runner.stop();
      await runner.settled();
      assert.equal(runner.progress().phase, 'cancelled');
      const items = stateItems(directory);
      assert.equal(items.git.status, 'failed');
      assert.equal(items.uv.status, 'cancelled');
      assert.equal(markerThere(directory), false);
    },
  ));

test('stop with no active run does nothing', () =>
  withRunner({ present: [GIT] }, async ({ runner, directory }) => {
    runner.stop();
    runner.start(auto('git'));
    await runner.settled();
    const before = readFileSync(setupStateFile(directory), 'utf8');
    runner.stop();
    assert.equal(runner.progress().phase, 'finished');
    assert.equal(readFileSync(setupStateFile(directory), 'utf8'), before);
  }));

// --- The state file tells the truth

test('from the stop on, the state file is right even if the engine never gets further', () =>
  withRunner({ on: hangingWinget, stopGraceMs: FOREVER }, async ({ runner, pc, directory }) => {
    runner.start(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    assert.equal(stateItems(directory).git, undefined);
    runner.stop();
    const items = stateItems(directory);
    assert.equal(items.git.status, 'cancelled');
    assert.equal(items.uv.status, 'cancelled');
    assert.equal(readSetupState(directory).state.finishedAt, undefined);
    // The current item ended in time after all: its real result replaces that.
    pc.add(GIT);
    pc.finishCommand();
    await runner.settled();
    assert.equal(stateItems(directory).git.status, 'done');
    assert.equal(stateItems(directory).uv.status, 'cancelled');
    assert.ok(readSetupState(directory).state.finishedAt);
  }));

test('a user cancel still writes nothing for items not reached', () =>
  withRunner({ on: hangingWinget, cancelGraceMs: 5 }, async ({ runner, pc, directory }) => {
    runner.start(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    runner.cancel();
    await runner.settled();
    assert.equal(stateItems(directory).uv, undefined);
  }));

test('no item is ever stored as running', () =>
  withRunner({ on: hangingWinget }, async ({ runner, pc, directory }) => {
    runner.start(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    assert.equal(statusOf(runner.progress(), 'git'), 'running');
    assert.deepEqual(stateItems(directory), {});
    pc.add(GIT);
    pc.finishCommand();
    await until(() => stateItems(directory).git, 'git written');
    assert.equal(stateItems(directory).git.status, 'done');
    runner.stop();
    await runner.settled();
    for (const item of Object.values(stateItems(directory)))
      assert.notEqual(item.status, 'running');
  }));

// --- After a restart

test('an engine that went down mid-item leaves nothing that looks active', () =>
  withFolder(async (directory) => {
    const pc = fakePc({ on: hangingWinget });
    const gone = serviceOn(directory, pc);
    gone.startRun(auto('git', 'uv'));
    await until(() => pc.finishCommand, 'winget started');
    assert.equal(markerThere(directory), true);

    // Nothing of the old engine runs any more: no close, no stop. A new engine starts.
    const next = serviceOn(directory, fakePc());
    assert.equal(markerThere(directory), false);
    assert.equal(next.runProgress(), null);
    const overview = await next.overview();
    assert.equal(overview.runActive, false);
    for (const item of Object.values(overview.state?.items ?? {}))
      assert.notEqual(item.status, 'running');

    // Only to end the fake; a real engine would be gone.
    await gone.close();
  }));

test('a state file that says running does not make a run active', () =>
  withFolder(async (directory) => {
    const at = '2026-11-06T00:00:00.000Z';
    await writeFile(
      setupStateFile(directory),
      JSON.stringify({ version: 1, mode: 'auto', items: { git: { status: 'running', at } } }),
    );
    const service = serviceOn(directory, fakePc());
    assert.equal(service.runProgress(), null);
    assert.equal((await service.overview()).runActive, false);
  }));

test('the page takes its running items from the run, never from the state file', () => {
  const folder = new URL('../src/ui/', import.meta.url);
  for (const file of readdirSync(folder).filter((name) => /\.tsx?$/.test(name)))
    assert.doesNotMatch(
      readFileSync(new URL(file, folder), 'utf8'),
      /\.state\??\.items/,
      `${file} reads the items of setup-state.json`,
    );
});

// --- Closing the engine

test('close waits for the current command and leaves no marker', () =>
  withFolder(async (directory) => {
    const pc = fakePc({ on: hangingWinget, stopGraceMs: FOREVER });
    const service = serviceOn(directory, pc);
    service.startRun(auto('git'));
    await until(() => pc.finishCommand, 'winget started');
    let closed = false;
    const closing = service.close().then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false);
    assert.equal(pc.named('winget')[0].signal.aborted, false);
    pc.add(GIT);
    pc.finishCommand();
    await closing;
    assert.equal(service.runProgress().phase, 'cancelled');
    assert.equal(statusOf(service.runProgress(), 'git'), 'done');
    assert.equal(markerThere(directory), false);
  }));

test('a command that survives its kill does not hold the engine past the wait', () =>
  withFolder(async (directory) => {
    let started = false;
    const pc = fakePc({
      stopGraceMs: 5,
      on: (request, name) => {
        if (name !== 'winget') return undefined;
        started = true;
        return new Promise(() => {});
      },
    });
    const service = serviceOn(directory, pc);
    service.startRun(auto('git', 'uv'));
    await until(() => started, 'winget started');
    const before = Date.now();
    await service.close();
    assert.ok(Date.now() - before < 5000);
    assert.equal(service.runProgress().phase, 'running');
    assert.equal(markerThere(directory), false);
    assert.equal(stateItems(directory).git.status, 'cancelled');
    assert.equal(stateItems(directory).uv.status, 'cancelled');
  }));

test('no run starts once the engine is closing', () =>
  withFolder(async (directory) => {
    const pc = fakePc({ present: [GIT] });
    const service = serviceOn(directory, pc);
    await service.close();
    assert.throws(() => service.startRun(auto('git')), { code: 'SETUP_RUN_ACTIVE' });
    assert.equal(pc.calls.length, 0);
    assert.equal(markerThere(directory), false);
  }));

test('a server closing during a run stops it gently, and the state reads right afterwards', () =>
  withFolder(async (directory) => {
    const pc = fakePc({ on: hangingWinget, stopGraceMs: FOREVER });
    const app = await startServer({ directory, setupChecks: pc.check, setupInstall: pc.overrides });
    const origin = new URL(app.url).origin;
    const session = await fetch(origin + '/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ token: new URL(app.launchUrl).hash.slice(1) }),
    });
    const Cookie = session.headers.get('set-cookie').split(';')[0];
    const started = await fetch(origin + '/api/v1/setup/run', {
      method: 'POST',
      headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(auto('git', 'uv')),
    });
    assert.equal(started.status, 200);
    await until(() => pc.finishCommand, 'winget started');
    assert.equal(markerThere(directory), true);

    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(pc.named('winget')[0].signal.aborted, false);
    pc.add(GIT);
    pc.finishCommand();
    await closing;

    assert.equal(markerThere(directory), false);
    assert.equal(stateItems(directory).git.status, 'done');
    assert.equal(stateItems(directory).uv.status, 'cancelled');

    const again = await startServer({
      directory,
      setupChecks: fakePc().check,
      setupInstall: fakePc().overrides,
    });
    try {
      const nextOrigin = new URL(again.url).origin;
      const nextSession = await fetch(nextOrigin + '/api/v1/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: nextOrigin },
        body: JSON.stringify({ token: new URL(again.launchUrl).hash.slice(1) }),
      });
      const headers = { Cookie: nextSession.headers.get('set-cookie').split(';')[0] };
      const run = await fetch(nextOrigin + '/api/v1/setup/run', { headers });
      assert.deepEqual(await run.json(), { run: null });
    } finally {
      await again.close();
    }
  }));

// --- The numbers fit

test('the waits fit inside what the PC program allows', () => {
  assert.equal(STOP_GRACE_MS, 10 * 1000);
  assert.equal(CLOSE_WAIT_MS, 12 * 1000);
  assert.ok(STOP_GRACE_MS < CANCEL_GRACE_MS);
  const engine = readFileSync(new URL('../src/desktop/shell/Engine.cs', import.meta.url), 'utf8');
  const allowed = Number(/WaitForExit\((\d+)\)/.exec(engine)[1]);
  assert.equal(allowed, 15000);
  assert.ok(CLOSE_WAIT_MS < allowed);
  const pc = fakePc();
  const { stopGraceMs, ...rest } = pc.overrides;
  assert.equal(stopGraceMs, 5);
  assert.equal(buildInstallDeps(pc.check, 'C:\\data', rest).stopGraceMs, STOP_GRACE_MS);
});

// --- How the shell is wired. A dialog needs a window, so this only reads the source.

test('user quits ask first; the quit signal never does', () => {
  const read = (file) =>
    readFileSync(new URL(`../src/desktop/shell/${file}`, import.meta.url), 'utf8');
  const context = read('ShellContext.cs');
  const quit = context.slice(
    context.indexOf('public void Quit('),
    context.indexOf('OnUpdateClick()'),
  );
  assert.doesNotMatch(quit, /MessageBox/);
  assert.match(context, /"종료", null, \(s, e\) => RequestQuit\(\)/);
  assert.match(context, /Updater\.State == "ready"\) RequestQuit\(applyUpdate: true\)/);
  assert.match(context, /quitSignal\.WaitOne\(\) && !Quitting\) ui\.Post\(_ => Quit\(\), null\)/);
  assert.match(context, /MessageBoxDefaultButton\.Button2/);
  const form = read('ShellForm.cs');
  assert.match(form, /case CloseAction\.RequestQuit:[\s\S]*?context\.RequestQuit\(\)/);
  assert.doesNotMatch(form, /context\.Quit\(/);
  const guard = read('QuitGuard.cs');
  assert.match(guard, /"setup-running"/);
  assert.match(
    guard,
    /reason != CloseReason\.UserClosing \|\| quitting\) return CloseAction\.Proceed/,
  );
});
