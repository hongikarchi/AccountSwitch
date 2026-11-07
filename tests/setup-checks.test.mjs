import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import {
  blendListsModule,
  DEFAULT_TIMEOUTS,
  findPackage,
  userMcpServer,
  refreshEnginePath,
  runChecks,
  versionMatches,
} from '../src/core/setup/checks.ts';
import { expandPath, pathHasFolder, rebuildPath } from '../src/core/setup/environment.ts';

const HOME = 'C:\\Users\\tester';
const APPDATA = `${HOME}\\AppData\\Roaming`;
const LOCAL = `${HOME}\\AppData\\Local`;
const BIN = `${HOME}\\.local\\bin`;
const PROGRAMS = 'C:\\Program Files';
const SECRET = 'do-not-leak-this-value';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false });
const fail = (stderr = '', code = 1) => ({ code, stdout: '', stderr, timedOut: false });
const timedOut = () => ({ code: null, stdout: '', stderr: '', timedOut: true });

const CLAUDE_CONFIG = `${HOME}\\.claude.json`;
const mcpConfig = (servers, over = {}) =>
  JSON.stringify({ oauthAccount: { emailAddress: SECRET }, mcpServers: servers, ...over });
const uvx = (pkg) => ({ type: 'stdio', command: 'uvx', args: [pkg], env: { TOKEN: SECRET } });
const http = (url) => ({ type: 'http', url, headers: { Authorization: `Bearer ${SECRET}` } });

const snapshot = (over = {}) => ({
  machinePath: 'C:\\Windows\\System32;C:\\Tools',
  userPath: `${BIN};%USERPROFILE%\\extra`,
  pythonUtf8: '1',
  documents: `${HOME}\\Documents`,
  executionPolicy: {
    MachinePolicy: 'Undefined',
    UserPolicy: 'Undefined',
    CurrentUser: 'RemoteSigned',
  },
  ...over,
});

/**
 * A pretend PC. `answers` maps a command's file name (lower case, no extension) to a function of
 * its arguments. Files and folders exist only when listed.
 */
function fakePc({ files = [], folders = {}, contents = {}, answers = {}, snap = snapshot() } = {}) {
  const calls = [];
  const fileSet = new Set(files);
  const deps = {
    platform: 'win32',
    env: {
      PATH: 'C:\\stale',
      USERPROFILE: HOME,
      APPDATA,
      LOCALAPPDATA: LOCAL,
      ProgramFiles: PROGRAMS,
      SystemRoot: 'C:\\Windows',
      CLAUDE_CONFIG_DIR: 'C:\\account',
      ANTHROPIC_API_KEY: 'k',
      OPENAI_API_KEY: 'k',
    },
    home: HOME,
    concurrency: 6,
    timeouts: DEFAULT_TIMEOUTS,
    exists: (path) => fileSet.has(path),
    listFolders: (path) => folders[path] ?? [],
    readFile: (path) => (contents[path] === undefined ? undefined : Buffer.from(contents[path])),
    executable: () => undefined,
    exclusive: (task) => task(),
    run: async (request) => {
      calls.push(request);
      const name = win32
        .basename(request.program)
        .replace(/\.[^.]+$/, '')
        .toLowerCase();
      if (name === 'powershell') return snap ? ok(JSON.stringify(snap)) : fail();
      return answers[name]?.(request.args, request) ?? fail();
    },
  };
  return { deps, calls };
}
const statusOf = (report, id) => report.results.find((result) => result.id === id);

test('nothing installed: everything is missing, and no command runs for what cannot run', async () => {
  const { deps, calls } = fakePc();
  const report = await runChecks(deps);
  assert.equal(report.supported, true);
  assert.equal(report.pathSource, 'registry');
  const programs = calls.map((call) => win32.basename(call.program));
  assert.deepEqual(programs, ['powershell.exe']);
  for (const result of report.results) {
    if (result.id === 'env') continue;
    assert.equal(result.status, 'missing', result.id);
  }
  assert.deepEqual(statusOf(report, 'codex').waitingFor, ['node']);
  assert.deepEqual(statusOf(report, 'rhinomcp-mcp').waitingFor, ['claude', 'uv']);
  assert.deepEqual(statusOf(report, 'rhinomcp-plugin').waitingFor, ['rhino']);
  assert.equal(statusOf(report, 'py-gis').missingPackages.length, 4);
});

test('PATH is rebuilt from the registry, in memory, before the checks look', async () => {
  const { deps } = fakePc({
    files: ['C:\\Tools\\git.exe'],
    answers: { git: () => ok('git version 2.56.0.windows.4\n') },
  });
  const report = await runChecks(deps);
  assert.equal(deps.env.PATH, `C:\\Windows\\System32;C:\\Tools;${BIN};${HOME}\\extra`);
  const git = statusOf(report, 'git');
  assert.equal(git.status, 'installed');
  assert.equal(git.foundVersion, '2.56.0.windows.4');
  assert.equal(git.notOnPath, undefined);
});

test('a failed registry read keeps the PATH the engine had, and says so', async () => {
  const { deps } = fakePc({ snap: null });
  const report = await runChecks(deps);
  assert.equal(deps.env.PATH, 'C:\\stale');
  assert.equal(report.pathSource, 'inherited');
  assert.equal(statusOf(report, 'env').status, 'error');
});

test('a Path key in another letter case is replaced, not doubled', async () => {
  const { deps } = fakePc();
  delete deps.env.PATH;
  deps.env.Path = 'C:\\stale';
  await refreshEnginePath(deps);
  assert.equal(deps.env.PATH, undefined);
  assert.match(deps.env.Path, /^C:\\Windows\\System32;/);
});

test('a known folder finds a program that is not on PATH, and that is reported', async () => {
  const { deps } = fakePc({
    files: [`${BIN}\\uv.exe`, `${BIN}\\uvx.exe`],
    snap: snapshot({ machinePath: 'C:\\Windows\\System32', userPath: '' }),
    answers: {
      uv: () => ok('uv 0.9.1 (abc 2026-01-01)\n'),
      uvx: () => ok('uvx 0.9.1\n'),
    },
  });
  const uv = statusOf(await runChecks(deps), 'uv');
  assert.equal(uv.status, 'installed');
  assert.equal(uv.foundVersion, '0.9.1');
  assert.equal(uv.notOnPath, true);
});

test('uv needs both uv and uvx', async () => {
  const { deps } = fakePc({
    files: [`${BIN}\\uv.exe`],
    answers: { uv: () => ok('uv 0.9.1\n') },
  });
  assert.equal(statusOf(await runChecks(deps), 'uv').status, 'missing');
});

test('git counts when its file exists, in either place, even if the command fails', async () => {
  for (const file of [`${PROGRAMS}\\Git\\cmd\\git.exe`, `${LOCAL}\\Programs\\Git\\cmd\\git.exe`]) {
    const { deps } = fakePc({ files: [file], answers: { git: () => fail() } });
    assert.equal(statusOf(await runChecks(deps), 'git').status, 'installed', file);
    const hanging = fakePc({ files: [file], answers: { git: () => timedOut() } });
    assert.equal(statusOf(await runChecks(hanging.deps), 'git').status, 'installed', file);
  }
});

test('node: any 24 is fine although 24.22.1 is what installs; another major is 버전 다름', async () => {
  const check = async (version) => {
    const { deps } = fakePc({
      files: [`${PROGRAMS}\\nodejs\\node.exe`],
      answers: { node: () => ok(`${version}\n`) },
    });
    return statusOf(await runChecks(deps), 'node');
  };
  const current = await check('v24.15.0');
  assert.equal(current.status, 'installed');
  assert.equal(current.foundVersion, '24.15.0');
  assert.equal(current.pinnedVersion, '24.22.1');
  const older = await check('v22.1.0');
  assert.equal(older.status, 'version-mismatch');
  assert.equal(older.foundVersion, '22.1.0');
  assert.equal((await check('v26.0.0')).status, 'version-mismatch');
});

test('python is asked for 3.13 exactly; pip items run through it and report what is absent', async () => {
  const { deps, calls } = fakePc({
    files: ['C:\\Windows\\py.exe'],
    answers: {
      py: (args) =>
        args.includes('--version')
          ? ok('Python 3.13.5\r\n')
          : ok(
              args.includes('rhino3dm')
                ? 'Name: rhino3dm\nVersion: 8\n---\nName: trimesh\nVersion: 4\n'
                : args.includes('pyshp')
                  ? ''
                  : 'Name: Pillow\nName: openpyxl\nName: PyMuPDF\nName: python_dotenv\n',
            ),
    },
  });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'python').status, 'installed');
  assert.equal(statusOf(report, 'python').foundVersion, '3.13.5');
  assert.ok(calls.some((call) => call.args[0] === '-3.13' && call.args.includes('show')));
  assert.equal(statusOf(report, 'py-3d').status, 'installed');
  assert.deepEqual(statusOf(report, 'py-gis').missingPackages, [
    'pyshp',
    'pyproj',
    'shapely',
    'rtree',
  ]);
  // Letter case and - or _ do not matter, as on PyPI.
  assert.deepEqual(statusOf(report, 'py-base').missingPackages, [
    'pypdf',
    'pdfplumber',
    'numpy',
    'requests',
    'beautifulsoup4',
  ]);
});

test('without Python 3.13 the pip items start nothing and count every package as absent', async () => {
  const { deps, calls } = fakePc({
    files: ['C:\\Windows\\py.exe'],
    answers: { py: () => fail('No suitable Python runtime found') },
  });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'python').status, 'missing');
  assert.equal(statusOf(report, 'py-base').missingPackages.length, 9);
  assert.equal(calls.filter((call) => call.args.includes('show')).length, 0);
});

test('claude and codex are installed by the file; the version is extra', async () => {
  const { deps } = fakePc({
    answers: { claude: () => ok('2.1.5 (Claude Code)\n'), codex: () => timedOut() },
  });
  deps.executable = (provider) =>
    provider === 'claude-cli' ? 'C:\\c\\claude.exe' : 'C:\\c\\codex.exe';
  // No registered MCP servers in this test.
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'claude').status, 'installed');
  assert.equal(statusOf(report, 'claude').foundVersion, '2.1.5');
  assert.equal(statusOf(report, 'codex').status, 'installed');
  assert.equal(statusOf(report, 'codex').foundVersion, undefined);
});

test('env holds three parts, each reported', async () => {
  const run = async (snap) => {
    const { deps } = fakePc({ snap });
    return statusOf(await runChecks(deps), 'env');
  };
  assert.equal((await run(snapshot())).status, 'installed');
  const parts = (result) => Object.fromEntries(result.parts.map((part) => [part.id, part.ok]));
  const undefinedPolicy = await run(
    snapshot({
      executionPolicy: { CurrentUser: 'Undefined' },
      pythonUtf8: null,
      userPath: 'C:\\x',
    }),
  );
  assert.equal(undefinedPolicy.status, 'missing');
  assert.deepEqual(parts(undefinedPolicy), {
    'execution-policy': false,
    'user-path': false,
    'python-utf8': false,
  });
  assert.equal(
    parts(await run(snapshot({ executionPolicy: { CurrentUser: 'Restricted' } })))[
      'execution-policy'
    ],
    false,
  );
  // The user PATH may hold the folder with another case or a trailing backslash.
  assert.equal(
    parts(await run(snapshot({ userPath: `${BIN.toUpperCase()}\\` })))['user-path'],
    true,
  );
});

test('a group policy that blocks scripts wins over CurrentUser, and the user is told', async () => {
  const { deps } = fakePc({
    snap: snapshot({
      executionPolicy: { MachinePolicy: 'Restricted', CurrentUser: 'RemoteSigned' },
    }),
  });
  const env = statusOf(await runChecks(deps), 'env');
  assert.equal(env.status, 'missing');
  assert.match(env.message, /정책/);
});

test('a plugin of another version is 버전 다름 with the newest found; files are ignored', async () => {
  const root = `${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0`;
  const { deps } = fakePc({
    files: [`${root}\\rhinomcp\\0.4.1.1`],
    folders: { [`${root}\\cordyceps`]: ['1.4.0', '1.10.0', 'notes'] },
  });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'rhinomcp-plugin').status, 'installed');
  assert.equal(statusOf(report, 'rhinomcp-plugin').foundVersion, '0.4.1.1');
  assert.equal(statusOf(report, 'cordyceps-plugin').status, 'version-mismatch');
  assert.equal(statusOf(report, 'cordyceps-plugin').foundVersion, '1.10.0');
});

test('Cordyceps needs its .gha in the pinned folder', async () => {
  const root = `${APPDATA}\\McNeel\\Rhinoceros\\packages\\8.0\\cordyceps`;
  const yes = fakePc({ files: [`${root}\\1.5.0\\Cordyceps.gha`] });
  assert.equal(statusOf(await runChecks(yes.deps), 'cordyceps-plugin').status, 'installed');
  const no = fakePc({ files: [`${root}\\1.5.0`] });
  assert.equal(statusOf(await runChecks(no.deps), 'cordyceps-plugin').status, 'missing');
});

test('the Rhino check only looks at a file and never starts Rhino', async () => {
  const { deps, calls } = fakePc({ files: [`${PROGRAMS}\\Rhino 8\\System\\Rhino.exe`] });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'rhino').status, 'installed');
  assert.equal(statusOf(report, 'rhinomcp-plugin').waitingFor, undefined);
  assert.ok(!calls.some((call) => /rhino|yak/i.test(call.program)));
});

function mcpPc(config) {
  const pc = fakePc({
    contents: config === undefined ? {} : { [CLAUDE_CONFIG]: config },
    answers: { claude: () => ok('2.1.5') },
  });
  pc.deps.executable = (provider) => (provider === 'claude-cli' ? 'C:\\c\\claude.exe' : undefined);
  return pc;
}

test('MCP checks: the file is read inside the lock, no server starts, no secret comes back', async () => {
  const pc = mcpPc(
    mcpConfig({
      rhino: uvx('rhinomcp@0.4.1.1'),
      cordyceps: http('http://127.0.0.1:26929/mcp'),
      blender: uvx('blender-mcp@1.5.5'),
    }),
  );
  let inLock = 0;
  const seenInLock = [];
  const { readFile } = pc.deps;
  pc.deps.readFile = (path) => {
    if (path === CLAUDE_CONFIG) seenInLock.push(inLock);
    return readFile(path);
  };
  pc.deps.exclusive = async (task) => {
    inLock++;
    try {
      return await task();
    } finally {
      inLock--;
    }
  };
  const report = await runChecks(pc.deps);
  assert.equal(statusOf(report, 'rhinomcp-mcp').status, 'installed');
  assert.equal(statusOf(report, 'rhinomcp-mcp').foundVersion, '0.4.1.1');
  assert.equal(statusOf(report, 'cordyceps-mcp').status, 'installed');
  assert.equal(statusOf(report, 'blender-mcp').status, 'installed');
  assert.equal(seenInLock.length, 3);
  assert.ok(seenInLock.every((depth) => depth >= 1));
  // `claude mcp get` would start the server, and uvx could download it.
  assert.equal(pc.calls.filter((call) => call.args[0] === 'mcp').length, 0);
  assert.equal(pc.calls.filter((call) => /uvx/i.test(call.program)).length, 0);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET));
});

test('MCP registrations that differ are 버전 다름 and say how', async () => {
  const check = async (id, servers) =>
    statusOf(await runChecks(mcpPc(mcpConfig(servers)).deps), id);
  const old = await check('rhinomcp-mcp', { rhino: uvx('rhinomcp@0.4.0') });
  assert.equal(old.status, 'version-mismatch');
  assert.equal(old.foundVersion, '0.4.0');
  const unpinned = await check('blender-mcp', { blender: uvx('blender-mcp') });
  assert.equal(unpinned.status, 'version-mismatch');
  assert.match(unpinned.message, /고정/);
  const other = await check('rhinomcp-mcp', { rhino: uvx('something-else') });
  assert.equal(other.status, 'version-mismatch');
  assert.match(other.message, /다른 방식/);
  const address = await check('cordyceps-mcp', { cordyceps: http('http://127.0.0.1:1/mcp') });
  assert.equal(address.status, 'version-mismatch');
  assert.doesNotMatch(JSON.stringify(address), /127\.0\.0\.1:1/);
});

test('an MCP server that is absent, in another scope, or unreadable gets its own status', async () => {
  const check = async (config) => statusOf(await runChecks(mcpPc(config).deps), 'rhinomcp-mcp');
  assert.equal((await check(undefined)).status, 'missing');
  assert.equal((await check(mcpConfig({ other: uvx('x') }))).status, 'missing');
  assert.equal((await check(JSON.stringify({ numStartups: 1 }))).status, 'missing');
  const local = JSON.stringify({
    projects: { 'C:/work': { mcpServers: { rhino: uvx('rhinomcp@0.4.1.1') } } },
  });
  assert.equal((await check(local)).status, 'missing');
  assert.equal((await check('{ not json')).status, 'error');
});

test('without Claude Code the MCP checks read nothing and take no lock', async () => {
  const { deps, calls } = fakePc({ contents: { [CLAUDE_CONFIG]: mcpConfig({}) } });
  let locked = 0;
  deps.exclusive = (task) => {
    locked++;
    return task();
  };
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'rhinomcp-mcp').status, 'missing');
  assert.equal(locked, 0);
  assert.equal(calls.filter((call) => call.args[0] === 'mcp').length, 0);
});

test('a lock that never frees gives a timeout; a task that starts later reads nothing', async () => {
  const pc = mcpPc(mcpConfig({ rhino: uvx('rhinomcp@0.4.1.1') }));
  const late = [];
  pc.deps.exclusive = (task) =>
    new Promise((resolve) => {
      late.push(() => task().then(resolve));
    });
  pc.deps.timeouts = { ...DEFAULT_TIMEOUTS, mcpLockWaitMs: 5 };
  let reads = 0;
  const { readFile } = pc.deps;
  pc.deps.readFile = (path) => {
    if (path === CLAUDE_CONFIG) reads++;
    return readFile(path);
  };
  const report = await runChecks(pc.deps);
  assert.equal(statusOf(report, 'rhinomcp-mcp').status, 'timeout');
  assert.match(statusOf(report, 'rhinomcp-mcp').message, /계정 전환/);
  await Promise.all(late.map((start) => start()));
  assert.equal(reads, 0);
});

test('Blender runs only from its known folder, only --version', async () => {
  const root = `${PROGRAMS}\\Blender Foundation`;
  const check = async (folder, stdout) => {
    const pc = fakePc({
      files: [`${root}\\${folder}\\blender.exe`],
      folders: { [root]: [folder, 'Blender 3.0', 'other'] },
      answers: { blender: () => stdout },
    });
    return { result: statusOf(await runChecks(pc.deps), 'blender'), calls: pc.calls };
  };
  const right = await check('Blender 5.2', ok('Blender 5.2.3 LTS\n\tbuild date: 2026\n'));
  assert.equal(right.result.status, 'installed');
  assert.equal(right.result.foundVersion, '5.2.3');
  const calls = right.calls.filter((call) => /blender/i.test(call.program));
  assert.deepEqual(
    calls.map((call) => [call.program, call.args]),
    [[`${root}\\Blender 5.2\\blender.exe`, ['--version']]],
  );
  const patch = await check('Blender 5.2', ok('Blender 5.2.1\n'));
  assert.equal(patch.result.status, 'version-mismatch');
  assert.equal(patch.result.foundVersion, '5.2.1');
  const older = await check('Blender 4.5', ok('Blender 4.5.2\n'));
  assert.equal(older.result.status, 'version-mismatch');
  assert.equal(older.result.foundVersion, '4.5.2');
  const hanging = await check('Blender 5.2', timedOut());
  assert.equal(hanging.result.status, 'timeout');
  assert.equal(hanging.result.foundVersion, '5.2');
  const odd = await check('Blender 5.2', ok('no version here'));
  assert.equal(odd.result.status, 'error');
});

test('Blender on PATH alone is not used, and the pinned folder wins over newer ones', async () => {
  const root = `${PROGRAMS}\\Blender Foundation`;
  const onPath = fakePc({ files: ['C:\\Tools\\blender.exe'] });
  assert.equal(statusOf(await runChecks(onPath.deps), 'blender').status, 'missing');
  assert.equal(onPath.calls.filter((call) => /blender/i.test(call.program)).length, 0);
  const many = fakePc({
    files: [`${root}\\Blender 5.2\\blender.exe`, `${root}\\Blender 5.3\\blender.exe`],
    folders: { [root]: ['Blender 5.3', 'Blender 5.2', 'Blender 5.1'] },
    answers: { blender: () => ok('Blender 5.2.3\n') },
  });
  await runChecks(many.deps);
  assert.ok(many.calls.some((call) => call.program === `${root}\\Blender 5.2\\blender.exe`));
});

test('the blender add-on needs the file and the module listed in user prefs', async () => {
  const user = `${APPDATA}\\Blender Foundation\\Blender\\5.2`;
  const file = `${user}\\scripts\\addons\\blender_mcp_addon.py`;
  const prefs = `${user}\\config\\userpref.blend`;
  const enabled = 'BLENDER17-01v050....blender_mcp_addon\0\0\0';
  const check = async (files, contents) => {
    const { deps, calls } = fakePc({ files, contents });
    const result = statusOf(await runChecks(deps), 'blender-mcp-addon');
    assert.ok(!calls.some((call) => /blender/i.test(call.program)));
    return result;
  };
  assert.equal((await check([file], { [prefs]: enabled })).status, 'installed');
  const off = await check([file], { [prefs]: 'BLENDER17-01v050....cycles\0' });
  assert.equal(off.status, 'missing');
  assert.deepEqual(
    off.parts.map((part) => part.ok),
    [true, false],
  );
  assert.equal((await check([], { [prefs]: enabled })).status, 'missing');
  assert.equal((await check([file], {})).status, 'missing');
  assert.equal((await check([file], { [prefs]: '\x28\xb5\x2f\xfdcompressed' })).status, 'error');
});

test('rhino-settings reports each of its four parts, from files only', async () => {
  const settings = `${APPDATA}\\McNeel\\Rhinoceros\\8.0\\settings\\settings-Scheme__Default.xml`;
  const starter = `${HOME}\\Documents\\AccountSwitch\\cordyceps-start.gh`;
  const note = `${HOME}\\.claude\\CLAUDE.md`;
  const parts = (result) => Object.fromEntries(result.parts.map((part) => [part.id, part.ok]));
  const off = fakePc({
    contents: {
      // The entry that only counts past uses of mcpstart must not count as a start-up command.
      [settings]:
        '<entry key="EnableFileLockingOpenWarning">False</entry>\n' +
        '<child key="Command Use Counts"><entry key="f0b5b632.mcpstart">2</entry></child>',
    },
  });
  const none = statusOf(await runChecks(off.deps), 'rhino-settings');
  assert.equal(none.status, 'missing');
  assert.deepEqual(parts(none), {
    'read-only-warning': false,
    mcpstart: false,
    'starter-file': false,
    'role-note': false,
  });
  const on = fakePc({
    files: [starter],
    contents: {
      [settings]:
        '<entry key="EnableFileLockingOpenWarning">True</entry>\n' +
        '<entry key="StartupCommands">_foo _mcpstart</entry>',
      [note]: 'mine\n<!-- accountswitch:start -->\nnote\n<!-- accountswitch:end -->\n',
    },
  });
  assert.equal(statusOf(await runChecks(on.deps), 'rhino-settings').status, 'installed');
  assert.equal(on.calls.length, 1, 'only the registry read');
});

test('the starter file follows a moved Documents folder', async () => {
  const moved = 'D:\\OneDrive\\문서';
  const { deps } = fakePc({
    files: [`${moved}\\AccountSwitch\\cordyceps-start.gh`],
    snap: snapshot({ documents: moved }),
  });
  const parts = statusOf(await runChecks(deps), 'rhino-settings').parts;
  assert.equal(parts.find((part) => part.id === 'starter-file').ok, true);
});

test('a hanging command gives timeout for that item and the rest still answer', async () => {
  const { deps } = fakePc({
    files: [`${PROGRAMS}\\nodejs\\node.exe`, 'C:\\Windows\\py.exe'],
    answers: { node: () => timedOut(), py: () => ok('Python 3.13.5\n') },
  });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'node').status, 'timeout');
  assert.match(statusOf(report, 'node').message, /다시 확인/);
  assert.equal(statusOf(report, 'python').status, 'installed');
});

test('a check that throws becomes an error for that item only', async () => {
  const { deps } = fakePc({
    files: [`${PROGRAMS}\\nodejs\\node.exe`],
    answers: {
      node: () => {
        throw new Error('boom');
      },
    },
  });
  const report = await runChecks(deps);
  assert.equal(statusOf(report, 'node').status, 'error');
  assert.equal(statusOf(report, 'uv').status, 'missing');
});

test('commands run at the same time, but no more than the limit', async () => {
  const { deps } = fakePc({
    files: [
      'C:\\Windows\\py.exe',
      `${PROGRAMS}\\nodejs\\node.exe`,
      `${BIN}\\uv.exe`,
      `${BIN}\\uvx.exe`,
      `${PROGRAMS}\\Git\\cmd\\git.exe`,
    ],
  });
  let active = 0;
  let most = 0;
  deps.concurrency = 2;
  deps.run = async ({ program }) => {
    if (/powershell/.test(program)) return ok(JSON.stringify(snapshot()));
    active++;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return ok('');
  };
  await runChecks(deps);
  assert.equal(most, 2);
});

test('elsewhere than Windows nothing runs and every item says unsupported', async () => {
  const { deps, calls } = fakePc();
  deps.platform = 'darwin';
  const report = await runChecks(deps);
  assert.equal(report.supported, false);
  assert.equal(report.platform, 'darwin');
  assert.equal(report.pathSource, 'none');
  assert.equal(calls.length, 0);
  assert.equal(deps.env.PATH, 'C:\\stale');
  assert.ok(report.results.every((result) => result.status === 'unsupported'));
});

test('versionMatches knows latest, a series, and an exact version', () => {
  assert.equal(versionMatches('latest', '1.2.3'), true);
  assert.equal(versionMatches(null, '1.2.3'), true);
  assert.equal(versionMatches('24.x', '24.15.0'), true);
  assert.equal(versionMatches('24.x', '241.0.0'), false);
  assert.equal(versionMatches('3.13.x', '3.13.5'), true);
  assert.equal(versionMatches('5.2.3', '5.2.3'), true);
  assert.equal(versionMatches('5.2.3', '5.2.30'), false);
});

test('userMcpServer keeps only what the checks need', () => {
  const config = Buffer.from(
    mcpConfig({ rhino: uvx('rhinomcp@0.4.1.1'), web: http(' http://a/ ') }),
  );
  const stdio = userMcpServer(config, 'rhino');
  assert.deepEqual(stdio, { command: 'uvx rhinomcp@0.4.1.1', url: undefined });
  assert.doesNotMatch(JSON.stringify(stdio), new RegExp(SECRET));
  assert.deepEqual(userMcpServer(config, 'web'), { command: '', url: 'http://a/' });
  assert.equal(userMcpServer(config, 'nothing'), undefined);
  assert.equal(userMcpServer(config, 'constructor'), undefined);
  assert.equal(userMcpServer(Buffer.from('nope'), 'rhino'), null);
  assert.equal(userMcpServer(Buffer.from('\uFEFF{"mcpServers":{}}'), 'rhino'), undefined);
});

test('findPackage finds a name as a whole word, with or without a version', () => {
  assert.deepEqual(findPackage('uvx rhinomcp@0.4.1.1', 'rhinomcp'), { version: '0.4.1.1' });
  assert.deepEqual(findPackage('uvx rhinomcp', 'rhinomcp'), { version: undefined });
  assert.deepEqual(findPackage('C:\\bin\\blender-mcp.exe', 'blender-mcp'), { version: undefined });
  assert.equal(findPackage('uvx not-rhinomcp@1', 'rhinomcp'), undefined);
  assert.equal(findPackage('uvx rhinomcp-extra@1', 'rhinomcp'), undefined);
});

test('blendListsModule reads plain .blend bytes and admits what it cannot read', () => {
  assert.equal(blendListsModule(Buffer.from('BLENDER17..a\0'), 'a'), true);
  assert.equal(blendListsModule(Buffer.from('BLENDER17..ab\0'), 'a'), false);
  assert.equal(blendListsModule(Buffer.from('compressed a\0'), 'a'), undefined);
});

test('rebuildPath is machine then user, expanded, each folder once', () => {
  const env = { USERPROFILE: HOME };
  assert.equal(
    rebuildPath(
      { machinePath: 'C:\\A;;"C:\\Quoted";', userPath: 'c:\\a;%USERPROFILE%\\b' },
      env,
      HOME,
    ),
    `C:\\A;C:\\Quoted;${HOME}\\b`,
  );
  assert.equal(rebuildPath({ machinePath: null, userPath: '' }, env, HOME), undefined);
});

test('expandPath fills in known variables and leaves unknown ones', () => {
  const env = { appdata: 'D:\\Roam' };
  assert.equal(expandPath('%APPDATA%\\x', env, HOME), 'D:\\Roam\\x');
  assert.equal(expandPath('%LOCALAPPDATA%\\x', {}, HOME), `${LOCAL}\\x`);
  assert.equal(expandPath('%ProgramFiles%\\x', {}, HOME), `${PROGRAMS}\\x`);
  assert.equal(expandPath('%NOPE%\\x', {}, HOME), '%NOPE%\\x');
  assert.equal(expandPath('%DOCUMENTS%\\x', {}, HOME, 'E:\\Docs'), 'E:\\Docs\\x');
  assert.equal(expandPath('%DOCUMENTS%\\x', {}, HOME), `${HOME}\\Documents\\x`);
});

test('pathHasFolder ignores letter case and a trailing backslash', () => {
  assert.equal(pathHasFolder('C:\\A;C:\\B\\', 'c:\\b'), true);
  assert.equal(pathHasFolder('C:\\A', 'C:\\A\\sub'), false);
  assert.equal(pathHasFolder(null, 'C:\\A'), false);
});
