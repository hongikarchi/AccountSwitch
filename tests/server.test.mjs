import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
