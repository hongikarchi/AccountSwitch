import { useEffect, useId, useRef, useState } from 'react';
import type { AiSettingsMode, AiSettingsSave } from '../core/setup/types.ts';
import { api, errors } from './gateway.ts';
import {
  BACKUP_NOTE,
  MODES,
  PREFIX_HINT,
  actionLabel,
  canKeepRow,
  isValidPrefix,
  keptAfter,
  parsePlan,
  planFailure,
  planMatches,
  planPath,
  prefixView,
  saveBody,
  typedPrefix,
  type LoadedPlan,
} from './ai-settings-logic.ts';

/** How long typing has to pause before the plan is asked for again. */
const ASK_AFTER_MS = 300;

/**
 * The AI 작업 설정 panel under its row (SPEC 3.11, DESIGN 5.6): the prefix, the mode and the plan.
 * Nothing here writes; 설치 hands the choices to the page, which saves them and starts the run.
 */
export function AiSettingsPanel({
  label,
  autoFocus,
  locked,
  blocked,
  stamp,
  install,
}: {
  /** The item's label, which names the 설치 button. */
  label: string;
  /** Opened by a press of the row's button, which is gone now: the keyboard goes to the field. */
  autoFocus: boolean;
  /** A run is on, so nothing here changes. */
  locked: boolean;
  /** The page is starting something or checking, so 설치 waits. */
  blocked: boolean;
  /** The check the plan follows (`CheckReport.finishedAt`): after a new check, the plan is asked again. */
  stamp: string | undefined;
  install: (save: AiSettingsSave) => void;
}) {
  // Until the saved prefix and mode are in, the field cannot be typed into.
  const [ready, setReady] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [mode, setMode] = useState<AiSettingsMode>('fill');
  const [loaded, setLoaded] = useState<LoadedPlan | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<{ rejected: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Only the newest question's answer counts.
  const asked = useRef(0);
  const loadedRef = useRef(loaded);
  const stampRef = useRef(stamp);
  stampRef.current = stamp;
  const id = useId();

  const accept = (next: LoadedPlan) => {
    const before = loadedRef.current?.plan.rows;
    setKept((current) => keptAfter(current, before, next.plan.rows));
    loadedRef.current = next;
    setLoaded(next);
    setFailure(null);
  };

  useEffect(
    () => () => {
      asked.current += 1;
    },
    [],
  );

  // On opening: the saved prefix and mode prefill the panel, with the plan for them.
  useEffect(() => {
    if (ready) return;
    const mine = ++asked.current;
    const at = stampRef.current;
    void api(planPath())
      .then(parsePlan)
      .then(
        (plan) => {
          if (mine !== asked.current) return;
          setPrefix(plan.branchPrefix ?? '');
          setMode(plan.mode);
          setReady(true);
          setFailure(null);
          if (plan.branchPrefix !== null)
            accept({ plan, prefix: plan.branchPrefix, mode: plan.mode, stamp: at });
        },
        (error: unknown) => {
          if (mine !== asked.current) return;
          const failed = planFailure(error, errors);
          // Refused without a prefix: nothing saved to start from, so the field starts empty.
          if (!failed.rejected) return setFailure(failed);
          setReady(true);
          setFailure(null);
        },
      );
  }, [ready, attempt]);

  // Then again after each change of a valid prefix or of the mode, once typing pauses.
  useEffect(() => {
    if (!ready) return;
    const wanted = typedPrefix(prefix);
    if (!isValidPrefix(wanted) || planMatches(loaded, wanted, mode, stamp)) return;
    const timer = setTimeout(() => {
      const mine = ++asked.current;
      void api(planPath(wanted, mode))
        .then(parsePlan)
        .then(
          (plan) => {
            if (mine === asked.current) accept({ plan, prefix: wanted, mode, stamp });
          },
          (error: unknown) => {
            if (mine === asked.current) setFailure(planFailure(error, errors));
          },
        );
    }, ASK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ready, prefix, mode, stamp, loaded, attempt]);

  const view = prefixView(prefix);
  const rejected = failure?.rejected ?? false;
  const current = planMatches(loaded, prefix, mode, stamp) ? loaded : null;
  const rows = loaded?.plan.rows;
  const canInstall = ready && view.valid && !rejected && !!current && !locked && !blocked;
  const showHint = !view.valid || rejected;
  const hintTone = rejected || (!view.valid && view.error) ? 'danger' : 'muted';
  const fieldId = `${id}-prefix`;
  const hintId = `${id}-hint`;

  const toggleKeep = (rowId: string) => {
    const next = new Set(kept);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setKept(next);
  };

  const waitingLine = !ready
    ? failure
      ? undefined
      : '불러오는 중이에요.'
    : view.valid
      ? failure
        ? undefined
        : '계획을 만드는 중이에요.'
      : '브랜치 접두어를 넣으면 무엇을 바꾸는지 보여 드려요.';

  return (
    <div className="ai-panel" role="group" aria-label={`${label} 고르기`}>
      <div className="ai-part">
        <label className="ai-label" htmlFor={fieldId}>
          브랜치 접두어
        </label>
        <input
          id={fieldId}
          className="ai-prefix"
          type="text"
          value={prefix}
          readOnly={!ready}
          disabled={locked}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
          aria-describedby={hintId}
          aria-invalid={hintTone === 'danger' ? true : undefined}
          onChange={(event) => {
            setPrefix(event.target.value);
            setFailure(null);
          }}
        />
        <div id={hintId} className="ai-preview">
          {showHint ? (
            <p data-tone={hintTone}>{PREFIX_HINT}</p>
          ) : view.valid ? (
            view.lines.map((line) => (
              <p key={line.label}>
                {line.label}: <code>{line.branch}</code>
              </p>
            ))
          ) : null}
        </div>
      </div>

      <fieldset className="ai-part" disabled={locked || !ready}>
        <legend className="ai-label">방식</legend>
        <div className="ai-choices">
          {MODES.map((choice) => (
            <label key={choice.id} className="ai-choice">
              <input
                type="radio"
                name={`${id}-mode`}
                value={choice.id}
                checked={mode === choice.id}
                onChange={() => {
                  setMode(choice.id);
                  setFailure(null);
                }}
              />
              <span className="choice-text">
                <span className="choice-title">{choice.title}</span>
                <span className="choice-detail">{choice.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="ai-part" aria-busy={ready && view.valid && !current && !failure}>
        {rows ? (
          <table className="ai-plan">
            <caption className="ai-label">계획</caption>
            <thead>
              <tr>
                <th scope="col">위치</th>
                <th scope="col">할 일</th>
                <th scope="col">설명</th>
                <th scope="col">
                  <span className="sr-only">내 것 유지</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isKept = canKeepRow(row) && kept.has(row.id);
                const text = isKept ? '되돌리기' : '내 것 유지';
                return (
                  <tr key={row.id}>
                    <td className="ai-target">
                      <code>{row.target}</code>
                    </td>
                    <td className="ai-action">{actionLabel(row, kept)}</td>
                    <td className="ai-detail">{row.detail}</td>
                    <td className="ai-keep">
                      {canKeepRow(row) ? (
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`${text}: ${row.target}`}
                          disabled={locked}
                          onClick={() => toggleKeep(row.id)}
                        >
                          {text}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <>
            <p className="ai-label">계획</p>
            {waitingLine ? <p className="ai-note">{waitingLine}</p> : null}
          </>
        )}
        {rows && !rows.length ? <p className="ai-note">바꿀 것이 없어요.</p> : null}
        {failure && !failure.rejected ? (
          <p className="ai-error" role="alert">
            {failure.message}{' '}
            <button
              type="button"
              className="text-button"
              disabled={locked}
              onClick={() => setAttempt((count) => count + 1)}
            >
              다시 시도
            </button>
          </p>
        ) : null}
      </div>

      <div className="ai-foot">
        <small className="ai-note">{BACKUP_NOTE}</small>
        <button
          type="button"
          className="primary-button"
          aria-label={`${label} 설치`}
          disabled={!canInstall}
          onClick={() => {
            if (current) install(saveBody(prefix, mode, kept, current.plan.rows));
          }}
        >
          설치
        </button>
      </div>
    </div>
  );
}
