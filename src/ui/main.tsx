import './zod-config.ts';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { AccountSettings } from './account-settings.tsx';
import { attachAccountUsage } from './account-usage-panel.ts';
import { mountUsageBars } from './usage-bars.ts';
import { api, connect } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';

// One page: each service's accounts (add, sign in, rename, choose, remove) and every account's
// usage. The dark theme follows the system.
const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => (document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light');
theme();
dark.addEventListener('change', theme);

const names: Record<Provider, { name: string; cli: string }> = {
  'claude-cli': { name: 'Claude', cli: 'Claude Code' },
  'codex-cli': { name: 'ChatGPT', cli: 'Codex CLI' },
};
const installedSchema = z.array(z.object({ id: z.enum(providers), installed: z.boolean() }));

function Usage() {
  const box = useRef<HTMLElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current && !box.current.childElementCount) attachAccountUsage(box.current);
    if (bars.current && !bars.current.childElementCount) mountUsageBars(bars.current);
  }, []);
  return (
    <section className="card" aria-labelledby="usage-title">
      <h2 id="usage-title">
        사용량 <small>선택된 계정</small>
      </h2>
      <div ref={bars} />
      <section ref={box} aria-label="계정별 사용량" />
    </section>
  );
}

function App() {
  const [installed, setInstalled] = useState<Record<string, boolean>>();
  useEffect(() => {
    void api('/providers')
      .then((value) =>
        setInstalled(
          Object.fromEntries(installedSchema.parse(value).map((row) => [row.id, row.installed])),
        ),
      )
      .catch(() => {});
  }, []);
  return (
    <main className="app">
      <header className="app-head">
        <h1>AccountSwitch</h1>
        <small>Claude·ChatGPT 구독 계정을 여러 개 등록하고 사용량을 봅니다.</small>
        <small>
          ‘사용’으로 고른 계정을 터미널·VS Code의 기본 로그인으로 바꾸는 기능은 개발 중입니다.
        </small>
      </header>
      <div className="services">
        {providers.map((provider) => (
          <section key={provider} className="card" aria-labelledby={`${provider}-title`}>
            <h2 id={`${provider}-title`}>
              {names[provider].name} <small>{names[provider].cli}</small>
            </h2>
            {installed && !installed[provider] ? (
              <p className="cli-missing">
                {names[provider].cli}를 찾지 못했습니다. 설치한 뒤 이 화면을 새로고침하세요.
              </p>
            ) : null}
            <AccountSettings provider={provider} />
          </section>
        ))}
      </div>
      <Usage />
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
connect()
  .then(() => root.render(<App />))
  .catch((error: unknown) =>
    root.render(
      <main className="app">
        <p className="remote-error">
          {error instanceof Error ? error.message : '연결하지 못했습니다.'}
        </p>
      </main>,
    ),
  );
