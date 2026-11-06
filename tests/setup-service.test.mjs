import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SetupService } from '../src/core/setup/service.ts';

const SNAPSHOT = JSON.stringify({
  machinePath: 'C:\\Fresh',
  userPath: '',
  pythonUtf8: null,
  documents: null,
  executionPolicy: {},
});

async function withService(overrides, body) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-service-'));
  const calls = [];
  const env = { PATH: 'C:\\stale', USERPROFILE: 'C:\\Users\\tester' };
  const service = new SetupService(directory, (task) => task(), {
    platform: 'win32',
    env,
    home: 'C:\\Users\\tester',
    exists: () => false,
    listFolders: () => [],
    readFile: () => undefined,
    executable: () => undefined,
    run: async (request) => {
      calls.push(request);
      return { code: 0, stdout: SNAPSHOT, stderr: '', timedOut: false };
    },
    ...overrides,
  });
  try {
    await body({ service, calls, env, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('building the service starts nothing', () =>
  withService({}, ({ calls, env }) => {
    assert.equal(calls.length, 0);
    assert.equal(env.PATH, 'C:\\stale');
  }));

test('checks asked for together share one run; a later one runs again', () =>
  withService({}, async ({ service, calls }) => {
    const [first, second] = await Promise.all([service.check(), service.check()]);
    assert.equal(first, second);
    assert.equal(calls.length, 1);
    await service.check();
    assert.equal(calls.length, 2);
  }));

test('a shared run still records for the request that asked to', () =>
  withService({}, async ({ service, directory }) => {
    await Promise.all([service.check(), service.check({ record: true })]);
    assert.equal(existsSync(join(directory, 'setup-state.json')), true);
  }));

test('the overview rebuilds PATH once per engine, before it decides the auto-open rule', () =>
  withService({}, async ({ service, calls, env }) => {
    const first = await service.overview();
    assert.equal(env.PATH, 'C:\\Fresh');
    await service.overview();
    assert.equal(calls.length, 1);
    assert.equal(first.lastCheck, null);
    assert.equal(first.runActive, false);
  }));

test('the overview reads Claude Code after PATH is fresh', () => {
  let seen;
  const env = { PATH: 'C:\\stale', USERPROFILE: 'C:\\Users\\tester' };
  return withService(
    {
      env,
      executable: () => {
        seen = env.PATH;
        return 'C:\\Fresh\\claude.exe';
      },
    },
    async ({ service }) => {
      const { autoOpen } = await service.overview();
      assert.equal(seen, 'C:\\Fresh');
      assert.equal(autoOpen.claudeInstalled, true);
      assert.equal(autoOpen.open, false);
    },
  );
});

test('a failed check does not stay stuck: the next one starts fresh', () => {
  let attempts = 0;
  return withService(
    {
      // A runner that throws at the very first command, the registry read.
      run: async () => {
        attempts++;
        if (attempts === 1) throw new Error('boom');
        return { code: 0, stdout: SNAPSHOT, stderr: '', timedOut: false };
      },
    },
    async ({ service }) => {
      await assert.rejects(service.check());
      assert.equal((await service.check()).pathSource, 'registry');
    },
  );
});
