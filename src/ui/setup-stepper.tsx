import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ELEVATION_NOTE, type Confirmation, type NodeState, type StepView } from './setup-logic.ts';

/** The circle of a step (DESIGN 5.6), on the 24 px grid. Only the running ring moves. */
function StepNode({ state }: { state: NodeState }) {
  return (
    <span className="step-node" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {state === 'done' ? (
          <>
            <circle cx="12" cy="12" r="12" className="node-fill" />
            <path d="M7.5 12.5l3 3 6-7" className="node-check" />
          </>
        ) : null}
        {state === 'running' ? (
          <>
            <circle cx="12" cy="12" r="11" className="node-track" />
            <circle cx="12" cy="12" r="11" className="node-arc" />
          </>
        ) : null}
        {state === 'pending' ? <circle cx="12" cy="12" r="11.25" className="node-ring" /> : null}
        {state === 'failed' ? (
          <>
            <circle cx="12" cy="12" r="11" className="node-danger" />
            <path d="M12 6.5v7M12 16.5v1" className="node-danger-mark" />
          </>
        ) : null}
        {state === 'needs-user' ? (
          <>
            <circle cx="12" cy="12" r="11" className="node-strong" />
            <path d="M7 12h9.5M12.5 8l4 4-4 4" className="node-mark" />
          </>
        ) : null}
        {state === 'mismatch' ? (
          <>
            <circle cx="12" cy="12" r="11" className="node-strong" />
            <path d="M7.5 9.5h9M7.5 14.5h9M14.5 7l-5 10" className="node-mark" />
          </>
        ) : null}
        {state === 'unknown' ? (
          <>
            <circle cx="12" cy="12" r="11.25" className="node-ring" />
            <path
              d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 16.5v.5"
              className="node-faint-mark"
            />
          </>
        ) : null}
        {state === 'skipped' ? (
          <>
            <circle cx="12" cy="12" r="11.25" className="node-ring" />
            <path d="M8 12h8" className="node-faint-mark" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

/** One step: meta line, title, one line of description, then whatever this step needs said. */
export function StepRow({
  view,
  active = false,
  control,
  actions,
}: {
  view: StepView;
  /** Reads at full strength even while pending: the user has it checked. */
  active?: boolean;
  control?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="step" data-node={view.node} data-active={active ? 'true' : undefined}>
      <StepNode state={view.node} />
      <div className="step-body">
        <div className="step-main">
          <small className="step-meta">{view.meta}</small>
          <h3 className="step-title">{view.label}</h3>
          {view.description ? <p className="step-description">{view.description}</p> : null}
        </div>
        {control ? <div className="step-control">{control}</div> : null}
        {view.elevating ? <p className="step-elevation">{ELEVATION_NOTE}</p> : null}
        {view.notes.map((note) => (
          <p key={note.text} className="step-note" data-tone={note.tone}>
            {note.text}
          </p>
        ))}
        {view.parts.length ? (
          <ul className="step-parts">
            {view.parts.map((part) => (
              <li key={part.label} data-ok={String(part.ok)}>
                <span>{part.label}</span>
                <small>{part.ok ? '됨' : '아직 안 됨'}</small>
              </li>
            ))}
          </ul>
        ) : null}
        {view.manual ? (
          <p className="step-manual">
            {view.manual.url ? (
              <a href={view.manual.url} target="_blank" rel="noreferrer">
                {view.manual.message}
              </a>
            ) : (
              view.manual.message
            )}
          </p>
        ) : null}
        {actions ? <div className="step-actions">{actions}</div> : null}
      </div>
    </li>
  );
}

/** The label above a group's first step, with the group's size as a small index. */
export function GroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="step-group">
      {label}
      <sup>{String(count).padStart(2, '0')}</sup>
    </h2>
  );
}

/** An optional group: one row with a checkbox, and its steps only once ticked. */
export function OptionalGroup({
  label,
  description,
  count,
  open,
  toggle,
  children,
}: {
  label: string;
  description: string;
  count: string;
  open: boolean;
  toggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const descriptionId = useId();
  return (
    <section className="step-section" data-optional="true">
      <label className="group-row">
        <span className="group-box">
          <input
            type="checkbox"
            aria-label={label}
            aria-describedby={descriptionId}
            checked={open}
            onChange={(event) => toggle(event.target.checked)}
          />
        </span>
        <span className="group-text">
          <small className="step-meta">{count}</small>
          <span className="step-title">{label}</span>
          <span className="step-description" id={descriptionId}>
            {description}
          </span>
        </span>
      </label>
      {open ? children : null}
    </section>
  );
}

/** One program on the program screen, ticked as a whole. Without `toggle` it cannot be chosen yet. */
export function ProgramCard({
  name,
  note,
  picked = false,
  toggle,
}: {
  name: string;
  note?: string;
  picked?: boolean;
  toggle?: (on: boolean) => void;
}) {
  return (
    <label
      className="program-card"
      data-picked={picked ? 'true' : undefined}
      data-disabled={toggle ? undefined : 'true'}
    >
      <input
        type="checkbox"
        checked={picked}
        disabled={!toggle}
        onChange={(event) => toggle?.(event.target.checked)}
      />
      <span className="program-name">{name}</span>
      {note ? <small>{note}</small> : null}
    </label>
  );
}

/** The app's one modal (DESIGN 5.6). The browser keeps the keyboard in it and gives it back. */
export function WarningDialog({
  title,
  detail,
  close,
}: {
  title: string;
  detail: string;
  close: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (box.current && !box.current.open) box.current.showModal();
  }, []);
  return (
    <dialog ref={box} className="setup-warning" aria-labelledby={titleId} onClose={close}>
      <h2 id={titleId} className="confirm-title">
        {title}
      </h2>
      <p className="setup-warning-detail">{detail}</p>
      <form method="dialog" className="setup-warning-actions">
        <button type="submit" className="primary-button">
          확인
        </button>
      </form>
    </dialog>
  );
}

/** "8개 중 5개 완료" and the area's one primary button, kept in view at the bottom. */
export function SummaryBar({
  line,
  detail,
  error,
  children,
}: {
  line?: string;
  detail?: string;
  error?: string;
  children?: ReactNode;
}) {
  return (
    <div className="setup-summary">
      <div className="summary-text" role="status" aria-live="polite">
        {line ? <span className="summary-line">{line}</span> : null}
        {detail ? <small className="summary-detail">{detail}</small> : null}
        {error ? (
          <small className="summary-detail" data-tone="danger">
            {error}
          </small>
        ) : null}
      </div>
      {children ? <div className="summary-actions">{children}</div> : null}
    </div>
  );
}

/** Puts the keyboard back on the button that opened a panel, once the panel closes. */
function useFocusBack() {
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
}

/** Asks before anything that changes what the user already has (SPEC 3.3). */
export function ConfirmPanel({
  entries,
  confirm,
  cancel,
  busy,
}: {
  entries: Confirmation[];
  confirm: () => void;
  cancel: () => void;
  busy: boolean;
}) {
  useFocusBack();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <div
      ref={panel}
      className="setup-confirm"
      role="alertdialog"
      aria-labelledby="setup-confirm-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
    >
      <h2 id="setup-confirm-title" className="confirm-title">
        이미 있는 것을 바꿔요. 진행할까요?
      </h2>
      <ul className="confirm-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.label}</strong>
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
      <div className="confirm-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={confirm}>
          진행
        </button>
        <button type="button" onClick={cancel}>
          돌아가기
        </button>
      </div>
    </div>
  );
}

/** 로그 보기: the end of today's log, as plain text, opened at its newest line. */
export function LogPanel({
  text,
  error,
  reload,
  close,
}: {
  text: string | undefined;
  error: string;
  reload: () => void;
  close: () => void;
}) {
  useFocusBack();
  const body = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text]);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus(), []);
  return (
    <section className="setup-log" aria-labelledby="setup-log-title">
      <div className="log-head">
        <h2 id="setup-log-title" className="log-title">
          설치 기록(로그)
        </h2>
        <button type="button" className="text-button" onClick={reload}>
          새로 고침
        </button>
        <button ref={closeButton} type="button" className="text-button" onClick={close}>
          닫기
        </button>
      </div>
      {error ? (
        <p className="log-error">{error}</p>
      ) : (
        <pre ref={body} className="log-body" tabIndex={0}>
          {text === undefined ? '불러오는 중이에요.' : text || '아직 기록이 없어요.'}
        </pre>
      )}
    </section>
  );
}
