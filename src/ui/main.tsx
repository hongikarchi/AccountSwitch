import './zod-config.ts';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { AccountSettings } from './account-settings.tsx';
import { UsageToolbar, useUsage } from './usage.tsx';
import { api, connect } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';

// One page: each service's accounts (add, sign in, rename, choose, remove) and every account's
// usage. Light or dark, as chosen (kept in this browser); the system's until one is chosen.
type Theme = 'light' | 'dark';
const THEME_KEY = 'accountswitch-theme';
const dark = matchMedia('(prefers-color-scheme: dark)');
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Not kept. */
  }
  return dark.matches ? 'dark' : 'light';
}
function applyTheme(value: Theme) {
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}
applyTheme(savedTheme());

// One account menu open at a time, closed by a click anywhere else.
document.addEventListener('click', (event) => {
  for (const open of document.querySelectorAll('details.account-more[open]'))
    if (!open.contains(event.target as Node)) open.removeAttribute('open');
});

const themes: { id: Theme; label: string }[] = [
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];
function ThemeSwitch() {
  const [choice, setChoice] = useState(savedTheme);
  const choose = (next: Theme) => {
    setChoice(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
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

const mac = navigator.userAgent.includes('Mac OS X');
/** How to install each CLI: the official command for this system, and the official guide. */
const install: Record<Provider, { command: string; guide: string }> = {
  'claude-cli': {
    command: mac
      ? 'curl -fsSL https://claude.ai/install.sh | bash'
      : 'irm https://claude.ai/install.ps1 | iex',
    guide: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  'codex-cli': {
    command: 'npm install -g @openai/codex',
    guide: 'https://github.com/openai/codex',
  },
};

/** A service whose CLI is not installed: how to install it, checked again by itself. */
function CliMissing({ provider }: { provider: Provider }) {
  const [copied, setCopied] = useState(false);
  const { command, guide } = install[provider];
  return (
    <div className="cli-missing">
      <p>{names[provider].cli}가 설치되어 있지 않습니다.</p>
      <p className="cli-step">{mac ? '터미널' : 'PowerShell'}에 붙여 넣어 설치하세요.</p>
      <code>{command}</code>
      <span className="cli-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            void navigator.clipboard.writeText(command).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? '복사했습니다' : '명령 복사'}
        </button>
        <a href={guide} target="_blank" rel="noreferrer">
          설치 안내
        </a>
      </span>
      {provider === 'codex-cli' ? <small>Node.js가 필요합니다 (nodejs.org).</small> : null}
    </div>
  );
}

function App() {
  const { usage, failure, load } = useUsage();
  const [installed, setInstalled] = useState<Record<string, boolean>>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      void api('/providers?installed=1')
        .then((value) => {
          const next = Object.fromEntries(
            installedSchema.parse(value).map((row) => [row.id, row.installed]),
          );
          setInstalled((before) => {
            // Just installed: load the accounts and usage of the new CLI.
            if (before && providers.some((p) => next[p] && !before[p]))
              window.dispatchEvent(new Event('accounts-changed'));
            return next;
          });
          // While a CLI is missing, look again every few seconds: no reload after installing.
          if (providers.some((p) => !next[p])) timer = setTimeout(check, 5000);
        })
        .catch(() => {
          timer = setTimeout(check, 5000);
        });
    check();
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="app">
      <header className="app-head">
        <h1>AccountSwitch</h1>
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
            <h2 id={`${provider}-title`}>{names[provider].name}</h2>
            {installed && !installed[provider] ? (
              <CliMissing provider={provider} />
            ) : (
              <AccountSettings
                provider={provider}
                usage={usage?.accounts.filter((account) => account.provider === provider)}
              />
            )}
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
