// SPEC 3.3 Paseo (#23) and SPEC 3.11 pluginsEnabled (#44): installing Paseo, its one desktop
// setting, the restart note, and the plugin switch. Everything runs on a pretend PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAiContent } from '../src/core/setup/ai-content.ts';
import { DEFAULT_PREFS, planAiSettings } from '../src/core/setup/ai-settings.ts';
import { catalog } from '../src/core/setup/manifest.ts';
import { keepRunningState, withKeepRunning } from '../src/core/setup/paseo-desktop.ts';
import { cardGroups, initialPicks } from '../src/ui/setup-logic.ts';
import {
  APPDATA,
  BIN,
  exit,
  HOME,
  itemOf,
  LATEST_URLS,
  LOCAL,
  ok,
  PROGRAMS,
  withRunner,
} from './setup-install-helpers.mjs';

const byId = new Map(catalog.items.map((item) => [item.id, item]));
const MINE = `${LOCAL}\\Programs\\Paseo\\Paseo.exe`;
const EVERYONE = `${PROGRAMS}\\Paseo\\Paseo.exe`;
const DESKTOP = `${APPDATA}\\Paseo\\desktop-settings.json`;
const CLAUDE = `${BIN}\\claude.exe`;
const auto = (...items) => ({ items, mode: 'auto' });

/** A desktop-settings.json as Paseo 0.17.4 writes it. */
const desktop = ({ keep = false, applied = true } = {}) =>
  `${JSON.stringify(
    {
      version: 1,
      settings: {
        releaseChannel: 'stable',
        notifications: { playSound: true },
        daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: keep },
      },
      migrations: {
        legacyRendererSettingsImported: false,
        daemonStopOnQuitDefaultApplied: applied,
      },
    },
    null,
    2,
  )}\n`;

// --- The catalog

test('Paseo comes after Claude Code and GPT, for this user, with a winget step and a fallback', () => {
  const ids = catalog.items.map((item) => item.id);
  assert.ok(ids.indexOf('paseo') > ids.indexOf('claude'));
  assert.ok(ids.indexOf('paseo') > ids.indexOf('codex'));
  assert.equal(ids.indexOf('paseo-settings'), ids.indexOf('paseo') + 1);
  const paseo = byId.get('paseo');
  assert.equal(paseo.mayElevate, false);
  const [winget, fallback] = paseo.install.steps;
  assert.equal(winget.id, 'Paseo.Paseo');
  assert.deepEqual(winget.args.slice(-2), ['--scope', 'user']);
  assert.deepEqual([fallback.kind, fallback.source], ['download-latest', 'paseo']);
  assert.deepEqual(fallback.args, ['/S', '/currentuser']);
  assert.deepEqual(byId.get('paseo-settings').dependsOn, ['paseo']);
  // Only the terminal programs say Paseo must start again.
  const noted = catalog.items.filter((item) => item.install.noteIfRunning).map((item) => item.id);
  assert.deepEqual(noted, ['claude', 'codex']);
});

test('the Paseo card is the one ticked when the program screen opens', () => {
  assert.ok(cardGroups(catalog).some((group) => group.id === 'paseo'));
  assert.deepEqual([...initialPicks(catalog)], ['paseo']);
});

// --- desktop-settings.json

test('the setting is read the way Paseo keeps it', () => {
  assert.equal(keepRunningState(undefined), 'missing');
  assert.equal(keepRunningState(desktop({ keep: true })), 'on');
  assert.equal(keepRunningState(desktop()), 'off');
  // Paseo would put its default back over a change to a file without the flag.
  assert.equal(keepRunningState(desktop({ applied: false })), 'not-ready');
  assert.equal(keepRunningState('{"version":1}'), 'not-ready');
  for (const bad of ['{ broken', '[]', '{"settings":[]}', '{"settings":{"daemon":1}}'])
    assert.equal(keepRunningState(bad), 'unreadable', bad);
});

test('turning it on changes that one value and keeps Paseo’s own format', () => {
  assert.equal(withKeepRunning(desktop()), desktop({ keep: true }));
  const bare = JSON.parse(withKeepRunning('{"version":1,"other":{"a":1}}'));
  assert.deepEqual(bare, {
    version: 1,
    other: { a: 1 },
    settings: { daemon: { keepRunningAfterQuit: true } },
  });
});

// --- The runs

const installedPaseo = { present: [EVERYONE] };

test('either install folder counts as Paseo installed', () =>
  withRunner(installedPaseo, async ({ runner, pc }) => {
    runner.start(auto('paseo'));
    await runner.settled();
    assert.equal(itemOf(runner.progress(), 'paseo').status, 'done');
    assert.equal(pc.named('winget').length, 0);
  }));

test('winget failing falls back to the newest x64 installer, silent and for this user', () =>
  withRunner(
    {
      on: (request, name, pc) => {
        if (name === 'winget') return exit(1);
        if (request.program.endsWith('Paseo-Setup-0.17.4-x64.exe')) {
          pc.add(MINE);
          return ok();
        }
      },
    },
    async ({ runner, pc }) => {
      runner.start(auto('paseo'));
      await runner.settled();
      assert.equal(itemOf(runner.progress(), 'paseo').status, 'done');
      assert.deepEqual(pc.downloads, [
        'https://api.github.com/repos/getpaseo/paseo/releases/latest',
        LATEST_URLS.paseo,
      ]);
      const installer = pc.calls.find((call) => call.program.endsWith('-x64.exe'));
      assert.deepEqual(installer.args, ['/S', '/currentuser']);
    },
  ));

test('the setting is turned on only while Paseo is closed, with a backup', () =>
  withRunner(
    { ...installedPaseo, present: [EVERYONE, DESKTOP], files: { [DESKTOP]: desktop() } },
    async ({ runner, pc }) => {
      runner.start(auto('paseo-settings'));
      await runner.settled();
      assert.equal(itemOf(runner.progress(), 'paseo-settings').status, 'done');
      assert.equal(pc.files.read(DESKTOP).toString(), desktop({ keep: true }));
      assert.equal(pc.files.read(`${DESKTOP}.accountswitch-bak`).toString(), desktop());
    },
  ));

test('a running Paseo is left alone and the user is told where to turn it on', () =>
  withRunner(
    { present: [EVERYONE, DESKTOP], files: { [DESKTOP]: desktop() }, running: ['Paseo.exe'] },
    async ({ runner, pc }) => {
      runner.start(auto('paseo-settings'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'paseo-settings');
      assert.deepEqual([item.status, item.reason], ['needs-user', 'PASEO_RUNNING']);
      assert.match(item.message, /종료 후에도 데몬 계속 실행/);
      assert.equal(pc.files.read(DESKTOP).toString(), desktop());
    },
  ));

test('no file, or one Paseo has not set up yet, is never written', async () => {
  for (const files of [{}, { [DESKTOP]: desktop({ applied: false }) }])
    await withRunner(
      { present: [EVERYONE, ...Object.keys(files)], files },
      async ({ runner, pc }) => {
        runner.start(auto('paseo-settings'));
        await runner.settled();
        const item = itemOf(runner.progress(), 'paseo-settings');
        assert.deepEqual([item.status, item.reason], ['needs-user', 'PASEO_SETTINGS_OPEN']);
        assert.match(item.message, /한 번 켰다가 끄면/);
        assert.equal(pc.files.read(DESKTOP)?.toString(), files[DESKTOP]);
      },
    );
});

const claudeInstall = (request, name, pc) => {
  if (name === 'powershell' && request.env?.ACCOUNTSWITCH_SCRIPT?.includes('claude-install')) {
    pc.add(CLAUDE);
    return ok();
  }
};

test('Claude Code installed while Paseo runs says Paseo has to start again', () =>
  withRunner(
    { on: claudeInstall, running: ['Paseo.exe'], present: [EVERYONE] },
    async ({ runner }) => {
      runner.start(auto('claude'));
      await runner.settled();
      const item = itemOf(runner.progress(), 'claude');
      assert.equal(item.status, 'done');
      assert.match(item.message, /Paseo를 완전히 끄고 다시 켜야/);
    },
  ));

test('without Paseo running, or with Claude Code already there, nothing is said', async () => {
  await withRunner({ on: claudeInstall }, async ({ runner }) => {
    runner.start(auto('claude'));
    await runner.settled();
    assert.doesNotMatch(itemOf(runner.progress(), 'claude').message ?? '', /Paseo/);
  });
  await withRunner({ present: [CLAUDE], running: ['Paseo.exe'] }, async ({ runner }) => {
    runner.start(auto('claude'));
    await runner.settled();
    assert.equal(itemOf(runner.progress(), 'claude').message, '이미 설치되어 있어요.');
  });
});

// --- #44: the plugin switch

test('the AI work settings turn Paseo’s plugins on, unless the user turned them off', () => {
  const content = loadAiContent();
  assert.equal(JSON.parse(content.get('paseo/config.json')).pluginsEnabled, true);
  const reader = (config) => ({
    platform: 'win32',
    home: HOME,
    read: () => undefined,
    exists: () => false,
    codex: false,
    paseo: { kind: 'ok', config },
  });
  const sets = (config, mode) =>
    planAiSettings(content, reader(config), { ...DEFAULT_PREFS, branchPrefix: 'team', mode })
      .find((row) => row.id === 'paseo')
      .apply.sets.filter((set) => set.path === 'pluginsEnabled');
  assert.deepEqual(sets({}, 'fill'), [{ path: 'pluginsEnabled', value: true }]);
  // A `false` the user chose stays under 채워 넣기, and 바꾸기 turns it on (SPEC 3.11).
  assert.deepEqual(sets({ pluginsEnabled: false }, 'fill'), []);
  assert.deepEqual(sets({ pluginsEnabled: false }, 'replace'), [
    { path: 'pluginsEnabled', value: true },
  ]);
  assert.deepEqual(sets({ pluginsEnabled: true }, 'replace'), []);
});
