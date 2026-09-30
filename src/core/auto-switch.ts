import { DomainError } from './errors.ts';
import { providers, type Provider } from './providers.ts';
import type { AccountProfiles } from './account-profiles.ts';
import type { AccountUsageService } from './account-usage.ts';

// Automatic switching: every minute, while "auto switch" and usage lookup are on, a service whose
// account in use reached the threshold (its 5-hour or 7-day use, whichever is higher) or its limit
// moves to the account with the most headroom (AccountUsageService.choose). The switch is the same
// as pressing 사용, so running CLIs pick it up the same way. At most one switch per service every
// ten minutes, unless the account in use cannot be used at all.

export interface AutoSwitchEvent {
  provider: Provider;
  from: string;
  to: string;
  at: string;
}
export interface AutoSwitchFailure {
  provider: Provider;
  to: string;
  code: string;
  at: string;
}
interface Options {
  usage: AccountUsageService;
  profiles: AccountProfiles;
  /** Make an account the default login, as the 사용 button does. */
  switchTo: (provider: Provider, id: string) => Promise<void>;
  now?: () => number;
  cooldownMs?: number;
}

export class AutoSwitch {
  /** The latest automatic switch and the latest failed one, for the page. */
  last?: AutoSwitchEvent;
  failure?: AutoSwitchFailure;
  private options: Required<Options>;
  private switchedAt = new Map<Provider, number>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(options: Options) {
    this.options = { now: Date.now, cooldownMs: 10 * 60_000, ...options };
  }
  /** One check of every service; returns the switches it made. */
  async tick() {
    const made: AutoSwitchEvent[] = [];
    if (this.running) return made;
    this.running = true;
    try {
      const settings = this.options.usage.settings();
      if (!settings.autoSwitch || !settings.usageLookup) return made;
      for (const provider of providers) {
        const current = this.options.profiles.selected(provider);
        const choice = await this.options.usage.choose(provider, current);
        if (!choice.switched) {
          // No longer needed: an earlier failure for this service is over.
          if (this.failure?.provider === provider) this.failure = undefined;
          continue;
        }
        const since = this.options.now() - (this.switchedAt.get(provider) ?? -Infinity);
        if (since < this.options.cooldownMs && !choice.limited) continue;
        const at = new Date(this.options.now()).toISOString();
        try {
          await this.options.switchTo(provider, choice.id);
        } catch (error) {
          this.failure = {
            provider,
            to: choice.id,
            code: error instanceof DomainError ? error.code : 'AUTO_SWITCH_FAILED',
            at,
          };
          continue;
        }
        this.switchedAt.set(provider, this.options.now());
        this.last = { provider, from: current, to: choice.id, at };
        this.failure = undefined;
        made.push(this.last);
      }
    } finally {
      this.running = false;
    }
    return made;
  }
  start(intervalMs = 60_000) {
    this.stop();
    this.timer = setInterval(() => void this.tick().catch(() => {}), intervalMs);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
