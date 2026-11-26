import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { api, errors } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';
import {
  cliNames,
  failureMessage,
  modelsSchema,
  paseoModel,
  shellReplySchema,
  viaPaseo,
  type Models,
  statusSchema,
  typedFolder,
} from './launcher-logic.ts';

// "Claude 열기" and "GPT 열기" (SPEC 4, DESIGN 5.3). The desktop window opens the folder dialog
// and the terminal itself and answers only a failure; in a browser there is no window to ask, so
// the page asks for a path and the engine opens the terminal. With Paseo (SPEC 4.1) the window only
// picks the folder and the engine makes the agent and shows it in Paseo.

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: unknown): void;
        addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
        removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
      };
    };
  }
}
const shell = window.chrome?.webview;

const RECHECK_MS = 5000;

const labels: Record<Provider, string> = {
  'claude-cli': 'Claude 열기',
  'codex-cli': 'GPT 열기',
};
const modelLabels: Record<Provider, string> = {
  'claude-cli': 'Claude 모델',
  'codex-cli': 'GPT 모델',
};

const problemOf = (error: unknown, provider: Provider) => {
  const { code, message } = error as { code?: string; message?: string };
  // These two are about the engine, not the folder, and the gateway has put them in words.
  if (message === errors.NETWORK_UNAVAILABLE || code === 'UNAUTHORIZED') return message;
  return failureMessage(code, provider);
};

export function useLauncher() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>>();
  const [failure, setFailure] = useState<string>();
  const [models, setModels] = useState<Models>();
  const [opening, setOpening] = useState<Partial<Record<Provider, boolean>>>({});
  const paseo = viaPaseo(status);

  const recheck = useCallback(() => {
    void api('/launcher')
      .then((value) => setStatus(statusSchema.parse(value)))
      // Answered by the next look; an engine that is gone has its own message elsewhere.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  // Installing can happen in this page's 설치 tab, with no focus event to wait for: while a CLI is
  // missing (or nothing is known yet), also look every few seconds, as the 계정 tab does.
  const waiting =
    !status || (status.platform === 'win32' && providers.some((p) => !status.installed[p]));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, recheck]);

  // Paseo's models: when Paseo is found, and again on focus (the engine keeps them a while).
  const loadModels = useCallback(() => {
    void api('/launcher/models')
      .then((value) => setModels(modelsSchema.parse(value)))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!paseo) return;
    loadModels();
    window.addEventListener('focus', loadModels);
    return () => window.removeEventListener('focus', loadModels);
  }, [paseo, loadModels]);

  /** The model a button opens Paseo with; undefined: it opens the terminal. */
  const modelFor = useCallback(
    (provider: Provider) => paseoModel(status, models, provider),
    [status, models],
  );

  const choose = useCallback((provider: Provider, model: string) => {
    setModels((now) => now && { ...now, [provider]: { ...now[provider], chosen: model } });
    void api('/launcher/models', 'PUT', { provider, model }).catch(() => undefined);
  }, []);

  /** The engine opens the folder: in Paseo when Paseo is there, else a terminal. */
  const openInEngine = useCallback(
    async (provider: Provider, folder: string) => {
      const model = modelFor(provider);
      setOpening((now) => ({ ...now, [provider]: true }));
      try {
        if (paseo) await api('/launcher/paseo', 'POST', { provider, folder, model });
        else await api('/launcher/open', 'POST', { provider, folder });
        return undefined;
      } catch (error) {
        // The folder, the CLI or Paseo may have gone away.
        recheck();
        return problemOf(error, provider);
      } finally {
        setOpening((now) => ({ ...now, [provider]: false }));
      }
    },
    [recheck, modelFor, paseo],
  );

  useEffect(() => {
    if (!shell) return;
    const answer = ({ data }: { data: unknown }) => {
      const reply = shellReplySchema.safeParse(data).data;
      if (!reply) return;
      if (reply.type === 'launcher.picked') {
        void openInEngine(reply.provider, reply.folder).then(setFailure);
        return;
      }
      setFailure(failureMessage(reply.reason, reply.provider));
      // The folder or the CLI may have gone away.
      recheck();
    };
    shell.addEventListener('message', answer);
    return () => shell.removeEventListener('message', answer);
  }, [recheck, openInEngine]);

  /** The desktop window's way: its folder dialog, then the terminal or Paseo. */
  const open = useCallback(
    (provider: Provider) => {
      setFailure(undefined);
      shell?.postMessage({
        type: paseo ? 'launcher.pick' : 'launcher.open',
        provider,
      });
    },
    [paseo],
  );

  const dismiss = useCallback(() => setFailure(undefined), []);

  return { status, failure, models, opening, modelFor, choose, open, openInEngine, dismiss };
}
type Launcher = ReturnType<typeof useLauncher>;

const HELP_ID = 'launcher-help';
const shown = ({ status }: Launcher) => status?.platform === 'win32';

/** The browser's stand-in for the folder dialog. */
function PathForm({
  launcher,
  provider,
  close,
}: {
  launcher: Launcher;
  provider: Provider;
  close: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const folder = typedFolder(text);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!folder || busy) return;
    setBusy(true);
    setProblem(undefined);
    const failed = await launcher.openInEngine(provider, folder);
    setBusy(false);
    if (!failed) return close();
    setProblem(failed);
    input.current?.focus();
  };
  return (
    <form className="launcher-popover launcher-path" onSubmit={(event) => void submit(event)}>
      <label className="launcher-label" htmlFor={`${id}-path`}>
        {cliNames[provider]}를 열 폴더 경로
      </label>
      <input
        ref={input}
        id={`${id}-path`}
        value={text}
        placeholder="C:\작업\모델링"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      {problem ? (
        <p className="launcher-problem" id={`${id}-problem`} role="alert">
          {problem}
        </p>
      ) : null}
      <div className="launcher-path-actions">
        <button type="button" className="text-button" onClick={close}>
          취소
        </button>
        <button type="submit" className="primary-button" disabled={!folder || busy}>
          {busy ? '여는 중…' : '열기'}
        </button>
      </div>
    </form>
  );
}

/** One launch button: straight to the folder dialog, with a path field in a browser. */
export function LauncherButton({ launcher, provider }: { launcher: Launcher; provider: Provider }) {
  const [typing, setTyping] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const installed = launcher.status?.installed[provider] === true;
  const model = launcher.modelFor(provider);
  const opening = launcher.opening[provider] === true;

  const closeAndFocus = useCallback(() => {
    setTyping(false);
    trigger.current?.focus();
  }, []);

  // The CLI went away with the field open; it must not come back open with the CLI.
  useEffect(() => {
    if (!installed) setTyping(false);
  }, [installed]);

  useEffect(() => {
    if (!typing) return;
    const outside = (event: MouseEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) setTyping(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeAndFocus();
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [typing, closeAndFocus]);

  if (!shown(launcher)) return null;

  return (
    <div
      className="launcher"
      ref={root}
      // Tab leaving the field closes it. A window losing focus has no target: the user may be
      // copying a path from Explorer, and what they typed must still be there.
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (to && !root.current?.contains(to)) setTyping(false);
      }}
    >
      {model ? (
        <select
          className="launcher-model"
          aria-label={modelLabels[provider]}
          value={model}
          disabled={!installed || opening}
          onChange={(event) => launcher.choose(provider, event.target.value)}
        >
          {launcher.models?.[provider].models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        ref={trigger}
        type="button"
        className="primary-button"
        disabled={!installed || opening}
        aria-describedby={installed ? undefined : HELP_ID}
        onClick={() => {
          if (shell) return launcher.open(provider);
          launcher.dismiss();
          setTyping((now) => !now);
        }}
      >
        {opening ? '여는 중…' : labels[provider]}
      </button>
      {typing ? <PathForm launcher={launcher} provider={provider} close={closeAndFocus} /> : null}
    </div>
  );
}

/** Under the buttons (DESIGN 5.3): the disabled help, or what went wrong. */
export function LauncherNotice({ launcher }: { launcher: Launcher }) {
  if (!shown(launcher)) return null;
  if (launcher.failure)
    return (
      <div className="launcher-notice" data-kind="failure" role="alert">
        <p>{launcher.failure}</p>
        <button type="button" className="text-button" onClick={launcher.dismiss}>
          닫기
        </button>
      </div>
    );
  const missing = providers.filter((p) => !launcher.status?.installed[p]).map((p) => cliNames[p]);
  if (!missing.length) return null;
  return (
    <div className="launcher-notice">
      <p id={HELP_ID}>설치 탭에서 {missing.join('와 ')}를 먼저 설치하세요</p>
    </div>
  );
}
