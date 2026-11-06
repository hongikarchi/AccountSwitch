import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  CheckReport,
  RunProgress,
  SetupItem,
  SetupMode,
  SetupOverview,
} from '../core/setup/types.ts';
import { api, errors } from './gateway.ts';
import {
  actionFor,
  autoOpens,
  byGroup,
  canStart,
  checkedInOrder,
  checkSummary,
  confirmationsFor,
  defaultChecked,
  failureMessage,
  groupCount,
  groupsOfRun,
  isRunActive,
  parseLog,
  parseOverview,
  parseReport,
  parseRun,
  resultsById,
  runAnnouncement,
  runOutcome,
  runRequest,
  runSummary,
  stepFromCheck,
  stepFromRun,
  toggleGroup,
  type Confirmation,
} from './setup-logic.ts';
import {
  ConfirmPanel,
  GroupLabel,
  LogPanel,
  OptionalGroup,
  StepRow,
  SummaryBar,
} from './setup-stepper.tsx';
import { EmptyState } from './usage.tsx';
import './setup.css';

// The 설치 tab (SPEC 3): the first screen, the checklist of the two modes, and the run screen. The
// server owns a run, so this page only ever draws what it answers, and comes back to the same place
// after a reload. Nothing starts a run but the two buttons that call `startRun`.

const POLL_MS = 1000;
const message = (error: unknown) => failureMessage(error, errors);

async function fetchRun() {
  return parseRun(await api('/setup/run'));
}

/** SPEC 3.1: opens the wizard by itself on a new PC only; a failed request changes nothing. */
export function useSetupAutoOpen(open: () => void) {
  const opener = useRef(open);
  opener.current = open;
  useEffect(() => {
    void api('/setup')
      .then((value) => {
        if (autoOpens(value)) opener.current();
      })
      .catch(() => {
        /* The 계정 tab goes on as it is. */
      });
  }, []);
}

/** The first screen (DESIGN 5.6). */
function FirstScreen({ choose }: { choose: (mode: SetupMode) => void }) {
  return (
    <div className="setup-first">
      <h1 className="setup-display" tabIndex={-1}>
        이 PC를 준비할게요
      </h1>
      <div className="choice-list">
        <button type="button" className="choice-row" onClick={() => choose('check')}>
          <span className="choice-text">
            <span className="choice-title">이미 세팅했어요 (점검만)</span>
            <span className="choice-detail">
              무엇이 있는지 확인만 해요. 아무것도 설치하지 않아요.
            </span>
          </span>
          <Chevron />
        </button>
        <button type="button" className="choice-row" onClick={() => choose('auto')}>
          <span className="choice-text">
            <span className="choice-title">자동으로 설정해 주세요</span>
            <span className="choice-detail">
              없는 것을 찾아 보여 드려요. 시작을 누르면 차례대로 설치해요.
            </span>
          </span>
          <Chevron />
        </button>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="choice-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PageHead({ title, detail, back }: { title: string; detail?: string; back?: () => void }) {
  return (
    <div className="setup-head">
      <div className="setup-head-text">
        <h1 className="setup-title" tabIndex={-1}>
          {title}
        </h1>
        {detail ? <p className="setup-detail">{detail}</p> : null}
      </div>
      {back ? (
        <button type="button" className="text-button" onClick={back}>
          처음으로
        </button>
      ) : null}
    </div>
  );
}

function RunScreen({
  overview,
  run,
  busy,
  connectionLost,
  error,
  act,
  cancel,
  showLog,
  logPanel,
}: {
  overview: SetupOverview;
  run: RunProgress;
  busy: boolean;
  connectionLost: boolean;
  error: string;
  act: (route: 'skip' | 'retry', item: string) => void;
  cancel: () => void;
  showLog: () => void;
  logPanel: ReactNode;
}) {
  const { catalog } = overview;
  const waiting = run.phase === 'waiting';
  const rows = run.items.map((progress) => {
    const item = catalog.items.find((entry) => entry.id === progress.id);
    return { progress, group: item?.group ?? '', view: stepFromRun(item, progress) };
  });
  // An id the catalog does not know has no group to sit under; it still has to be seen.
  const grouped = byGroup(catalog, rows);
  const loose = rows.filter((row) => !catalog.groups.some((group) => group.id === row.group));
  const renderRow = (row: (typeof rows)[number]) => (
    <StepRow
      key={row.view.id}
      view={row.view}
      actions={
        row.progress.status === 'failed' && waiting && !run.cancelling ? (
          <>
            <button type="button" disabled={busy} onClick={() => act('retry', row.view.id)}>
              다시 시도
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => act('skip', row.view.id)}
            >
              건너뛰기
            </button>
            <button type="button" className="text-button" onClick={showLog}>
              로그 보기
            </button>
          </>
        ) : undefined
      }
    />
  );
  return (
    <>
      <PageHead
        title={waiting ? '설치가 멈췄어요' : '설치하고 있어요'}
        detail={
          waiting
            ? '실패한 항목을 다시 시도하거나 건너뛰면 이어서 설치해요.'
            : '이 화면을 떠나도 설치는 계속돼요. 돌아오면 이어서 보여 드려요.'
        }
      />
      <p className="sr-only" aria-live="polite">
        {runAnnouncement(catalog, run)}
      </p>
      <div className="stepper" data-live="true">
        {grouped.map(({ group, rows: inGroup }) => (
          <section key={group.id} className="step-section">
            <GroupLabel label={group.label} count={inGroup.length} />
            <ol className="step-list">{inGroup.map(renderRow)}</ol>
          </section>
        ))}
        {loose.length ? (
          <section className="step-section">
            <ol className="step-list">{loose.map(renderRow)}</ol>
          </section>
        ) : null}
      </div>
      {logPanel}
      <SummaryBar
        line={runSummary(run)}
        detail={
          run.cancelling
            ? '취소하는 중이에요. 지금 하던 작업이 끝나면 멈춰요.'
            : connectionLost
              ? '연결이 끊겼어요. 다시 연결하는 중이에요.'
              : undefined
        }
        error={error}
      >
        <button type="button" disabled={busy || run.cancelling} onClick={cancel}>
          {run.cancelling ? '취소하는 중' : '취소'}
        </button>
      </SummaryBar>
    </>
  );
}

export function SetupTab({ active }: { active: boolean }) {
  const [overview, setOverview] = useState<SetupOverview>();
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [run, setRun] = useState<RunProgress | null>(null);
  const [lastRun, setLastRun] = useState<RunProgress | null>(null);
  const [connectionLost, setConnectionLost] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<{
    items: string[];
    mode: SetupMode;
    entries: Confirmation[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [log, setLog] = useState<{ text?: string; error: string } | null>(null);

  // Read by callbacks that outlive a render: the group choice, the answer being waited for, and
  // whether a run is being followed.
  const groups = useRef(openGroups);
  const checkSeq = useRef(0);
  const following = useRef(false);
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const root = useRef<HTMLDivElement>(null);
  // Moves the keyboard to the new screen's title, only after the user's own press.
  const focusTitle = useRef(false);

  const chooseGroups = (next: ReadonlySet<string>) => {
    groups.current = next;
    setOpenGroups(next);
  };

  const runCheck = useCallback(async (record = false) => {
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckError('');
    try {
      const next = parseReport(await api('/setup/check', 'POST', record ? { record } : undefined));
      if (seq !== checkSeq.current) return;
      setReport(next);
      const catalog = overviewRef.current?.catalog;
      if (catalog) setChecked(defaultChecked(catalog, next, groups.current));
    } catch (error) {
      if (seq === checkSeq.current) setCheckError(message(error));
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }, []);

  /** A run the server has ended, or forgotten: show the result of what is on the PC now. */
  const finishRun = useCallback(
    (ended: RunProgress | null, known = overviewRef.current) => {
      following.current = false;
      setRun(null);
      setLastRun(ended);
      setConfirming(null);
      if (ended && known) {
        const next = new Set(groups.current);
        for (const group of groupsOfRun(known.catalog, ended)) next.add(group);
        groups.current = next;
        setOpenGroups(next);
      }
      if (ended) setMode(ended.mode);
      else setMode((current) => current ?? 'check');
      void runCheck();
    },
    [runCheck],
  );

  const applyRun = useCallback(
    (next: RunProgress | null, wasStarted = false) => {
      setConnectionLost(0);
      if (isRunActive(next)) {
        following.current = true;
        setRun(next);
      } else if (following.current || wasStarted) {
        finishRun(next);
      }
    },
    [finishRun],
  );

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const next = parseOverview(await api('/setup'));
      overviewRef.current = next;
      setOverview(next);
      if (!next.supported) return;
      const current = await fetchRun().catch(() => null);
      if (isRunActive(current)) {
        applyRun(current);
        chooseGroups(new Set(groupsOfRun(next.catalog, current)));
      } else if (current) {
        finishRun(current, next);
      } else if (next.stateFile === 'ok' && next.state) {
        // SPEC 3.1: after the first time, the tab is the same checklist with current status.
        setMode(next.state.mode);
        void runCheck();
      }
    } catch (error) {
      setLoadError(message(error));
    }
  }, [applyRun, finishRun, runCheck]);

  // The panel stays mounted while hidden, so nothing runs until the tab is first opened. Coming
  // back to it picks up a run started in another window.
  const opened = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (!opened.current) {
      opened.current = true;
      void load();
    } else if (overviewRef.current?.supported) {
      void fetchRun()
        .then((current) => {
          if (isRunActive(current)) {
            setMode(current.mode);
            applyRun(current);
          }
        })
        .catch(() => {
          /* The polling, if any, says so. */
        });
    }
  }, [active, applyRun, load]);

  // One request at a time, one second apart, only while a run is active (SPEC 3.4).
  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(() => {
      fetchRun().then(
        (next) => applyRun(next),
        () => setConnectionLost((count) => count + 1),
      );
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [run, connectionLost, applyRun]);

  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    root.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [mode, run]);

  const choose = (next: SetupMode) => {
    focusTitle.current = true;
    setMode(next);
    setLastRun(null);
    setActionError('');
    // 점검만 is recorded, or the wizard would reopen on every start of a PC without Claude Code.
    void runCheck(next === 'check');
  };
  const backToFirst = () => {
    focusTitle.current = true;
    checkSeq.current += 1;
    setChecking(false);
    setMode(null);
    setLastRun(null);
    setReport(null);
    setCheckError('');
    setActionError('');
    setConfirming(null);
    setLog(null);
    chooseGroups(new Set());
  };

  /** The one way into a run: after a press, with the items the user left checked. */
  const startRun = async (items: string[], runMode: SetupMode, confirmed: Confirmation[] = []) => {
    setBusy(true);
    setActionError('');
    setConfirming(null);
    try {
      await api('/setup/run', 'POST', runRequest(items, runMode, confirmed));
      focusTitle.current = true;
      setLastRun(null);
      setLog(null);
      setMode(runMode);
      applyRun(await fetchRun(), true);
    } catch (error) {
      // 409: another window started a run first, so this page follows that one.
      const current = await fetchRun().catch(() => null);
      if (isRunActive(current)) {
        setMode(current.mode);
        applyRun(current);
      } else setActionError(message(error));
    } finally {
      setBusy(false);
    }
  };
  /** Asks first when these items change something the user already has. */
  const requestRun = (items: string[], runMode: SetupMode) => {
    const entries = overview ? confirmationsFor(overview.catalog, report, items) : [];
    if (entries.length) setConfirming({ items, mode: runMode, entries });
    else void startRun(items, runMode);
  };

  const act = async (send: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await send();
      applyRun(await fetchRun());
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const loadLog = async () => {
    setLog((current) => ({ text: current?.text, error: '' }));
    try {
      setLog({ text: parseLog(await api('/setup/log')), error: '' });
    } catch (error) {
      setLog({ error: message(error) });
    }
  };

  const logPanel = log ? (
    <LogPanel
      text={log.text}
      error={log.error}
      reload={() => void loadLog()}
      close={() => setLog(null)}
    />
  ) : null;
  const logButton = (
    <button type="button" className="text-button" onClick={() => void loadLog()}>
      로그 보기
    </button>
  );

  const content = () => {
    if (loadError)
      return (
        <EmptyState size="large" kind="error" title="설치 화면을 열지 못했어요" detail={loadError}>
          <button type="button" onClick={() => void load()}>
            다시 시도
          </button>
        </EmptyState>
      );
    if (!overview) return <p className="setup-loading">불러오는 중이에요.</p>;
    if (!overview.supported || report?.supported === false)
      return (
        <EmptyState
          size="large"
          kind="install"
          title="이 컴퓨터에서는 쓸 수 없어요"
          detail="설치 화면은 Windows에서만 쓸 수 있어요. 계정 화면은 그대로 쓸 수 있어요."
        />
      );
    if (!overview.catalog.items.length)
      return (
        <EmptyState
          size="large"
          kind="install"
          title="설치할 항목이 없어요"
          detail="AccountSwitch를 새 버전으로 바꾼 뒤 다시 확인해 보세요."
        >
          <button type="button" onClick={() => void load()}>
            다시 시도
          </button>
        </EmptyState>
      );
    if (run)
      return (
        <>
          <RunScreen
            overview={overview}
            run={run}
            busy={busy}
            connectionLost={connectionLost > 0}
            error={actionError}
            act={(route, item) => void act(() => api(`/setup/run/${route}`, 'POST', { item }))}
            cancel={() => void act(() => api('/setup/cancel', 'POST', {}))}
            showLog={() => void loadLog()}
            logPanel={logPanel}
          />
        </>
      );
    if (!mode) return <FirstScreen choose={choose} />;
    if (checkError && !report)
      return (
        <EmptyState size="large" kind="error" title="점검하지 못했어요" detail={checkError}>
          <button type="button" onClick={() => void runCheck(mode === 'check' && !lastRun)}>
            다시 시도
          </button>
        </EmptyState>
      );
    return checklist();
  };

  // A plain function, not a component: a component defined here would remount on every render and
  // take the keyboard off the checkbox just pressed.
  function checklist() {
    const { catalog } = overview!;
    const results = resultsById(report);
    const lastItems = new Map((lastRun?.items ?? []).map((entry) => [entry.id, entry]));
    const auto = mode === 'auto';
    const outcome = lastRun ? runOutcome(lastRun) : undefined;
    const selected = checkedInOrder(catalog, checked);
    const startable = canStart(catalog, checked);
    const anythingToInstall = catalog.items.some((item) => {
      const action = actionFor(item, results.get(item.id));
      return (
        (action.kind === 'install' || action.kind === 'register-again') &&
        (!catalog.groups.find((group) => group.id === item.group)?.optional ||
          openGroups.has(item.group))
      );
    });

    const row = (item: SetupItem) => {
      const result = results.get(item.id);
      const action = actionFor(item, result);
      const isChecked = checked.has(item.id);
      const view = stepFromCheck(catalog, item, result, {
        ...(auto ? { checked } : {}),
        ...(lastItems.get(item.id) ? { lastRun: lastItems.get(item.id) } : {}),
      });
      const canInstall = action.kind === 'install' || action.kind === 'register-again';
      const verb = action.kind === 'register-again' ? '다시 등록' : '설치';
      if (auto && canInstall && isChecked && action.kind === 'install' && action.warning)
        view.notes.push({ text: action.warning, tone: 'muted' });
      const control = !canInstall ? undefined : auto ? (
        <label className="step-check">
          <input
            type="checkbox"
            aria-label={`${item.label} ${verb}`}
            checked={isChecked}
            onChange={(event) => {
              const next = new Set(checked);
              if (event.target.checked) next.add(item.id);
              else next.delete(item.id);
              setChecked(next);
            }}
          />
          <span aria-hidden="true">{verb}</span>
        </label>
      ) : (
        <button
          type="button"
          aria-label={`${item.label} ${verb}`}
          disabled={busy || checking || !!result?.waitingFor?.length}
          onClick={() => requestRun([item.id], 'check')}
        >
          {verb}
        </button>
      );
      return <StepRow key={item.id} view={view} active={auto && isChecked} control={control} />;
    };

    const required = catalog.groups.filter((group) => !group.optional);
    const optional = catalog.groups.filter((group) => group.optional);
    const inGroup = (id: string) => catalog.items.filter((item) => item.group === id);

    return (
      <>
        <PageHead
          title={outcome?.title ?? (auto ? '설치할 항목을 고르세요' : '점검 결과')}
          detail={
            outcome?.detail ??
            (auto
              ? '없는 항목에 미리 체크해 두었어요. 시작을 눌러야 설치가 시작돼요.'
              : '확인만 했어요. 아무것도 바꾸지 않았어요. 필요한 것만 골라 설치할 수 있어요.')
          }
          back={backToFirst}
        />
        <div className="stepper">
          {required.map((group) => (
            <section key={group.id} className="step-section">
              <GroupLabel label={group.label} count={inGroup(group.id).length} />
              <ol className="step-list">{inGroup(group.id).map(row)}</ol>
            </section>
          ))}
          {optional.length ? <p className="optional-label">필요하면 더 고르세요</p> : null}
          {optional.map((group) => (
            <OptionalGroup
              key={group.id}
              label={group.label}
              description={group.description}
              count={groupCount(catalog, report, group.id)}
              open={openGroups.has(group.id)}
              toggle={(on) => {
                const next = toggleGroup(catalog, report, { checked, openGroups }, group.id, on);
                chooseGroups(next.openGroups);
                setChecked(next.checked);
              }}
            >
              <ol className="step-list">{inGroup(group.id).map(row)}</ol>
            </OptionalGroup>
          ))}
        </div>
        {confirming ? (
          <ConfirmPanel
            entries={confirming.entries}
            busy={busy}
            confirm={() => void startRun(confirming.items, confirming.mode, confirming.entries)}
            cancel={() => setConfirming(null)}
          />
        ) : null}
        {logPanel}
        <SummaryBar
          line={
            checking && !report ? '확인하는 중이에요' : checkSummary(catalog, report, openGroups)
          }
          detail={
            checking
              ? '지금 상태를 확인하는 중이에요.'
              : auto && startable
                ? `체크한 ${selected.length}개를 설치해요.`
                : undefined
          }
          error={actionError || checkError}
        >
          {lastRun ? logButton : null}
          {auto && anythingToInstall ? (
            <>
              <button
                type="button"
                className="text-button"
                disabled={checking}
                onClick={() => void runCheck()}
              >
                다시 확인
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!startable || busy || checking || !!confirming}
                onClick={() => requestRun(selected, 'auto')}
              >
                {lastRun ? '계속' : '시작'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={checking}
              onClick={() => void runCheck()}
            >
              다시 확인
            </button>
          )}
        </SummaryBar>
      </>
    );
  }

  return (
    <div ref={root} className="setup-page">
      {content()}
    </div>
  );
}
