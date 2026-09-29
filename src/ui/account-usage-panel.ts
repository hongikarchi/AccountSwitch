import { z } from 'zod';
import { append as el } from './elements.ts';
import { api } from './gateway.ts';

// Every subscription account with its usage and reset times, and the opt-in usage lookup.
const windowSchema = z.object({ percent: z.number(), resetsAt: z.string().nullable() }).optional();
const usageSchema = z.object({
  settings: z.object({ usageLookup: z.boolean(), autoSwitch: z.boolean(), threshold: z.number() }),
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
const profilesSchema = z.object({
  profiles: z.array(z.object({ id: z.string(), provider: z.string(), label: z.string() })),
  active: z.record(z.string(), z.string()),
  defaultLabels: z.record(z.string(), z.string()).optional(),
});
type Usage = z.infer<typeof usageSchema>;
const service = { 'claude-cli': 'Claude', 'codex-cli': 'ChatGPT' } as const;
const when = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  const hours = (date.getTime() - Date.now()) / 3600_000;
  return hours < 24
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit' });
};

export function attachAccountUsage(section: HTMLElement) {
  const box = el('div', '', section, { class: 'account-usage' });
  let data: Usage | undefined,
    profiles: z.infer<typeof profilesSchema> | undefined,
    failure = '',
    timer: ReturnType<typeof setInterval> | undefined;
  const load = async (refresh = false) => {
    try {
      [data, profiles] = await Promise.all([
        api('/accounts/usage' + (refresh ? '?refresh=1' : '')).then((v) => usageSchema.parse(v)),
        api('/accounts').then((v) => profilesSchema.parse(v)),
      ]);
      failure = '';
    } catch (error) {
      failure = error instanceof Error ? error.message : '계정 정보를 불러오지 못했습니다.';
    }
    draw();
  };
  const save = async (next: Partial<Usage['settings']>) => {
    await api('/accounts/usage-settings', 'POST', next);
    await load(true);
    window.dispatchEvent(new Event('accounts-changed'));
  };
  const bar = (row: HTMLElement, label: string, value: Usage['accounts'][number]['session']) => {
    const line = el('div', '', row, { class: 'usage-line' });
    el('span', label, line, { class: 'usage-label' });
    const track = el('span', '', line, { class: 'usage-track' });
    const fill = el('span', '', track, { class: 'usage-fill' });
    const percent = Math.min(100, Math.max(0, value?.percent ?? 0));
    fill.style.width = percent + '%';
    fill.dataset.level = percent >= 90 ? 'high' : percent >= 70 ? 'mid' : 'low';
    el(
      'span',
      value
        ? `${Math.round(value.percent)}%${value.resetsAt ? ' · ' + when(value.resetsAt) + ' 초기화' : ''}`
        : '—',
      line,
      { class: 'usage-value' },
    );
  };
  function draw() {
    box.replaceChildren();
    if (failure) el('p', failure, box, { class: 'remote-error' });
    if (!data) {
      el('p', '확인 중…', box);
      return;
    }
    const options = el('div', '', box, { class: 'usage-options' });
    const toggle = (label: string, checked: boolean, change: (value: boolean) => void) => {
      const row = el('label', '', options, { class: 'remote-toggle' });
      const input = el('input', '', row, { type: 'checkbox' });
      input.checked = checked;
      row.append(' ' + label);
      input.onchange = () => change(input.checked);
      return row;
    };
    toggle(
      '계정별 사용량 조회',
      data.settings.usageLookup,
      (value) => void save({ usageLookup: value }),
    );
    el(
      'small',
      '각 계정의 로그인 정보로 Claude·ChatGPT의 비공개 사용량 주소를 조회합니다. 서비스 약관상 위험을 감수하는 선택 기능입니다(3분마다 갱신).',
      options,
    );
    // Automatic switching (AccountUsageService.choose) comes with switching the CLI's default login.
    const list = el('ul', '', box, { class: 'settings-rows usage-list' });
    for (const account of data.accounts) {
      const label =
        account.id === 'default'
          ? (profiles?.defaultLabels?.[account.provider] ?? '기존 CLI 로그인')
          : (profiles?.profiles.find((p) => p.id === account.id)?.label ?? '추가 계정');
      const active = profiles?.active[account.provider] === account.id;
      const row = el('li', '', list, { class: 'usage-row' });
      const head = el('div', '', row, { class: 'usage-head' });
      el('strong', `${service[account.provider]} · ${account.email ?? label}`, head);
      el('small', [label, account.plan].filter(Boolean).join(' · '), head);
      if (active) el('span', '사용 중', head, { class: 'pill', 'data-ok': 'true' });
      if (account.limitReached || account.limitedUntil)
        el(
          'span',
          account.limitedUntil ? `한도 · ${when(account.limitedUntil)}까지 건너뜀` : '한도 도달',
          head,
          {
            class: 'pill',
          },
        );
      if (!account.signedIn) el('p', '로그인되지 않음 · 위 계정 목록에서 로그인하세요.', row);
      else if (account.state === 'off')
        el('p', '사용량 조회가 꺼져 있습니다.', row, { class: 'usage-note' });
      else {
        bar(row, account.provider === 'claude-cli' ? '5시간' : '짧은 한도', account.session);
        bar(row, '7일', account.weekly);
        if (account.state === 'token-expired')
          el(
            'small',
            '로그인 토큰이 만료돼 마지막 값입니다. 이 계정을 한 번 쓰면 갱신됩니다.',
            row,
          );
        if (account.state === 'error')
          el('small', `조회 실패 (${account.error ?? '알 수 없음'})`, row);
      }
      if (account.signedIn && !active) {
        const use = el('button', '이 계정 사용', row, { type: 'button' });
        use.onclick = () =>
          void api('/accounts/select', 'POST', { provider: account.provider, id: account.id })
            .then(() => {
              window.dispatchEvent(new Event('accounts-changed'));
              return load();
            })
            .catch((error) => {
              failure = error instanceof Error ? error.message : '전환하지 못했습니다.';
              draw();
            });
      }
    }
    const refresh = el('button', '지금 새로고침', box, { type: 'button', class: 'usage-refresh' });
    refresh.onclick = () => void load(true);
  }
  void load();
  timer = setInterval(() => void load(), 60_000);
  window.addEventListener('accounts-changed', () => void load());
  draw();
}
