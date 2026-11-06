import { DomainError } from '../errors.ts';
import { realCheckDeps, refreshEnginePath, runChecks, type CheckDeps } from './checks.ts';
import { buildInstallDeps, realInstallFiles, type InstallOverrides } from './install-deps.ts';
import { readLogTail } from './install-log.ts';
import { catalog } from './manifest.ts';
import { SetupRunner } from './runner.ts';
import { readSetupState, recordCheck, shouldAutoOpen } from './state.ts';
import type { CheckReport, RunProgress, RunRequest, SetupOverview } from './types.ts';

// What /api/v1/setup answers from. Nothing here starts a program until a route asks.

const CLOSE_WAIT_MS = 2000;

export class SetupService {
  private deps: CheckDeps;
  private directory: string;
  private installOverrides: InstallOverrides;
  private installer: SetupRunner | undefined;
  private last: CheckReport | null = null;
  private running: Promise<CheckReport> | undefined;
  private pathReady: Promise<unknown> | undefined;

  constructor(
    directory: string,
    exclusive: CheckDeps['exclusive'],
    overrides: Partial<CheckDeps> = {},
    installOverrides: InstallOverrides = {},
  ) {
    this.directory = directory;
    this.deps = realCheckDeps({ exclusive, ...overrides });
    this.installOverrides = installOverrides;
  }

  /** Made when the first run starts, so asking about runs can never reach anything real. */
  private runner() {
    return (this.installer ??= new SetupRunner(
      buildInstallDeps(this.deps, this.directory, this.installOverrides),
    ));
  }

  startRun(request: RunRequest): RunProgress {
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

  /** The engine is closing: stop the run, and wait for it only briefly. */
  async close() {
    if (!this.installer) return;
    this.installer.stop();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CLOSE_WAIT_MS);
    });
    await Promise.race([this.installer.settled(), late]);
    clearTimeout(timer);
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
