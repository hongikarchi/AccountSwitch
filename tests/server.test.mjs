import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startServer } from '../src/server/server.ts';
import { fakePc, SECRET } from './setup-install-helpers.mjs';

test('the API needs the launch token session, this origin for writes, and this address', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-'));
  const app = await startServer({ directory });
  try {
    const origin = new URL(app.url).origin;
    assert.equal((await fetch(origin + '/api/v1/accounts')).status, 401);
    const wrong = await fetch(origin + '/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ token: 'nope' }),
    });
    assert.equal(wrong.status, 401);
    const token = new URL(app.launchUrl).hash.slice(1);
    const session = await fetch(origin + '/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ token }),
    });
    assert.equal(session.status, 200);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const list = await fetch(origin + '/api/v1/accounts', { headers: { Cookie: cookie } });
    assert.deepEqual((await list.json()).active, {
      'claude-cli': 'default',
      'codex-cli': 'default',
    });
    const add = (headers) =>
      fetch(origin + '/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
        body: JSON.stringify({ provider: 'claude-cli', label: '회사' }),
      });
    assert.equal((await add({ Origin: 'http://evil.example' })).status, 403);
    assert.equal((await add({})).status, 403);
    assert.equal((await add({ Origin: origin })).status, 201);
    // The account in use (here the CLI's own login) signs in again in place, with no folder.
    const post = (path, data) =>
      fetch(origin + '/api/v1/accounts/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
        body: JSON.stringify(data),
      });
    const command = await post('login-command', { provider: 'claude-cli', id: 'default' });
    assert.equal(command.status, 200);
    assert.doesNotMatch((await command.json()).command, /CLAUDE_CONFIG_DIR/);
    // ...but it cannot be signed out from here.
    const logout = await post('logout', { provider: 'claude-cli', id: 'default' });
    assert.deepEqual([logout.status, (await logout.json()).code], [409, 'PROFILE_ACTIVE']);
    // fetch() cannot change Host, so ask with a raw request as a rebinding page would arrive.
    const other = await new Promise((resolve, reject) =>
      request(
        origin + '/api/v1/accounts',
        { headers: { Cookie: cookie, Host: 'attacker.example' } },
        resolve,
      )
        .on('error', reject)
        .end(),
    );
    assert.equal(other.statusCode, 403);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the launcher routes need the session and origin; open never starts a real process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-'));
  const project = join(directory, '내 프로젝트 & 2');
  await mkdir(project);
  const claude = join(directory, 'claude.exe');
  await writeFile(claude, '');
  const saved = process.env.ACCOUNTSWITCH_CLAUDE_PATH;
  process.env.ACCOUNTSWITCH_CLAUDE_PATH = claude;
  const started = [];
  const launcherSpawn = (command, args, options) => {
    started.push({ command, args, options });
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  const app = await startServer({ directory, launcherSpawn });
  try {
    const origin = new URL(app.url).origin;
    const session = await fetch(origin + '/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ token: new URL(app.launchUrl).hash.slice(1) }),
    });
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const post = (path, data, headers = { Cookie: cookie, Origin: origin }) =>
      fetch(origin + '/api/v1/launcher/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
    const status = () => fetch(origin + '/api/v1/launcher', { headers: { Cookie: cookie } });

    // Refused without the session, and from another page, before anything is looked at.
    assert.equal((await fetch(origin + '/api/v1/launcher')).status, 401);
    for (const path of ['recent', 'open']) {
      assert.equal((await post(path, { folder: project }, { Origin: origin })).status, 401);
      assert.equal(
        (await post(path, { folder: project }, { Cookie: cookie, Origin: 'http://evil.example' }))
          .status,
        403,
      );
      assert.equal((await post(path, { folder: project }, { Cookie: cookie })).status, 403);
      assert.equal((await post(path, { folder: 7 })).status, 400);
      assert.equal((await post(path, { folder: project, extra: 1 })).status, 400);
    }
    assert.equal(started.length, 0);

    const first = await (await status()).json();
    assert.deepEqual(first, { platform: process.platform, installed: true, recent: [] });

    const remembered = await post('recent', { folder: project });
    assert.deepEqual([remembered.status, await remembered.json()], [200, { recent: [project] }]);
    assert.deepEqual((await (await status()).json()).recent, [project]);
    const missing = await post('recent', { folder: join(directory, 'nothing') });
    assert.deepEqual([missing.status, (await missing.json()).code], [409, 'FOLDER_NOT_FOUND']);

    const opened = await post('open', { folder: project });
    if (process.platform === 'win32') {
      assert.deepEqual([opened.status, await opened.json()], [200, { folder: project }]);
      assert.equal(started.length, 1);
      assert.equal(started[0].options.cwd, project);
      assert.ok(!started[0].args.join(' ').includes(directory));
      const refused = await post('open', { folder: join(directory, 'nothing') });
      assert.deepEqual([refused.status, (await refused.json()).code], [409, 'FOLDER_NOT_FOUND']);
    } else {
      assert.deepEqual([opened.status, (await opened.json()).code], [409, 'UNSUPPORTED_PLATFORM']);
      assert.equal(started.length, 0);
    }
  } finally {
    if (saved === undefined) delete process.env.ACCOUNTSWITCH_CLAUDE_PATH;
    else process.env.ACCOUNTSWITCH_CLAUDE_PATH = saved;
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/** A server whose setup checks see a pretend PC: nothing real starts and PATH stays as it is. */
async function setupServer(setupChecks) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-setup-'));
  const calls = [];
  const app = await startServer({
    directory,
    setupChecks: {
      platform: 'win32',
      env: { PATH: 'C:\\stale', USERPROFILE: 'C:\\Users\\tester' },
      home: 'C:\\Users\\tester',
      exists: () => false,
      listFolders: () => [],
      readFile: () => undefined,
      executable: () => undefined,
      run: async (request) => {
        calls.push(request);
        return {
          code: 0,
          stderr: '',
          timedOut: false,
          stdout: JSON.stringify({
            machinePath: 'C:\\Windows\\System32',
            userPath: '',
            pythonUtf8: null,
            documents: null,
            executionPolicy: { CurrentUser: 'Undefined' },
          }),
        };
      },
      ...setupChecks,
    },
  });
  const origin = new URL(app.url).origin;
  const session = await fetch(origin + '/api/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ token: new URL(app.launchUrl).hash.slice(1) }),
  });
  const Cookie = session.headers.get('set-cookie').split(';')[0];
  return {
    directory,
    calls,
    origin,
    get: () => fetch(origin + '/api/v1/setup', { headers: { Cookie } }),
    check: (data) =>
      fetch(origin + '/api/v1/setup/check', {
        method: 'POST',
        headers: {
          Cookie,
          Origin: origin,
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    close: async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('GET /api/v1/setup gives the catalog, the state, and whether the wizard opens', async () => {
  const server = await setupServer();
  try {
    const response = await server.get();
    assert.equal(response.status, 200);
    const setup = await response.json();
    assert.equal(setup.platform, 'win32');
    assert.equal(setup.supported, true);
    assert.equal(setup.runActive, false);
    assert.equal(setup.lastCheck, null);
    assert.equal(setup.state, null);
    assert.equal(setup.stateFile, 'missing');
    assert.deepEqual(setup.autoOpen, {
      open: true,
      stateFileExists: false,
      claudeInstalled: false,
    });
    assert.equal(setup.catalog.items.length, 20);
    assert.equal(setup.catalog.groups.length, 6);
    assert.equal(setup.catalog.items[0].id, 'git');
    // Asking must not create the file that decides the rule.
    assert.equal(existsSync(join(server.directory, 'setup-state.json')), false);
  } finally {
    await server.close();
  }
});

test('the wizard does not open where Claude Code is installed, or after a recorded check', async () => {
  const installed = await setupServer({ executable: () => 'C:\\c\\claude.exe' });
  try {
    const { autoOpen } = await (await installed.get()).json();
    assert.deepEqual(autoOpen, { open: false, stateFileExists: false, claudeInstalled: true });
  } finally {
    await installed.close();
  }
  const server = await setupServer();
  try {
    assert.equal((await (await server.get()).json()).autoOpen.open, true);
    assert.equal((await server.check({ record: true })).status, 200);
    const after = await (await server.get()).json();
    assert.equal(after.autoOpen.open, false);
    assert.equal(after.stateFile, 'ok');
    assert.equal(after.state.mode, 'check');
    assert.equal(after.state.items.git.status, 'missing');
  } finally {
    await server.close();
  }
});

test('a damaged state file counts as existing, so nobody is forced through the wizard', async () => {
  const server = await setupServer();
  try {
    writeFileSync(join(server.directory, 'setup-state.json'), '{ broken');
    const setup = await (await server.get()).json();
    assert.equal(setup.stateFile, 'corrupt');
    assert.equal(setup.state, null);
    assert.equal(setup.autoOpen.open, false);
  } finally {
    await server.close();
  }
});

test('POST /api/v1/setup/check runs the checks, with or without a body, and writes nothing', async () => {
  const server = await setupServer();
  try {
    for (const data of [undefined, {}]) {
      const response = await server.check(data);
      assert.equal(response.status, 200);
      const report = await response.json();
      assert.equal(report.supported, true);
      assert.equal(report.pathSource, 'registry');
      assert.equal(report.results.length, 20);
      assert.equal(report.results.find((result) => result.id === 'git').status, 'missing');
    }
    assert.ok(server.calls.length >= 2);
    assert.equal(existsSync(join(server.directory, 'setup-state.json')), false);
    const setup = await (await server.get()).json();
    assert.equal(setup.lastCheck.results.length, 20);
  } finally {
    await server.close();
  }
});

test('POST /api/v1/setup/check refuses unknown input', async () => {
  const server = await setupServer();
  try {
    const response = await server.check({ items: ['git'] });
    assert.deepEqual([response.status, (await response.json()).code], [400, 'INVALID_INPUT']);
  } finally {
    await server.close();
  }
});

test('the setup API needs the session and this origin', async () => {
  const server = await setupServer();
  try {
    assert.equal((await fetch(server.origin + '/api/v1/setup')).status, 401);
    const noOrigin = await fetch(server.origin + '/api/v1/setup/check', { method: 'POST' });
    assert.equal(noOrigin.status, 403);
    assert.equal(server.calls.length, 0);
  } finally {
    await server.close();
  }
});

test('elsewhere than Windows the setup API answers, starts nothing and never opens', async () => {
  const server = await setupServer({ platform: 'darwin' });
  try {
    const setup = await (await server.get()).json();
    assert.equal(setup.platform, 'darwin');
    assert.equal(setup.supported, false);
    assert.equal(setup.autoOpen.open, false);
    const report = await (await server.check({ record: true })).json();
    assert.equal(report.supported, false);
    assert.ok(report.results.every((result) => result.status === 'unsupported'));
    assert.equal(server.calls.length, 0);
    assert.equal(existsSync(join(server.directory, 'setup-state.json')), false);
  } finally {
    await server.close();
  }
});

// --- Install runs (SPEC 3.4). Every command, download and file lands in the pretend PC.

/** A session on a server that is already running. */
async function signIn(app) {
  const origin = new URL(app.url).origin;
  const session = await fetch(origin + '/api/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ token: new URL(app.launchUrl).hash.slice(1) }),
  });
  return { origin, Cookie: session.headers.get('set-cookie').split(';')[0] };
}

/** A signed-in client of a server whose installs all go to a pretend PC. */
async function installServer(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-run-'));
  const pc = fakePc(options);
  // The account lock stays the server's own, so a registration really queues with switches.
  const { exclusive: _fakeLock, ...checks } = pc.check;
  const app = await startServer({ directory, setupChecks: checks, setupInstall: pc.overrides });
  const { origin, Cookie } = await signIn(app);
  const post = (path, data) =>
    fetch(origin + '/api/v1/setup' + path, {
      method: 'POST',
      headers: {
        Cookie,
        Origin: origin,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const get = async (path) =>
    (await fetch(origin + '/api/v1/setup' + path, { headers: { Cookie } })).json();
  const until = async (condition, what) => {
    for (let turn = 0; turn < 1000; turn++) {
      const { run } = await get('/run');
      if (run && condition(run)) return run;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`never happened: ${what}`);
  };
  return {
    pc,
    directory,
    origin,
    post,
    get,
    until,
    phase: (phase) => until((run) => run.phase === phase, phase),
    close: async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const answered = (code) => ({ code, stdout: '', stderr: '', timedOut: false });
const installsGit = (_request, name, pc) => {
  if (name !== 'winget') return undefined;
  pc.add('C:\\Program Files\\Git\\cmd\\git.exe');
  return answered(0);
};
const DECLINED_CODE = 2316632332;

test('POST /api/v1/setup/run starts a run, and GET shows it to the end', async () => {
  const server = await installServer({ on: installsGit });
  try {
    assert.deepEqual(await server.get('/run'), { run: null });
    const response = await server.post('/run', { items: ['git'], mode: 'auto' });
    assert.equal(response.status, 200);
    const { run } = await response.json();
    assert.equal(run.mode, 'auto');
    assert.deepEqual(
      run.items.map((item) => item.id),
      ['git'],
    );
    const finished = await server.phase('finished');
    assert.equal(finished.items[0].status, 'done');
    const overview = await server.get('');
    assert.equal(overview.runActive, false);
    assert.equal(overview.state.items.git.status, 'done');
  } finally {
    await server.close();
  }
});

test('POST /api/v1/setup/run refuses what it cannot run', async () => {
  const server = await installServer();
  try {
    for (const data of [
      {},
      { items: ['git'] },
      { items: [], mode: 'auto' },
      { items: ['nope'], mode: 'auto' },
      { items: ['git'], mode: 'other' },
      { items: ['git'], mode: 'auto', extra: 1 },
      { items: ['git'], mode: 'auto', replace: ['git'] },
      { items: ['git'], mode: 'auto', replace: ['nope'] },
    ]) {
      const response = await server.post('/run', data);
      assert.deepEqual(
        [response.status, (await response.json()).code],
        [400, 'INVALID_INPUT'],
        JSON.stringify(data),
      );
    }
    assert.equal(server.pc.calls.length, 0);
    assert.deepEqual(await server.get('/run'), { run: null });
    assert.equal((await server.post('/run')).status, 400);
  } finally {
    await server.close();
  }
});

test('a second run is refused while one is active, and runActive tells so', async () => {
  const server = await installServer({
    on: (_request, name) => (name === 'winget' ? answered(DECLINED_CODE) : undefined),
  });
  try {
    await server.post('/run', { items: ['git'], mode: 'auto' });
    const waiting = await server.phase('waiting');
    assert.equal(waiting.items[0].reason, 'ELEVATION_DECLINED');
    assert.equal((await server.get('')).runActive, true);
    const second = await server.post('/run', { items: ['node'], mode: 'auto' });
    assert.deepEqual([second.status, (await second.json()).code], [409, 'SETUP_RUN_ACTIVE']);
  } finally {
    await server.close();
  }
});

test('skip, retry and cancel answer with the run, and only when they apply', async () => {
  let attempts = 0;
  const server = await installServer({
    present: ['C:\\Users\\tester\\.local\\bin\\uv.exe', 'C:\\Users\\tester\\.local\\bin\\uvx.exe'],
    on: (request, name, pc) => {
      if (name !== 'winget') return undefined;
      attempts++;
      // Git is declined once, then comes through. Node and Blender are always declined.
      if (attempts > 1 && request.args[2] === 'Git.Git') return installsGit(request, name, pc);
      return answered(DECLINED_CODE);
    },
  });
  const status = (run, id) => run.items.find((item) => item.id === id).status;
  try {
    for (const path of ['/run/skip', '/run/retry']) {
      const early = await server.post(path, { item: 'git' });
      assert.deepEqual([early.status, (await early.json()).code], [409, 'SETUP_RUN_NOT_WAITING']);
    }
    const noRun = await server.post('/cancel');
    assert.deepEqual([noRun.status, (await noRun.json()).code], [409, 'SETUP_RUN_NOT_ACTIVE']);

    await server.post('/run', { items: ['git', 'uv', 'node', 'blender'], mode: 'auto' });
    await server.phase('waiting');
    for (const data of [{}, { item: 5 }, { item: 'git', extra: 1 }, { item: 'nope' }]) {
      const bad = await server.post('/run/retry', data);
      assert.equal(bad.status, 400, JSON.stringify(data));
    }
    const retried = await server.post('/run/retry', { item: 'git' });
    assert.equal(retried.status, 200);
    assert.ok((await retried.json()).run);

    const stopped = await server.until((run) => status(run, 'node') === 'failed', 'node declined');
    assert.equal(status(stopped, 'git'), 'done');
    const skipped = await server.post('/run/skip', { item: 'node' });
    assert.equal(status((await skipped.json()).run, 'node'), 'skipped');

    const later = await server.until((run) => status(run, 'blender') === 'failed', 'blender');
    assert.equal(status(later, 'uv'), 'done');
    const cancelled = await server.post('/cancel');
    assert.equal(cancelled.status, 200);
    assert.ok((await cancelled.json()).run);
    assert.equal((await server.phase('cancelled')).cancelling, false);
    assert.equal((await server.get('')).runActive, false);
  } finally {
    await server.close();
  }
});

test('GET /api/v1/setup/log gives the end of the log of today, with no secret in it', async () => {
  const server = await installServer({
    on: (request, name, pc) => {
      const result = installsGit(request, name, pc);
      return result && { ...result, stdout: `done\nANTHROPIC_API_KEY=${SECRET}` };
    },
  });
  try {
    assert.deepEqual(await server.get('/log'), { text: '' });
    await server.post('/run', { items: ['git'], mode: 'auto' });
    await server.phase('finished');
    const { text } = await server.get('/log');
    assert.match(text, /git: 시작/);
    assert.ok(!text.includes(SECRET));
  } finally {
    await server.close();
  }
});

test('the install routes need the session and this origin', async () => {
  const server = await installServer();
  try {
    for (const path of ['/run', '/log'])
      assert.equal((await fetch(server.origin + '/api/v1/setup' + path)).status, 401, path);
    for (const path of ['/run', '/run/skip', '/run/retry', '/cancel']) {
      const response = await fetch(server.origin + '/api/v1/setup' + path, { method: 'POST' });
      assert.equal(response.status, 403, path);
    }
    assert.equal(server.pc.calls.length, 0);
  } finally {
    await server.close();
  }
});

test('elsewhere than Windows a run is refused and nothing starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-run-mac-'));
  const pc = fakePc();
  const app = await startServer({
    directory,
    setupChecks: { ...pc.check, platform: 'darwin' },
    setupInstall: pc.overrides,
  });
  try {
    const { origin, Cookie } = await signIn(app);
    const response = await fetch(origin + '/api/v1/setup/run', {
      method: 'POST',
      headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ['git'], mode: 'auto' }),
    });
    assert.deepEqual(
      [response.status, (await response.json()).code],
      [409, 'UNSUPPORTED_PLATFORM'],
    );
    assert.equal(pc.calls.length, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a server started with no fakes cannot start a real install under the test runner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-server-real-'));
  const app = await startServer({ directory });
  const errors = console.error;
  console.error = () => {};
  try {
    const { origin, Cookie } = await signIn(app);
    const response = await fetch(origin + '/api/v1/setup/run', {
      method: 'POST',
      headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ['git'], mode: 'auto' }),
    });
    assert.equal(response.status, 500);
    const answer = await fetch(origin + '/api/v1/setup/run', { headers: { Cookie } });
    assert.deepEqual(await answer.json(), { run: null });
  } finally {
    console.error = errors;
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
