import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog, PINS } from '../src/core/setup/manifest.ts';

const byId = new Map(catalog.items.map((item) => [item.id, item]));

test('the catalog has every item of the spec, once, in the spec order', () => {
  assert.deepEqual(
    catalog.items.map((item) => item.id),
    [
      'git',
      'gh',
      'node',
      'uv',
      'python',
      'env',
      'py-base',
      'py-gis',
      'py-3d',
      'claude',
      'codex',
      'rhino',
      'rhinomcp-plugin',
      'rhinomcp-launcher',
      'rhinomcp-mcp',
      'rhinomcp-codex',
      'cordyceps-plugin',
      'cordyceps-mcp',
      'cordyceps-codex',
      'rhino-settings',
      'blender',
      'blender-mcp-addon',
      'blender-mcp-start',
      'blender-mcp',
      'blender-mcp-codex',
    ],
  );
  assert.equal(byId.size, catalog.items.length);
});

test('the catalog survives JSON unchanged, so the page can render from it', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
});

test('every item has Korean text and a known group, and dependencies come first', () => {
  const groups = new Set(catalog.groups.map((group) => group.id));
  const seen = new Set();
  for (const item of catalog.items) {
    assert.match(item.description, /[가-힣]/, item.id);
    assert.match(item.install.summary, /[가-힣]/, item.id);
    assert.ok(item.label.length > 0, item.id);
    assert.ok(groups.has(item.group), item.id);
    assert.ok(item.install.steps.length > 0, item.id);
    for (const dependency of item.dependsOn) assert.ok(seen.has(dependency), item.id);
    seen.add(item.id);
  }
});

test('dependencies follow the spec rules', () => {
  const dependsOn = (id) => byId.get(id).dependsOn;
  assert.deepEqual(dependsOn('codex'), ['node']);
  for (const id of ['py-base', 'py-gis', 'py-3d']) assert.deepEqual(dependsOn(id), ['python']);
  assert.deepEqual(dependsOn('rhinomcp-launcher'), ['uv']);
  assert.deepEqual(dependsOn('rhinomcp-mcp'), [
    'claude',
    'uv',
    'rhinomcp-plugin',
    'rhinomcp-launcher',
  ]);
  assert.deepEqual(dependsOn('rhinomcp-codex'), [
    'codex',
    'uv',
    'rhinomcp-plugin',
    'rhinomcp-launcher',
  ]);
  assert.deepEqual(dependsOn('blender-mcp'), ['claude', 'uv']);
  assert.deepEqual(dependsOn('cordyceps-mcp'), ['claude']);
  assert.deepEqual(dependsOn('rhinomcp-plugin'), ['rhino']);
  assert.deepEqual(dependsOn('cordyceps-plugin'), ['rhino']);
  assert.deepEqual(dependsOn('blender-mcp-addon'), ['blender']);
});

test('only the base group is on by default', () => {
  for (const group of catalog.groups) assert.equal(group.optional, group.id !== 'base', group.id);
});

test('the pins of the spec are what checks and installs use', () => {
  const step = (id, index = 0) => byId.get(id).install.steps[index];
  // Latest by default (SPEC 3.3): only Python and the Blender group keep a pin.
  assert.deepEqual(
    [PINS.python, PINS.pythonInstaller, PINS.blender, PINS.blenderMcp],
    ['3.13', '3.13.17', '5.2.3', '1.5.5'],
  );
  for (const gone of ['node', 'nodeMajor', 'gitInstaller', 'ghInstaller', 'cordyceps', 'rhinomcp'])
    assert.equal(PINS[gone], undefined, gone);
  // Without --version this id installs the newest LTS; any Node 22 or newer is left alone.
  assert.equal(step('node').id, 'OpenJS.NodeJS.LTS');
  assert.ok(!step('node').args.includes('--version'));
  assert.equal(byId.get('node').check.acceptVersion, '>=22');
  assert.equal(byId.get('node').pinnedVersion, 'latest');
  // rhinomcp is not pinned: the plugin installs the newest, its servers run the launcher.
  const launcher = '%LOCALAPPDATA%\\AccountSwitch\\mcp\\rhinomcp-launch.py';
  assert.equal(step('rhinomcp-plugin').version, undefined);
  assert.equal(byId.get('rhinomcp-plugin').check.version, undefined);
  assert.equal(
    byId.get('rhinomcp-plugin').check.root,
    '%APPDATA%\\McNeel\\Rhinoceros\\packages\\8.0\\rhinomcp',
  );
  assert.deepEqual(byId.get('rhinomcp-launcher').check, { kind: 'launcher', file: launcher });
  assert.deepEqual(step('rhinomcp-launcher'), { kind: 'launcher', file: launcher });
  for (const id of ['rhinomcp-mcp', 'rhinomcp-codex']) {
    assert.deepEqual(
      step(id).args.slice(-5),
      ['uv', 'run', '--no-project', '--quiet', launcher],
      id,
    );
    assert.equal(byId.get(id).check.launcher, launcher, id);
    assert.equal(byId.get(id).check.package, undefined, id);
    assert.ok(byId.get(id).dependsOn.includes('rhinomcp-launcher'), id);
  }
  assert.deepEqual(step('blender-mcp').args.slice(-4), [
    'uvx',
    '--with',
    'mcp==1.30.0',
    'blender-mcp@1.5.5',
  ]);
  assert.equal(byId.get('blender-mcp').check.version, '1.5.5');
  assert.equal(step('cordyceps-plugin').version, undefined);
  assert.equal(byId.get('cordyceps-plugin').check.version, undefined);
  assert.equal(byId.get('cordyceps-plugin').check.marker, 'Cordyceps.gha');
  assert.deepEqual(step('blender').args.slice(-2), ['--version', '5.2.3']);
  assert.equal(step('gh').id, 'GitHub.cli');
  // The fallbacks of Git, GitHub CLI and Node are looked up when they run.
  assert.deepEqual(
    ['git', 'gh', 'node'].map((id) => [step(id, 1).kind, step(id, 1).source]),
    [
      ['download-latest', 'git-for-windows'],
      ['download-latest', 'gh'],
      ['download-latest', 'node-lts'],
    ],
  );
});

test('what the pip check looks for is what its install installs', () => {
  for (const id of ['py-base', 'py-gis', 'py-3d']) {
    const item = byId.get(id);
    assert.deepEqual(item.install.steps[0].packages, item.check.packages);
  }
});

test("GPT's connections run the same servers, with telemetry off and the same pins", () => {
  const step = (id) => byId.get(id).install.steps[0];
  assert.deepEqual(step('rhinomcp-codex'), {
    kind: 'codex-mcp-add',
    args: [
      'mcp',
      'add',
      'rhino',
      '--env',
      'RHINO_MCP_HOST=127.0.0.1',
      '--',
      'uv',
      'run',
      '--no-project',
      '--quiet',
      '%LOCALAPPDATA%\\AccountSwitch\\mcp\\rhinomcp-launch.py',
    ],
  });
  assert.deepEqual(step('cordyceps-codex').args, [
    'mcp',
    'add',
    'cordyceps',
    '--url',
    'http://127.0.0.1:26929/mcp',
  ]);
  assert.deepEqual(step('blender-mcp-codex').args, [
    'mcp',
    'add',
    'blender',
    '--env',
    'DISABLE_TELEMETRY=true',
    '--',
    'uvx',
    '--with',
    'mcp==1.30.0',
    'blender-mcp@1.5.5',
  ]);
  for (const id of ['rhinomcp-codex', 'cordyceps-codex', 'blender-mcp-codex']) {
    assert.equal(byId.get(id).check.client, 'codex');
    assert.ok(byId.get(id).dependsOn.includes('codex'));
    assert.ok(!byId.get(id).dependsOn.includes('claude'));
  }
});

test('every winget step has the standard flags and the declined exit code', () => {
  const steps = catalog.items.flatMap((item) => item.install.steps);
  const wingets = steps.filter((step) => step.kind === 'winget');
  assert.equal(wingets.length, 5);
  for (const step of wingets) {
    assert.deepEqual(step.args.slice(0, 9), [
      'install',
      '--id',
      step.id,
      '-e',
      '--source',
      'winget',
      '--accept-source-agreements',
      '--accept-package-agreements',
      '--disable-interactivity',
    ]);
    assert.deepEqual(step.declinedExitCodes, [2316632332]);
    assert.match(step.program, /^%LOCALAPPDATA%\\Microsoft\\WindowsApps\\winget\.exe$/);
  }
  for (const step of steps.filter((s) => s.kind === 'download-installer'))
    assert.ok(step.declinedExitCodes.length > 0, step.url);
});

test('every download comes from a host the spec allows', () => {
  const allowed = new Set([
    'nodejs.org',
    'www.python.org',
    'github.com',
    'download.blender.org',
    'claude.ai',
    'astral.sh',
    'raw.githubusercontent.com',
  ]);
  const urls = catalog.items
    .flatMap((item) => item.install.steps)
    .filter((step) => step.kind !== 'manual' && step.url)
    .map((step) => step.url);
  assert.ok(urls.length >= 5);
  for (const url of urls) {
    assert.equal(new URL(url).protocol, 'https:', url);
    assert.ok(allowed.has(new URL(url).hostname), url);
  }
});

test('blender telemetry stays off and its prefs are never reset', () => {
  assert.ok(byId.get('blender-mcp').install.steps[0].args.includes('DISABLE_TELEMETRY=true'));
  const addon = byId.get('blender-mcp-addon').install.steps[0];
  assert.match(addon.sha256, /^[0-9a-f]{64}$/);
  assert.match(addon.url, /\/[0-9a-f]{40}\/addon\.py$/);
  assert.equal(addon.saveAs, 'blender_mcp_addon.py');
  assert.doesNotMatch(JSON.stringify(catalog), /factory-startup/);
});

test('Claude config writes are marked for the account-switch lock', () => {
  const script = byId.get('claude').install.steps.find((step) => step.kind === 'powershell-script');
  assert.equal(script.insideClaudeLock, true);
  for (const id of ['rhinomcp-mcp', 'cordyceps-mcp', 'blender-mcp'])
    assert.equal(byId.get(id).install.steps[0].kind, 'claude-mcp-add');
});

test('Claude Code tries the restore of a stopped update before the install script (SPEC 3.10)', () => {
  assert.deepEqual(
    byId.get('claude').install.steps.map((step) => step.kind),
    ['claude-restore', 'powershell-script'],
  );
});

test('the catalog holds no personal paths', () => {
  assert.doesNotMatch(
    readFileSync(new URL('../src/core/setup/manifest.ts', import.meta.url), 'utf8'),
    /C:\\\\Users|\/Users\//,
  );
});
