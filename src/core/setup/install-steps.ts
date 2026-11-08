import { join, win32 } from 'node:path';
import { codexEnvironment, subscriptionEnvironment } from '../cli.ts';
import { rawUserMcpServer } from './checks.ts';
import type { CommandRequest, CommandResult } from './commands.ts';
import { expandPath, findProgram, powershellPath } from './environment.ts';
import { installBlenderAddon } from './install-blender.ts';
import { cleanUp, StepStop, type InstallDeps } from './install-deps.ts';
import { downloadsFolder, fetchBytes, saveDownload } from './install-download.ts';
import { describeCommand, type SetupLog } from './install-log.ts';
import { applyRhinoSettings } from './install-rhino.ts';
import { applyEnvironment } from './install-windows.ts';
import type { CheckResult, InstallStep, SetupItem } from './types.ts';

// One install step of the manifest. Commands go through the runner, with no shell, and a program by
// its full path whenever it can be known.

export const INSTALL_FAILED = '설치하지 못했어요. 로그를 확인해 보세요.';
export const DECLINED_MESSAGE = "권한 확인에서 '아니요'를 눌렀어요";
export const ELEVATION_HINT =
  "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요.";
export const CANCELLED_MESSAGE = '취소했어요.';
export const TIMEOUT_MESSAGE = '시간이 너무 오래 걸려서 멈췄어요.';

export interface StepFailure {
  reason: string;
  message: string;
}

/**
 * - `ran`: a command ran, so the check is worth repeating whatever it answered.
 * - `failure`: what to report if that check does not say installed.
 * - `needsUser`: the same, when it is up to the user.
 * - `stop`: the same, and no later step may run: the reason would only be bypassed by one.
 * - `note`: said along with `done`, when that check does say installed.
 */
export interface StepResult {
  ran: boolean;
  failure?: StepFailure;
  needsUser?: StepFailure;
  stop?: StepFailure & { status: 'failed' | 'needs-user' };
  note?: string;
}

export interface ExecOptions {
  /** Shown in the log in place of the command line, for scripts. */
  label?: string;
  /** Only how it ended goes to the log, not its output. */
  quiet?: boolean;
  /** Less than what is left of the item's time, for a command the item can do without. */
  maxMs?: number;
}

export interface StepContext {
  deps: InstallDeps;
  item: SetupItem;
  precheck: CheckResult;
  /** The user confirmed registering this MCP server again (SPEC 3.3). */
  replace: boolean;
  log: SetupLog;
  /** Fires at once on a cancel. */
  cancelSignal: AbortSignal;
  /** Fires when the current command outlasted the grace period after a cancel. */
  killSignal: AbortSignal;
  remainingMs: () => number;
  path: (template: string) => string;
  childEnv: () => NodeJS.ProcessEnv;
  /** Runs one command and logs it. A cancel or a timeout ends the item here. */
  exec: (
    request: Omit<CommandRequest, 'timeoutMs' | 'signal'>,
    options?: ExecOptions,
  ) => Promise<CommandResult>;
  /** Inside DefaultLogin.exclusive, giving up when the item's time or the run ends (SPEC 3.7). */
  claudeLock: <T>(task: () => Promise<T>) => Promise<T>;
}

/** No API key, no account folder and no session of whoever started the engine (SPEC 3.7). */
export function installEnvironment(env: NodeJS.ProcessEnv) {
  const clean = codexEnvironment(subscriptionEnvironment(env));
  for (const key of Object.keys(clean)) if (key.toUpperCase() === 'CLAUDECODE') delete clean[key];
  return clean;
}

export function createStepContext(
  deps: InstallDeps,
  item: SetupItem,
  precheck: CheckResult,
  options: {
    replace: boolean;
    log: SetupLog;
    cancelSignal: AbortSignal;
    killSignal: AbortSignal;
    deadline: number;
  },
): StepContext {
  const { check } = deps;
  const remainingMs = () => options.deadline - Date.now();
  const timeout = () => new StepStop('failed', 'TIMEOUT', TIMEOUT_MESSAGE);
  const cancelled = () => new StepStop('failed', 'CANCELLED', CANCELLED_MESSAGE);
  const childEnv = () => installEnvironment(check.env as NodeJS.ProcessEnv);
  return {
    deps,
    item,
    precheck,
    replace: options.replace,
    log: options.log,
    cancelSignal: options.cancelSignal,
    killSignal: options.killSignal,
    remainingMs,
    childEnv,
    path: (template) => expandPath(template, check.env, check.home),
    exec: async (request, { label, quiet, maxMs = Infinity } = {}) => {
      const timeoutMs = Math.min(remainingMs(), maxMs);
      if (timeoutMs <= 0) throw timeout();
      options.log.line(`$ ${label ?? describeCommand(request.program, request.args)}`);
      const result = await check.run({
        env: childEnv(),
        ...request,
        timeoutMs,
        signal: options.killSignal,
      });
      options.log.result(result, { quiet });
      if (result.cancelled) throw cancelled();
      if (result.timedOut) throw timeout();
      return result;
    },
    claudeLock: <T>(task: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        let started = false;
        let abandoned = false;
        const give = (reason: StepStop) => {
          if (started || abandoned) return;
          abandoned = true;
          clearTimeout(waiting);
          reject(reason);
        };
        const onCancel = () => give(cancelled());
        const waiting = setTimeout(() => give(timeout()), Math.max(1, remainingMs()));
        options.cancelSignal.addEventListener('abort', onCancel, { once: true });
        if (options.cancelSignal.aborted) onCancel();
        check
          .exclusive(async () => {
            options.cancelSignal.removeEventListener('abort', onCancel);
            clearTimeout(waiting);
            if (abandoned) return undefined;
            started = true;
            return task();
          })
          .then((value) => {
            if (!abandoned) resolve(value as T);
          }, reject);
      }),
  };
}

const REBOOT_NOTE = 'PC를 다시 시작해야 설치가 마무리돼요.';
const REBOOT_RETRY = 'PC를 다시 시작한 뒤 다시 시도하세요.';
const REBOOT_SOON = 'PC가 곧 다시 시작될 수 있어요. 열어 둔 파일을 저장하세요.';
/** ERROR_SUCCESS_REBOOT_REQUIRED and ERROR_SUCCESS_REBOOT_INITIATED, from any installer. */
const REBOOT_PENDING: Record<number, string> = { 3010: REBOOT_RETRY, 1641: REBOOT_SOON };

/** A step's exit code and what it says. Windows codes can arrive as negative numbers. */
function judge(
  result: CommandResult,
  declined: number[] = [],
  failure: StepFailure = { reason: 'INSTALL_FAILED', message: INSTALL_FAILED },
): StepResult {
  if (result.spawnError) return { ran: false, failure };
  const code = result.code === null ? null : result.code >>> 0;
  if (code !== null && declined.includes(code))
    throw new StepStop('failed', 'ELEVATION_DECLINED', DECLINED_MESSAGE);
  if (code !== null && Object.hasOwn(REBOOT_PENDING, code))
    return {
      ran: true,
      note: code === 1641 ? REBOOT_SOON : REBOOT_NOTE,
      stop: { status: 'needs-user', reason: 'REBOOT_PENDING', message: REBOOT_PENDING[code] },
    };
  return code === 0 ? { ran: true } : { ran: true, failure };
}

type WingetStop = NonNullable<StepResult['stop']> & { note?: string };

const WINGET_ALREADY: WingetStop = {
  status: 'failed',
  reason: 'WINGET_ALREADY_INSTALLED',
  message: '이미 설치되어 있다고 나오는데 여기서는 제대로 잡히지 않아요. 로그를 확인해 보세요.',
};
const WINGET_POLICY: WingetStop = {
  status: 'needs-user',
  reason: 'WINGET_BLOCKED_BY_POLICY',
  message: '회사나 학교의 정책이 설치를 막고 있어요. 관리자에게 문의하세요.',
};
const WINGET_IN_USE: WingetStop = {
  status: 'failed',
  reason: 'WINGET_APP_IN_USE',
  message: '설치할 프로그램이 지금 쓰이고 있어요. 닫은 뒤 다시 시도해 보세요.',
};
const WINGET_REBOOT = (message: string, note?: string): WingetStop => ({
  status: 'needs-user',
  reason: 'WINGET_REBOOT_REQUIRED',
  message,
  ...(note ? { note } : {}),
});

/**
 * Exit codes of winget that end the item, because a fallback would bypass or collide with the reason
 * (SPEC 3.6). Anything else may still fall back. Values from winget's own list, read 2026-11-06:
 * https://github.com/microsoft/winget-cli/blob/master/doc/windows/package-manager/winget/returnCodes.md
 * The check after the step still comes first, so "already installed" ends in `done` when it is true.
 */
const WINGET_STOPS = new Map<number, WingetStop>([
  [0x8a15002b, WINGET_ALREADY], // UPDATE_NOT_APPLICABLE
  [0x8a15010d, WINGET_ALREADY], // INSTALL_ALREADY_INSTALLED
  [0x8a150061, WINGET_ALREADY], // PACKAGE_ALREADY_INSTALLED
  [
    0x8a15010e, // INSTALL_DOWNGRADE
    {
      status: 'needs-user',
      reason: 'WINGET_NEWER_INSTALLED',
      message: '이미 더 높은 버전이 있어서 그대로 뒀어요.',
    },
  ],
  [0x8a15010f, WINGET_POLICY], // INSTALL_BLOCKED_BY_POLICY
  [0x8a15003a, WINGET_POLICY], // BLOCKED_BY_POLICY, winget itself turned off by group policy
  [
    0x8a150102, // INSTALL_INSTALL_IN_PROGRESS
    {
      status: 'failed',
      reason: 'WINGET_INSTALL_IN_PROGRESS',
      message: '다른 설치가 진행 중이에요. 끝난 뒤 다시 시도해 보세요.',
    },
  ],
  [0x8a150101, WINGET_IN_USE], // INSTALL_PACKAGE_IN_USE
  [0x8a150103, WINGET_IN_USE], // INSTALL_FILE_IN_USE
  [0x8a150111, WINGET_IN_USE], // INSTALL_PACKAGE_IN_USE_BY_APPLICATION
  [
    0x8a150105, // INSTALL_DISK_FULL
    {
      status: 'failed',
      reason: 'WINGET_DISK_FULL',
      message: '디스크 공간이 모자라요. 공간을 비운 뒤 다시 시도해 보세요.',
    },
  ],
  [0x8a150109, WINGET_REBOOT(REBOOT_RETRY, REBOOT_NOTE)], // INSTALL_REBOOT_REQUIRED_TO_FINISH
  [0x8a15010a, WINGET_REBOOT(REBOOT_RETRY)], // INSTALL_REBOOT_REQUIRED_FOR_INSTALL
  [0x8a15010b, WINGET_REBOOT(REBOOT_SOON, REBOOT_SOON)], // INSTALL_REBOOT_INITIATED
]);

function judgeWinget(result: CommandResult, declined: number[]): StepResult {
  const judged = judge(result, declined);
  const known = result.code === null ? undefined : WINGET_STOPS.get(result.code >>> 0);
  if (!known) return judged;
  const { note, ...stop } = known;
  return { ran: true, stop, ...(note ? { note } : {}) };
}

/** Save the install script through the host list, then run what was saved (SPEC 3.3). */
async function runScript(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'powershell-script' }>,
) {
  const { check, fetch: fetcher, files, directory } = context.deps;
  const bytes = await fetchBytes(step.url, {
    fetcher,
    cancel: context.cancelSignal,
    timeoutMs: context.remainingMs(),
  });
  const file = join(downloadsFolder(directory), `${context.item.id}-install.ps1`);
  files.write(file, bytes);
  const run = async () =>
    judge(
      await context.exec(
        {
          program: powershellPath(check.env, check.home),
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'iex (Get-Content -Raw -Encoding UTF8 -LiteralPath $env:ACCOUNTSWITCH_SCRIPT)',
          ],
          env: { ...context.childEnv(), ACCOUNTSWITCH_SCRIPT: file },
        },
        { label: `PowerShell: ${step.url}` },
      ),
    );
  try {
    return await (step.insideClaudeLock ? context.claudeLock(run) : run());
  } finally {
    cleanUp(files, context.log, file);
  }
}

/** On the bytes about to run, as late as possible, so nothing can change between this and the run. */
async function verifyInstaller(context: StepContext, file: string, sha256: string) {
  let actual: string;
  try {
    actual = await context.deps.files.hash(file);
  } catch {
    throw new StepStop(
      'failed',
      'HASH_MISMATCH',
      '내려받은 설치 파일을 확인하지 못해서 실행하지 않았어요.',
    );
  }
  if (actual !== sha256.toLowerCase())
    throw new StepStop(
      'failed',
      'HASH_MISMATCH',
      '내려받은 설치 파일이 기대한 파일과 달라서 실행하지 않았어요.',
    );
  if (context.cancelSignal.aborted) throw new StepStop('failed', 'CANCELLED', CANCELLED_MESSAGE);
}

async function runInstaller(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'download-installer' }>,
) {
  const { fetch: fetcher, files, directory } = context.deps;
  const file = await saveDownload(step.url, directory, files, {
    fetcher,
    cancel: context.cancelSignal,
    timeoutMs: context.remainingMs(),
  });
  const fill = (value: string) => (value === '<file>' ? file : value);
  const program =
    step.program === 'msiexec'
      ? context.path('%SystemRoot%\\System32\\msiexec.exe')
      : fill(step.program);
  try {
    await verifyInstaller(context, file, step.sha256);
    return judge(
      await context.exec({ program, args: step.args.map(fill) }),
      step.declinedExitCodes,
    );
  } finally {
    cleanUp(files, context.log, file);
  }
}

/**
 * `npm.cmd` with `shell: false` fails with EINVAL, so npm runs as what it is: `node npm-cli.js`, from
 * the Node that is on this PC now.
 */
async function runNpm(context: StepContext, step: Extract<InstallStep, { kind: 'npm-global' }>) {
  const { check } = context.deps;
  const node = findProgram(
    'node',
    [context.path('%ProgramFiles%\\nodejs')],
    check.env,
    check.exists,
  );
  const script =
    node && win32.join(win32.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!node || !script || !check.exists(script))
    throw new StepStop('failed', 'NODE_MISSING', 'Node.js를 찾지 못했어요. 먼저 설치해 주세요.');
  return judge(
    await context.exec({
      program: node,
      args: [script, 'install', '-g', step.package, '--no-audit', '--no-fund'],
    }),
  );
}

async function runPip(context: StepContext, step: Extract<InstallStep, { kind: 'pip' }>) {
  const { check } = context.deps;
  const folders = context.item.check.kind === 'pip' ? context.item.check.knownFolders : [];
  const launcher = findProgram(step.launcher, folders.map(context.path), check.env, check.exists);
  if (!launcher)
    throw new StepStop('failed', 'PYTHON_MISSING', 'Python을 찾지 못했어요. 먼저 설치해 주세요.');
  // Only what the check found missing, so nothing the user has gets upgraded.
  const packages = context.precheck.missingPackages?.length
    ? context.precheck.missingPackages
    : step.packages;
  return judge(
    await context.exec({
      program: launcher,
      args: [
        `-${step.python}`,
        '-m',
        'pip',
        '--disable-pip-version-check',
        '--no-input',
        'install',
        ...packages,
      ],
    }),
  );
}

async function runYak(context: StepContext, step: Extract<InstallStep, { kind: 'yak' }>) {
  const program = context.path(step.program);
  if (!context.deps.check.exists(program))
    throw new StepStop(
      'failed',
      'YAK_MISSING',
      'Rhino 패키지 관리자를 찾지 못했어요. Rhino 8이 제대로 설치되어 있는지 확인해 주세요.',
    );
  return judge(await context.exec({ program, args: ['install', step.package, step.version] }));
}

const CLAUDE_MISSING = 'Claude Code를 찾지 못했어요. 먼저 설치해 주세요.';
const MCP_FAILED = 'Claude Code에 등록하지 못했어요. 로그를 확인해 보세요.';
const CODEX_MISSING = 'Codex CLI를 찾지 못했어요. 먼저 설치해 주세요.';
const CODEX_MCP_FAILED = 'Codex CLI에 등록하지 못했어요. 로그를 확인해 보세요.';
const MCP_CONFIG_UNREADABLE =
  'Claude Code 설정 파일을 읽지 못해서 등록을 그대로 뒀어요. 다시 시도해 보세요.';
const MCP_PUT_BACK = '새 설정으로 등록하지 못해서 원래 설정으로 되돌렸어요.';
const MCP_NOT_PUT_BACK =
  '새 설정으로 등록하지 못했고, 원래 설정도 되돌리지 못했어요. 이 연결은 지금 Claude Code에 등록되어 있지 않으니 직접 다시 등록해 주세요.';
const RESTORE_TIMEOUT_MS = 30 * 1000;

const ended = (failure: StepFailure): StepResult => ({
  ran: true,
  stop: { status: 'failed', ...failure },
});

/**
 * Put back the entry that `claude mcp remove` took away. Past the item's time and past a cancel, since
 * otherwise those are exactly what would lose it. `entry` can hold secrets: only how the command ended
 * is logged, and nothing of it goes anywhere else (SPEC 3.7).
 */
async function restoreMcpServer(context: StepContext, claude: string, name: string, entry: object) {
  const { check } = context.deps;
  context.log.line(`$ claude mcp add-json: ${name} 되돌리기`);
  const result = await check.run({
    program: claude,
    args: ['mcp', 'add-json', '-s', 'user', name, JSON.stringify(entry)],
    cwd: check.home,
    env: context.childEnv(),
    timeoutMs: RESTORE_TIMEOUT_MS,
  });
  context.log.result(result, { quiet: true });
  return result.code === 0;
}

/**
 * Inside DefaultLogin.exclusive, without CLAUDE_CONFIG_DIR (SPEC 3.7). Output is not logged: `claude
 * mcp` prints env values. Registered differently, the old entry goes first, and only when the user
 * confirmed; the runner never gets here otherwise. That entry is kept in memory first, and put back
 * if the add does not succeed.
 */
async function runClaudeMcp(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'claude-mcp-add' }>,
) {
  const { check } = context.deps;
  const { item, precheck, replace } = context;
  return context.claudeLock(async () => {
    const claude = check.executable('claude-cli');
    if (!claude) throw new StepStop('failed', 'CLAUDE_MISSING', CLAUDE_MISSING);
    const failure = { reason: 'MCP_FAILED', message: MCP_FAILED };
    const request = (args: string[]) => ({ program: claude, args, cwd: check.home });
    let previous: { name: string; entry: object } | undefined;
    if (precheck.status === 'version-mismatch') {
      if (!replace || item.check.kind !== 'mcp')
        throw new StepStop('failed', 'REPLACE_NOT_CONFIRMED', MCP_FAILED);
      const { name } = item.check;
      const config = check.readFile(win32.join(check.home, '.claude.json'));
      const entry = config ? rawUserMcpServer(config, name) : null;
      // Nothing to put back later means nothing may be taken away now.
      if (entry === null) throw new StepStop('failed', 'MCP_FAILED', MCP_CONFIG_UNREADABLE);
      // Gone since the check: nothing to remove, and nothing to put back.
      if (entry) {
        const removed = await context.exec(request(['mcp', 'remove', '-s', 'user', name]), {
          quiet: true,
        });
        if (removed.code !== 0)
          return removed.spawnError ? judge(removed, [], failure) : ended(failure);
        previous = { name, entry };
      }
    }
    if (!previous)
      return judge(await context.exec(request(step.args), { quiet: true }), [], failure);
    const { name, entry } = previous;
    let added: CommandResult;
    try {
      added = await context.exec(request(step.args), { quiet: true });
    } catch (error) {
      // A timeout or a cancel: the add was stopped, and the entry is still gone.
      if (!(error instanceof StepStop)) throw error;
      const back = await restoreMcpServer(context, claude, name, entry);
      throw new StepStop(
        error.status,
        error.reason,
        `${error.userMessage} ${back ? MCP_PUT_BACK : MCP_NOT_PUT_BACK}`,
      );
    }
    if (added.code === 0) return { ran: true };
    const back = await restoreMcpServer(context, claude, name, entry);
    return ended(
      back
        ? { reason: 'MCP_FAILED', message: MCP_PUT_BACK }
        : { reason: 'MCP_RESTORE_FAILED', message: MCP_NOT_PUT_BACK },
    );
  });
}

/**
 * No lock: an account switch changes only Codex's auth.json. The add replaces an entry of the same
 * name in place, so there is nothing to remove first and a failed add leaves the old one (SPEC 3.7).
 * Output is not logged, for the same reason as `claude mcp`.
 */
async function runCodexMcp(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'codex-mcp-add' }>,
) {
  const { check } = context.deps;
  if (context.precheck.status === 'version-mismatch' && !context.replace)
    throw new StepStop('failed', 'REPLACE_NOT_CONFIRMED', CODEX_MCP_FAILED);
  const codex = check.executable('codex-cli');
  if (!codex) throw new StepStop('failed', 'CODEX_MISSING', CODEX_MISSING);
  const result = await context.exec(
    { program: codex, args: step.args, cwd: check.home },
    { quiet: true },
  );
  return judge(result, [], { reason: 'MCP_FAILED', message: CODEX_MCP_FAILED });
}

export async function executeStep(context: StepContext, step: InstallStep): Promise<StepResult> {
  switch (step.kind) {
    case 'winget': {
      const result = await context.exec({
        program: context.path(step.program),
        args: step.args,
      });
      return judgeWinget(result, step.declinedExitCodes);
    }
    case 'powershell-script':
      return runScript(context, step);
    case 'download-installer':
      return runInstaller(context, step);
    case 'npm-global':
      return runNpm(context, step);
    case 'pip':
      return runPip(context, step);
    case 'yak':
      return runYak(context, step);
    case 'codex-mcp-add':
      return runCodexMcp(context, step);
    case 'claude-mcp-add':
      return runClaudeMcp(context, step);
    case 'environment':
      return applyEnvironment(context, step);
    case 'blender-addon':
      return installBlenderAddon(context, step);
    case 'rhino-settings':
      return applyRhinoSettings(context);
    case 'manual':
      throw new StepStop('needs-user', 'MANUAL', step.message);
  }
}
