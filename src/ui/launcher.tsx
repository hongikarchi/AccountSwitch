import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { z } from 'zod';
import { api, errors } from './gateway.ts';
import { providers, type Provider } from '../core/providers.ts';
import {
  cliNames,
  failureMessage,
  installedPrograms,
  paseoAnswerSchema,
  shellReplySchema,
  statusSchema,
  typedFolder,
  viaPaseo,
} from './launcher-logic.ts';

// "Paseo 열기" and "터미널 열기" (SPEC 4, DESIGN 5.3). The desktop window shows the folder dialog;
// for a terminal it also opens it and answers only a failure, for Paseo it hands the folder back
// and the engine opens it in Paseo (SPEC 4.1). In a browser there is no window to ask, so the
// page asks for a path and the engine does both.

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

/** The choice of 터미널 열기, in the words of the buttons the user knew. */
const programLabels: Record<Provider, string> = {
  'claude-cli': 'Claude',
  'codex-cli': 'GPT',
};

const problemOf = (error: unknown, provider?: Provider) => {
  const { code, message } = error as { code?: string; message?: string };
  // These two are about the engine, not the folder, and the gateway has put them in words.
  if (message === errors.NETWORK_UNAVAILABLE || code === 'UNAUTHORIZED') return message;
  return failureMessage(code, provider);
};

/** `openSetup` shows the 설치 tab, for Paseo 열기 pressed without Paseo (SPEC 4.1). */
export function useLauncher(openSetup: () => void) {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>>();
  const [failure, setFailure] = useState<string>();
  const [opening, setOpening] = useState(false);
  // Paseo 열기 was pressed without Paseo: the line under the buttons says to install it first.
  const [needsPaseo, setNeedsPaseo] = useState(false);
  const paseoFound = viaPaseo(status);
  useEffect(() => {
    if (paseoFound) setNeedsPaseo(false);
  }, [paseoFound]);

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

  // Installing can happen in this page's 설치 tab, with no focus event to wait for: while a CLI or
  // Paseo is missing (or nothing is known yet), also look every few seconds, as the 계정 tab does.
  const waiting =
    !status ||
    (status.platform === 'win32' &&
      (providers.some((p) => !status.installed[p]) || status.paseo === false));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, recheck]);

  /** The engine opens the folder in Paseo; the failure in words, or undefined. */
  const openPaseo = useCallback(
    async (folder: string) => {
      setOpening(true);
      try {
        const answer = paseoAnswerSchema.parse(await api('/launcher/paseo', 'POST', { folder }));
        // No agent to send the window to: the shell brings Paseo forward (SPEC 4.1).
        if (answer.shown === 'window') shell?.postMessage({ type: 'launcher.show-paseo' });
        return undefined;
      } catch (error) {
        // The folder or Paseo may have gone away.
        recheck();
        return problemOf(error);
      } finally {
        setOpening(false);
      }
    },
    [recheck],
  );

  /** The browser's way to a terminal: the engine opens it. */
  const openTerminal = useCallback(
    async (provider: Provider, folder: string) => {
      try {
        await api('/launcher/open', 'POST', { provider, folder });
        return undefined;
      } catch (error) {
        recheck();
        return problemOf(error, provider);
      }
    },
    [recheck],
  );

  useEffect(() => {
    if (!shell) return;
    const answer = ({ data }: { data: unknown }) => {
      const reply = shellReplySchema.safeParse(data).data;
      if (!reply) return;
      if (reply.type === 'launcher.picked') {
        void openPaseo(reply.folder).then(setFailure);
        return;
      }
      setFailure(failureMessage(reply.reason, reply.provider));
      // The folder or the CLI may have gone away.
      recheck();
    };
    shell.addEventListener('message', answer);
    return () => shell.removeEventListener('message', answer);
  }, [recheck, openPaseo]);

  /** The desktop window's folder dialog: for Paseo, or for a terminal of this program. */
  const pick = useCallback((provider?: Provider) => {
    setFailure(undefined);
    shell?.postMessage(provider ? { type: 'launcher.open', provider } : { type: 'launcher.pick' });
  }, []);

  const dismiss = useCallback(() => {
    setFailure(undefined);
    setNeedsPaseo(false);
  }, []);

  /** Paseo 열기 without Paseo: say so under the buttons; nothing is installed from here. */
  const askInstall = useCallback(() => {
    setFailure(undefined);
    setNeedsPaseo(true);
  }, []);

  /** To the 설치 tab, at Paseo's step when the checklist shows it. */
  const goInstall = useCallback(() => {
    setNeedsPaseo(false);
    openSetup();
    requestAnimationFrame(() =>
      document
        .querySelector('[data-item="paseo"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }, [openSetup]);

  return {
    status,
    failure,
    needsPaseo,
    opening,
    openPaseo,
    openTerminal,
    pick,
    dismiss,
    askInstall,
    goInstall,
  };
}
type Launcher = ReturnType<typeof useLauncher>;

const HELP_ID = 'launcher-help';
const shown = ({ status }: Launcher) => status?.platform === 'win32';

/** Closes a popover on a click outside or Escape (DESIGN 5.3), focus back on the button. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, root, close]);
}

/** The browser's stand-in for the folder dialog. */
function PathForm({
  label,
  submit,
  close,
}: {
  label: string;
  submit: (folder: string) => Promise<string | undefined>;
  close: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const folder = typedFolder(text);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!folder || busy) return;
    setBusy(true);
    setProblem(undefined);
    const failed = await submit(folder);
    setBusy(false);
    if (!failed) return close();
    setProblem(failed);
    input.current?.focus();
  };
  return (
    <form className="launcher-popover launcher-path" onSubmit={(event) => void send(event)}>
      <label className="launcher-label" htmlFor={`${id}-path`}>
        {label}
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

/** What a launch button has open under it: nothing, the program choice, or a path field. */
type Open = null | 'choose' | 'paseo' | Provider;

/** One launch button with its popover; closing by Tab, Escape or a click outside. */
function LaunchButton({
  launcher,
  label,
  primary,
  press,
  open,
  setOpen,
  children,
}: {
  launcher: Launcher;
  label: string;
  primary: boolean;
  press: () => void;
  open: Open;
  setOpen: (open: Open) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const programs = installedPrograms(launcher.status);
  const usable = programs.length > 0;

  const closeAndFocus = useCallback(() => {
    setOpen(null);
    trigger.current?.focus();
  }, [setOpen]);
  useDismiss(open !== null, root, closeAndFocus);

  // The programs went away with a popover open; it must not come back open with them.
  useEffect(() => {
    if (!usable) setOpen(null);
  }, [usable, setOpen]);

  return (
    <div
      className="launcher"
      ref={root}
      // Tab leaving the popover closes it. A window losing focus has no target: the user may be
      // copying a path from Explorer, and what they typed must still be there.
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (to && !root.current?.contains(to)) setOpen(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={primary ? 'primary-button' : undefined}
        disabled={!usable || launcher.opening}
        aria-describedby={usable ? undefined : HELP_ID}
        aria-expanded={shell ? undefined : open !== null}
        onClick={() => {
          launcher.dismiss();
          if (open !== null) return setOpen(null);
          press();
        }}
      >
        {label}
      </button>
      {open === null ? null : children}
    </div>
  );
}

/** "Paseo 열기": straight to the folder dialog (SPEC 4.1); without Paseo, the way to install it. */
export function PaseoButton({ launcher }: { launcher: Launcher }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  if (!shown(launcher)) return null;
  return (
    <LaunchButton
      launcher={launcher}
      label={launcher.opening ? '여는 중…' : 'Paseo 열기'}
      primary
      press={() => {
        if (!viaPaseo(launcher.status)) return launcher.askInstall();
        if (shell) return launcher.pick();
        setOpen('paseo');
      }}
      open={open}
      setOpen={setOpen}
    >
      <PathForm label="Paseo로 열 폴더 경로" submit={launcher.openPaseo} close={close} />
    </LaunchButton>
  );
}

/** "터미널 열기": Claude or GPT when both are installed, then the folder (SPEC 4). */
export function TerminalButton({ launcher }: { launcher: Launcher }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  const programs = installedPrograms(launcher.status);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open === 'choose') first.current?.focus();
  }, [open]);
  if (!shown(launcher)) return null;

  const go = (provider: Provider) => {
    if (shell) {
      setOpen(null);
      launcher.pick(provider);
    } else setOpen(provider);
  };

  return (
    <LaunchButton
      launcher={launcher}
      label="터미널 열기"
      primary={false}
      press={() => (programs.length === 1 ? go(programs[0]) : setOpen('choose'))}
      open={open}
      setOpen={setOpen}
    >
      {open === 'choose' ? (
        <div className="launcher-popover launcher-choice" role="group" aria-label="열 프로그램">
          {programs.map((provider, index) => (
            <button
              key={provider}
              ref={index === 0 ? first : undefined}
              type="button"
              onClick={() => go(provider)}
            >
              {programLabels[provider]}
            </button>
          ))}
        </div>
      ) : open === 'claude-cli' || open === 'codex-cli' ? (
        <PathForm
          label={`${cliNames[open]}를 열 폴더 경로`}
          submit={(folder) => launcher.openTerminal(open, folder)}
          close={close}
        />
      ) : null}
    </LaunchButton>
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
  if (launcher.needsPaseo)
    return (
      <div className="launcher-notice" role="status">
        <p>Paseo를 먼저 설치해야 해요. 설치 탭에서 Paseo를 골라 설치하세요</p>
        <button type="button" className="text-button" onClick={launcher.goInstall}>
          설치 탭으로
        </button>
        <button type="button" className="text-button" onClick={launcher.dismiss}>
          닫기
        </button>
      </div>
    );
  if (!launcher.status || installedPrograms(launcher.status).length) return null;
  return (
    <div className="launcher-notice">
      <p id={HELP_ID}>설치 탭에서 Claude Code나 Codex CLI를 먼저 설치하세요</p>
    </div>
  );
}
