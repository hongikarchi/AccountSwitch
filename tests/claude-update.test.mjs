// SPEC 3.10: a Claude Code update that stopped midway, found from the files and put right from the
// build it was installing. Everything runs on the pretend PC of setup-install-helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { runChecks } from '../src/core/setup/checks.ts';
import { claudeFolders, stuckClaudeUpdate } from '../src/core/setup/claude-update.ts';
import { catalog } from '../src/core/setup/manifest.ts';
import {
  BIN,
  exit,
  HOME,
  ok,
  statusOf,
  itemOf,
  withRunner,
  fakePc,
} from './setup-install-helpers.mjs';

const CLAUDE = `${BIN}\\claude.exe`;
const VERSIONS = `${HOME}\\.local\\share\\claude\\versions`;
const NEW = `${BIN}\\claude.exe.new.6208.1795485665581.fe067da0`;
const OLD = `${BIN}\\claude.exe.old.1795485666570.6208`;
const BUILD = `${VERSIONS}\\2.1.331`;
const INSTALL_SCRIPT = 'https://claude.ai/install.ps1';
const claudeItem = catalog.items.find((item) => item.id === 'claude');

/** The state measured on the development PC: both leftovers, no claude.exe, three builds. */
const stuckPc = {
  present: [NEW, OLD, `${VERSIONS}\\2.1.329`, `${VERSIONS}\\2.1.99`, BUILD],
  files: { [BUILD]: 'build 2.1.331', [`${VERSIONS}\\2.1.329`]: 'build 2.1.329' },
};

/** A folder reader over a list of full paths. */
function reader(paths) {
  return {
    exists: (path) => paths.includes(path),
    listFiles: (folder) =>
      paths.filter((path) => win32.dirname(path) === folder).map((path) => win32.basename(path)),
  };
}

const scriptRan = (pc) => pc.downloads.includes(INSTALL_SCRIPT);
const scriptPutsClaude = (request, name, pc) => {
  if (name === 'powershell' && request.args.at(-1).includes('ACCOUNTSWITCH_SCRIPT')) {
    pc.add(CLAUDE);
    return ok();
  }
};

// --- Finding it

test('the native installer folders are under the home folder', () => {
  assert.deepEqual(claudeFolders(HOME), { bin: BIN, versions: VERSIONS });
});

test('no claude.exe, a leftover and a build: stuck, with the newest build by number', () => {
  const stuck = stuckClaudeUpdate(HOME, reader(stuckPc.present));
  assert.deepEqual(stuck, {
    target: CLAUDE,
    build: BUILD,
    version: '2.1.331',
    leftovers: [NEW, OLD],
  });
});

test('either leftover alone is enough', () => {
  for (const leftover of [NEW, OLD])
    assert.equal(stuckClaudeUpdate(HOME, reader([leftover, BUILD]))?.version, '2.1.331');
});

test('not stuck when claude.exe is there, when nothing was left over, or with no finished build', () => {
  assert.equal(stuckClaudeUpdate(HOME, reader([CLAUDE, NEW, OLD, BUILD])), undefined);
  assert.equal(stuckClaudeUpdate(HOME, reader([BUILD])), undefined);
  assert.equal(stuckClaudeUpdate(HOME, reader([NEW, OLD])), undefined);
  // A download still being written is not named by its version alone.
  assert.equal(stuckClaudeUpdate(HOME, reader([NEW, `${VERSIONS}\\2.1.331.tmp`])), undefined);
  // Another program's leftovers do not count.
  assert.equal(stuckClaudeUpdate(HOME, reader([`${BIN}\\uv.exe.old.1`, BUILD])), undefined);
});

test('the check says the update stopped, and that the accounts are fine', async () => {
  const pc = fakePc(stuckPc);
  const [result] = (await runChecks(pc.check, [claudeItem])).results;
  assert.equal(result.status, 'missing');
  assert.match(result.message, /업데이트가 중간에 멈춰서/);
  assert.match(result.message, /2\.1\.331/);
  assert.match(result.message, /계정은 그대로예요/);
});

test('a plain missing Claude Code has no such message', async () => {
  const pc = fakePc({});
  const [result] = (await runChecks(pc.check, [claudeItem])).results;
  assert.equal(result.status, 'missing');
  assert.equal(result.message, undefined);
});

// --- Putting it right

test('installing puts the build back, removes the leftovers, and downloads nothing', () =>
  withRunner(stuckPc, async ({ runner, pc }) => {
    runner.start({ items: ['claude'], mode: 'auto' });
    await runner.settled();
    const item = itemOf(runner.progress(), 'claude');
    assert.equal(item.status, 'done');
    assert.equal(item.message, '받아 둔 새 버전(2.1.331)으로 고쳤어요.');
    assert.equal(pc.files.store.get(CLAUDE).toString(), 'build 2.1.331');
    assert.ok(!pc.has(NEW) && !pc.has(OLD));
    assert.ok(pc.has(BUILD), 'the build itself stays');
    assert.ok(![...pc.files.store.keys()].some((path) => path.includes('.restore-')));
    assert.equal(scriptRan(pc), false);
    // Neither ~/.claude.json nor a login is written, so no lock is taken.
    assert.deepEqual(pc.insideLock, []);
    // The placed file had to answer before it counted.
    assert.ok(pc.calls.some((call) => call.program === CLAUDE && call.args.includes('--version')));
  }));

test('a leftover a running Claude Code holds stays, and the repair still counts', () =>
  withRunner(stuckPc, async ({ runner, pc }) => {
    const remove = pc.files.remove;
    pc.files.remove = (path) => {
      if (path === OLD) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      remove(path);
    };
    runner.start({ items: ['claude'], mode: 'auto' });
    await runner.settled();
    assert.equal(statusOf(runner.progress(), 'claude'), 'done');
    assert.ok(pc.has(OLD));
    assert.ok(!pc.has(NEW));
    assert.match(pc.log(), /EBUSY/);
  }));

test('a placed build that does not answer is taken out again, and the install script runs', () =>
  withRunner(
    {
      ...stuckPc,
      on: (request, name, pc) => {
        if (name === 'claude' && !pc.downloads.includes(INSTALL_SCRIPT)) return exit(1);
        return scriptPutsClaude(request, name, pc);
      },
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['claude'], mode: 'auto' });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'claude'), 'done');
      assert.equal(scriptRan(pc), true);
      // What the restore placed did not stay; what is there now is the script's.
      assert.equal(pc.files.store.get(CLAUDE), undefined);
      assert.ok(![...pc.files.store.keys()].some((path) => path.includes('.restore-')));
      assert.match(pc.log(), /받아 둔 새 버전\(2\.1\.331\)을 제자리에 넣어요/);
    },
  ));

test('a build that cannot be copied falls back to the install script', () =>
  withRunner({ ...stuckPc, on: scriptPutsClaude }, async ({ runner, pc }) => {
    pc.files.copy = () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    };
    runner.start({ items: ['claude'], mode: 'auto' });
    await runner.settled();
    assert.equal(statusOf(runner.progress(), 'claude'), 'done');
    assert.equal(scriptRan(pc), true);
    assert.match(pc.log(), /EACCES/);
  }));

test('a claude.exe that appears meanwhile is kept, and the copy removed', () =>
  withRunner(stuckPc, async ({ runner, pc }) => {
    const copy = pc.files.copy;
    pc.files.copy = (from, to) => {
      copy(from, to);
      pc.files.store.set(CLAUDE, Buffer.from('put there by someone else'));
      pc.add(CLAUDE);
    };
    runner.start({ items: ['claude'], mode: 'auto' });
    await runner.settled();
    assert.equal(statusOf(runner.progress(), 'claude'), 'done');
    assert.equal(pc.files.store.get(CLAUDE).toString(), 'put there by someone else');
    assert.ok(![...pc.files.store.keys()].some((path) => path.includes('.restore-')));
    assert.equal(scriptRan(pc), false);
  }));

test('when nothing stopped midway, the install script runs as before and nothing is copied', () =>
  withRunner(
    { present: [BUILD], files: stuckPc.files, on: scriptPutsClaude },
    async ({ runner, pc }) => {
      runner.start({ items: ['claude'], mode: 'auto' });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'claude'), 'done');
      assert.equal(scriptRan(pc), true);
      assert.equal(pc.files.store.get(CLAUDE), undefined);
      assert.doesNotMatch(pc.log(), /받아 둔 새 버전/);
    },
  ));
