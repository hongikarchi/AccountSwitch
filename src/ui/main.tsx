import './zod-config.ts';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { AccountSettings } from './account-settings.tsx';
import { UsageToolbar, useUsage } from './usage.tsx';
import { api, connect } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';

// One page: each service's accounts (add, sign in, rename, choose, remove) and every account's
// usage. The theme follows the system unless light or dark is chosen (kept in this browser).
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'accountswitch-theme';
const dark = matchMedia('(prefers-color-scheme: dark)');
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
function applyTheme(choice: Theme) {
  const value = choice === 'system' ? (dark.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}
applyTheme(savedTheme());
dark.addEventListener('change', () => applyTheme(savedTheme()));

const themes: { id: Theme; label: string }[] = [
  { id: 'system', label: '시스템' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];
function ThemeSwitch() {
  const [choice, setChoice] = useState(savedTheme);
  const choose = (next: Theme) => {
    setChoice(next);
    applyTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Not kept; applies until the page reloads. */
    }
  };
  return (
    <div className="theme-switch" role="group" aria-label="화면 테마">
      {themes.map((theme) => (
        <button
          key={theme.id}
          type="button"
          aria-pressed={choice === theme.id}
          onClick={() => choose(theme.id)}
        >
          {theme.label}
        </button>
      ))}
    </div>
  );
}

const names: Record<Provider, { name: string; cli: string }> = {
  'claude-cli': { name: 'Claude', cli: 'Claude Code' },
  'codex-cli': { name: 'ChatGPT', cli: 'Codex CLI' },
};
const installedSchema = z.array(z.object({ id: z.enum(providers), installed: z.boolean() }));

function App() {
  const { usage, failure, load } = useUsage();
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
        <ThemeSwitch />
      </header>
      <div className="services">
        {providers.map((provider) => (
          <section
            key={provider}
            className="card"
            data-provider={provider}
            aria-labelledby={`${provider}-title`}
          >
            <h2 id={`${provider}-title`}>
              {names[provider].name} <small>{names[provider].cli}</small>
            </h2>
            {installed && !installed[provider] ? (
              <p className="cli-missing">
                {names[provider].cli}를 찾지 못했습니다. 설치한 뒤 이 화면을 새로고침하세요.
              </p>
            ) : null}
            <AccountSettings
              provider={provider}
              usage={usage?.accounts.filter((account) => account.provider === provider)}
            />
          </section>
        ))}
      </div>
      <UsageToolbar usage={usage} failure={failure} load={load} />
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
