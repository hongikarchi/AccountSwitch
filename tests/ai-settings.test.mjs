// SPEC 3.11: the AI work settings, planned against a pretend PC and applied with backups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, posix, win32 } from 'node:path';
import { loadAiContent } from '../src/core/setup/ai-content.ts';
import {
  applyAiSettings,
  composeRules,
  DEFAULT_PREFS,
  mergeSettings,
  parsePrefs,
  pendingRows,
  placesOf,
  planAiSettings,
  publicRow,
  ruleHash,
  SKILL_MANIFEST,
} from '../src/core/setup/ai-settings.ts';
import {
  BRANCH_PREFIX,
  integrationBranch,
  taskBranch,
} from '../src/core/setup/ai-settings-rules.ts';
import { paseoCli } from '../src/core/setup/ai-settings-pc.ts';
import { catalog, catalogFor } from '../src/core/setup/manifest.ts';
import { roleNote } from '../src/core/setup/role-note.ts';
import { itemOf, withRunner } from './setup-install-helpers.mjs';

const HOME = 'C:\\Users\\tester';
const RULES = `${HOME}\\.claude\\CLAUDE.md`;
const AGENTS = `${HOME}\\.codex\\AGENTS.md`;
const SETTINGS = `${HOME}\\.claude\\settings.json`;
const SKILLS = `${HOME}\\.claude\\skills`;
const RHINO_NOTE = `<!-- accountswitch:start -->\n${roleNote()}\n<!-- accountswitch:end -->`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The real content, with a small skill set so tests stay readable. */
const content = new Map([
  ['claude/CLAUDE.md', '# Global instructions\n\n## Branches\n- `{{branchPrefix}}_develop`\n'],
  ['claude/settings.json', JSON.stringify({ model: 'opus', permissions: { defaultMode: 'auto' } })],
  ['claude/skills/demo/SKILL.md', 'base {{branchPrefix}}_develop\n'],
  ['claude/skills/demo/references/notes.md', 'notes\n'],
  [
    'paseo/config.json',
    JSON.stringify({
      daemon: { relay: { enabled: false }, browserTools: { enabled: true } },
      agents: { providers: { muse: { enabled: false } }, resumeOnStartup: true },
    }),
  ],
]);

/** A pretend PC: files by full path; Paseo absent unless given. */
function pc({ files = {}, codex = false, paseo = { kind: 'missing' } } = {}) {
  const store = new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)]));
  const reader = {
    platform: 'win32',
    home: HOME,
    read: (path) => store.get(path),
    exists: (path) =>
      store.has(path) || [...store.keys()].some((file) => file.startsWith(path + '\\')),
    codex,
    paseo,
  };
  return { store, reader };
}
const prefs = (over = {}) => ({ ...DEFAULT_PREFS, branchPrefix: 'team', ...over });
const plan = (machine, over) => planAiSettings(content, machine.reader, prefs(over));
const rowOf = (rows, id) => rows.find((row) => row.id === id);

// --- The prefix and the content

test('the prefix is lowercase letters, digits and -, and names the two branches', () => {
  for (const ok of ['team', 'a1', 'my-team']) assert.ok(BRANCH_PREFIX.test(ok), ok);
  for (const bad of ['', 'Team', '-team', 'te am', 'team_x', 'a'.repeat(32), '팀'])
    assert.ok(!BRANCH_PREFIX.test(bad), bad);
  assert.equal(integrationBranch('team'), 'team_develop');
  assert.equal(taskBranch('team', 'login'), 'team_login');
});

test('the bundled content has the rules, settings, three skills and Paseo, and no personal name', () => {
  const real = loadAiContent();
  for (const path of ['claude/CLAUDE.md', 'claude/settings.json', 'paseo/config.json'])
    assert.ok(real.has(path), path);
  const skills = new Set(
    [...real.keys()].flatMap((path) => /^claude\/skills\/([^/]+)\//.exec(path)?.[1] ?? []),
  );
  assert.deepEqual([...skills].sort(), ['paseo-workflow', 'progress-report', 'ui-review']);
  for (const [path, text] of real) {
    // Public repository: no form of address, e-mail address or personal folder.
    assert.doesNotMatch(
      text,
      /대표님|[\w.-]+@[\w-]+\.(com|net|kr|in|io)\b|C:\\Users\\|\/Users\/[a-z]/i,
      path,
    );
    if (path.endsWith('.json')) JSON.parse(text);
  }
  assert.match(real.get('claude/CLAUDE.md'), /\{\{branchPrefix\}\}_develop/);
  assert.equal(JSON.parse(real.get('paseo/config.json')).daemon.relay.enabled, false);
  assert.equal(JSON.parse(real.get('claude/settings.json')).permissions.defaultMode, 'auto');
});

// --- A new PC

test('on a new PC every target is added, with the prefix filled in; GPT and Paseo are skipped', () => {
  const rows = plan(pc());
  assert.deepEqual(
    rows.map((row) => [row.id, row.action]),
    [
      ['rules:claude', 'add'],
      ['rules:codex', 'skip'],
      ['settings', 'add'],
      ['skill:demo', 'add'],
      ['agents-skills', 'skip'],
      ['paseo', 'skip'],
    ],
  );
  const rules = rowOf(rows, 'rules:claude');
  // Shown with `/`: Korean fonts draw `\` as ₩.
  assert.equal(rules.target, '~/.claude/CLAUDE.md');
  assert.match(rules.apply.text, /`team_develop`/);
  assert.doesNotMatch(rules.apply.text, /branchPrefix/);
  assert.deepEqual(rowOf(rows, 'skill:demo').apply.files, [
    ['SKILL.md', 'base team_develop\n'],
    ['references/notes.md', 'notes\n'],
  ]);
  // The page never sees what would be written.
  assert.equal(publicRow(rules).apply, undefined);
});

test('with Codex CLI the rules and skills get a copy for GPT too', () => {
  const rows = plan(pc({ codex: true }));
  assert.equal(rowOf(rows, 'rules:codex').action, 'add');
  assert.equal(rowOf(rows, 'rules:codex').target, '~/.codex/AGENTS.md');
  assert.equal(rowOf(rows, 'agents-skill:demo').action, 'add');
  assert.equal(rowOf(rows, 'agents-skill:demo').target, '~/.agents/skills/demo');
});

// --- The global rule file (whole, keeping AccountSwitch's own blocks)

test('a rule file AccountSwitch did not write is replaced in both modes, and the Rhino note stays', () => {
  const machine = pc({ files: { [RULES]: `## 언어\n- 한국어\n\n${RHINO_NOTE}\n` } });
  for (const mode of ['fill', 'replace']) {
    const row = rowOf(plan(machine, { mode }), 'rules:claude');
    assert.equal(row.action, 'replace', mode);
    assert.match(row.detail, /백업/);
    assert.ok(row.apply.text.startsWith('# Global instructions'));
    assert.ok(row.apply.text.includes(RHINO_NOTE), 'the Rhino note is carried over');
    assert.doesNotMatch(row.apply.text, /## 언어/);
  }
});

test('a rule file AccountSwitch wrote: same, a new version, or the user changed it', () => {
  const written = composeRules(
    content.get('claude/CLAUDE.md').replaceAll('{{branchPrefix}}', 'team'),
    undefined,
  );
  const record = { 'rules:claude': ruleHash(written) };
  assert.equal(
    rowOf(plan(pc({ files: { [RULES]: written } }), { written: record }), 'rules:claude').action,
    'same',
  );
  // A Rhino note added since is no change by the user.
  const withNote = `${written}\n${RHINO_NOTE}\n`;
  assert.equal(ruleHash(withNote), ruleHash(written));
  // Under another prefix the content differs: unchanged by the user, so a new version.
  const other = plan(pc({ files: { [RULES]: withNote } }), {
    branchPrefix: 'other',
    written: record,
  });
  assert.equal(rowOf(other, 'rules:claude').action, 'update');
  assert.ok(rowOf(other, 'rules:claude').apply.text.includes(RHINO_NOTE));
  // Changed by the user: kept under 채워 넣기, replaced under 바꾸기.
  const edited = pc({ files: { [RULES]: `${written}\n## Mine\n` } });
  assert.equal(
    rowOf(plan(edited, { written: record, branchPrefix: 'other' }), 'rules:claude').action,
    'keep',
  );
  assert.equal(
    rowOf(plan(edited, { written: record, branchPrefix: 'other', mode: 'replace' }), 'rules:claude')
      .action,
    'replace',
  );
});

test('a rule file that is not plain UTF-8 is left alone', () => {
  const machine = pc();
  machine.store.set(RULES, Buffer.from([0xff, 0xfe, 0x23, 0x00]));
  const row = rowOf(plan(machine), 'rules:claude');
  assert.equal(row.action, 'skip');
  assert.equal(row.canKeep, false);
});

// --- settings.json

test('settings: 채워 넣기 adds what is missing, 바꾸기 also sets what differs, the rest stays', () => {
  const current = { model: 'sonnet', permissions: { allow: ['Bash(git *)'] }, hooks: { x: 1 } };
  const fill = mergeSettings(current, JSON.parse(content.get('claude/settings.json')), 'fill');
  assert.deepEqual(fill.changed, ['permissions.defaultMode']);
  assert.equal(fill.result.model, 'sonnet');
  assert.deepEqual(fill.result.permissions.allow, ['Bash(git *)']);
  const replace = mergeSettings(
    current,
    JSON.parse(content.get('claude/settings.json')),
    'replace',
  );
  assert.deepEqual(replace.changed, ['model', 'permissions.defaultMode']);
  assert.deepEqual(replace.result.hooks, { x: 1 });
});

test('the settings row keeps the file indentation, and a file that is not JSON is skipped', () => {
  const machine = pc({ files: { [SETTINGS]: '{\n    "theme": "dark"\n}\n' } });
  const row = rowOf(plan(machine), 'settings');
  assert.equal(row.action, 'fill');
  assert.match(row.apply.text, /^\{\n {4}"theme": "dark"/);
  assert.match(row.detail, /model/);
  assert.equal(rowOf(plan(pc({ files: { [SETTINGS]: '{ not json' } })), 'settings').action, 'skip');
  const same = pc({
    files: { [SETTINGS]: JSON.stringify({ model: 'x', permissions: { defaultMode: 'plan' } }) },
  });
  assert.equal(rowOf(plan(same), 'settings').action, 'same');
});

// --- Skills

function skillOnDisk(files, manifest = true) {
  const folder = `${SKILLS}\\demo`;
  const entries = Object.fromEntries(
    Object.entries(files).map(([relative, text]) => [
      `${folder}\\${relative.replaceAll('/', '\\')}`,
      text,
    ]),
  );
  if (manifest)
    entries[`${folder}\\${SKILL_MANIFEST}`] = JSON.stringify({
      version: 1,
      files: Object.fromEntries(
        Object.entries(files).map(([relative, text]) => [relative, sha256(text)]),
      ),
    });
  return entries;
}

test('a skill AccountSwitch wrote and nobody changed: the same, or a new version', () => {
  const current = { 'SKILL.md': 'base team_develop\n', 'references/notes.md': 'notes\n' };
  assert.equal(rowOf(plan(pc({ files: skillOnDisk(current) })), 'skill:demo').action, 'same');
  const older = { 'SKILL.md': 'an older version\n', 'references/notes.md': 'notes\n' };
  assert.equal(rowOf(plan(pc({ files: skillOnDisk(older) })), 'skill:demo').action, 'update');
});

test('a skill the user changed, or one of the same name from elsewhere, is kept unless 바꾸기', () => {
  const edited = skillOnDisk({
    'SKILL.md': 'base team_develop\n',
    'references/notes.md': 'notes\n',
  });
  edited[`${SKILLS}\\demo\\SKILL.md`] = 'my own edit\n';
  const foreign = skillOnDisk({ 'SKILL.md': 'someone else\n' }, false);
  for (const files of [edited, foreign]) {
    assert.equal(rowOf(plan(pc({ files })), 'skill:demo').action, 'keep');
    assert.equal(rowOf(plan(pc({ files }), { mode: 'replace' }), 'skill:demo').action, 'replace');
  }
});

// --- Paseo

test('Paseo: only what is not set, and its providers map merged and set whole', () => {
  const config = {
    daemon: { relay: { enabled: true } },
    agents: { providers: { mine: { enabled: true } } },
  };
  const fill = rowOf(plan(pc({ paseo: { kind: 'ok', config } })), 'paseo');
  assert.equal(fill.action, 'fill');
  assert.deepEqual(fill.apply.sets, [
    // The user's own provider stays beside the one the content turns off.
    { path: 'agents.providers', value: { mine: { enabled: true }, muse: { enabled: false } } },
    { path: 'daemon.browserTools.enabled', value: true },
    { path: 'agents.resumeOnStartup', value: true },
  ]);
  // 채워 넣기 keeps a relay the user turned on; 바꾸기 turns it off.
  const replace = rowOf(plan(pc({ paseo: { kind: 'ok', config } }), { mode: 'replace' }), 'paseo');
  assert.ok(
    replace.apply.sets.some((set) => set.path === 'daemon.relay.enabled' && set.value === false),
  );
  assert.equal(rowOf(plan(pc({ paseo: { kind: 'unreadable' } })), 'paseo').action, 'skip');
});

test("Paseo's CLI runs as Paseo.exe in Node mode, never through its .cmd", () => {
  const folder = 'C:\\Program Files\\Paseo';
  const runner = `${folder}\\resources\\app.asar.unpacked\\dist\\daemon\\node-entrypoint-runner.js`;
  const present = new Set([`${folder}\\Paseo.exe`, runner]);
  const cli = paseoCli({
    platform: 'win32',
    env: {},
    home: HOME,
    exists: (path) => present.has(path),
  });
  const request = cli(['daemon', 'config', 'get', '--json']);
  assert.equal(request.program, `${folder}\\Paseo.exe`);
  assert.deepEqual(request.args.slice(-4), ['daemon', 'config', 'get', '--json']);
  assert.equal(request.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(
    paseoCli({ platform: 'win32', env: {}, home: HOME, exists: () => false }),
    undefined,
  );
  const mac = paseoCli({
    platform: 'darwin',
    env: {},
    home: '/Users/tester',
    exists: (path) => path === '/Applications/Paseo.app/Contents/Resources/bin/paseo',
  });
  assert.equal(mac(['reload']).program, '/Applications/Paseo.app/Contents/Resources/bin/paseo');
});

// --- Applying

function writer(machine, calls = [], { failCopy } = {}) {
  const lines = [];
  return {
    lines,
    calls,
    read: (path) => machine.store.get(path),
    write: (path, data) => machine.store.set(path, Buffer.from(data)),
    copy: (from, to) => {
      if (failCopy?.(from)) throw new Error('disk full');
      machine.store.set(to, machine.store.get(from));
    },
    exists: machine.reader.exists,
    filesUnder: (folder) =>
      [...machine.store.keys()]
        .filter((path) => path.startsWith(folder + '\\'))
        .map((path) => path.slice(folder.length + 1).replaceAll('\\', '/')),
    // A pretend Paseo that keeps what it is set to, as `paseo daemon config set` does.
    paseo: async (args) => {
      calls.push(args);
      if (args[2] === 'set' && machine.reader.paseo.kind === 'ok') {
        const keys = args[3].split('.');
        let at = machine.reader.paseo.config;
        for (const key of keys.slice(0, -1)) at = at[key] ??= {};
        at[keys.at(-1)] = JSON.parse(args[4]);
      }
      return { code: 0 };
    },
    log: (line) => lines.push(line),
    backupFolder: `${HOME}\\.claude\\backups\\accountswitch-ai-settings-x`,
  };
}

test('applying backs up what it replaces, writes, records the rule hash and the skill manifest', async () => {
  const machine = pc({
    files: { [RULES]: `## 언어\n\n${RHINO_NOTE}\n`, [SETTINGS]: '{"theme":"dark"}' },
    paseo: { kind: 'ok', config: {} },
  });
  const rows = plan(machine);
  const out = writer(machine);
  const outcome = await applyAiSettings(rows, [], out, placesOf('win32', HOME), HOME, {});
  const backup = out.backupFolder;
  assert.equal(
    machine.store.get(`${backup}\\claude\\CLAUDE.md`).toString(),
    `## 언어\n\n${RHINO_NOTE}\n`,
  );
  assert.equal(
    machine.store.get(`${backup}\\claude\\settings.json`).toString(),
    '{"theme":"dark"}',
  );
  assert.ok(machine.store.get(RULES).toString().includes(RHINO_NOTE));
  assert.equal(outcome.written['rules:claude'], ruleHash(machine.store.get(RULES).toString()));
  const manifest = JSON.parse(machine.store.get(`${SKILLS}\\demo\\${SKILL_MANIFEST}`).toString());
  assert.equal(manifest.files['SKILL.md'], sha256('base team_develop\n'));
  assert.equal(JSON.parse(machine.store.get(SETTINGS).toString()).theme, 'dark');
  // Paseo: each set as JSON, then a reload.
  assert.deepEqual(out.calls.at(-1), ['reload']);
  assert.ok(
    out.calls.some((args) => args.join(' ') === 'daemon config set daemon.relay.enabled false'),
  );
  assert.deepEqual(outcome.failed, []);
  assert.ok(outcome.backedUp);
  // Afterwards the plan has nothing left to do.
  const again = planAiSettings(content, machine.reader, prefs({ written: outcome.written }));
  const settled = again.map((row) => [row.id, row.action]);
  assert.deepEqual(pendingRows(again, []), [], JSON.stringify(settled));
});

test('a row whose backup fails writes nothing, and the others still go ahead', async () => {
  const machine = pc({ files: { [RULES]: 'mine\n' } });
  const out = writer(machine, [], { failCopy: (from) => from === RULES });
  const outcome = await applyAiSettings(plan(machine), [], out, placesOf('win32', HOME), HOME, {});
  assert.equal(machine.store.get(RULES).toString(), 'mine\n');
  assert.deepEqual(
    outcome.failed.map((failed) => failed.id),
    ['rules:claude'],
  );
  assert.ok(outcome.done.includes('settings'));
});

test('rows switched to 내 것 유지 are not written, and count as settled', async () => {
  const machine = pc({ files: { [RULES]: 'mine\n' } });
  const rows = plan(machine);
  await applyAiSettings(rows, ['rules:claude'], writer(machine), placesOf('win32', HOME), HOME, {});
  assert.equal(machine.store.get(RULES).toString(), 'mine\n');
  assert.ok(!pendingRows(plan(machine), ['rules:claude']).some((row) => row.id === 'rules:claude'));
});

// --- Saved choices and the catalog

test('saved choices that cannot be read count as nothing saved', () => {
  assert.deepEqual(parsePrefs(undefined), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(Buffer.from('{ broken')), DEFAULT_PREFS);
  const prefsRead = parsePrefs(
    Buffer.from(JSON.stringify({ branchPrefix: 'team', mode: 'replace', keep: ['x', 1] })),
  );
  assert.deepEqual(prefsRead, { branchPrefix: 'team', mode: 'replace', keep: ['x'], written: {} });
});

test('macOS gets only the AI work settings; Windows gets everything, them included', () => {
  assert.deepEqual(
    catalogFor('darwin').items.map((item) => item.id),
    ['ai-settings'],
  );
  assert.deepEqual(
    catalogFor('darwin').groups.map((group) => group.id),
    ['ai'],
  );
  assert.equal(catalogFor('win32').items.length, catalog.items.length);
  assert.deepEqual(catalogFor('linux').items, []);
  const item = catalog.items.find((entry) => entry.id === 'ai-settings');
  assert.deepEqual(item.platforms, ['win32', 'darwin']);
  assert.equal(catalog.groups.find((group) => group.id === 'ai').optional, true);
});

test('on macOS the places are under the home folder with forward slashes', () => {
  const places = placesOf('darwin', '/Users/tester');
  assert.equal(places.rules, posix.join('/Users/tester', '.claude', 'CLAUDE.md'));
  assert.equal(places.show(places.agentsSkills), '~/.agents/skills');
  assert.equal(placesOf('win32', HOME).rules, win32.join(HOME, '.claude', 'CLAUDE.md'));
  assert.equal(placesOf('win32', HOME, 'D:\\paseo').paseoConfig, 'D:\\paseo\\config.json');
});

// --- Through the runner, on the pretend PC of the install tests

test('a run applies the saved choices, backs up, records what it wrote, and then checks installed', () =>
  withRunner({}, async ({ runner, pc, directory }) => {
    pc.check.dataDirectory = directory;
    const prefsPath = join(directory, 'ai-settings.json');
    pc.files.store.set(
      prefsPath,
      Buffer.from(JSON.stringify({ branchPrefix: 'team', mode: 'fill' })),
    );
    pc.files.store.set(RULES, Buffer.from('## 언어\n- 한국어\n'));
    runner.start({ items: ['ai-settings'], mode: 'check' });
    await runner.settled();
    const item = itemOf(runner.progress(), 'ai-settings');
    assert.equal(item.status, 'done', JSON.stringify(item));
    assert.match(item.message, /백업/);
    const rules = pc.files.store.get(RULES).toString();
    assert.match(rules, /team_develop/);
    assert.doesNotMatch(rules, /## 언어/);
    const backups = [...pc.files.store.keys()].filter((path) =>
      path.includes('accountswitch-ai-settings-'),
    );
    const backupOfRules = backups.find((path) => path.endsWith('\\claude\\CLAUDE.md'));
    assert.ok(backupOfRules, backups.join('\n'));
    assert.equal(pc.files.store.get(backupOfRules).toString(), '## 언어\n- 한국어\n');
    const saved = JSON.parse(pc.files.store.get(prefsPath).toString());
    assert.equal(saved.written['rules:claude'], ruleHash(rules));
    assert.ok(pc.files.store.has(`${SKILLS}\\paseo-workflow\\SKILL.md`));
    // Nothing of Paseo or Codex ran: neither is on this pretend PC.
    assert.equal(pc.calls.filter((call) => /Paseo\.exe$/i.test(call.program)).length, 0);
  }));

test('without a saved prefix the item waits for the user and writes nothing', () =>
  withRunner({}, async ({ runner, pc, directory }) => {
    pc.check.dataDirectory = directory;
    runner.start({ items: ['ai-settings'], mode: 'check' });
    await runner.settled();
    const item = itemOf(runner.progress(), 'ai-settings');
    assert.equal(item.status, 'needs-user');
    assert.equal(item.reason, 'AI_SETTINGS_UNSET');
    assert.equal(pc.files.store.has(RULES), false);
  }));
