// SPEC 3.3, latest by default (#25): the newest installers with their publisher's hash, Node 22 or
// newer left alone, and rhinomcp following the plugin through the launcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, versionMatches } from '../src/core/setup/checks.ts';
import { findLatest } from '../src/core/setup/install-latest.ts';
import { catalog } from '../src/core/setup/manifest.ts';
import { rhinomcpLauncher, runsLauncher } from '../src/core/setup/rhinomcp-launcher.ts';
import {
  BIN,
  exit,
  fakePc,
  itemOf,
  LATEST,
  LATEST_URLS,
  latestAnswer,
  LAUNCHER,
  PRETEND_INSTALLER,
  until,
  withRunner,
} from './setup-install-helpers.mjs';

/** A reader over the pretend publishers, with some answers changed. */
const reader =
  (changes = {}) =>
  async (url) =>
    Buffer.from(Object.hasOwn(changes, url) ? changes[url] : (latestAnswer(url) ?? ''));
const reason = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error.reason;
  }
};

// --- Finding the newest installer

test('Node: the first LTS of the index, and its line of SHASUMS256.txt', async () => {
  const found = await findLatest('node-lts', reader());
  assert.equal(found.version, LATEST.node);
  assert.equal(found.url, LATEST_URLS.node);
  assert.match(found.sha256, /^[0-9a-f]{64}$/);
});

test('Git and GitHub CLI: the asset by name, with the digest GitHub publishes', async () => {
  const git = await findLatest('git-for-windows', reader());
  assert.deepEqual([git.version, git.url], [LATEST.git, LATEST_URLS.git]);
  const gh = await findLatest('gh', reader());
  assert.deepEqual([gh.version, gh.url], [LATEST.gh, LATEST_URLS.gh]);
  assert.match(gh.sha256, /^[0-9a-f]{64}$/);
});

test('Paseo: the x64 installer by name, not the one for every architecture', async () => {
  const paseo = await findLatest('paseo', reader());
  assert.deepEqual([paseo.version, paseo.url], [LATEST.paseo, LATEST_URLS.paseo]);
  assert.notEqual(paseo.sha256, '0'.repeat(64));
});

test('anything not of the expected shape is LATEST_UNKNOWN, never a guess', async () => {
  const index = 'https://nodejs.org/dist/index.json';
  const sums = `https://nodejs.org/dist/v${LATEST.node}/SHASUMS256.txt`;
  const gitRelease = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
  const asset = (over) =>
    JSON.stringify({
      assets: [
        {
          name: `Git-${LATEST.git}-64-bit.exe`,
          browser_download_url: LATEST_URLS.git,
          digest: `sha256:${'a'.repeat(64)}`,
          ...over,
        },
      ],
    });
  for (const [source, changes] of [
    ['node-lts', { [index]: 'not json' }],
    ['node-lts', { [index]: JSON.stringify([{ version: 'v27.0.0', lts: false }]) }],
    ['node-lts', { [index]: JSON.stringify([{ version: 'v26.13.1-rc.1', lts: 'L' }]) }],
    ['node-lts', { [index]: JSON.stringify({ version: 'v26.13.1' }) }],
    ['node-lts', { [sums]: `${'a'.repeat(64)}  node-v${LATEST.node}-arm64.msi` }],
    ['node-lts', { [sums]: `nothex  node-v${LATEST.node}-x64.msi` }],
    ['git-for-windows', { [gitRelease]: 'not json' }],
    ['git-for-windows', { [gitRelease]: JSON.stringify({ assets: [] }) }],
    ['git-for-windows', { [gitRelease]: asset({ digest: null }) }],
    ['git-for-windows', { [gitRelease]: asset({ digest: 'md5:abc' }) }],
    [
      'git-for-windows',
      { [gitRelease]: asset({ browser_download_url: 'https://elsewhere/x.exe' }) },
    ],
  ])
    assert.equal(await reason(findLatest(source, reader(changes))), 'LATEST_UNKNOWN', source);
});

test('a lookup that answers nonsense ends the item before anything is downloaded or run', () =>
  withRunner(
    {
      on: (request, name) => (name === 'winget' ? exit(1) : undefined),
      fetch: async () => new Response('<html>not the index</html>'),
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['node'], mode: 'auto' });
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'node').reason, 'LATEST_UNKNOWN');
      assert.equal(pc.named('msiexec').length, 0);
      assert.ok(![...pc.files.store.keys()].some((path) => path.endsWith('.msi')));
    },
  ));

test('the newest installer still has to match the hash it was announced with', () =>
  withRunner(
    {
      on: (request, name) => (name === 'winget' ? exit(1) : undefined),
      fetch: async (url) => new Response(latestAnswer(url) ?? `not ${PRETEND_INSTALLER}`),
    },
    async ({ runner, pc }) => {
      runner.start({ items: ['gh'], mode: 'auto' });
      await until(() => runner.progress().phase === 'waiting');
      assert.equal(itemOf(runner.progress(), 'gh').reason, 'HASH_MISMATCH');
      assert.equal(pc.named('msiexec').length, 0);
    },
  ));

// --- Versions

test('`>=22` takes 22 and anything newer, in numeric order', () => {
  for (const found of ['22.0.0', '22.12.0', '24.15.0', '26.13.1', '100.0.0'])
    assert.equal(versionMatches('>=22', found), true, found);
  for (const found of ['20.18.0', '21.99.99', '9.0.0'])
    assert.equal(versionMatches('>=22', found), false, found);
});

test('the Node item says latest, and leaves any 22 or newer alone', () => {
  const node = catalog.items.find((item) => item.id === 'node');
  assert.equal(node.pinnedVersion, 'latest');
  assert.equal(node.check.acceptVersion, '>=22');
});

// --- rhinomcp launcher

test('a registration runs the launcher when it is uv run --no-project --quiet <launcher>', () => {
  const path = 'C:\\Users\\tester\\AppData\\Local\\AccountSwitch\\mcp\\rhinomcp-launch.py';
  for (const command of [
    `uv run --no-project --quiet ${path}`,
    `C:\\Users\\tester\\.local\\bin\\uv.exe run --no-project --quiet ${path}`,
    `UV run --no-project --quiet ${path.toUpperCase()}`,
    `uv run --no-project --quiet ${path.replaceAll('\\', '\\\\')}`,
    `uv run --no-project --quiet ${path.replaceAll('\\', '/')}`,
  ])
    assert.equal(runsLauncher(command, path), true, command);
  for (const command of [
    'uvx rhinomcp@0.5.1',
    `uv run --quiet ${path}`,
    `uv run --no-project --quiet ${path} extra`,
    `python ${path}`,
    `uvx run --no-project --quiet ${path}`,
  ])
    assert.equal(runsLauncher(command, path), false, command);
});

test('the launcher check wants exactly the current text, in either line ending', async () => {
  const status = async (text) => {
    const pc = fakePc(text === undefined ? {} : { files: { [LAUNCHER]: text } });
    return (
      await runChecks(
        pc.check,
        catalog.items.filter((item) => item.id === 'rhinomcp-launcher'),
      )
    ).results[0].status;
  };
  assert.equal(await status(rhinomcpLauncher()), 'installed');
  assert.equal(await status(rhinomcpLauncher().replace(/\n/g, '\r\n')), 'installed');
  assert.equal(await status('# an older launcher\n'), 'missing');
  assert.equal(await status(undefined), 'missing');
});

test('the launcher text reads the plugin, asks PyPI, and runs the server on its own stdio', () => {
  const text = rhinomcpLauncher();
  assert.match(text, /McNeel", "Rhinoceros", "packages", "8\.0", PACKAGE/);
  assert.match(text, /https:\/\/pypi\.org\/pypi\//);
  assert.match(text, /timeout=3/);
  assert.match(text, /\[uv, "tool", "run", spec\], stdin=sys\.stdin, stdout=sys\.stdout/);
  // The standard library only: nothing to install before it can run.
  const imports = [...text.matchAll(/^import (\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [
    'json',
    'os',
    'shutil',
    'subprocess',
    'sys',
    'urllib.error',
    'urllib.request',
  ]);
  // Nothing but the server may write to standard output, which carries MCP.
  const prints = text.match(/print\(/g) ?? [];
  assert.ok(prints.length > 0);
  assert.equal((text.match(/file=sys\.stderr/g) ?? []).length, prints.length);
  assert.ok(!text.includes(BIN), 'no personal path');
});
