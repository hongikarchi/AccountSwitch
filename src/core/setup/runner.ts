import { DomainError } from '../errors.ts';
import { runChecks } from './checks.ts';
import { StepStop, type InstallDeps } from './install-deps.ts';
import { SetupLog } from './install-log.ts';
import {
  CANCELLED_MESSAGE,
  createStepContext,
  ELEVATION_HINT,
  executeStep,
  INSTALL_FAILED,
  type StepContext,
  type StepFailure,
} from './install-steps.ts';
import { ensureItemOnPath } from './install-windows.ts';
import { catalog } from './manifest.ts';
import { setRunMarker } from './run-marker.ts';
import { finishSetupState, recordSetupItem } from './state.ts';
import type {
  CheckResult,
  RunItemProgress,
  RunItemStatus,
  RunProgress,
  RunRequest,
  SetupItem,
  SetupStateItem,
} from './types.ts';

// One install run at a time, in catalog order (SPEC 3.4). Installs start only from `start`, which
// only POST /setup/run calls, and only for the items in the request.

const OTHER_VERSION_KEPT = 'OTHER_VERSION_KEPT';
const CHECK_FAILED = '지금 상태를 확인하지 못했어요. 다시 시도해 보세요.';

interface Outcome {
  status: Extract<RunItemStatus, 'done' | 'failed' | 'skipped' | 'needs-user'>;
  message?: string;
  reason?: string;
}

interface Run {
  progress: RunProgress;
  replace: Set<string>;
  cancelRequested: boolean;
  /** Fires at once on a cancel: downloads and a wait for the lock stop here. */
  cancel: AbortController;
  /** Fires when the current command outlasted the grace period. */
  kill: AbortController;
  graceTimer?: NodeJS.Timeout;
  /** The engine is closing; `stop` has done its work. */
  stopping: boolean;
  /** While `waiting`: goes on after a skip, a retry or a cancel. */
  resume?: () => void;
  ended: Promise<void>;
  log: SetupLog;
}

/** Validate a request against the catalog; the routes only check its shape. */
function validated(request: RunRequest) {
  const byId = new Map(catalog.items.map((item) => [item.id, item]));
  if (!request.items.length || request.items.some((id) => !byId.has(id)))
    throw new DomainError('INVALID_INPUT');
  const replace = request.replace ?? [];
  if (replace.some((id) => byId.get(id)?.check.kind !== 'mcp'))
    throw new DomainError('INVALID_INPUT');
  const wanted = new Set(request.items);
  return {
    items: catalog.items.filter((item) => wanted.has(item.id)),
    replace: new Set(replace),
  };
}

const itemOf = (id: string) => catalog.items.find((item) => item.id === id) as SetupItem;

export class SetupRunner {
  private deps: InstallDeps;
  private run: Run | undefined;
  /** An install ran and the item's own command did not then answer: a file alone won't do (SPEC 3.4). */
  private unconfirmed = new Set<string>();

  constructor(deps: InstallDeps) {
    this.deps = deps;
  }

  /** Whether a run's phase is `running` or `waiting` (SPEC 3.4). */
  active() {
    const phase = this.run?.progress.phase;
    return phase === 'running' || phase === 'waiting';
  }

  progress(): RunProgress | null {
    return this.run ? structuredClone(this.run.progress) : null;
  }

  /** Resolves when the current run has ended. For tests and for closing the engine. */
  settled() {
    return this.run?.ended ?? Promise.resolve();
  }

  start(request: RunRequest) {
    if (this.deps.check.platform !== 'win32') throw new DomainError('UNSUPPORTED_PLATFORM');
    const { items, replace } = validated(request);
    if (this.active()) throw new DomainError('SETUP_RUN_ACTIVE');
    const run: Run = {
      progress: {
        phase: 'running',
        mode: request.mode,
        cancelling: false,
        items: items.map((item) => ({ id: item.id, status: 'pending' })),
        startedAt: this.deps.now().toISOString(),
      },
      replace,
      cancelRequested: false,
      cancel: new AbortController(),
      kill: new AbortController(),
      stopping: false,
      ended: Promise.resolve(),
      log: new SetupLog(this.deps.files, this.deps.directory, this.deps.now),
    };
    this.run = run;
    run.log.line(`--- 설치 시작 (${request.mode}): ${items.map((item) => item.id).join(', ')}`);
    this.mark(run, true);
    run.ended = this.drive(run);
    return this.progress() as RunProgress;
  }

  skip(id: string) {
    const { run, item } = this.waitingOn(id);
    item.status = 'skipped';
    item.message = '건너뛰었어요.';
    item.finishedAt = this.deps.now().toISOString();
    run.log.line(`${id}: 건너뜀`);
    this.record(run, item);
    this.goOn(run);
    return this.progress() as RunProgress;
  }

  retry(id: string) {
    const { run, item } = this.waitingOn(id);
    run.log.line(`${id}: 다시 시도`);
    run.progress.items[run.progress.items.indexOf(item)] = { id, status: 'pending' };
    this.goOn(run);
    return this.progress() as RunProgress;
  }

  /** Stop after the current command; kill what outlasts the grace period (SPEC 3.4). */
  cancel() {
    const run = this.run;
    if (!run || !this.active()) throw new DomainError('SETUP_RUN_NOT_ACTIVE');
    if (!run.cancelRequested) {
      run.cancelRequested = true;
      run.progress.cancelling = true;
      run.log.line('--- 취소 요청');
      run.cancel.abort();
      run.graceTimer = setTimeout(() => run.kill.abort(), this.deps.cancelGraceMs);
      run.graceTimer.unref?.();
      run.resume?.();
    }
    return this.progress() as RunProgress;
  }

  /**
   * The engine is closing: stop like a cancel, with a grace period that fits before the PC program
   * gives up on the engine (SPEC 3.4). The state file is right from here on, even if the engine goes
   * down before the run ends; the current item's own result replaces this if it ends in time.
   */
  stop() {
    const run = this.run;
    if (!run || !this.active() || run.stopping) return;
    run.stopping = true;
    run.cancelRequested = true;
    run.progress.cancelling = true;
    run.log.line('--- 프로그램을 끝내는 중이라 설치를 멈춰요');
    run.cancel.abort();
    clearTimeout(run.graceTimer);
    run.graceTimer = setTimeout(() => run.kill.abort(), this.deps.stopGraceMs);
    run.graceTimer.unref?.();
    const at = this.deps.now().toISOString();
    for (const item of run.progress.items)
      if (item.status === 'pending' || item.status === 'running')
        this.write(run, item.id, { status: 'cancelled', at });
    run.resume?.();
  }

  private mark(run: Run, active: boolean) {
    try {
      setRunMarker(this.deps.directory, active);
    } catch (error) {
      run.log.line(`setup-running 쓰기 실패: ${(error as Error).message}`);
    }
  }

  private waitingOn(id: string) {
    const run = this.run;
    const item = run?.progress.items.find((entry) => entry.id === id);
    if (!run || !item) {
      if (!catalog.items.some((entry) => entry.id === id)) throw new DomainError('INVALID_INPUT');
      throw new DomainError('SETUP_RUN_NOT_WAITING');
    }
    if (run.progress.phase !== 'waiting' || item.status !== 'failed')
      throw new DomainError('SETUP_RUN_NOT_WAITING');
    return { run, item };
  }

  private goOn(run: Run) {
    run.progress.phase = 'running';
    run.resume?.();
  }

  private async drive(run: Run) {
    // Starts on a later turn, so `start` answers before the first command.
    await Promise.resolve();
    try {
      for (;;) {
        if (run.cancelRequested) break;
        const item = run.progress.items.find((entry) => entry.status === 'pending');
        if (!item) break;
        await this.runItem(run, item);
        if (item.status === 'failed' && !run.cancelRequested) {
          run.progress.phase = 'waiting';
          await new Promise<void>((resolve) => {
            run.resume = resolve;
          });
          run.resume = undefined;
        }
      }
    } finally {
      this.finish(run);
    }
  }

  private finish(run: Run) {
    clearTimeout(run.graceTimer);
    const at = this.deps.now().toISOString();
    if (run.cancelRequested)
      for (const item of run.progress.items)
        if (item.status === 'pending') {
          item.status = 'skipped';
          item.reason = 'CANCELLED';
          item.message = '취소해서 설치하지 않았어요.';
        }
    run.progress.phase = run.cancelRequested ? 'cancelled' : 'finished';
    run.progress.cancelling = false;
    run.progress.finishedAt = at;
    run.log.line(`--- 설치 끝 (${run.progress.phase})`);
    try {
      finishSetupState(this.deps.directory, run.progress.mode, at);
    } catch (error) {
      run.log.line(`setup-state.json 쓰기 실패: ${(error as Error).message}`);
    }
    this.mark(run, false);
  }

  private record(run: Run, item: RunItemProgress) {
    this.write(run, item.id, {
      status: item.status,
      ...(item.foundVersion ? { version: item.foundVersion } : {}),
      at: item.finishedAt ?? this.deps.now().toISOString(),
    });
  }

  private write(run: Run, id: string, entry: SetupStateItem) {
    try {
      recordSetupItem(this.deps.directory, run.progress.mode, id, entry);
    } catch (error) {
      run.log.line(`setup-state.json 쓰기 실패: ${(error as Error).message}`);
    }
  }

  private async runItem(run: Run, progress: RunItemProgress) {
    const item = itemOf(progress.id);
    progress.status = 'running';
    progress.startedAt = this.deps.now().toISOString();
    if (item.mayElevate) progress.message = ELEVATION_HINT;
    run.log.line(`${item.id}: 시작`);
    let outcome: Outcome;
    try {
      outcome = await this.installItem(run, item, progress);
    } catch (error) {
      if (error instanceof StepStop)
        outcome = { status: error.status, reason: error.reason, message: error.userMessage };
      else {
        run.log.line(`${item.id}: 뜻밖의 오류: ${(error as Error).message}`);
        outcome = { status: 'failed', reason: 'INTERNAL', message: INSTALL_FAILED };
      }
    }
    progress.status = outcome.status;
    if (outcome.message) progress.message = outcome.message;
    else delete progress.message;
    if (outcome.reason) progress.reason = outcome.reason;
    else delete progress.reason;
    progress.finishedAt = this.deps.now().toISOString();
    run.log.line(
      `${item.id}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}${
        outcome.message ? ` ${outcome.message}` : ''
      }`,
    );
    this.record(run, progress);
  }

  /** The item and whatever it needs that is not in this run; PATH is rebuilt first (SPEC 3.5). */
  private async checkFor(run: Run, item: SetupItem) {
    const inRun = new Set(run.progress.items.map((entry) => entry.id));
    const outside = item.dependsOn.filter((id) => !inRun.has(id)).map(itemOf);
    const report = await runChecks(this.deps.check, [item, ...outside], {
      requireCommand: this.unconfirmed.has(item.id),
    });
    return {
      result: report.results.find((entry) => entry.id === item.id) as CheckResult,
      outside: report.results.filter((entry) => entry.id !== item.id),
    };
  }

  /** What this item still waits for, as labels. */
  private waitingFor(run: Run, item: SetupItem, outside: CheckResult[]) {
    return item.dependsOn
      .filter((id) => {
        const entry = run.progress.items.find((candidate) => candidate.id === id);
        if (!entry) {
          const status = outside.find((result) => result.id === id)?.status;
          return status !== 'installed' && status !== 'version-mismatch';
        }
        if (entry.status === 'done') return false;
        return !(entry.status === 'skipped' && entry.reason === OTHER_VERSION_KEPT);
      })
      .map((id) => itemOf(id).label);
  }

  private async installItem(
    run: Run,
    item: SetupItem,
    progress: RunItemProgress,
  ): Promise<Outcome> {
    const { result: precheck, outside } = await this.checkFor(run, item);
    if (precheck.foundVersion) progress.foundVersion = precheck.foundVersion;
    const context = createStepContext(this.deps, item, precheck, {
      replace: run.replace.has(item.id),
      log: run.log,
      cancelSignal: run.cancel.signal,
      killSignal: run.kill.signal,
      deadline: Date.now() + this.deps.itemTimeoutMs,
    });
    if (precheck.status === 'installed') {
      this.unconfirmed.delete(item.id);
      await this.fixPath(context, item);
      return { status: 'done', message: '이미 설치되어 있어요.' };
    }
    const waits = this.waitingFor(run, item, outside);
    if (waits.length)
      return {
        status: 'skipped',
        reason: 'WAITING_FOR',
        message: `${waits.join(', ')}이(가) 먼저 있어야 해서 건너뛰었어요.`,
      };
    if (precheck.status === 'timeout' || precheck.status === 'error')
      return {
        status: 'failed',
        reason: 'CHECK_FAILED',
        message: precheck.message ?? CHECK_FAILED,
      };
    if (precheck.status === 'version-mismatch') {
      const kept = this.keepExisting(run, item, precheck);
      if (kept) return kept;
    }
    return this.runSteps(run, context, item, progress);
  }

  /** SPEC 3.3: what a user already has stays, unless they asked for this very item. */
  private keepExisting(run: Run, item: SetupItem, precheck: CheckResult): Outcome | undefined {
    if (item.check.kind === 'mcp')
      return run.replace.has(item.id)
        ? undefined
        : {
            status: 'needs-user',
            reason: 'REPLACE_NOT_CONFIRMED',
            message: `${precheck.message ?? '다른 설정으로 등록되어 있어요.'} 바꾸려면 확인해 주세요.`,
          };
    if (run.progress.mode !== 'auto') return undefined;
    return {
      status: 'skipped',
      reason: OTHER_VERSION_KEPT,
      message: precheck.foundVersion
        ? `이미 다른 버전(${precheck.foundVersion})이 있어서 그대로 뒀어요.`
        : '이미 다른 버전이 있어서 그대로 뒀어요.',
    };
  }

  private async runSteps(
    run: Run,
    context: StepContext,
    item: SetupItem,
    progress: RunItemProgress,
  ): Promise<Outcome> {
    let last: StepFailure = { reason: 'INSTALL_FAILED', message: INSTALL_FAILED };
    for (const step of item.install.steps) {
      if (run.cancelRequested)
        return { status: 'failed', reason: 'CANCELLED', message: CANCELLED_MESSAGE };
      let outcome;
      try {
        outcome = await executeStep(context, step);
      } catch (error) {
        // A step that could not start: its fallback may still work. A decline never gets here.
        if (error instanceof StepStop && error.fallback) {
          run.log.line(`${item.id}: ${error.reason}`);
          last = { reason: error.reason, message: error.userMessage };
          continue;
        }
        throw error;
      }
      if (outcome.ran) {
        const after = (await runChecks(this.deps.check, [item], { requireCommand: true }))
          .results[0];
        if (after.foundVersion) progress.foundVersion = after.foundVersion;
        if (after.status === 'installed') {
          this.unconfirmed.delete(item.id);
          await this.fixPath(context, item);
          return { status: 'done', ...(outcome.note ? { message: outcome.note } : {}) };
        }
        this.unconfirmed.add(item.id);
        if (outcome.needsUser) return { status: 'needs-user', ...outcome.needsUser };
        if (outcome.stop) return outcome.stop;
        // Not knowing is no reason to run a second installer on top (SPEC 3.4).
        if (after.status === 'timeout' || after.status === 'error')
          return {
            status: 'failed',
            reason: 'CHECK_FAILED',
            message: after.message ?? CHECK_FAILED,
          };
        last =
          after.status === 'version-mismatch'
            ? {
                reason: 'VERSION_MISMATCH',
                message: `설치했지만 다른 버전${after.foundVersion ? `(${after.foundVersion})` : ''}이 먼저 잡혀요.`,
              }
            : (outcome.failure ?? {
                reason: 'NOT_DETECTED',
                message: '설치가 끝났는데 프로그램을 찾지 못했어요. 로그를 확인해 보세요.',
              });
      } else if (outcome.failure) {
        run.log.line(`${item.id}: 시작하지 못해서 다음 방법으로 넘어가요.`);
        last = outcome.failure;
      }
    }
    return { status: 'failed', ...last };
  }

  /**
   * A PATH that could not be fixed is logged; the program itself is installed all the same. After a
   * cancel no new write starts; the next run reaches this again through "already installed".
   */
  private async fixPath(context: StepContext, item: SetupItem) {
    if (context.cancelSignal.aborted) return;
    try {
      await ensureItemOnPath(context, item);
    } catch (error) {
      if (error instanceof StepStop && ['CANCELLED', 'TIMEOUT'].includes(error.reason)) return;
      context.log.line(`${item.id}: PATH에 추가하지 못했어요.`);
    }
  }
}
