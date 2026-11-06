import { join, win32 } from 'node:path';
import { codexEnvironment, subscriptionEnvironment } from '../cli.ts';
import type { CommandRequest, CommandResult } from './commands.ts';
import { expandPath, findProgram, powershellPath } from './environment.ts';
import { installBlenderAddon } from './install-blender.ts';
import { StepStop, type InstallDeps } from './install-deps.ts';
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
 */
export interface StepResult {
  ran: boolean;
  failure?: StepFailure;
  needsUser?: StepFailure;
}

export interface ExecOptions {
  /** Shown in the log in place of the command line, for scripts. */
  label?: string;
  /** Only how it ended goes to the log, not its output. */
  quiet?: boolean;
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
    exec: async (request, { label, quiet } = {}) => {
      const timeoutMs = remainingMs();
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

/** A failed winget and what the exit code says. Windows codes can arrive as negative numbers. */
function judge(
  result: CommandResult,
  declined: number[] = [],
  failure: StepFailure = { reason: 'INSTALL_FAILED', message: INSTALL_FAILED },
): StepResult {
  if (result.spawnError) return { ran: false, failure };
  const code = result.code === null ? null : result.code >>> 0;
  if (code !== null && declined.includes(code))
    throw new StepStop('failed', 'ELEVATION_DECLINED', DECLINED_MESSAGE);
  return code === 0 ? { ran: true } : { ran: true, failure };
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
    files.remove(file);
  }
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
    return judge(
      await context.exec({ program, args: step.args.map(fill) }),
      step.declinedExitCodes,
    );
  } finally {
    files.remove(file);
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

/**
 * Inside DefaultLogin.exclusive, without CLAUDE_CONFIG_DIR (SPEC 3.7). Output is not logged: `claude
 * mcp` prints env values. Registered differently, the old entry goes first, and only when the user
 * confirmed; the runner never gets here otherwise.
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
    if (precheck.status === 'version-mismatch') {
      if (!replace || item.check.kind !== 'mcp')
        throw new StepStop('failed', 'REPLACE_NOT_CONFIRMED', MCP_FAILED);
      const removed = await context.exec(
        request(['mcp', 'remove', '-s', 'user', item.check.name]),
        {
          quiet: true,
        },
      );
      if (removed.code !== 0) return judge(removed, [], failure);
    }
    return judge(await context.exec(request(step.args), { quiet: true }), [], failure);
  });
}

export async function executeStep(context: StepContext, step: InstallStep): Promise<StepResult> {
  switch (step.kind) {
    case 'winget': {
      const result = await context.exec({
        program: context.path(step.program),
        args: step.args,
      });
      return judge(result, step.declinedExitCodes);
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
