import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { codexEnvironment, executable, subscriptionEnvironment } from '../cli.ts';
import {
  runCommand,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from './commands.ts';
import {
  expandPath,
  getEnv,
  pathHasFolder,
  readWindowsSnapshot,
  rebuildPath,
  setEnginePath,
  type Env,
  type WindowsSnapshot,
} from './environment.ts';
import { catalog } from './manifest.ts';
import type { CheckPart, CheckReport, CheckResult, CheckSpec, SetupItem } from './types.ts';

// The checks of SPEC 3.3. Strictly read only: they look at files and run version commands. They
// never install, never write the registry or a setting, and never read credentials. The one thing
// they change is the engine's own PATH in memory (SPEC 3.5 step 1).

export interface CheckDeps {
  platform: string;
  run: CommandRunner;
  /** The engine's environment; only PATH is ever replaced. */
  env: Env;
  home: string;
  exists: (path: string) => boolean;
  /** Names of the folders directly inside a folder; empty when it cannot be read. */
  listFolders: (path: string) => string[];
  /** Undefined when the file cannot be read. */
  readFile: (path: string) => Buffer | undefined;
  executable: (provider: 'claude-cli' | 'codex-cli') => string | undefined;
  /** `DefaultLogin.exclusive('claude-cli', task)`: one at a time with account switches. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
  /** How many commands may run at once. */
  concurrency: number;
  timeouts: { commandMs: number; pipMs: number; mcpLockWaitMs: number };
}

export const DEFAULT_TIMEOUTS: CheckDeps['timeouts'] = {
  commandMs: 15000,
  pipMs: 30000,
  mcpLockWaitMs: 60000,
};

/**
 * `existsSync` follows a link, and says false for an app-execution alias in WindowsApps (measured on
 * winget's: `lstat` works, and starting it works). So a link that is there counts as there.
 */
export function pathExists(path: string) {
  if (existsSync(path)) return true;
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function realCheckDeps(
  options: Pick<CheckDeps, 'exclusive'> & Partial<CheckDeps>,
): CheckDeps {
  return {
    platform: process.platform,
    run: runCommand,
    env: process.env,
    home: homedir(),
    exists: pathExists,
    listFolders: (path) => {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    readFile: (path) => {
      try {
        return readFileSync(path);
      } catch {
        return undefined;
      }
    },
    executable,
    concurrency: 6,
    timeouts: DEFAULT_TIMEOUTS,
    ...options,
  };
}

/** Rebuild the engine's PATH from the registry; a failed read keeps the PATH it had. */
export async function refreshEnginePath(deps: CheckDeps) {
  const snapshot = await readWindowsSnapshot(deps.run, deps.env, deps.home);
  const path = snapshot && rebuildPath(snapshot, deps.env, deps.home);
  if (path) setEnginePath(deps.env, path);
  return { snapshot, refreshed: !!path };
}

/** Whether a found version satisfies a pin: `latest`, `24.x`, or an exact version. */
export function versionMatches(pinned: string | null, found: string) {
  if (pinned === null || pinned === 'latest') return true;
  if (pinned.endsWith('.x')) return found.startsWith(pinned.slice(0, -1));
  return found === pinned;
}

/** Normalized as PyPI does: `Pillow`, `python_dotenv` and `python-dotenv` compare by this. */
const packageKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');

/** Newest first, comparing the numbers in version names. */
const newestFirst = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true });

/**
 * One server of `mcpServers` in ~/.claude.json, whole, secrets included. Only for putting it back
 * after a failed re-registration (SPEC 3.7): it stays in memory and is never logged. Undefined: not
 * registered. Null: the file cannot be understood.
 */
export function rawUserMcpServer(config: Buffer, name: string): object | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(config.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== 'object' || !Object.hasOwn(servers, name)) return undefined;
  const server = (servers as Record<string, unknown>)[name];
  return server && typeof server === 'object' ? server : undefined;
}

/**
 * A user-scope server in ~/.claude.json, where `claude mcp add -s user` puts it. Only what the checks
 * need: `env` and `headers` may hold secrets and are dropped here. Undefined: not registered. Null:
 * the file cannot be understood. `claude mcp get` would tell the same, but it starts the server.
 */
export function userMcpServer(config: Buffer, name: string) {
  const server = rawUserMcpServer(config, name);
  if (!server) return server;
  const { command, args, url } = server as { command?: unknown; args?: unknown; url?: unknown };
  return {
    /** The command line of a stdio server. */
    command: [command, ...(Array.isArray(args) ? args : [])]
      .filter((part) => typeof part === 'string')
      .join(' '),
    url: typeof url === 'string' ? url.trim() : undefined,
  };
}

/** Whether the registered command runs this package, and its `name@version`. */
export function findPackage(command: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `(?:^|[\\s\\\\/"'])${escaped}(?:@([^\\s"']+)|\\.exe)?(?=$|[\\s"'])`,
    'i',
  ).exec(command);
  return match ? { version: match[1] } : undefined;
}

/**
 * Whether userpref.blend lists an add-on module, without starting Blender. Blender keeps a
 * NUL-terminated module name for each enabled add-on (measured on 5.1 and 5.2), so this is a search
 * of the bytes. Undefined: not a plain .blend (a compressed one), so it cannot be told.
 */
export function blendListsModule(file: Buffer, module: string) {
  if (file.subarray(0, 7).toString('latin1') !== 'BLENDER') return undefined;
  return file.includes(Buffer.from(module + '\0', 'latin1'));
}

interface Context {
  deps: CheckDeps;
  snapshot?: WindowsSnapshot;
  /** A slot among the commands that may run at once. */
  run: CommandRunner;
  childEnv: NodeJS.ProcessEnv;
  path: (template: string) => string;
  /** After an install: a file alone (`orFilesExist`) does not count (SPEC 3.4). */
  requireCommand: boolean;
}

type Outcome = Omit<CheckResult, 'id' | 'pinnedVersion'>;

const STUCK = '응답이 없어 확인하지 못했어요. 다시 확인해 보세요.';

/** PATH first, then the item's known folders. On Windows only: everything here is `win32`. */
function resolveProgram(context: Context, program: string, knownFolders: string[]) {
  const names = ['.exe', '.cmd', '.bat', '.com'].map((extension) => program + extension);
  const look = (folder: string) =>
    names.map((name) => win32.join(folder, name)).find(context.deps.exists);
  for (const folder of (getEnv(context.deps.env, 'PATH') ?? '').split(';')) {
    // A relative entry would mean "wherever the engine happens to be running".
    if (!win32.isAbsolute(folder)) continue;
    const file = look(folder);
    if (file) return { file, onPath: true };
  }
  for (const folder of knownFolders) {
    const file = look(context.path(folder));
    if (file) return { file, onPath: false };
  }
  return undefined;
}

function firstGroup(pattern: string | undefined, text: string) {
  return pattern ? new RegExp(pattern, 'm').exec(text)?.[1] : undefined;
}

const commandOf = (context: Context, program: string, args: string[], timeoutMs: number) =>
  ({ program, args, timeoutMs, env: context.childEnv }) satisfies CommandRequest;

async function checkCommand(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'command' }>,
  pinned: string | null,
): Promise<Outcome> {
  const alsoFile =
    !context.requireCommand &&
    spec.orFilesExist?.some((file) => context.deps.exists(context.path(file)));
  const fallback: Outcome | undefined = alsoFile ? { status: 'installed' } : undefined;
  let foundVersion: string | undefined;
  let notOnPath = false;
  for (const [index, command] of spec.commands.entries()) {
    const program = resolveProgram(context, command.program, spec.knownFolders);
    if (!program) return fallback ?? { status: 'missing' };
    notOnPath ||= !program.onPath;
    const result = await context.run(
      commandOf(context, program.file, command.args, context.deps.timeouts.commandMs),
    );
    if (result.timedOut) return fallback ?? { status: 'timeout', message: STUCK };
    if (result.spawnError && result.spawnError !== 'ENOENT')
      return fallback ?? { status: 'error', message: '프로그램을 실행하지 못했어요.' };
    if (result.code !== 0) return fallback ?? { status: 'missing' };
    if (index === 0)
      foundVersion = firstGroup(command.versionPattern, result.stdout + '\n' + result.stderr);
  }
  const extra = {
    ...(foundVersion ? { foundVersion } : {}),
    ...(notOnPath ? { notOnPath } : {}),
  };
  if (foundVersion && !versionMatches(spec.acceptVersion ?? pinned, foundVersion))
    return { status: 'version-mismatch', ...extra };
  return { status: 'installed', ...extra };
}

async function checkCli(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'cli' }>,
): Promise<Outcome> {
  const program = context.deps.executable(spec.provider);
  if (!program) return { status: 'missing' };
  // Installed is decided by the file; the version is only reported when the CLI answers.
  const result = await context.run(
    commandOf(context, program, ['--version'], context.deps.timeouts.commandMs),
  );
  const foundVersion =
    result.code === 0 ? firstGroup(spec.versionPattern, result.stdout) : undefined;
  return { status: 'installed', ...(foundVersion ? { foundVersion } : {}) };
}

function checkEnvironment(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'environment' }>,
): Outcome {
  const { snapshot } = context;
  if (!snapshot)
    return { status: 'error', message: 'Windows 설정을 읽지 못했어요. 다시 확인해 보세요.' };
  const policies = snapshot.executionPolicy;
  const allowed = (policy: string | undefined) => !!policy && spec.allowedPolicies.includes(policy);
  // A group policy wins over CurrentUser, and the user cannot change it from here (SPEC 3.5).
  const enforced = [policies.MachinePolicy, policies.UserPolicy].find(
    (policy) => policy && policy !== 'Undefined',
  );
  const scriptsOk = enforced ? allowed(enforced) : allowed(policies.CurrentUser);
  const parts: CheckPart[] = [
    { id: 'execution-policy', label: '스크립트 실행 허용', ok: scriptsOk },
    {
      id: 'user-path',
      label: '프로그램 경로',
      ok: pathHasFolder(snapshot.userPath, context.path(spec.userPathFolder)),
    },
    {
      id: 'python-utf8',
      label: '한글 깨짐 방지',
      ok: snapshot.pythonUtf8 === spec.userVariables.PYTHONUTF8,
    },
  ];
  return {
    status: parts.every((part) => part.ok) ? 'installed' : 'missing',
    parts,
    ...(enforced && !scriptsOk
      ? { message: '회사나 학교의 정책이 스크립트 실행을 막고 있어요. 관리자에게 문의하세요.' }
      : {}),
  };
}

async function checkPip(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'pip' }>,
): Promise<Outcome> {
  const launcher = resolveProgram(context, spec.launcher, spec.knownFolders);
  if (!launcher) return { status: 'missing', missingPackages: spec.packages };
  const result = await context.run(
    commandOf(
      context,
      launcher.file,
      [`-${spec.python}`, '-m', 'pip', '--disable-pip-version-check', 'show', ...spec.packages],
      context.deps.timeouts.pipMs,
    ),
  );
  if (result.timedOut) return { status: 'timeout', message: STUCK };
  // pip exits 1 when none is found; each one found prints a `Name:` line whatever the exit code.
  const found = new Set(
    [...result.stdout.matchAll(/^Name:\s*(.+)$/gm)].map((match) => packageKey(match[1])),
  );
  const missing = spec.packages.filter((name) => !found.has(packageKey(name)));
  return missing.length ? { status: 'missing', missingPackages: missing } : { status: 'installed' };
}

function checkVersionedFolder(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'versioned-folder' }>,
): Outcome {
  const root = context.path(spec.root);
  const wanted = win32.join(root, spec.version, ...(spec.marker ? [spec.marker] : []));
  if (context.deps.exists(wanted)) return { status: 'installed', foundVersion: spec.version };
  const others = context.deps
    .listFolders(root)
    .filter((name) => /^\d/.test(name) && name !== spec.version)
    .sort(newestFirst);
  return others.length
    ? { status: 'version-mismatch', foundVersion: others[0] }
    : { status: 'missing' };
}

/** Inside the account-switch lock, and giving up rather than waiting forever for that lock. */
function insideLock<T>(deps: CheckDeps, task: () => Promise<T>) {
  return new Promise<T | undefined>((resolve, reject) => {
    let abandoned = false;
    const waiting = setTimeout(() => {
      abandoned = true;
      resolve(undefined);
    }, deps.timeouts.mcpLockWaitMs);
    deps
      .exclusive(async () => {
        if (abandoned) return undefined;
        clearTimeout(waiting);
        return task();
      })
      .then(resolve, reject);
  });
}

async function checkMcp(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'mcp' }>,
): Promise<Outcome> {
  if (!context.deps.executable('claude-cli')) return { status: 'missing' };
  // Inside the lock so the read never meets an account switch rewriting the file (SPEC 3.7).
  const read = await insideLock(context.deps, async () => ({
    config: context.deps.readFile(win32.join(context.deps.home, '.claude.json')),
  }));
  if (!read) return { status: 'timeout', message: '계정 전환이 끝나지 않아 확인하지 못했어요.' };
  if (!read.config) return { status: 'missing' };
  const server = userMcpServer(read.config, spec.name);
  if (server === null)
    return { status: 'error', message: 'Claude Code 설정 파일을 읽지 못했어요.' };
  if (!server) return { status: 'missing' };
  if (spec.url && server.url !== spec.url)
    return { status: 'version-mismatch', message: '다른 주소로 등록되어 있어요.' };
  if (spec.package) {
    const found = findPackage(server.command, spec.package);
    if (!found) return { status: 'version-mismatch', message: '다른 방식으로 등록되어 있어요.' };
    if (!found.version)
      return { status: 'version-mismatch', message: '버전을 고정하지 않고 등록되어 있어요.' };
    if (found.version !== spec.version)
      return { status: 'version-mismatch', foundVersion: found.version };
    return { status: 'installed', foundVersion: found.version };
  }
  return { status: 'installed' };
}

/**
 * A Blender outside the known folder, from the registry only: it is never started, and winget's
 * `uninstallPrevious` could remove it (SPEC 3.3). An entry whose folder has no `blender.exe` is a
 * leftover of an uninstall. Without a snapshot the answer is unknown, so it must not read as missing.
 */
function blenderElsewhere(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'blender' }>,
): Outcome {
  if (!context.snapshot)
    return { status: 'error', message: 'Blender가 있는지 확인하지 못했어요. 다시 확인해 보세요.' };
  const name = new RegExp(spec.uninstallNamePattern, 'i');
  const found = context.snapshot.blenderInstalls
    .filter((entry) => name.test(entry.name.trim()))
    .filter(
      ({ location }) => !location || context.deps.exists(win32.join(location.trim(), spec.program)),
    )
    .sort((a, b) => newestFirst(a.version ?? '', b.version ?? ''))[0];
  if (!found) return { status: 'missing' };
  const version = found.version?.trim();
  const place = found.location?.trim();
  return {
    status: 'version-mismatch',
    ...(version ? { foundVersion: version } : {}),
    message: `다른 곳에 설치된 Blender${version ? ` ${version}` : ''}${place ? `(${place})` : ''}을(를) 찾았어요.`,
  };
}

/**
 * Only the known install folders and only `blender.exe --version`, which prints and exits before
 * any window exists. The file's own version resource would not need a run, but it says only `5.2`
 * (measured), and the pin is 5.2.3.
 */
async function checkBlender(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'blender' }>,
  pinned: string | null,
): Promise<Outcome> {
  const root = context.path(spec.root);
  const pattern = new RegExp(spec.folderPattern);
  const folders = context.deps
    .listFolders(root)
    .filter((name) => pattern.test(name))
    .filter((name) => context.deps.exists(win32.join(root, name, spec.program)))
    .sort((a, b) =>
      a === spec.preferredFolder ? -1 : b === spec.preferredFolder ? 1 : newestFirst(a, b),
    );
  if (!folders.length) return blenderElsewhere(context, spec);
  const folder = folders[0];
  const series = /\d+\.\d+/.exec(folder)?.[0];
  const result = await context.run(
    commandOf(
      context,
      win32.join(root, folder, spec.program),
      ['--version'],
      context.deps.timeouts.commandMs,
    ),
  );
  const seriesOnly = series ? { foundVersion: series } : {};
  if (result.timedOut) return { status: 'timeout', message: STUCK, ...seriesOnly };
  const foundVersion =
    result.code === 0 ? firstGroup(spec.versionPattern, result.stdout) : undefined;
  if (!foundVersion)
    return { status: 'error', message: 'Blender 버전을 읽지 못했어요.', ...seriesOnly };
  return {
    status: versionMatches(pinned, foundVersion) ? 'installed' : 'version-mismatch',
    foundVersion,
  };
}

function checkBlenderAddon(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'blender-addon' }>,
): Outcome {
  const present = context.deps.exists(
    win32.join(context.path(spec.addonsFolder), `${spec.module}.py`),
  );
  const prefs = context.deps.readFile(context.path(spec.userPrefs));
  const listed = prefs && blendListsModule(prefs, spec.module);
  const parts: CheckPart[] = [
    { id: 'file', label: '애드온 파일', ok: present },
    { id: 'enabled', label: 'Blender에서 켜짐', ok: listed === true },
  ];
  // Only a file that exists but cannot be understood leaves the answer unknown.
  if (prefs && listed === undefined)
    return { status: 'error', parts, message: 'Blender 설정 파일을 읽지 못했어요.' };
  return { status: present && listed === true ? 'installed' : 'missing', parts };
}

function checkRhinoSettings(
  context: Context,
  spec: Extract<CheckSpec, { kind: 'rhino-settings' }>,
): Outcome {
  const settings = context.deps.readFile(context.path(spec.settingsFile))?.toString('utf8') ?? '';
  const note = context.deps.readFile(context.path(spec.roleNoteFile))?.toString('utf8') ?? '';
  const parts: CheckPart[] = [
    {
      id: 'read-only-warning',
      label: '읽기 전용 경고',
      ok: new RegExp(spec.readOnlyWarningPattern, 'i').test(settings),
    },
    {
      id: 'mcpstart',
      label: 'Rhino 시작할 때 mcpstart 실행',
      ok: new RegExp(spec.startupCommandPattern, 'i').test(settings),
    },
    {
      id: 'starter-file',
      label: 'Grasshopper 시작 파일',
      ok: context.deps.exists(context.path(spec.starterFile)),
    },
    {
      id: 'role-note',
      label: 'Claude Code 도구 안내',
      ok: note.includes(spec.roleNoteStart) && note.includes(spec.roleNoteEnd),
    },
  ];
  return { status: parts.every((part) => part.ok) ? 'installed' : 'missing', parts };
}

function checkOne(context: Context, item: SetupItem): Outcome | Promise<Outcome> {
  const { check } = item;
  switch (check.kind) {
    case 'command':
      return checkCommand(context, check, item.pinnedVersion);
    case 'cli':
      return checkCli(context, check);
    case 'environment':
      return checkEnvironment(context, check);
    case 'pip':
      return checkPip(context, check);
    case 'file':
      return { status: context.deps.exists(context.path(check.path)) ? 'installed' : 'missing' };
    case 'versioned-folder':
      return checkVersionedFolder(context, check);
    case 'mcp':
      return checkMcp(context, check);
    case 'blender':
      return checkBlender(context, check, item.pinnedVersion);
    case 'blender-addon':
      return checkBlenderAddon(context, check);
    case 'rhino-settings':
      return checkRhinoSettings(context, check);
  }
}

/** At most `limit` commands at once; the rest wait for a slot. */
function limited(run: CommandRunner, limit: number): CommandRunner {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (request) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await run(request);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Run every check: items whose dependency must answer first wait for it, the rest run at once. */
export async function runChecks(
  deps: CheckDeps,
  items: SetupItem[] = catalog.items,
  { requireCommand = false }: { requireCommand?: boolean } = {},
): Promise<CheckReport> {
  const startedAt = new Date().toISOString();
  const report = (
    pathSource: CheckReport['pathSource'],
    results: CheckResult[],
    supported = true,
  ): CheckReport => ({
    platform: deps.platform,
    supported,
    startedAt,
    finishedAt: new Date().toISOString(),
    pathSource,
    results,
  });
  if (deps.platform !== 'win32')
    return report(
      'none',
      items.map((item) => ({
        id: item.id,
        status: 'unsupported',
        pinnedVersion: item.pinnedVersion,
      })),
      false,
    );

  const { snapshot, refreshed } = await refreshEnginePath(deps);
  const context: Context = {
    deps,
    snapshot,
    run: limited(deps.run, deps.concurrency),
    // Whatever else the engine's environment holds, API keys and account folders stay out of it.
    childEnv: codexEnvironment(subscriptionEnvironment(deps.env as NodeJS.ProcessEnv)),
    path: (template) => expandPath(template, deps.env, deps.home, snapshot?.documents ?? undefined),
    requireCommand,
  };
  const byId = new Map(items.map((item) => [item.id, item]));
  const started = new Map<string, Promise<CheckResult>>();
  const start = (item: SetupItem): Promise<CheckResult> => {
    const known = started.get(item.id);
    if (known) return known;
    const promise = (async (): Promise<CheckResult> => {
      const dependencies = await Promise.all(
        item.dependsOn.flatMap((id) => {
          const dependency = byId.get(id);
          return dependency ? [start(dependency)] : [];
        }),
      );
      const waitingFor = dependencies.filter((d) => d.status === 'missing').map((d) => d.id);
      const base = {
        id: item.id,
        pinnedVersion: item.pinnedVersion,
        ...(waitingFor.length ? { waitingFor } : {}),
      };
      // These need the dependency to run at all, so a known absence saves starting anything.
      const needs =
        item.check.kind === 'pip' ? 'python' : item.check.kind === 'mcp' ? 'claude' : '';
      if (needs && waitingFor.includes(needs))
        return {
          ...base,
          status: 'missing',
          ...(item.check.kind === 'pip' ? { missingPackages: item.check.packages } : {}),
        };
      try {
        return { ...base, ...(await checkOne(context, item)) };
      } catch {
        return { ...base, status: 'error', message: '확인하지 못했어요. 다시 확인해 보세요.' };
      }
    })();
    started.set(item.id, promise);
    return promise;
  };
  const results = await Promise.all(items.map(start));
  return report(refreshed ? 'registry' : 'inherited', results);
}
