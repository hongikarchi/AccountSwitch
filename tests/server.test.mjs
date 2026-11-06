import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startServer } from '../src/server/server.ts';

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
