import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from './gateway.ts';

// Every account's sign-in and usage (5-hour or shorter window, 7 days, reset times), loaded once
// for the page and shown inside each account's row; the usage lookup switch sits at the bottom.
const windowSchema = z.object({ percent: z.number(), resetsAt: z.string().nullable() }).optional();
const usageSchema = z.object({
  settings: z.object({ usageLookup: z.boolean() }),
  accounts: z.array(
    z.object({
      provider: z.enum(['claude-cli', 'codex-cli']),
      id: z.string(),
      signedIn: z.boolean(),
      email: z.string().optional(),
      plan: z.string().optional(),
      session: windowSchema,
      weekly: windowSchema,
      limitReached: z.boolean(),
      limitedUntil: z.string().optional(),
      checkedAt: z.string().optional(),
      state: z.enum(['ok', 'off', 'signed-out', 'token-expired', 'error']),
      error: z.string().optional(),
    }),
  ),
});
export type Usage = z.infer<typeof usageSchema>;
export type AccountUsage = Usage['accounts'][number];
type Window = AccountUsage['session'];

const when = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  const hours = (date.getTime() - Date.now()) / 3600_000;
  return hours < 24
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit' });
};

/** The page's usage: loaded now, every minute, after account changes and on request. */
export function useUsage() {
  const [usage, setUsage] = useState<Usage>();
  const [failure, setFailure] = useState('');
  const load = useCallback(async (refresh = false) => {
    try {
      setUsage(usageSchema.parse(await api('/accounts/usage' + (refresh ? '?refresh=1' : ''))));
      setFailure('');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '사용량을 불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const changed = () => void load();
    window.addEventListener('accounts-changed', changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener('accounts-changed', changed);
    };
  }, [load]);
  return { usage, failure, load };
}

function Line({ label, value }: { label: string; value: Window }) {
  const percent = Math.min(100, Math.max(0, value?.percent ?? 0));
  return (
    <div className="usage-line">
      <span className="usage-label">{label}</span>
      <span className="usage-track">
        <span
          className="usage-fill"
          data-level={percent >= 90 ? 'high' : 'ok'}
          style={{ width: percent + '%' }}
        />
      </span>
      <span className="usage-value">
        {value
          ? `${Math.round(value.percent)}%${value.resetsAt ? ' · ' + when(value.resetsAt) + ' 초기화' : ''}`
          : '—'}
      </span>
    </div>
  );
}

/** One account's usage bars, under its row; nothing while signed out or with lookup off. */
export function AccountUsageLines({ account }: { account?: AccountUsage }) {
  if (!account?.signedIn || account.state === 'off' || account.state === 'signed-out') return null;
  return (
    <div className="account-usage">
      <Line
        label={account.provider === 'claude-cli' ? '5시간' : '짧은 한도'}
        value={account.session}
      />
      <Line label="7일" value={account.weekly} />
      {account.limitedUntil ? (
        <small className="usage-note">한도 · {when(account.limitedUntil)}까지</small>
      ) : null}
      {account.state === 'token-expired' ? (
        <small className="usage-note">
          토큰 만료로 마지막 값 · 이 계정을 한 번 쓰면 갱신됩니다
        </small>
      ) : null}
      {account.state === 'error' ? (
        <small className="usage-note">조회 실패 ({account.error ?? '알 수 없음'})</small>
      ) : null}
    </div>
  );
}

/** Usage lookup on/off and refresh, once for the page. */
export function UsageToolbar({
  usage,
  failure,
  load,
}: {
  usage?: Usage;
  failure: string;
  load: (refresh?: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const checked = usage?.accounts
    .map((row) => row.checkedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const toggle = async (value: boolean) => {
    setSaving(true);
    try {
      await api('/accounts/usage-settings', 'POST', { usageLookup: value });
      await load(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <footer className="usage-toolbar">
      <label className="remote-toggle">
        <input
          type="checkbox"
          checked={usage?.settings.usageLookup ?? false}
          disabled={!usage || saving}
          onChange={(event) => void toggle(event.target.checked)}
        />
        사용량 조회
      </label>
      <small>
        {usage?.settings.usageLookup
          ? `3분마다 갱신${checked ? ' · ' + when(checked) + ' 확인' : ''} · 비공식 사용량 주소를 씁니다`
          : '꺼짐'}
      </small>
      {failure ? <small className="remote-error">{failure}</small> : null}
      <button type="button" disabled={!usage?.settings.usageLookup} onClick={() => void load(true)}>
        새로고침
      </button>
    </footer>
  );
}
