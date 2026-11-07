import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { symlinkSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists, realCheckDeps, runChecks } from '../src/core/setup/checks.ts';
import { readWindowsSnapshot } from '../src/core/setup/environment.ts';
import { COPY_PREVIOUS_EXPRESSION, isOlderSeries } from '../src/core/setup/install-blender.ts';
import { realInstallFiles } from '../src/core/setup/install-deps.ts';
import { catalog, PINS } from '../src/core/setup/manifest.ts';
import {
  APPDATA,
  BIN,
  CLAUDE_CONFIG,
  exit,
  fakePc,
  HOME,
  itemOf,
  LOCAL,
  NOTE,
  ok,
  pinnedHash,
  PROGRAMS,
  SECRET,
  SETTINGS,
  statusOf,
  until,
  withRunner,
} from './setup-install-helpers.mjs';

const GIT = `${PROGRAMS}\\Git\\cmd\\git.exe`;
const NODE = `${PROGRAMS}\\nodejs\\node.exe`;
const PY = `${LOCAL}\\Programs\\Python\\Launcher\\py.exe`;
const CLAUDE = `${BIN}\\claude.exe`;
const UV = `${BIN}\\uv.exe`;
const UVX = `${BIN}\\uvx.exe`;
const RHINO = `${PROGRAMS}\\Rhino 8\\System\\Rhino.exe`;
const BLENDER_ROOT = `${PROGRAMS}\\Blender Foundation`;
const BLENDER = `${BLENDER_ROOT}\\Blender 5.2\\blender.exe`;
const auto = (...items) => ({ items, mode: 'auto' });
const itemById = (id) => catalog.items.find((item) => item.id === id);
const timedOut = () => ({ code: null, stdout: '', stderr: '', timedOut: true });
const errno = (code) => Object.assign(new Error(code), { code });

// --- Finding 1: ~/.claude/CLAUDE.md and the Rhino settings file

const XML = (value) =>
  `<settings><child key="Options"><child key="FileSettings"><entry key="EnableFileLockingOpenWarning">${value}</entry></child></child></settings>`;
const NOTE_BACKUP = `${NOTE}.accountswitch-bak`;
const SETTINGS_BACKUP = `${SETTINGS}.accountswitch-bak`;

const noteCases = {
  'UTF-16 with its byte order mark, as PowerShell 5.1 > writes': Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('# 내 메모\r\n', 'utf16le'),
  ]),
  'UTF-16 without one, plain letters only': Buffer.from('# my notes\r\n', 'utf16le'),
  'CP949 Korean': Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0d, 0x0a]),
};

for (const [name, bytes] of Object.entries(noteCases))
  test(`a note file in ${name} keeps every byte and says so`, () =>
    withRunner(
      { present: [RHINO], files: { [SETTINGS]: XML('False'), [NOTE]: bytes } },
      async ({ runner, pc }) => {
        runner.start(auto('rhino', 'rhino-settings'));
        await runner.settled();
        const item = itemOf(runner.progress(), 'rhino-settings');
        assert.equal(item.status, 'needs-user');
        assert.match(item.message, /CLAUDE\.md/);
        assert.match(item.message, /UTF-8/);
        assert.deepEqual(pc.files.read(NOTE), bytes);
        assert.equal(pc.files.read(NOTE_BACKUP), undefined);
      },
    ));

/** A note file that exists, whose read fails with this error. */
const failingRead = (pc, path, code) => {
  const read = pc.files.read;
  pc.files.read = (file) => {
    if (file === path) throw errno(code);
    return read(file);
  };
};

test('a read error is not an empty file: the note is not replaced by the block', () =>
  withRunner(
    { present: [RHINO], files: { [SETTINGS]: XML('False'), [NOTE]: '# Mine\n' } },
    async ({ runner, pc }) => {
      failingRead(pc, NOTE, 'EBUSY');
      const writes = [];
      const write = pc.files.write;
      pc.files.write = (path, data) => {
        writes.push(path);
        write(path, data);
      };
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'rhino-settings');
      assert.equal(item.status, 'needs-user');
      assert.match(item.message, /읽지 못해서/);
      assert.equal(writes.includes(NOTE), false);
      assert.equal(pc.files.store.get(NOTE).toString(), '# Mine\n');
      assert.equal(pc.files.store.has(NOTE_BACKUP), false);
    },
  ));

test('only a file that does not exist counts as missing, and then it is created with no backup', () =>
  withRunner({ present: [RHINO], files: { [SETTINGS]: XML('True') } }, async ({ runner, pc }) => {
    runner.start(auto('rhino', 'rhino-settings'));
    await runner.settled();
    assert.ok(pc.files.read(NOTE).toString().startsWith('<!-- accountswitch:start -->'));
    assert.equal(pc.files.read(NOTE_BACKUP), undefined);
  }));

test('the note gets a backup before its first change, and later changes keep that first one', () =>
  withRunner(
    { present: [RHINO], files: { [SETTINGS]: XML('True'), [NOTE]: '# Mine\n' } },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(pc.files.read(NOTE_BACKUP).toString(), '# Mine\n');
      const first = pc.files.read(NOTE).toString();
      assert.ok(first.startsWith('# Mine\n'));
      pc.files.write(
        NOTE,
        first.replace(
          /start -->[^]*<!-- accountswitch:end/,
          'start -->\nold\n<!-- accountswitch:end',
        ),
      );
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(pc.files.read(NOTE_BACKUP).toString(), '# Mine\n');
      assert.equal(pc.files.read(NOTE).toString(), first);
    },
  ));

test('a backup that cannot be looked at or written stops the write', async () => {
  for (const breakIt of [
    (pc) => failingRead(pc, NOTE_BACKUP, 'EACCES'),
    (pc) => {
      pc.files.copy = () => {
        throw errno('ENOSPC');
      };
    },
  ])
    await withRunner(
      { present: [RHINO], files: { [SETTINGS]: XML('True'), [NOTE]: '# Mine\n' } },
      async ({ runner, pc }) => {
        breakIt(pc);
        runner.start(auto('rhino', 'rhino-settings'));
        await runner.settled();
        const item = itemOf(runner.progress(), 'rhino-settings');
        assert.equal(item.status, 'needs-user');
        assert.match(item.message, /바꾸지 못해서/);
        assert.equal(pc.files.store.get(NOTE).toString(), '# Mine\n');
      },
    );
});

test('a Rhino settings file that cannot be read is not called missing, and nothing changes', () =>
  withRunner(
    { present: [RHINO], files: { [SETTINGS]: XML('False'), [NOTE]: '# Mine\n' } },
    async ({ runner, pc }) => {
      failingRead(pc, SETTINGS, 'EBUSY');
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'rhino-settings');
      assert.equal(item.status, 'needs-user');
      assert.match(item.message, /Rhino 설정 파일을 읽거나 쓰지 못해서/);
      assert.doesNotMatch(item.message, /한 번 켰다가/);
      assert.equal(pc.files.store.get(SETTINGS).toString(), XML('False'));
      assert.equal(pc.files.store.has(SETTINGS_BACKUP), false);
    },
  ));

test('a Rhino backup that cannot be read is not overwritten with a later state', () =>
  withRunner(
    {
      present: [RHINO],
      files: {
        [SETTINGS]: XML('False'),
        [SETTINGS_BACKUP]: 'the first backup',
        [NOTE]: '# Mine\n',
      },
    },
    async ({ runner, pc }) => {
      failingRead(pc, SETTINGS_BACKUP, 'EBUSY');
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.equal(pc.files.store.get(SETTINGS_BACKUP).toString(), 'the first backup');
      assert.equal(pc.files.store.get(SETTINGS).toString(), XML('False'));
    },
  ));

test('a Rhino settings file in UTF-16 is left alone', () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(XML('False'), 'utf16le')]);
  return withRunner(
    { present: [RHINO], files: { [SETTINGS]: bytes, [NOTE]: '# Mine\n' } },
    async ({ runner, pc }) => {
      runner.start(auto('rhino', 'rhino-settings'));
      await runner.settled();
      assert.deepEqual(pc.files.read(SETTINGS), bytes);
      assert.equal(pc.files.read(SETTINGS_BACKUP), undefined);
    },
  );
});

test('the real read: undefined only for a missing file, and any other error reaches the caller', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'accountswitch-read-'));
  try {
    assert.equal(realInstallFiles.read(join(folder, 'none.md')), undefined);
    assert.throws(() => realInstallFiles.read(folder), /EISDIR/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

// --- Finding 2: no restart on its own, and the user hears about a pending one

test('every MSI and bundle fallback passes /norestart, and the Git one its own flag', () => {
  const fallback = (id) => itemById(id).install.steps.find((s) => s.kind === 'download-installer');
  assert.deepEqual(fallback('node').args, ['/i', '<file>', '/passive', '/norestart']);
  assert.deepEqual(fallback('blender').args, ['/i', '<file>', '/passive', '/norestart']);
  assert.deepEqual(fallback('python').args, [
    '/passive',
    '/norestart',
    'InstallAllUsers=0',
    'PrependPath=1',
  ]);
  assert.ok(fallback('git').args.includes('/NORESTART'));
});

test('exit 3010 with the program there: done, and the message asks for a restart', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(1);
        if (name === 'msiexec') {
          pc.add(NODE);
          return exit(3010);
        }
      },
    },
    async ({ runner }) => {
      runner.start(auto('node'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'done');
      assert.match(item.message, /PC를 다시 시작/);
    },
  ));

test('exit 1641: the message says to save open files', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(1);
        if (name === 'msiexec') {
          pc.add(NODE);
          return exit(1641);
        }
      },
    },
    async ({ runner }) => {
      runner.start(auto('node'));
      await runner.settled();
      assert.match(itemOf(runner.progress(), 'node').message, /저장하세요/);
    },
  ));

test('exit 3010 with the program not found yet: needs-user, and the run goes on', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(3010) : undefined) },
    async ({ runner, pc }) => {
      runner.start(auto('node', 'env'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'needs-user');
      assert.equal(item.reason, 'REBOOT_PENDING');
      assert.match(item.message, /PC를 다시 시작/);
      assert.equal(pc.named('msiexec').length, 0, 'no second installer before the restart');
      assert.equal(runner.progress().phase, 'finished');
    },
  ));

// --- Finding 3: a Blender outside the known folder

const BLENDER_ITEM = [itemById('blender')];
const elsewhere = (over = {}) => ({
  name: 'Blender',
  version: '5.1.0',
  location: 'D:\\프로그램\\Blender\\',
  ...over,
});

test('a Blender found in the registry only: version-mismatch with its version, never started', async () => {
  const pc = fakePc({
    present: ['D:\\프로그램\\Blender\\blender.exe'],
    blenderInstalls: [elsewhere()],
  });
  const [result] = (await runChecks(pc.check, BLENDER_ITEM)).results;
  assert.equal(result.status, 'version-mismatch');
  assert.equal(result.foundVersion, '5.1.0');
  assert.match(result.message, /D:\\프로그램\\Blender/, 'Korean survives');
  assert.equal(pc.named('blender').length, 0);
});

test('the pinned version outside the known folder still is not the one the add-on step can use', async () => {
  const pc = fakePc({ blenderInstalls: [elsewhere({ version: PINS.blender, location: '' })] });
  const [result] = (await runChecks(pc.check, BLENDER_ITEM)).results;
  assert.equal(result.status, 'version-mismatch');
  assert.equal(result.foundVersion, PINS.blender);
});

test('the highest of several, no version is fine, and other programs named Blender do not count', async () => {
  const check = async (blenderInstalls, present = []) => {
    const pc = fakePc({ present, blenderInstalls });
    return (await runChecks(pc.check, BLENDER_ITEM)).results[0];
  };
  const several = await check([
    elsewhere({ version: '4.5.2', location: null }),
    elsewhere({ version: '5.1.0', location: null }),
  ]);
  assert.equal(several.foundVersion, '5.1.0');
  const steam = await check([{ name: 'Blender', version: null, location: null }]);
  assert.equal(steam.status, 'version-mismatch');
  assert.equal(steam.foundVersion, undefined);
  assert.equal(
    (await check([elsewhere({ name: 'Blender 4.5 LTS', location: null })])).status,
    'version-mismatch',
  );
  for (const name of ['Blender Launcher', 'BlenderKit', 'Blender Tools 2'])
    assert.equal((await check([elsewhere({ name, location: null })])).status, 'missing', name);
});

test('an uninstall entry whose folder has no blender.exe is a leftover', async () => {
  const pc = fakePc({ blenderInstalls: [elsewhere()] });
  const [result] = (await runChecks(pc.check, BLENDER_ITEM)).results;
  assert.equal(result.status, 'missing');
});

test('the known folder answers first; the registry is only for when it holds nothing', async () => {
  const pc = fakePc({
    present: [BLENDER, 'D:\\프로그램\\Blender\\blender.exe'],
    folders: { [BLENDER_ROOT]: ['Blender 5.2'] },
    blenderInstalls: [elsewhere()],
  });
  const [result] = (await runChecks(pc.check, BLENDER_ITEM)).results;
  assert.equal(result.status, 'installed');
  assert.equal(result.foundVersion, PINS.blender);
});

test('no snapshot means the answer is unknown, not missing', async () => {
  const pc = fakePc();
  pc.snapshotFails = true;
  const [result] = (await runChecks(pc.check, BLENDER_ITEM)).results;
  assert.equal(result.status, 'error');
});

test('auto mode keeps a Blender found in the registry and winget never runs', () =>
  withRunner(
    { present: ['D:\\프로그램\\Blender\\blender.exe'], blenderInstalls: [elsewhere()] },
    async ({ runner, pc }) => {
      runner.start(auto('blender'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'blender');
      assert.equal(item.status, 'skipped');
      assert.equal(item.reason, 'OTHER_VERSION_KEPT');
      assert.equal(pc.named('winget').length, 0);
    },
  ));

test('the snapshot reads the three Uninstall keys, reads only, and asks for UTF-8', async () => {
  let script = '';
  const run = async (request) => {
    script = request.args.at(-1);
    return exit(1);
  };
  await readWindowsSnapshot(run, { SystemRoot: 'C:\\Windows' }, HOME);
  const path = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
  assert.ok(script.includes(`'HKLM:\\${path}'`));
  assert.ok(script.includes(`'HKCU:\\${path}'`));
  assert.ok(
    script.includes(
      `'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'`,
    ),
  );
  assert.ok(script.includes('UTF8Encoding'));
  assert.ok(script.includes('-ErrorAction SilentlyContinue'));
  assert.doesNotMatch(script, /Set-Item|New-Item|Remove-Item|SetValue|Start-Process|blender\.exe/i);
});

test('a list in an unexpected shape loses only that list, not the rest of the snapshot', async () => {
  const answer = (blenderInstalls) => async () =>
    ok(
      JSON.stringify({
        machinePath: 'C:\\A',
        userPath: 'C:\\B',
        pythonUtf8: null,
        documents: null,
        executionPolicy: {},
        blenderInstalls,
      }),
    );
  for (const odd of [{ name: 'Blender' }, 'Blender', [{ version: 1 }], undefined]) {
    const snapshot = await readWindowsSnapshot(answer(odd), { SystemRoot: 'C:\\W' }, HOME);
    assert.deepEqual(snapshot.blenderInstalls, []);
    assert.equal(snapshot.machinePath, 'C:\\A');
  }
  const korean = await readWindowsSnapshot(answer([elsewhere()]), { SystemRoot: 'C:\\W' }, HOME);
  assert.equal(korean.blenderInstalls[0].location, 'D:\\프로그램\\Blender\\');
});

// --- Finding 4: a check after a step that cannot answer

test('winget exit 0, then Blender does not answer: failed, and the MSI does not run', () =>
  withRunner(
    {
      folders: { [BLENDER_ROOT]: ['Blender 5.2'] },
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(BLENDER);
          return ok();
        }
        if (name === 'blender') return timedOut();
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('blender'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'blender');
      assert.equal(item.status, 'failed');
      assert.equal(item.reason, 'CHECK_FAILED');
      assert.equal(pc.named('msiexec').length, 0);
      assert.equal(pc.downloads.length, 0);
    },
  ));

test('a check that errors after a step is the same as one that times out', () =>
  withRunner(
    {
      folders: { [BLENDER_ROOT]: ['Blender 5.2'] },
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(BLENDER);
          return exit(1);
        }
        if (name === 'blender') return ok('no version here');
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('blender'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'blender').reason, 'CHECK_FAILED');
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

// --- Finding 5: winget's own exit codes (returnCodes.md)

const STOPS = [
  [0x8a15002b, 2316632107, 'WINGET_ALREADY_INSTALLED', 'failed', /이미 설치/],
  [0x8a15010d, 2316632333, 'WINGET_ALREADY_INSTALLED', 'failed', /이미 설치/],
  [0x8a150061, 2316632161, 'WINGET_ALREADY_INSTALLED', 'failed', /이미 설치/],
  [0x8a15010e, 2316632334, 'WINGET_NEWER_INSTALLED', 'needs-user', /더 높은 버전/],
  [0x8a15010f, 2316632335, 'WINGET_BLOCKED_BY_POLICY', 'needs-user', /정책/],
  [0x8a15003a, 2316632122, 'WINGET_BLOCKED_BY_POLICY', 'needs-user', /정책/],
  [0x8a150102, 2316632322, 'WINGET_INSTALL_IN_PROGRESS', 'failed', /다른 설치/],
  [0x8a150101, 2316632321, 'WINGET_APP_IN_USE', 'failed', /쓰이고/],
  [0x8a150103, 2316632323, 'WINGET_APP_IN_USE', 'failed', /쓰이고/],
  [0x8a150111, 2316632337, 'WINGET_APP_IN_USE', 'failed', /쓰이고/],
  [0x8a150105, 2316632325, 'WINGET_DISK_FULL', 'failed', /디스크/],
  [0x8a150109, 2316632329, 'WINGET_REBOOT_REQUIRED', 'needs-user', /PC를 다시 시작/],
  [0x8a15010a, 2316632330, 'WINGET_REBOOT_REQUIRED', 'needs-user', /PC를 다시 시작/],
  [0x8a15010b, 2316632331, 'WINGET_REBOOT_REQUIRED', 'needs-user', /저장하세요/],
];

for (const [hex, unsigned, reason, status, message] of STOPS) {
  const name = `0x${hex.toString(16).toUpperCase()}`;
  test(`winget ${name} ends the item as ${reason}, with no fallback`, async () => {
    assert.equal(hex, unsigned);
    // Unsigned as SPEC 3.6 says, and negative too, as `judge` has always allowed.
    for (const code of [unsigned, unsigned | 0])
      await withRunner(
        { on: (request, command) => (command === 'winget' ? exit(code) : undefined) },
        async ({ runner, pc }) => {
          runner.start(auto('node'));
          await until(() => runner.progress().items[0].status === status);
          const item = itemOf(runner.progress(), 'node');
          assert.equal(item.reason, reason);
          assert.match(item.message, message);
          assert.equal(pc.named('msiexec').length, 0);
          assert.equal(pc.downloads.length, 0);
        },
      );
  });
}

test('already installed and no applicable upgrade are checked again, and that can be done', async () => {
  for (const code of [2316632107, 2316632333, 2316632161])
    await withRunner(
      {
        on: (request, name, pc) => {
          if (name === 'winget') {
            pc.add(NODE);
            return exit(code);
          }
        },
      },
      async ({ runner }) => {
        runner.start(auto('node'));
        await runner.settled();
        const item = itemOf(runner.progress(), 'node');
        assert.equal(item.status, 'done');
        assert.equal(item.message, undefined);
      },
    );
});

test('restart needed to finish, with the program there: done, and it says to restart', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(NODE);
          return exit(2316632329);
        }
      },
    },
    async ({ runner }) => {
      runner.start(auto('node'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'done');
      assert.match(item.message, /PC를 다시 시작/);
    },
  ));

test('a policy block leaves the run going; an install in progress stops to offer a retry', async () => {
  await withRunner(
    { on: (request, name) => (name === 'winget' ? exit(2316632335) : undefined) },
    async ({ runner }) => {
      runner.start(auto('node', 'env'));
      await runner.settled();
      assert.equal(runner.progress().phase, 'finished');
    },
  );
  await withRunner(
    { on: (request, name) => (name === 'winget' ? exit(2316632322) : undefined) },
    async ({ runner }) => {
      runner.start(auto('node', 'env'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(statusOf(runner.progress(), 'env'), 'pending');
    },
  );
});

test('a code off the list still falls back, and the declined code still ends it as before', async () => {
  await withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(0x8a150011 | 0); // INSTALLER_HASH_MISMATCH
        if (name === 'msiexec') {
          pc.add(NODE);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(pc.named('msiexec').length, 1);
    },
  );
  await withRunner(
    { on: (request, name) => (name === 'winget' ? exit(2316632332) : undefined) },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'node').reason, 'ELEVATION_DECLINED');
      assert.equal(pc.named('msiexec').length, 0);
    },
  );
});

// --- Finding 7: installers are checked against the published hash

test('every fixed installer carries the hash its project publishes, and SPEC says the same', () => {
  const published = {
    'Git-2.56.0.4-64-bit.exe': '4961a4a8cc778d8b6e00a5819e5fe4d078b754555aff7aedc2d77a5d74c2de80',
    'node-v24.22.1-x64.msi': '3bda4baf1ee709b33cf920dd633106ddb23951e322bff9c03ec9f64ab8981b01',
    'python-3.13.17-amd64.exe': '5da012101ba2e17113a9a1cd901e9ce1441086f2b7ecb5de06ec94163899a190',
    'blender-5.2.3-windows-x64.msi':
      'a103d4ece8d9acffd2a95c9d8860355b1f209977cc983b4a3d1e1cfb441c8605',
  };
  const spec = readFileSync(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
  const steps = catalog.items
    .flatMap((item) => item.install.steps)
    .filter((step) => step.kind === 'download-installer');
  assert.equal(steps.length, Object.keys(published).length);
  for (const step of steps) {
    assert.match(step.sha256, /^[0-9a-f]{64}$/, step.url);
    const file = step.url.split('/').pop();
    assert.equal(step.sha256, published[file], file);
    assert.ok(spec.includes(`| \`${file}\` | \`${step.sha256}\` |`), `SPEC names ${file}`);
    assert.equal(pinnedHash(file), step.sha256);
  }
});

test('a download that does not match its hash never runs, and is not left behind', () =>
  withRunner(
    {
      on: (request, name) => (name === 'winget' ? exit(1) : undefined),
      fetch: async () => new Response('tampered bytes'),
    },
    async ({ runner, pc }) => {
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.status, 'failed');
      assert.equal(item.reason, 'HASH_MISMATCH');
      assert.equal(pc.named('msiexec').length, 0);
      assert.deepEqual(
        [...pc.files.store.keys()].filter((path) => path.endsWith('.msi')),
        [],
      );
    },
  ));

test('the hash is of the file on disk after it was saved, not of what came over the wire', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(1) : undefined) },
    async ({ runner, pc }) => {
      const save = pc.files.save;
      pc.files.save = async (path, ...rest) => {
        await save(path, ...rest);
        pc.files.store.set(path, Buffer.from('changed on disk'));
      };
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'node').reason, 'HASH_MISMATCH');
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

test('a file that cannot be hashed does not run either', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(1) : undefined) },
    async ({ runner, pc }) => {
      pc.files.hash = async () => {
        throw errno('EBUSY');
      };
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'node');
      assert.equal(item.reason, 'HASH_MISMATCH');
      assert.match(item.message, /확인하지 못해서/);
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

test('a cancel while the hash is being checked starts nothing', () =>
  withRunner(
    { on: (request, name) => (name === 'winget' ? exit(1) : undefined) },
    async ({ runner, pc }) => {
      const hash = pc.files.hash;
      pc.files.hash = async (path) => {
        runner.cancel();
        return hash(path);
      };
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(runner.progress().phase, 'cancelled');
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

test('the real hash is SHA-256 of the file, and a missing file throws', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'accountswitch-hash-'));
  try {
    const path = join(folder, 'x.msi');
    await writeFile(path, 'payload');
    assert.equal(
      await realInstallFiles.hash(path),
      createHash('sha256').update('payload').digest('hex'),
    );
    await assert.rejects(realInstallFiles.hash(join(folder, 'none.msi')));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

// --- Finding 8: a re-registration that fails puts the old entry back

const OLD_ENTRY = {
  type: 'stdio',
  command: 'uvx',
  args: ['rhinomcp@0.3.0'],
  env: { RHINO_TOKEN: SECRET, RHINO_MCP_HOST: '10.0.0.5' },
};
const oldConfig = () =>
  JSON.stringify({ oauthAccount: { emailAddress: 'nobody' }, mcpServers: { rhino: OLD_ENTRY } });
const REPLACE = { items: ['rhinomcp-mcp'], mode: 'auto', replace: ['rhinomcp-mcp'] };

/** `claude mcp` on the pretend config. `add` and `addJson` say how those two end. */
function claudeMcp({ add = () => exit(1, SECRET), addJson = () => ok() } = {}) {
  return (request, name, pc) => {
    if (name !== 'claude' || request.args[0] !== 'mcp') return undefined;
    const config = JSON.parse(pc.files.read(CLAUDE_CONFIG).toString());
    if (request.args[1] === 'remove') {
      delete config.mcpServers[request.args.at(-1)];
      pc.files.write(CLAUDE_CONFIG, JSON.stringify(config));
      return ok();
    }
    if (request.args[1] === 'add') return add(pc, config);
    if (request.args[1] === 'add-json') {
      const answer = addJson();
      if (answer.code === 0) {
        config.mcpServers[request.args[4]] = JSON.parse(request.args[5]);
        pc.files.write(CLAUDE_CONFIG, JSON.stringify(config));
      }
      return answer;
    }
  };
}
const mcpCalls = (pc) => pc.named('claude').filter((call) => call.args[0] === 'mcp');
const noLeak = (runner, pc) => {
  assert.ok(!pc.log().includes(SECRET), 'not in the log');
  assert.ok(!JSON.stringify(runner.progress()).includes(SECRET), 'not in progress');
};

test('a failed add restores the entry whole, custom env included, inside the lock', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: claudeMcp(),
    },
    async ({ runner, pc }) => {
      runner.start(REPLACE);
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'rhinomcp-mcp');
      assert.equal(item.status, 'failed');
      assert.equal(item.reason, 'MCP_FAILED');
      assert.match(item.message, /원래 설정으로 되돌렸어요/);
      assert.deepEqual(
        mcpCalls(pc).map((call) => call.args[1]),
        ['remove', 'add', 'add-json'],
      );
      const restore = mcpCalls(pc)[2];
      assert.deepEqual(restore.args.slice(0, 5), ['mcp', 'add-json', '-s', 'user', 'rhino']);
      assert.deepEqual(JSON.parse(restore.args[5]), OLD_ENTRY);
      assert.ok(pc.insideLock.includes(restore), 'inside the lock');
      assert.equal(restore.env.CLAUDE_CONFIG_DIR, undefined);
      assert.deepEqual(JSON.parse(pc.files.read(CLAUDE_CONFIG)).mcpServers.rhino, OLD_ENTRY);
      noLeak(runner, pc);
    },
  ));

test('only that one server travels: nothing else of ~/.claude.json reaches the command', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: claudeMcp(),
    },
    async ({ runner, pc }) => {
      runner.start(REPLACE);
      await until(() => runner.progress().phase === 'waiting');
      assert.ok(!mcpCalls(pc)[2].args[5].includes('oauthAccount'));
    },
  ));

test('when the restore fails too, it says so plainly, and no secret goes with it', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: claudeMcp({ addJson: () => exit(1, SECRET) }),
    },
    async ({ runner, pc }) => {
      runner.start(REPLACE);
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'rhinomcp-mcp');
      assert.equal(item.reason, 'MCP_RESTORE_FAILED');
      assert.match(item.message, /되돌리지 못했어요/);
      assert.match(item.message, /직접 다시 등록/);
      noLeak(runner, pc);
    },
  ));

test('an add that times out or is cancelled restores too, past the end of the item', async () => {
  for (const [answer, reason] of [
    [timedOut(), 'TIMEOUT'],
    [{ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true }, 'CANCELLED'],
  ])
    await withRunner(
      {
        present: [CLAUDE, UV, UVX],
        files: { [CLAUDE_CONFIG]: oldConfig() },
        on: claudeMcp({ add: () => answer }),
      },
      async ({ runner, pc }) => {
        runner.start(REPLACE);
        await until(() => runner.progress().phase === 'waiting');
        const item = itemOf(runner.progress(), 'rhinomcp-mcp');
        assert.equal(item.reason, reason);
        assert.match(item.message, /원래 설정으로 되돌렸어요/);
        const restore = mcpCalls(pc).at(-1);
        assert.equal(restore.args[1], 'add-json');
        assert.equal(restore.signal, undefined, 'a cancel must not stop the restore');
        assert.ok(restore.timeoutMs > 0);
        assert.deepEqual(JSON.parse(pc.files.read(CLAUDE_CONFIG)).mcpServers.rhino, OLD_ENTRY);
        noLeak(runner, pc);
      },
    );
});

test('a successful re-registration does not restore anything', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: claudeMcp({
        add: (pc, config) => {
          config.mcpServers.rhino = { command: 'uvx', args: [`rhinomcp@${PINS.rhinomcp}`] };
          pc.files.write(CLAUDE_CONFIG, JSON.stringify(config));
          return ok();
        },
      }),
    },
    async ({ runner, pc }) => {
      runner.start(REPLACE);
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'rhinomcp-mcp'), 'done');
      assert.deepEqual(
        mcpCalls(pc).map((call) => call.args[1]),
        ['remove', 'add'],
      );
    },
  ));

test('a config that cannot be read at that moment: nothing is removed', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: claudeMcp(),
    },
    async ({ runner, pc }) => {
      // The check reads it first and answers version-mismatch; the step then finds it broken.
      const read = pc.check.readFile;
      let reads = 0;
      pc.check.readFile = (path) =>
        path === CLAUDE_CONFIG && ++reads > 1 ? Buffer.from('{') : read(path);
      runner.start(REPLACE);
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'rhinomcp-mcp');
      assert.equal(item.status, 'failed');
      assert.match(item.message, /그대로 뒀어요/);
      assert.equal(mcpCalls(pc).length, 0);
    },
  ));

test('a failed remove keeps the entry and does not try to add', () =>
  withRunner(
    {
      present: [CLAUDE, UV, UVX],
      files: { [CLAUDE_CONFIG]: oldConfig() },
      on: (request, name) =>
        name === 'claude' && request.args[1] === 'remove' ? exit(1) : undefined,
    },
    async ({ runner, pc }) => {
      runner.start(REPLACE);
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'rhinomcp-mcp').reason, 'MCP_FAILED');
      assert.deepEqual(
        mcpCalls(pc).map((call) => call.args[1]),
        ['remove'],
      );
    },
  ));

// --- Finding 10: cleanup never changes the outcome

const stuckFile = (pc) => {
  pc.files.remove = () => {
    throw errno('EPERM');
  };
};

test('an installer that timed out and still holds its file stays a TIMEOUT', () =>
  withRunner(
    {
      on: (request, name) => {
        if (name === 'winget') return exit(1);
        if (name === 'msiexec') return timedOut();
      },
    },
    async ({ runner, pc }) => {
      stuckFile(pc);
      runner.start(auto('node'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'node').reason, 'TIMEOUT');
      assert.match(pc.log(), /임시 파일을 지우지 못했어요/);
    },
  ));

test('an installer that worked stays done when its file cannot be removed', () =>
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
      stuckFile(pc);
      runner.start(auto('node'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'node'), 'done');
    },
  ));

test('a script that timed out and cannot be removed stays a TIMEOUT', () =>
  withRunner(
    {
      fetch: async () => new Response('# script'),
      on: (request, name) =>
        name === 'powershell' && request.args.at(-1).includes('ACCOUNTSWITCH_SCRIPT')
          ? timedOut()
          : undefined,
    },
    async ({ runner, pc }) => {
      stuckFile(pc);
      runner.start(auto('uv'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'uv').reason, 'TIMEOUT');
    },
  ));

// --- Finding 11: app-execution aliases

test('the real exists finds a link whose target cannot be followed, like an execution alias', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'accountswitch-alias-'));
  try {
    const link = join(folder, 'py.exe');
    symlinkSync(join(folder, 'nowhere'), link, 'junction');
    assert.equal(pathExists(link), true);
    assert.equal(pathExists(join(folder, 'none.exe')), false);
    assert.equal(pathExists(folder), true);
    assert.equal(realCheckDeps({ exclusive: (task) => task() }).exists, pathExists);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a py that exists only as an alias on PATH is found and asked, so no second Python', async () => {
  const windowsApps = `${LOCAL}\\Microsoft\\WindowsApps`;
  const pc = fakePc({ present: [`${windowsApps}\\py.exe`], userPath: windowsApps });
  const [result] = (await runChecks(pc.check, [itemById('python')])).results;
  assert.equal(result.status, 'installed');
  assert.equal(pc.named('py')[0].program, `${windowsApps}\\py.exe`);
});

// --- Finding 12: Blender's offer to import the previous version's settings

const ADDON_BYTES = Buffer.from('# the add-on\n');
const USER_PREFS = `${APPDATA}\\Blender Foundation\\Blender\\5.2\\config\\userpref.blend`;
const ADDON_FILE = `${APPDATA}\\Blender Foundation\\Blender\\5.2\\scripts\\addons\\blender_mcp_addon.py`;
const VERSIONS = `${APPDATA}\\Blender Foundation\\Blender`;

async function withPinnedAddon(body) {
  const step = itemById('blender-mcp-addon').install.steps[0];
  const original = step.sha256;
  step.sha256 = createHash('sha256').update(ADDON_BYTES).digest('hex');
  try {
    await body();
  } finally {
    step.sha256 = original;
  }
}

const isCopy = (request) => request.args.includes(COPY_PREVIOUS_EXPRESSION);
const isAddon = (request) =>
  request.args.includes('--python-expr') && !request.args.includes(COPY_PREVIOUS_EXPRESSION);

function addonRun({ versions = [], prefs = false, copy = () => ok() }) {
  return {
    present: [BLENDER, ...(prefs ? [USER_PREFS] : [])],
    folders: { [BLENDER_ROOT]: ['Blender 5.2'], [VERSIONS]: versions },
    files: prefs ? { [USER_PREFS]: 'BLENDER-v502\0' } : {},
    fetch: async () => new Response(ADDON_BYTES),
    on: (request, name, pc) => {
      if (name !== 'blender') return undefined;
      if (isCopy(request)) return copy();
      if (isAddon(request)) {
        pc.add(ADDON_FILE);
        pc.files.write(USER_PREFS, Buffer.from('BLENDER-v502\0blender_mcp_addon\0'));
        return ok();
      }
    },
  };
}
const blenderRuns = (pc) =>
  pc.named('blender').filter((call) => call.args.includes('--python-expr'));

test('no 5.2 prefs and an older folder: settings are copied first, in a run of their own', () =>
  withPinnedAddon(() =>
    withRunner(addonRun({ versions: ['4.5', '5.1'] }), async ({ runner, pc }) => {
      runner.start(auto('blender-mcp-addon'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'blender-mcp-addon');
      assert.equal(item.status, 'done');
      assert.equal(item.message, undefined);
      const runs = blenderRuns(pc);
      assert.equal(runs.length, 2);
      assert.ok(isCopy(runs[0]), 'the copy comes first');
      assert.ok(isAddon(runs[1]));
      assert.deepEqual(runs[0].args, [
        '-b',
        '--python-exit-code',
        '1',
        '--python-expr',
        'import bpy\nbpy.ops.preferences.copy_prev()',
      ]);
      assert.ok(!runs[0].args.includes('--factory-startup'));
      assert.ok(runs[0].timeoutMs <= 5 * 60 * 1000, 'it cannot use up the item');
    }),
  ));

test('prefs of 5.2 already there: their settings stand, and nothing is copied', () =>
  withPinnedAddon(() =>
    withRunner(addonRun({ versions: ['5.1'], prefs: true }), async ({ runner, pc }) => {
      runner.start(auto('blender-mcp-addon'));
      await runner.settled();
      assert.equal(blenderRuns(pc).length, 1);
      assert.ok(isAddon(blenderRuns(pc)[0]));
    }),
  ));

test('no older version folder: nothing to copy', async () => {
  for (const versions of [[], ['5.2'], ['5.3', '6.0'], ['scripts', 'config']])
    await withPinnedAddon(() =>
      withRunner(addonRun({ versions }), async ({ runner, pc }) => {
        runner.start(auto('blender-mcp-addon'));
        await runner.settled();
        assert.equal(blenderRuns(pc).length, 1, versions.join());
      }),
    );
});

test('the copy failing or timing out does not stop the add-on, and the message says so', async () => {
  for (const copy of [() => exit(1), () => timedOut()])
    await withPinnedAddon(() =>
      withRunner(addonRun({ versions: ['5.1'], copy }), async ({ runner, pc }) => {
        runner.start(auto('blender-mcp-addon'));
        await runner.settled();
        const item = itemOf(runner.progress(), 'blender-mcp-addon');
        assert.equal(item.status, 'done');
        assert.match(item.message, /이전 버전 Blender의 설정을 가져오지 못했어요/);
        assert.equal(blenderRuns(pc).length, 2);
      }),
    );
});

test('a cancel during the copy stays a cancel: the add-on does not start', () =>
  withPinnedAddon(() =>
    withRunner(
      addonRun({
        versions: ['5.1'],
        copy: () => ({ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true }),
      }),
      async ({ runner, pc }) => {
        runner.start(auto('blender-mcp-addon'));
        await until(() => runner.progress().phase === 'waiting');
        assert.equal(itemOf(runner.progress(), 'blender-mcp-addon').reason, 'CANCELLED');
        assert.equal(blenderRuns(pc).length, 1);
      },
    ),
  ));

test('a wrong add-on hash changes nothing: not even the settings copy starts', () =>
  withRunner(
    { ...addonRun({ versions: ['5.1'] }), fetch: async () => new Response('tampered') },
    async ({ runner, pc }) => {
      runner.start(auto('blender-mcp-addon'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'blender-mcp-addon').reason, 'HASH_MISMATCH');
      assert.equal(blenderRuns(pc).length, 0);
    },
  ));

test('older compares numbers, not text', () => {
  assert.equal(isOlderSeries('5.1', '5.2'), true);
  assert.equal(isOlderSeries('4.10', '5.2'), true);
  assert.equal(isOlderSeries('5.10', '5.2'), false);
  assert.equal(isOlderSeries('5.2', '5.2'), false);
  assert.equal(isOlderSeries('6.0', '5.2'), false);
  assert.equal(isOlderSeries('config', '5.2'), false);
});

// --- Half-installed Git

const brokenGit = (over) => (request, name, pc) => {
  if (name === 'winget') {
    pc.add(GIT);
    return ok();
  }
  if (name === 'git') return exit(1);
  return over?.(request, name, pc);
};

test('git.exe there but git --version failing: the install is not done', () =>
  withRunner({ on: brokenGit() }, async ({ runner, pc }) => {
    runner.start(auto('git'));
    await until(() => runner.progress().phase === 'waiting');
    const item = itemOf(runner.progress(), 'git');
    assert.equal(item.status, 'failed');
    assert.equal(item.reason, 'NOT_DETECTED');
    assert.equal(pc.named('winget').length, 1);
    assert.equal(pc.downloads.length, 1, 'the fallback got its turn');
  }));

test('a retry of that is not fooled by the file either, and a working Git then counts', () => {
  let fixed = false;
  return withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return ok();
        }
        if (name === 'git') return fixed ? ok('git version 2.56.0') : exit(1);
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      const before = pc.named('winget').length;
      runner.retry('git');
      await until(
        () =>
          runner.progress().phase === 'waiting' && statusOf(runner.progress(), 'git') === 'failed',
      );
      assert.ok(pc.named('winget').length > before, 'it tried again, not "already installed"');
      fixed = true;
      runner.retry('git');
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
    },
  );
});

test('a git --version that does not answer after an install is unknown, not done', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') {
          pc.add(GIT);
          return ok();
        }
        if (name === 'git') return timedOut();
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('git'));
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'git').reason, 'CHECK_FAILED');
      assert.equal(pc.downloads.length, 0);
    },
  ));

test('for an existing user nothing changes: the plain check and a first run accept the file', async () => {
  const pc = fakePc({
    present: [GIT],
    on: (request, name) => (name === 'git' ? exit(1) : undefined),
  });
  const [result] = (await runChecks(pc.check, [itemById('git')])).results;
  assert.equal(result.status, 'installed');
  await withRunner(
    { present: [GIT], on: (request, name) => (name === 'git' ? exit(1) : undefined) },
    async ({ runner, pc: runnerPc }) => {
      runner.start(auto('git'));
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'git'), 'done');
      assert.equal(runnerPc.named('winget').length, 0);
    },
  );
});

test('the other checks are not affected by the bar set after an install', async () => {
  const pc = fakePc({ present: [PY] });
  const [result] = (await runChecks(pc.check, [itemById('python')], { requireCommand: true }))
    .results;
  assert.equal(result.status, 'installed');
  assert.equal(pc.named('py').length, 1);
});

// --- GPT's connections (SPEC 3.7)

const CODEX = `${APPDATA}\\npm\\codex.cmd`;
const CODEX_CONFIG = `${HOME}\\.codex\\config.toml`;
const codexCalls = (pc) => pc.named('codex').filter((call) => call.args[0] === 'mcp');

test('a GPT connection is added with no lock, no account folder and nothing logged', () =>
  withRunner(
    {
      present: [CODEX, UV, UVX],
      on: (request, name, pc) => {
        if (name !== 'codex' || request.args[0] !== 'mcp') return undefined;
        pc.files.write(
          CODEX_CONFIG,
          '[mcp_servers.blender]\ncommand = "uvx"\nargs = ["blender-mcp@1.5.5"]\n',
        );
        return ok(SECRET);
      },
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['blender-mcp-codex'], mode: 'auto' });
      await runner.settled();
      assert.equal(statusOf(runner.progress(), 'blender-mcp-codex'), 'done');
      const [add] = codexCalls(pc);
      assert.deepEqual(add.args, [
        'mcp',
        'add',
        'blender',
        '--env',
        'DISABLE_TELEMETRY=true',
        '--',
        'uvx',
        'blender-mcp@1.5.5',
      ]);
      assert.equal(add.env.CODEX_HOME, undefined);
      assert.ok(!pc.insideLock.includes(add), 'no lock');
      assert.ok(!pc.log().includes(SECRET), 'output is not logged');
    },
  ));

test('a GPT connection registered differently needs the confirmation, and is then replaced in place', async () => {
  const files = {
    [CODEX_CONFIG]: '[mcp_servers.rhino]\ncommand = "uvx"\nargs = ["rhinomcp@0.3.0"]\n',
  };
  const on = (request, name) => (name === 'codex' && request.args[0] === 'mcp' ? ok() : undefined);
  await withRunner({ present: [CODEX, UV, UVX], files, on }, async ({ runner, pc }) => {
    runner.start({ items: ['rhinomcp-codex'], mode: 'auto' });
    await until(() => itemOf(runner.progress(), 'rhinomcp-codex').status === 'needs-user');
    assert.equal(itemOf(runner.progress(), 'rhinomcp-codex').reason, 'REPLACE_NOT_CONFIRMED');
    assert.equal(codexCalls(pc).length, 0);
  });
  await withRunner({ present: [CODEX, UV, UVX], files, on }, async ({ runner, pc }) => {
    runner.start({ items: ['rhinomcp-codex'], mode: 'auto', replace: ['rhinomcp-codex'] });
    await until(() => codexCalls(pc).length > 0);
    assert.deepEqual(
      codexCalls(pc).map((call) => call.args[1]),
      ['add'],
    );
  });
});

test('a failed GPT connection says so, in the words of Codex CLI', () =>
  withRunner(
    {
      present: [CODEX, UV, UVX],
      on: (request, name) =>
        name === 'codex' && request.args[0] === 'mcp' ? exit(1, SECRET) : undefined,
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['cordyceps-codex'], mode: 'auto' });
      await until(() => runner.progress().phase === 'waiting');
      const item = itemOf(runner.progress(), 'cordyceps-codex');
      assert.equal(item.status, 'failed');
      assert.match(item.message, /Codex CLI/);
      noLeak(runner, pc);
    },
  ));
