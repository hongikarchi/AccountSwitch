import { realCheckDeps, refreshEnginePath, runChecks, type CheckDeps } from './checks.ts';
import { catalog } from './manifest.ts';
import { readSetupState, recordCheck, shouldAutoOpen } from './state.ts';
import type { CheckReport, SetupOverview } from './types.ts';

// What /api/v1/setup answers from. Nothing here starts a program until a route asks.

export class SetupService {
  private deps: CheckDeps;
  private directory: string;
  private last: CheckReport | null = null;
  private running: Promise<CheckReport> | undefined;
  private pathReady: Promise<unknown> | undefined;

  constructor(
    directory: string,
    exclusive: CheckDeps['exclusive'],
    overrides: Partial<CheckDeps> = {},
  ) {
    this.directory = directory;
    this.deps = realCheckDeps({ exclusive, cwd: directory, ...overrides });
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
      runActive: false,
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
