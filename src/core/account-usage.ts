import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Provider } from './providers.ts';
import type { AccountProfiles } from './account-profiles.ts';

// Multi-account usage, opt-in because the usage addresses are the providers' own undocumented ones:
// each account's own CLI login files are read to show who is signed
// in, and — only with "usage lookup" on — its token is sent to the provider's usage endpoint.
// Tokens are never refreshed or rewritten here (the CLI owns that), never logged or returned.
const CLAUDE_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE = 'https://chatgpt.com/backend-api/wham/usage';
/** Claude's usage endpoint allows about 30 calls an hour per account. */
const MIN_INTERVAL_MS = 3 * 60_000;
const FORCED_INTERVAL_MS = 60_000;

export interface UsageWindow {
  percent: number;
  resetsAt: string | null;
}
export interface AccountUsage {
  provider: Provider;
  id: string;
  signedIn: boolean;
  email?: string;
  plan?: string;
  /** Claude: 5-hour window; Codex: its shorter window when it has one. */
  session?: UsageWindow;
  /** 7-day window. */
  weekly?: UsageWindow;
  limitReached: boolean;
  /** Set when a request failed on this account's limit (until the reset time, or an hour). */
  limitedUntil?: string;
  checkedAt?: string;
  state: 'ok' | 'off' | 'signed-out' | 'token-expired' | 'error';
  error?: string;
}
const settingsSchema = z.object({
  usageLookup: z.boolean().default(false),
  autoSwitch: z.boolean().default(false),
  threshold: z.number().int().min(50).max(100).default(90),
});
export type UsageSettings = z.infer<typeof settingsSchema>;

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const jwtPayload = (token: string | undefined) => {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};
const iso = (value: unknown) =>
  typeof value === 'number'
    ? new Date(value * 1000).toISOString()
    : typeof value === 'string' && value
      ? new Date(value).toISOString()
      : null;

interface Options {
  profiles: AccountProfiles;
  /** Settings file (next to the account profiles). */
  file: string;
  home?: string;
  fetch?: typeof fetch;
  now?: () => number;
}
export class AccountUsageService {
  private options: Required<Omit<Options, 'profiles' | 'file'>> & Options;
  private cache = new Map<string, AccountUsage & { fetchedAt?: number }>();
  private pending = new Map<string, Promise<AccountUsage>>();
  constructor(options: Options) {
    this.options = { home: homedir(), fetch: globalThis.fetch, now: Date.now, ...options };
  }
  settings(): UsageSettings {
    return settingsSchema.parse(readJson(this.options.file) ?? {});
  }
  setSettings(next: Partial<UsageSettings>) {
    const value = settingsSchema.parse({ ...this.settings(), ...next });
    const temporary = this.options.file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, this.options.file);
    return value;
  }
  /** The CLI folder of an account (the active one is in the user's own ~/.claude / ~/.codex). */
  private folder(provider: Provider, id: string) {
    return (
      this.options.profiles.directory(provider, id) ??
      join(this.options.home, provider === 'claude-cli' ? '.claude' : '.codex')
    );
  }
  /** Who is signed in, from the CLI's own files (no network). */
  private identity(provider: Provider, id: string) {
    const relocated = this.options.profiles.directory(provider, id) !== undefined;
    const folder = this.folder(provider, id);
    if (provider === 'claude-cli') {
      const credentials = z
        .object({
          claudeAiOauth: z
            .object({
              accessToken: z.string(),
              expiresAt: z.number().optional(),
              subscriptionType: z.string().optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .safeParse(readJson(join(folder, '.credentials.json'))).data?.claudeAiOauth;
      // Claude keeps account details next to its folder by default, inside it when relocated.
      const account = z
        .object({ oauthAccount: z.object({ emailAddress: z.string() }).passthrough() })
        .passthrough()
        .safeParse(
          readJson(
            relocated ? join(folder, '.claude.json') : join(this.options.home, '.claude.json'),
          ),
        ).data?.oauthAccount;
      return {
        token: credentials?.accessToken,
        expiresAt: credentials?.expiresAt,
        email: account?.emailAddress,
        plan: credentials?.subscriptionType,
      };
    }
    const tokens = z
      .object({
        tokens: z
          .object({ access_token: z.string(), account_id: z.string(), id_token: z.string() })
          .passthrough(),
      })
      .passthrough()
      .safeParse(readJson(join(folder, 'auth.json'))).data?.tokens;
    const claims = jwtPayload(tokens?.id_token);
    const access = jwtPayload(tokens?.access_token);
    return {
      token: tokens?.access_token,
      account: tokens?.account_id,
      expiresAt: typeof access?.exp === 'number' ? access.exp * 1000 : undefined,
      email: typeof claims?.email === 'string' ? claims.email : undefined,
      plan: claims?.['https://api.openai.com/auth']?.chatgpt_plan_type,
    };
  }
  private key(provider: Provider, id: string) {
    return provider + ':' + id;
  }
  /** Current usage of one account; network only when lookup is on and the cache is stale. */
  async get(provider: Provider, id: string, force = false): Promise<AccountUsage> {
    const key = this.key(provider, id);
    const cached = this.cache.get(key);
    const identity = this.identity(provider, id);
    const base = {
      provider,
      id,
      signedIn: !!identity.token,
      email: identity.email,
      plan: identity.plan,
      limitedUntil:
        cached?.limitedUntil && Date.parse(cached.limitedUntil) > this.options.now()
          ? cached.limitedUntil
          : undefined,
    };
    if (!identity.token)
      return this.store(key, { ...base, limitReached: false, state: 'signed-out' });
    if (!this.settings().usageLookup)
      return this.store(key, { ...base, limitReached: !!base.limitedUntil, state: 'off' });
    const age = cached?.fetchedAt ? this.options.now() - cached.fetchedAt : Infinity;
    if (cached?.fetchedAt && age < (force ? FORCED_INTERVAL_MS : MIN_INTERVAL_MS))
      return { ...cached, ...base, limitReached: cached.limitReached || !!base.limitedUntil };
    // The CLI refreshes its own token on its next run; an expired one is never refreshed here.
    if (identity.expiresAt && identity.expiresAt < this.options.now())
      return this.store(key, {
        ...(cached ?? {}),
        ...base,
        limitReached: cached?.limitReached ?? false,
        state: 'token-expired',
      });
    let running = this.pending.get(key);
    if (!running) {
      running = this.fetchUsage(provider, identity)
        .then((usage) =>
          this.store(key, {
            ...base,
            ...usage,
            state: 'ok' as const,
            fetchedAt: this.options.now(),
          }),
        )
        .catch((error: Error) =>
          this.store(key, {
            ...(cached ?? {}),
            ...base,
            limitReached: cached?.limitReached ?? false,
            state: 'error' as const,
            error: error.message,
            fetchedAt: this.options.now(),
          }),
        )
        .finally(() => this.pending.delete(key));
      this.pending.set(key, running);
    }
    return running;
  }
  private store(key: string, value: AccountUsage & { fetchedAt?: number }) {
    this.cache.set(key, value);
    const { fetchedAt: _fetchedAt, ...visible } = value;
    return visible;
  }
  private async fetchUsage(
    provider: Provider,
    identity: ReturnType<AccountUsageService['identity']>,
  ): Promise<
    Pick<AccountUsage, 'session' | 'weekly' | 'limitReached' | 'checkedAt' | 'email' | 'plan'>
  > {
    const checkedAt = new Date(this.options.now()).toISOString();
    if (provider === 'claude-cli') {
      const response = await this.options.fetch(CLAUDE_USAGE, {
        headers: {
          Authorization: 'Bearer ' + identity.token,
          'anthropic-beta': 'oauth-2025-04-20',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw Error('HTTP_' + response.status);
      const window = z
        .object({ utilization: z.number(), resets_at: z.string().nullish() })
        .nullish();
      const body = z
        .object({ five_hour: window, seven_day: window })
        .passthrough()
        .parse(await response.json());
      const view = (value: z.infer<typeof window>) =>
        value ? { percent: value.utilization, resetsAt: iso(value.resets_at) } : undefined;
      const session = view(body.five_hour),
        weekly = view(body.seven_day);
      return {
        session,
        weekly,
        limitReached: [session, weekly].some((w) => (w?.percent ?? 0) >= 100),
        checkedAt,
      };
    }
    const response = await this.options.fetch(CODEX_USAGE, {
      headers: {
        Authorization: 'Bearer ' + identity.token,
        'ChatGPT-Account-Id': String(identity.account ?? ''),
        'User-Agent': 'codex_cli_rs',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error('HTTP_' + response.status);
    const window = z
      .object({
        used_percent: z.number(),
        limit_window_seconds: z.number().optional(),
        reset_at: z.number().nullish(),
      })
      .nullish();
    const body = z
      .object({
        email: z.string().optional(),
        plan_type: z.string().optional(),
        rate_limit: z
          .object({
            limit_reached: z.boolean().optional(),
            primary_window: window,
            secondary_window: window,
          })
          .nullish(),
      })
      .passthrough()
      .parse(await response.json());
    const windows = [body.rate_limit?.primary_window, body.rate_limit?.secondary_window].filter(
      (value): value is NonNullable<z.infer<typeof window>> => !!value,
    );
    const view = (value?: z.infer<typeof window>) =>
      value ? { percent: value.used_percent, resetsAt: iso(value.reset_at) } : undefined;
    // Codex reports one or two windows; the one of a week or longer is the weekly limit.
    const weekly = windows.find((w) => (w.limit_window_seconds ?? 0) >= 6 * 86400);
    const session = windows.find((w) => w !== weekly);
    return {
      session: view(session),
      weekly: view(weekly),
      limitReached: !!body.rate_limit?.limit_reached,
      checkedAt,
      email: body.email ?? identity.email,
      plan: body.plan_type ?? identity.plan,
    };
  }
  /** Every account (the CLI's own login plus added ones) of both services. */
  async all(force = false) {
    const data = this.options.profiles.list();
    const rows: AccountUsage[] = [];
    for (const provider of ['claude-cli', 'codex-cli'] as const)
      for (const id of [
        'default',
        ...data.profiles.filter((p) => p.provider === provider).map((p) => p.id),
      ])
        rows.push(await this.get(provider, id, force));
    return rows;
  }
  /** A request failed on this account's limit: skip it until its reset (or for an hour). */
  markLimited(provider: Provider, id: string) {
    const key = this.key(provider, id);
    const cached = this.cache.get(key);
    const resets = [cached?.session, cached?.weekly]
      .filter((w) => w && w.percent >= 90 && w.resetsAt)
      .map((w) => Date.parse(w!.resetsAt!));
    const until = resets.length ? Math.max(...resets) : this.options.now() + 3600_000;
    this.cache.set(key, {
      ...(cached ?? { provider, id, signedIn: true, state: 'ok' as const }),
      limitReached: true,
      limitedUntil: new Date(until).toISOString(),
    });
  }
  private load(usage: AccountUsage) {
    if (usage.limitReached || usage.limitedUntil) return Infinity;
    return Math.max(usage.session?.percent ?? 0, usage.weekly?.percent ?? 0);
  }
  /**
   * The account for a new request: the current one unless it is signed out, limited or at the
   * threshold; then the signed-in account of the same service with the most headroom.
   */
  async choose(provider: Provider, current: string) {
    const settings = this.settings();
    if (!settings.autoSwitch) return { id: current, switched: false };
    const now = await this.get(provider, current);
    if (now.signedIn && this.load(now) < settings.threshold)
      return { id: current, switched: false };
    const data = this.options.profiles.list();
    const others = await Promise.all(
      ['default', ...data.profiles.filter((p) => p.provider === provider).map((p) => p.id)]
        .filter((id) => id !== current)
        .map((id) => this.get(provider, id)),
    );
    const best = others
      .filter((usage) => usage.signedIn && this.load(usage) < settings.threshold)
      .sort((a, b) => this.load(a) - this.load(b))[0];
    return best ? { id: best.id, switched: true, from: current } : { id: current, switched: false };
  }
  exists(provider: Provider, id: string) {
    return existsSync(this.folder(provider, id));
  }
}
