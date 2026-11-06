// A pretend Windows PC for the install tests: every command, download and file lands here, so no
// test can install anything. The state file goes to a temporary folder.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { realCheckDeps } from '../src/core/setup/checks.ts';
import { buildInstallDeps } from '../src/core/setup/install-deps.ts';
import { SetupRunner } from '../src/core/setup/runner.ts';

export const HOME = 'C:\\Users\\tester';
export const APPDATA = `${HOME}\\AppData\\Roaming`;
export const LOCAL = `${HOME}\\AppData\\Local`;
export const BIN = `${HOME}\\.local\\bin`;
export const PROGRAMS = 'C:\\Program Files';
export const SECRET = 'do-not-leak-this-value';
export const CLAUDE_CONFIG = `${HOME}\\.claude.json`;
export const SETTINGS = `${APPDATA}\\McNeel\\Rhinoceros\\8.0\\settings\\settings-Scheme__Default.xml`;
export const NOTE = `${HOME}\\.claude\\CLAUDE.md`;
export const WINGET = `${LOCAL}\\Microsoft\\WindowsApps\\winget.exe`;

export const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false });
export const exit = (code, stderr = '') => ({ code, stdout: '', stderr, timedOut: false });
export const notThere = () => ({
  code: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  spawnError: 'ENOENT',
});

/** Files in memory, with the shape of InstallFiles. */
export function memoryFiles(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  return {
    store,
    read: (path) => store.get(path),
    write: (path, data) => store.set(path, Buffer.from(data)),
    copy: (from, to) => store.set(to, store.get(from)),
    remove: (path) => store.delete(path),
    save: async (path, body) => {
      store.set(path, Buffer.from(await new Response(body).arrayBuffer()));
    },
    append: (path, text) =>
      store.set(path, Buffer.concat([store.get(path) ?? Buffer.alloc(0), Buffer.from(text)])),
    tail: (path, max) => (store.get(path) ?? Buffer.alloc(0)).subarray(-max),
  };
}

const VERSION_ANSWERS = {
  git: 'git version 2.50.0',
  node: 'v24.22.1',
  uv: 'uv 0.9.0',
  uvx: 'uvx 0.9.0',
  py: 'Python 3.13.5',
  claude: '2.1.0 (Claude Code)',
  codex: 'codex-cli 0.50.0',
  blender: 'Blender 5.2.3',
};

const lower = (path) => path.toLowerCase();

/**
 * `on(request, name, pc)` answers a command first; undefined leaves it to the defaults, where an
 * install "succeeds" without changing anything. `pc.add(path)` makes a file appear.
 */
export function fakePc({
  present = [],
  files: initialFiles = {},
  folders = {},
  on = () => undefined,
  fetch,
  policy = { CurrentUser: 'RemoteSigned' },
  userPath = BIN,
  machinePath = 'C:\\Windows\\System32',
  pythonUtf8 = '1',
  running = [],
  pip = [],
  exclusive,
  now,
  itemTimeoutMs,
  cancelGraceMs,
  // Short, so a test that ends with a command still going does not wait out the real 10 s.
  stopGraceMs = 5,
} = {}) {
  const files = memoryFiles(initialFiles);
  const paths = new Set(present.map(lower));
  const pc = {
    calls: [],
    downloads: [],
    files,
    running: new Set(running),
    pip: new Set(pip),
    /** The user PATH as the registry holds it, unexpanded. */
    rawUserPath: userPath,
    pathWrites: [],
    broadcasts: 0,
    snapshotFails: false,
    policy,
    pythonUtf8,
    versions: { ...VERSION_ANSWERS },
    lockHolders: 0,
    insideLock: [],
    add: (path) => paths.add(lower(path)),
    drop: (path) => paths.delete(lower(path)),
    has: (path) => paths.has(lower(path)),
    log() {
      const text = [...files.store.entries()].filter(([path]) => path.includes('setup-'));
      return text.map(([, bytes]) => bytes.toString('utf8')).join('');
    },
    /** Commands that are not checks: what a run would really have changed. */
    named: (name) => pc.calls.filter((call) => commandName(call) === name),
  };
  const env = {
    PATH: 'C:\\stale',
    USERPROFILE: HOME,
    APPDATA,
    LOCALAPPDATA: LOCAL,
    ProgramFiles: PROGRAMS,
    SystemRoot: 'C:\\Windows',
    CLAUDE_CONFIG_DIR: 'C:\\some\\account',
    ANTHROPIC_API_KEY: SECRET,
    OPENAI_API_KEY: SECRET,
    CLAUDECODE: '1',
  };
  pc.env = env;

  const run = async (request) => {
    pc.calls.push(request);
    if (pc.lockHolders > 0) pc.insideLock.push(request);
    const name = commandName(request);
    const script = name === 'powershell' ? request.args.at(-1) : '';
    if (script.includes('GetFolderPath')) {
      if (pc.snapshotFails) return exit(1);
      return ok(
        JSON.stringify({
          machinePath,
          userPath: pc.rawUserPath.replaceAll('%USERPROFILE%', HOME),
          pythonUtf8: pc.pythonUtf8,
          documents: `${HOME}\\Documents`,
          executionPolicy: pc.policy,
        }),
      );
    }
    const custom = await on(request, name, pc);
    if (custom) return custom;
    if (script.includes('OpenSubKey'))
      return ok(JSON.stringify({ value: pc.rawUserPath === null ? null : pc.rawUserPath }));
    if (script.includes("SetValue('Path'")) {
      pc.pathWrites.push(request.env.ACCOUNTSWITCH_VALUE);
      pc.rawUserPath = request.env.ACCOUNTSWITCH_VALUE;
      return ok();
    }
    if (script.includes('SendMessageTimeout')) {
      pc.broadcasts++;
      return ok();
    }
    if (script.includes('SetEnvironmentVariable')) {
      if (request.env.ACCOUNTSWITCH_NAME === 'PYTHONUTF8')
        pc.pythonUtf8 = request.env.ACCOUNTSWITCH_VALUE;
      return ok();
    }
    if (script.includes('Set-ExecutionPolicy')) {
      pc.policy = { ...pc.policy, CurrentUser: request.env.ACCOUNTSWITCH_VALUE };
      return ok();
    }
    if (name === 'tasklist') {
      const image = /IMAGENAME eq (.+)$/.exec(request.args[1])[1];
      return ok(
        pc.running.has(image)
          ? `"${image}","4321","Console","1","1,024 K"\r\n`
          : 'INFO: No tasks are running which match the specified criteria.\r\n',
      );
    }
    if (request.args.includes('show') && request.args.includes('pip')) {
      const names = request.args.slice(request.args.indexOf('show') + 1);
      return ok(
        names
          .filter((package_) => pc.pip.has(package_))
          .map((package_) => `Name: ${package_}\nVersion: 1\n`)
          .join('---\n'),
      );
    }
    if (['--version', '-v'].includes(request.args.at(-1)) && pc.versions[name])
      return ok(pc.versions[name]);
    return ok();
  };

  const check = realCheckDeps({
    platform: 'win32',
    env,
    home: HOME,
    run,
    exists: (path) => paths.has(lower(path)),
    listFolders: (path) => folders[path] ?? [],
    readFile: (path) => files.read(path),
    executable: (provider) => {
      const file = provider === 'claude-cli' ? `${BIN}\\claude.exe` : `${APPDATA}\\npm\\codex.cmd`;
      return paths.has(lower(file)) ? file : undefined;
    },
    exclusive:
      exclusive ??
      (async (task) => {
        pc.lockHolders++;
        try {
          return await task();
        } finally {
          pc.lockHolders--;
        }
      }),
  });
  pc.check = check;
  pc.overrides = {
    fetch:
      fetch ??
      (async (url) => {
        pc.downloads.push(url);
        return new Response('installer bytes');
      }),
    files,
    ...(now ? { now } : {}),
    ...(itemTimeoutMs ? { itemTimeoutMs } : {}),
    ...(cancelGraceMs ? { cancelGraceMs } : {}),
    stopGraceMs,
  };
  return pc;
}

export function commandName(request) {
  return win32
    .basename(request.program)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');
}

/** A hang in a run fails its test instead of the whole suite. */
function inTime(promise, ms = 20000) {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('still not finished')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A runner on a pretend PC, with its state file in a temporary folder. */
export async function withRunner(options, body) {
  const directory = await mkdtemp(join(tmpdir(), 'accountswitch-setup-runner-'));
  const pc = fakePc(options);
  const runner = new SetupRunner(buildInstallDeps(pc.check, directory, pc.overrides));
  try {
    await inTime(body({ runner, pc, directory }));
  } finally {
    runner.stop();
    await inTime(runner.settled());
    await rm(directory, { recursive: true, force: true });
  }
}

export const statusOf = (run, id) => run.items.find((item) => item.id === id)?.status;
export const itemOf = (run, id) => run.items.find((item) => item.id === id);

/** Poll until the condition holds, without assuming how many turns a fake takes. */
export async function until(condition, what = 'condition') {
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`never happened: ${what}`);
}
