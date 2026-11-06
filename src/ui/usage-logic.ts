// The rules of the usage lines with no page around them.

/** "5시간", "7일": the length a service reports for a window. */
export function windowLabel(window?: { windowSeconds?: number }) {
  const seconds = window?.windowSeconds;
  if (!seconds || seconds <= 0) return '한도';
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`;
  const hours = Math.round(seconds / 3600);
  return hours < 24 ? `${hours}시간` : `${Math.round(hours / 24)}일`;
}

/**
 * Whether an account has a line for its shorter window. ChatGPT can report a weekly window and no
 * shorter one, and then there is nothing to show. Without any answer yet the line stays, as for
 * Claude, whose 5-hour window is a fixed part of its answer.
 */
export function showsSession(account: { provider: string; session?: unknown; weekly?: unknown }) {
  return account.provider === 'claude-cli' || !!account.session || !account.weekly;
}
