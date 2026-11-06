import './zod-config.ts';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { AccountSettings, ServiceHead } from './account-settings.tsx';
import { EmptyState, UsageToolbar, useUsage } from './usage.tsx';
import { LogoMark } from './logo.tsx';
import { SetupTab, useSetupAutoOpen } from './setup.tsx';
import { api, connect } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';

// One page with two tabs. 계정: each service's accounts (add, sign in, rename, choose, remove) and
// every account's usage. 설치: the setup wizard (not on macOS). Light or dark, as chosen (kept in
// this browser); the system's until one is chosen.
type Theme = 'light' | 'dark';
const THEME_KEY = 'accountswitch-theme';
const dark = matchMedia('(prefers-color-scheme: dark)');
function chosenTheme(): Theme | undefined {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Not kept. */
  }
  return undefined;
}
const currentTheme = (): Theme => chosenTheme() ?? (dark.matches ? 'dark' : 'light');
function applyTheme(value: Theme) {
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}
applyTheme(currentTheme());

// One account menu open at a time, closed by a click anywhere else.
document.addEventListener('click', (event) => {
  for (const open of document.querySelectorAll('details.account-more[open]'))
    if (!open.contains(event.target as Node)) open.removeAttribute('open');
});

let fadeTimer: ReturnType<typeof setTimeout>;
/** Applies a theme with the page colors cross-fading; the CSS rule exists only for that moment. */
function fadeToTheme(value: Theme) {
  const root = document.documentElement;
  root.dataset.themeChanging = 'true';
  applyTheme(value);
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => delete root.dataset.themeChanging, 280);
}

/** The two-state pill of DESIGN 5.2. Checked means dark. */
function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  // Until the user chooses, the theme follows the system even while the page is open.
  useEffect(() => {
    const follow = () => {
      if (chosenTheme()) return;
      const next = currentTheme();
      setTheme(next);
      fadeToTheme(next);
    };
    dark.addEventListener('change', follow);
    return () => dark.removeEventListener('change', follow);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    fadeToTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Not kept; applies until the page reloads. */
    }
  };
  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label="화면 테마"
      onClick={toggle}
    >
      <span className="theme-knob" />
      <span className="theme-label" data-active={String(theme === 'light')}>
        Light<sup>01</sup>
      </span>
      <span className="theme-label" data-active={String(theme === 'dark')}>
        Dark<sup>02</sup>
      </span>
    </button>
  );
}

const names: Record<Provider, { cli: string }> = {
  'claude-cli': { cli: 'Claude Code' },
  'codex-cli': { cli: 'Codex CLI' },
};
const installedSchema = z.array(z.object({ id: z.enum(providers), installed: z.boolean() }));

const mac = navigator.userAgent.includes('Mac OS X');

type Tab = 'accounts' | 'setup';
const TAB_KEY = 'accountswitch-tab';
const tabs: { id: Tab; label: string }[] = [
  { id: 'accounts', label: '계정' },
  ...(mac ? [] : [{ id: 'setup' as const, label: '설치' }]),
];
function savedTab(): Tab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    const saved = tabs.find((tab) => tab.id === value);
    if (saved) return saved.id;
  } catch {
    /* Not kept. */
  }
  return 'accounts';
}

function Tabs({ current, choose }: { current: Tab; choose: (tab: Tab) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="화면">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          className="tab"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={current === tab.id}
          tabIndex={current === tab.id ? 0 : -1}
          onClick={() => choose(tab.id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
            const next = tabs[(index + step) % tabs.length];
            choose(next.id);
            document.getElementById(`tab-${next.id}`)?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

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
    <EmptyState
      kind="terminal"
      title={`${names[provider].cli}가 설치되어 있지 않습니다.`}
      detail={`${mac ? '터미널' : 'PowerShell'}에 붙여 넣어 설치하세요.`}
    >
      <code className="empty-command">{command}</code>
      <span className="empty-actions">
        <button
          type="button"
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
    </EmptyState>
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
  const [tab, setTab] = useState(savedTab);
  // SPEC 3.1: only a new PC opens on 설치, and that does not become the saved tab.
  useSetupAutoOpen(() => {
    if (!mac) setTab('setup');
  });
  const chooseTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* Not kept; applies until the page reloads. */
    }
  };
  return (
    <>
      <header className="app-head">
        <div className="app-head-inner">
          <div className="brand">
            <LogoMark />
            <h1 className="wordmark">AccountSwitch</h1>
          </div>
          <Tabs current={tab} choose={chooseTab} />
          <div className="head-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="app-body">
        {/* Both panels stay mounted: leaving a tab must not interrupt a sign-in being followed. */}
        <div
          className="tab-panel"
          role="tabpanel"
          id="panel-accounts"
          aria-labelledby="tab-accounts"
          hidden={tab !== 'accounts'}
        >
          <div className="services">
            {providers.map((provider) => (
              <section
                key={provider}
                className="service"
                data-provider={provider}
                aria-labelledby={`${provider}-title`}
              >
                {installed && !installed[provider] ? (
                  <>
                    <ServiceHead provider={provider} />
                    <CliMissing provider={provider} />
                  </>
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
        </div>
        {mac ? null : (
          <div
            className="tab-panel"
            role="tabpanel"
            id="panel-setup"
            aria-labelledby="tab-setup"
            hidden={tab !== 'setup'}
          >
            <SetupTab active={tab === 'setup'} />
          </div>
        )}
      </main>
    </>
  );
}

const root = createRoot(document.getElementById('root')!);
connect()
  .then(() => root.render(<App />))
  .catch((error: unknown) =>
    root.render(
      <main className="app-body">
        <EmptyState
          size="large"
          kind="error"
          title="연결하지 못했습니다"
          detail={error instanceof Error ? error.message : undefined}
        >
          <button type="button" onClick={() => location.reload()}>
            다시 시도
          </button>
        </EmptyState>
      </main>,
    ),
  );
