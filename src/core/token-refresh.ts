// Renewing an expired login the way the CLI itself would, so an account not in use shows its
// usage without being used first. Refresh tokens rotate: the new ones must be saved at once, and
// one refresh token must never be sent twice (the provider can then sign the login out). These
// functions only talk to the provider; DefaultLogin.refresh reads and saves under the CLI's locks.

const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** The provider refused the refresh token itself: only signing in again helps. */
export class LoginExpired extends Error {
  constructor(detail: string) {
    super('LOGIN_EXPIRED: ' + detail);
  }
}

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

async function exchange(fetcher: typeof fetch, url: string, body: Record<string, string>) {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Inside the time Claude Code waits for the refresh lock held meanwhile (5 tries of 1-2 s).
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let data: Record<string, unknown> | undefined;
  try {
    data = record(JSON.parse(text));
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    // RFC 6749: a 400/401 naming the grant (invalid_grant, refresh_token_*) is final; anything
    // else (rate limits, outages, unreadable answers) is worth trying again later.
    const error = record(data?.error)?.code ?? data?.error;
    if (
      [400, 401, 403].includes(response.status) &&
      typeof error === 'string' &&
      /invalid_grant|refresh_token_(expired|reused|invalidated)/i.test(error)
    )
      throw new LoginExpired(error);
    throw new Error('HTTP_' + response.status);
  }
  if (!data) throw new Error('INVALID_RESPONSE');
  return data;
}

/** A new claudeAiOauth from an expired one (other fields kept). */
export async function refreshClaude(
  oauth: Record<string, unknown>,
  fetcher: typeof fetch,
  now: number,
) {
  const refreshToken = oauth.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) throw new LoginExpired('no refresh token');
  const data = await exchange(fetcher, CLAUDE_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_CLIENT_ID,
  });
  // Once the provider answered, its new refresh token is the only one that works: always keep it,
  // even from an answer missing other fields.
  if (typeof data.access_token !== 'string' && typeof data.refresh_token !== 'string')
    throw new Error('INVALID_RESPONSE');
  return {
    ...oauth,
    ...(typeof data.access_token === 'string' ? { accessToken: data.access_token } : {}),
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
    ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
    ...(typeof data.scope === 'string' ? { scopes: data.scope.split(/\s+/).filter(Boolean) } : {}),
  };
}

/** A new auth.json from an expired one (account and other fields kept). */
export async function refreshCodex(
  auth: Record<string, unknown>,
  fetcher: typeof fetch,
  now: number,
) {
  const tokens = record(auth.tokens);
  const refreshToken = tokens?.refresh_token;
  if (!tokens || typeof refreshToken !== 'string' || !refreshToken)
    throw new LoginExpired('no refresh token');
  const data = await exchange(fetcher, CODEX_TOKEN_URL, {
    client_id: CODEX_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  // As for Claude: a new refresh token is kept even from an answer missing other fields.
  if (typeof data.access_token !== 'string' && typeof data.refresh_token !== 'string')
    throw new Error('INVALID_RESPONSE');
  return {
    ...auth,
    tokens: {
      ...tokens,
      ...(typeof data.access_token === 'string' ? { access_token: data.access_token } : {}),
      ...(typeof data.id_token === 'string' ? { id_token: data.id_token } : {}),
      ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}),
    },
    last_refresh: new Date(now).toISOString(),
  };
}

/** When an access token stops working (ms), from Claude's expiresAt or a Codex JWT's exp. */
export function expiresAt(value: unknown): number | undefined {
  const claude = record(value)?.expiresAt;
  if (typeof claude === 'number') return claude;
  const token = record(record(value)?.tokens)?.access_token;
  if (typeof token !== 'string') return undefined;
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
