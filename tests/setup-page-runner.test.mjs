// The page's rules and the runner's, together: whatever the page offers must do something when the
// runner gets the request the page would send. Everything runs on the pretend PC of the install tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, PINS } from '../src/core/setup/manifest.ts';
import { actionFor, confirmationsFor, runRequest } from '../src/ui/setup-logic.ts';
import { itemOf, ok, PROGRAMS, withRunner } from './setup-install-helpers.mjs';

const BLENDER_FOLDER = `${PROGRAMS}\\Blender Foundation`;
const other = (id) => ({ id, status: 'version-mismatch', pinnedVersion: 'x', foundVersion: '1.0' });
const report = (...results) => ({ results });

test('auto mode offers no install over another version, except registering MCP again', () => {
  for (const item of catalog.items) {
    const { kind } = actionFor(item, other(item.id), 'auto');
    assert.equal(kind, item.check.kind === 'mcp' ? 'register-again' : 'none', item.id);
  }
});

test('every 다시 등록 the page offers is a replace the runner accepts', () =>
  withRunner({}, async ({ runner }) => {
    const ids = catalog.items.filter((item) => item.check.kind === 'mcp').map((item) => item.id);
    const asked = confirmationsFor(catalog, report(...ids.map(other)), ids, 'auto');
    assert.equal(asked.length, ids.length);
    const request = runRequest(ids, 'auto', asked);
    assert.deepEqual(request.replace, ids);
    assert.doesNotThrow(() => runner.start(request));
    await runner.settled();
  }));

test('Blender over another version: the 점검만 button, once agreed to, really installs', () =>
  withRunner(
    {
      present: [`${BLENDER_FOLDER}\\Blender 5.1\\blender.exe`],
      folders: { [BLENDER_FOLDER]: ['Blender 5.1'] },
      on: (request, name, pc) => {
        if (name !== 'winget') return undefined;
        pc.add(`${BLENDER_FOLDER}\\Blender 5.2\\blender.exe`);
        pc.versions.blender = `Blender ${PINS.blender}`;
        return ok();
      },
    },
    async ({ runner, pc }) => {
      pc.versions.blender = 'Blender 5.1.0';
      const asked = confirmationsFor(catalog, report(other('blender')), ['blender'], 'check');
      assert.equal(asked.length, 1);
      runner.start(runRequest(['blender'], 'check', asked));
      await runner.settled();
      assert.equal(itemOf(runner.progress(), 'blender').status, 'done');
      assert.deepEqual(pc.named('winget')[0].args.slice(-2), ['--version', PINS.blender]);
    },
  ));
