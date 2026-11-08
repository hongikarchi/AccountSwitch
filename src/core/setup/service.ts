import { DomainError } from '../errors.ts';
import { realCheckDeps, refreshEnginePath, runChecks, type CheckDeps } from './checks.ts';
import {
  buildInstallDeps,
  realInstallFiles,
  STOP_GRACE_MS,
  type InstallOverrides,
} from './install-deps.ts';
import { readLogTail } from './install-log.ts';
import { catalog } from './manifest.ts';
import { setRunMarker } from './run-marker.ts';
import { SetupRunner } from './runner.ts';
import { readSetupState, recordCheck, shouldAutoOpen } from './state.ts';
import type { CheckReport, RunProgress, RunRequest, SetupOverview } from './types.ts';

// What /api/v1/setup answers from. Nothing here starts a program until a route asks.

/** After the grace period, how long a closing engine still waits for the run to end (SPEC 3.4). */
const CLOSE_MARGIN_MS = 2000;
export const CLOSE_WAIT_MS = STOP_GRACE_MS + CLOSE_MARGIN_MS;

export class SetupService {
  private deps: CheckDeps;
  private directory: string;
  private installOverrides: InstallOverrides;
  private installer: SetupRunner | undefined;
  private last: CheckReport | null = null;
  private running: Promise<CheckReport> | undefined;
  private pathReady: Promise<unknown> | undefined;
  private closing = false;

  constructor(
    directory: string,
    exclusive: CheckDeps['exclusive'],
    overrides: Partial<CheckDeps> = {},
    installOverrides: InstallOverrides = {},
  ) {
    this.directory = directory;
    this.deps = realCheckDeps({ exclusive, ...overrides });
    this.installOverrides = installOverrides;
    // One service per engine, and a second engine attaches before it gets here: a marker found now
    // was left by an engine that went down during a run.
    try {
      setRunMarker(directory, false);
    } catch {
      // It only costs one question when quitting.
    }
  }

  /** Made when the first run starts, so asking about runs can never reach anything real. */
  private runner() {
    return (this.installer ??= new SetupRunner(
      buildInstallDeps(this.deps, this.directory, this.installOverrides),
    ));
  }

  startRun(request: RunRequest): RunProgress {
    if (this.closing) throw new DomainError('SETUP_RUN_ACTIVE');
    return this.runner().start(request);
  }

  runProgress() {
    return this.installer?.progress() ?? null;
  }

  /** The existing runner; before the first run there is nothing to skip, retry or cancel. */
  private existing(id: string) {
    if (this.installer) return this.installer;
    if (!catalog.items.some((item) => item.id === id)) throw new DomainError('INVALID_INPUT');
    throw new DomainError('SETUP_RUN_NOT_WAITING');
  }

  skipItem(id: string): RunProgress {
    return this.existing(id).skip(id);
  }

  retryItem(id: string): RunProgress {
    return this.existing(id).retry(id);
  }

  cancelRun(): RunProgress {
    if (!this.installer) throw new DomainError('SETUP_RUN_NOT_ACTIVE');
    return this.installer.cancel();
  }

  /** Today's log; there may be one from before this engine started. */
  log() {
    const { files = realInstallFiles, now } = this.installOverrides;
    return readLogTail(files, this.directory, now?.() ?? new Date());
  }

  /** The engine is closing: stop the run gently, and wait for it no longer than SPEC 3.4 allows. */
  async close() {
    this.closing = true;
    if (!this.installer) return;
    this.installer.stop();
    const grace = this.installOverrides.stopGraceMs ?? STOP_GRACE_MS;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, grace + CLOSE_MARGIN_MS);
    });
    await Promise.race([this.installer.settled(), late]);
    clearTimeout(timer);
    // A run still not over is cut off with the engine.
    try {
      setRunMarker(this.directory, false);
    } catch {
      // The next engine removes it.
    }
  }

  async overview(): Promise<SetupOverview> {
    const { platform } = this.deps;
    const supported = platform === 'win32';
    // Once per engine, so the auto-open rule does not trust a PATH from before an install.
    if (supported) await (this.pathReady ??= refreshEnginePath(this.deps));
    const { file, state } = readSetupState(this.directory);
    return {
      platform,
      supported,
      catalog,
      lastCheck: this.last,
      state,
      stateFile: file,
      runActive: this.installer?.active() ?? false,
      autoOpen: shouldAutoOpen({
        platform,
        stateFileExists: file !== 'missing',
        claudeInstalled: !!this.deps.executable('claude-cli'),
      }),
    };
  }

  /**
   * Run every check; a second request while one runs gets the same answer. `record`: the user chose
   * 점검만, so the results go to setup-state.json. Only then does a check write anything, and only
   * that file, in AccountSwitch's own data folder.
   */
  async check({ record = false }: { record?: boolean } = {}) {
    this.running ??= runChecks(this.deps).finally(() => {
      this.running = undefined;
    });
    const report = await this.running;
    this.last = report;
    if (record && report.supported) recordCheck(this.directory, report);
    return report;
  }
}
