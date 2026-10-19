import test from 'node:test';
import assert from 'node:assert/strict';
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
