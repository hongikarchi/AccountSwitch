import { z } from 'zod';
import { api } from './gateway.ts';

// Account usage bars (Design SCR-12): for each service, the current account's short window (Claude
// 5 hours, ChatGPT its shorter window) and 7-day use as thin bars with a percentage. Shown in the
// host panel's footer and the app's status bar. Nothing is estimated: without usage lookup the
// bars say so.

const accountsSchema = z.object({ active: z.record(z.string(), z.string()) });
const windowSchema = z.object({ percent: z.number() }).optional();
const usageSchema = z.object({
  settings: z.object({ usageLookup: z.boolean() }).partial().optional(),
  accounts: z.array(
    z.object({
      provider: z.string(),
      id: z.string(),
      signedIn: z.boolean().optional(),
      session: windowSchema,
      weekly: windowSchema,
      limitReached: z.boolean(),
    }),
  ),
});
const SERVICES = [
  { id: 'claude-cli', name: 'Claude', short: '5h' },
  { id: 'codex-cli', name: 'ChatGPT', short: '단기' },
];

function meter(parent: HTMLElement, label: string, percent: number) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const item = document.createElement('span');
  item.className = 'usage-meter';
  item.dataset.level = value >= 100 ? 'full' : value >= 90 ? 'high' : 'ok';
  item.title = `${label} ${value}%`;
  const bar = document.createElement('span');
  bar.className = 'usage-track';
  const fill = document.createElement('i');
  fill.style.width = value + '%';
  bar.append(fill);
  const text = document.createElement('small');
  text.textContent = `${label} ${value}%`;
  item.append(bar, text);
  parent.append(item);
}

/** Fill `element` with the bars and keep them current. Returns a refresh function. */
export function mountUsageBars(element: HTMLElement) {
  element.classList.add('usage-bars');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    clearTimeout(timer);
    try {
      const [accounts, usage] = await Promise.all([
        api('/accounts').then((value) => accountsSchema.parse(value)),
        api('/accounts/usage').then((value) => usageSchema.parse(value)),
      ]);
      element.replaceChildren();
      let shown = 0;
      for (const service of SERVICES) {
        const id = accounts.active[service.id];
        const row = usage.accounts.find((a) => a.provider === service.id && a.id === id);
        if (!row || row.signedIn === false) continue;
        const group = document.createElement('span');
        group.className = 'usage-service';
        group.dataset.provider = service.id;
        const name = document.createElement('b');
        name.textContent = service.name;
        group.append(name);
        if (row.limitReached) {
          const limit = document.createElement('small');
          limit.className = 'usage-limit';
          limit.textContent = '한도';
          group.append(limit);
        }
        if (row.session) meter(group, service.short, row.session.percent);
        if (row.weekly) meter(group, '7일', row.weekly.percent);
        if (!row.session && !row.weekly && !row.limitReached) continue;
        element.append(group);
        shown++;
      }
      if (!shown) {
        const off = document.createElement('small');
        off.className = 'usage-off';
        off.textContent =
          usage.settings?.usageLookup === false
            ? '사용량 조회 꺼짐 · 아래 "계정별 사용량 조회"로 켤 수 있습니다'
            : '사용량 확인 전';
        element.append(off);
      }
    } catch {
      /* Advisory display: keep the last bars. */
    }
    timer = setTimeout(() => void refresh(), 120_000);
  };
  window.addEventListener('accounts-changed', () => void refresh());
  void refresh();
  return refresh;
}
