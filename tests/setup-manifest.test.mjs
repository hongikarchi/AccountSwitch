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
      'node',
      'uv',
      'python',
      'claude',
      'codex',
      'env',
      'py-base',
      'py-gis',
      'py-3d',
      'rhino',
      'rhinomcp-plugin',
      'rhinomcp-mcp',
      'cordyceps-plugin',
      'cordyceps-mcp',
      'rhino-settings',
      'blender',
      'blender-mcp-addon',
      'blender-mcp',
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
  assert.deepEqual(dependsOn('rhinomcp-mcp'), ['claude', 'uv']);
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
  assert.deepEqual(
    [PINS.node, PINS.python, PINS.rhinomcp, PINS.cordyceps, PINS.blender, PINS.blenderMcp],
    ['24.22.1', '3.13', '0.4.1.1', '1.5.0', '5.2.3', '1.5.5'],
  );
  // Without --version this id installs Node 26; any Node 24 already there is left alone.
  assert.deepEqual(step('node').args.slice(-2), ['--version', '24.22.1']);
  assert.equal(step('node').id, 'OpenJS.NodeJS.LTS');
  assert.equal(byId.get('node').check.acceptVersion, '24.x');
  assert.deepEqual(step('rhinomcp-mcp').args.slice(-2), ['uvx', 'rhinomcp@0.4.1.1']);
  assert.deepEqual(step('blender-mcp').args.slice(-2), ['uvx', 'blender-mcp@1.5.5']);
  assert.equal(byId.get('rhinomcp-mcp').check.version, '0.4.1.1');
  assert.equal(byId.get('blender-mcp').check.version, '1.5.5');
  assert.equal(step('rhinomcp-plugin').version, '0.4.1.1');
  assert.equal(step('cordyceps-plugin').version, '1.5.0');
  assert.deepEqual(step('blender').args.slice(-2), ['--version', '5.2.3']);
});

test('what the pip check looks for is what its install installs', () => {
  for (const id of ['py-base', 'py-gis', 'py-3d']) {
    const item = byId.get(id);
    assert.deepEqual(item.install.steps[0].packages, item.check.packages);
  }
});

test('every winget step has the standard flags and the declined exit code', () => {
  const steps = catalog.items.flatMap((item) => item.install.steps);
  const wingets = steps.filter((step) => step.kind === 'winget');
  assert.equal(wingets.length, 4);
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
  assert.ok(urls.length >= 7);
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
  assert.equal(byId.get('claude').install.steps[0].insideClaudeLock, true);
  for (const id of ['rhinomcp-mcp', 'cordyceps-mcp', 'blender-mcp'])
    assert.equal(byId.get(id).install.steps[0].kind, 'claude-mcp-add');
});

test('the catalog holds no personal paths', () => {
  assert.doesNotMatch(
    readFileSync(new URL('../src/core/setup/manifest.ts', import.meta.url), 'utf8'),
    /C:\\\\Users|\/Users\//,
  );
});
