import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { z } from 'zod';
import { api, errors } from './gateway.ts';
import {
  failureMessage,
  folderName,
  openedSchema,
  parentFolder,
  recentSchema,
  shellReplySchema,
  statusSchema,
  typedFolder,
} from './launcher-logic.ts';

// "Claude Code 열기" (SPEC 4, DESIGN 5.1 and 5.5). The desktop window opens the terminal itself and
// answers by message; in a browser there is no window to ask, so the engine opens it.

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

const problemOf = (error: unknown, fromRecent: boolean) => {
  const { code, message } = error as { code?: string; message?: string };
  // These two are about the engine, not the folder, and the gateway has put them in words.
  if (message === errors.NETWORK_UNAVAILABLE || code === 'UNAUTHORIZED') return message;
  return failureMessage(code, fromRecent);
};

export function useLauncher() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>>();
  const [failure, setFailure] = useState<string>();
  // The folder the window was asked to open, to tell a vanished recent folder from anything else.
  const asked = useRef<string>(undefined);
  // Only the newest answer counts: a recheck started before a folder was added knows less.
  const latest = useRef(0);

  const recheck = useCallback(() => {
    const request = ++latest.current;
    void api('/launcher')
      .then((value) => {
        const next = statusSchema.parse(value);
        if (request === latest.current) setStatus(next);
      })
      // Answered by the next look; an engine that is gone has its own message elsewhere.
      .catch(() => undefined);
  }, []);

  const remember = useCallback((folder: string) => {
    const request = ++latest.current;
    void api('/launcher/recent', 'POST', { folder })
      .then((value) => {
        const { recent } = recentSchema.parse(value);
        if (request === latest.current) setStatus((now) => now && { ...now, recent });
      })
      // The terminal is open; a list that did not update is not worth a message.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  // Installing can happen in this page's 설치 tab, with no focus event to wait for: while Claude
  // Code is missing (or nothing is known yet), also look every few seconds, as the 계정 tab does.
  const waiting = !status || (status.platform === 'win32' && !status.installed);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, recheck]);

  useEffect(() => {
    if (!shell) return;
    const answer = ({ data }: { data: unknown }) => {
      const reply = shellReplySchema.safeParse(data).data;
      if (!reply) return;
      if (reply.type === 'claude.opened') {
        asked.current = undefined;
        remember(reply.folder);
      } else if (reply.type === 'claude.cancelled') {
        asked.current = undefined;
      } else {
        setFailure(failureMessage(reply.reason, asked.current !== undefined));
        // BUSY answers this request only; the one under way still has its own answer coming.
        if (reply.reason !== 'BUSY') asked.current = undefined;
        // The folder or Claude Code may have gone away.
        recheck();
      }
    };
    shell.addEventListener('message', answer);
    return () => shell.removeEventListener('message', answer);
  }, [remember, recheck]);

  /** Opens through the engine and answers with what went wrong, if anything. */
  const openInEngine = useCallback(
    async (folder: string, fromRecent: boolean) => {
      try {
        const opened = openedSchema.parse(await api('/launcher/open', 'POST', { folder }));
        remember(opened.folder);
        return undefined;
      } catch (error) {
        // The folder or Claude Code may have gone away.
        recheck();
        return problemOf(error, fromRecent);
      }
    },
    [remember, recheck],
  );

  /** A folder from the recent list, or no folder for the window's own dialog. */
  const open = useCallback(
    (folder?: string) => {
      setFailure(undefined);
      if (shell) {
        asked.current = folder;
        shell.postMessage(
          folder === undefined ? { type: 'claude.open' } : { type: 'claude.open', folder },
        );
      } else if (folder !== undefined) {
        void openInEngine(folder, true).then(setFailure);
      }
    },
    [openInEngine],
  );

  const dismiss = useCallback(() => setFailure(undefined), []);

  return { status, failure, open, openInEngine, dismiss };
}
type Launcher = ReturnType<typeof useLauncher>;

const HELP_ID = 'launcher-help';
const shown = ({ status }: Launcher) => status?.platform === 'win32';

/** The browser's stand-in for the folder dialog. */
function PathForm({ launcher, close }: { launcher: Launcher; close: () => void }) {
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
    const failed = await launcher.openInEngine(folder, false);
    setBusy(false);
    if (!failed) return close();
    setProblem(failed);
    input.current?.focus();
  };
  return (
    <form className="launcher-popover launcher-path" onSubmit={(event) => void submit(event)}>
      <label className="launcher-label" htmlFor={`${id}-path`}>
        폴더 경로
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

/** The header button and its menu. */
export function LauncherButton({ launcher }: { launcher: Launcher }) {
  const [view, setView] = useState<'closed' | 'menu' | 'path'>('closed');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const installed = launcher.status?.installed === true;

  const closeAndFocus = useCallback(() => {
    setView('closed');
    trigger.current?.focus();
  }, []);

  // Claude Code went away with the menu open; it must not come back open with Claude Code.
  useEffect(() => {
    if (!installed) setView('closed');
  }, [installed]);

  useEffect(() => {
    if (view !== 'menu') return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[firstFocus.current === 'first' ? 0 : items.length - 1].focus();
  }, [view]);

  // One menu open at a time: a click on an account menu lands here, and main.tsx closes those.
  useEffect(() => {
    if (view === 'closed') return;
    const outside = (event: MouseEvent) => {
      // Not contains(): 폴더 선택… has left the page by the time its own click gets here.
      if (root.current && !event.composedPath().includes(root.current)) setView('closed');
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
  }, [view, closeAndFocus]);

  if (!shown(launcher) || !launcher.status) return null;
  const { recent } = launcher.status;

  const openMenu = (focus: 'first' | 'last') => {
    firstFocus.current = focus;
    launcher.dismiss();
    setView('menu');
  };
  const chooseFolder = () => {
    if (shell) {
      closeAndFocus();
      launcher.open();
    } else {
      setView('path');
    }
  };
  const chooseRecent = (folder: string) => {
    closeAndFocus();
    launcher.open(folder);
  };
  const moveInMenu = (event: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    items[(to + items.length) % items.length].focus();
  };

  return (
    <div
      className="launcher"
      ref={root}
      // Tab leaving the menu closes it. A window losing focus has no target: the user may be
      // copying a path from Explorer, and what they typed must still be there.
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (to && !root.current?.contains(to)) setView('closed');
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="primary-button launcher-button"
        disabled={!installed}
        aria-haspopup="menu"
        aria-expanded={view !== 'closed'}
        aria-controls={view === 'menu' ? id : undefined}
        aria-describedby={installed ? undefined : HELP_ID}
        onClick={() => (view === 'closed' ? openMenu('first') : setView('closed'))}
        onKeyDown={(event) => {
          if (view !== 'closed' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
          event.preventDefault();
          openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
        }}
      >
        Claude Code 열기
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M2 3.5 5 6.5l3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {view === 'menu' ? (
        <div
          ref={menu}
          id={id}
          className="launcher-popover"
          role="menu"
          aria-label="Claude Code를 열 폴더"
          onKeyDown={moveInMenu}
        >
          <button type="button" role="menuitem" tabIndex={-1} onClick={chooseFolder}>
            폴더 선택…
          </button>
          {recent.length > 0 ? (
            <div className="launcher-recent" role="group" aria-label="최근 폴더">
              <div className="launcher-label" aria-hidden="true">
                최근 폴더
              </div>
              {recent.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  title={folder}
                  onClick={() => chooseRecent(folder)}
                >
                  <span className="launcher-name">{folderName(folder)}</span>
                  {/* Cut at its start: the folders nearest the name tell two of a name apart. */}
                  <span className="launcher-parent">
                    <bdi dir="ltr">{parentFolder(folder)}</bdi>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {view === 'path' ? <PathForm launcher={launcher} close={closeAndFocus} /> : null}
    </div>
  );
}

/** Under the header row, which has no room for a sentence: the disabled help, or what went wrong. */
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
  if (launcher.status?.installed) return null;
  return (
    <div className="launcher-notice">
      <p id={HELP_ID}>설치 탭에서 Claude Code를 먼저 설치하세요</p>
    </div>
  );
}
