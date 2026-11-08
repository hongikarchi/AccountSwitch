import { useCallback, useEffect, useRef, useState } from 'react';
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
  canStart,
  cardDone,
  checkedInOrder,
  checkSummary,
  confirmationsFor,
  defaultChecked,
  failureMessage,
  groupItems,
  groupsOfRun,
  isListed,
  isRunActive,
  parseLog,
  parseOverview,
  parseReport,
  parseRun,
  picksCli,
  resultsById,
  runAnnouncement,
  runOutcome,
  runRequest,
  runSummary,
  stepFromCheck,
  stepFromGroup,
  stepFromRun,
  usingGroups,
  type Confirmation,
} from './setup-logic.ts';
import {
  ConfirmPanel,
  GroupLabel,
  LogPanel,
  ProgramCard,
  StepRow,
  SummaryBar,
  WarningDialog,
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
              쓰는 프로그램을 고르면 필요한 것을 차례대로 설치해요.
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

/** Auto mode's first question (SPEC 3.2): nothing happens here until 다음 is pressed. */
function ProgramScreen({
  overview,
  report,
  picked,
  setPicked,
  checking,
  busy,
  error,
  next,
  back,
}: {
  overview: SetupOverview;
  report: CheckReport | null;
  picked: ReadonlySet<string>;
  setPicked: (next: ReadonlySet<string>) => void;
  checking: boolean;
  busy: boolean;
  error: string;
  next: () => void;
  back: () => void;
}) {
  return (
    <>
      <PageHead title="어떤 프로그램을 쓰세요?" back={back} />
      <div className="program-cards">
        {overview.catalog.groups
          .filter((group) => group.optional)
          .map((group) =>
            cardDone(overview.catalog, report, group.id, picked) ? (
              <ProgramCard key={group.id} name={group.label} note="설치됨" />
            ) : (
              <ProgramCard
                key={group.id}
                name={group.label}
                picked={picked.has(group.id)}
                toggle={(on) => {
                  const after = new Set(picked);
                  if (on) after.add(group.id);
                  else after.delete(group.id);
                  setPicked(after);
                }}
              />
            ),
          )}
        <ProgramCard name="ZWCAD" note="준비 중" />
      </div>
      <SummaryBar {...(checking ? { line: '확인하는 중이에요' } : {})} error={error}>
        <button
          type="button"
          className="primary-button"
          disabled={checking || busy || !report}
          onClick={next}
        >
          다음
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
  // Auto mode's program screen, until 다음 is pressed.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [warning, setWarning] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
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
      setPicking(false);
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
        // The run shows on the checklist, whose other rows need the PC's state (read only).
        setMode(current.mode);
        void runCheck();
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
    setPicking(next === 'auto');
    setPicked(new Set());
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
    setPicking(false);
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
      setPicking(false);
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
    const entries = overview ? confirmationsFor(overview.catalog, report, items, runMode) : [];
    if (entries.length) setConfirming({ items, mode: runMode, entries });
    else void startRun(items, runMode);
  };

  /**
   * 다음: the press that installs what the ticked cards and the base group miss. With neither Claude
   * Code nor GPT, ticked or there, it only warns (SPEC 3.2). With nothing to install, the checklist
   * says where things are.
   */
  const startPicked = () => {
    const { catalog } = overview!;
    if (!picksCli(catalog, usingGroups(catalog, report, picked))) return setWarning(true);
    const nextChecked = defaultChecked(catalog, report, picked);
    chooseGroups(picked);
    setChecked(nextChecked);
    const items = checkedInOrder(catalog, nextChecked);
    const starts = canStart(catalog, nextChecked);
    // A question to answer first has its panel on the checklist.
    if (!starts || confirmationsFor(catalog, report, items, 'auto').length) {
      focusTitle.current = true;
      setPicking(false);
    }
    if (starts) requestRun(items, 'auto');
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
    if (run) return checklist();
    if (!mode) return <FirstScreen choose={choose} />;
    if (checkError && !report)
      return (
        <EmptyState size="large" kind="error" title="점검하지 못했어요" detail={checkError}>
          <button type="button" onClick={() => void runCheck(mode === 'check' && !lastRun)}>
            다시 시도
          </button>
        </EmptyState>
      );
    if (mode === 'auto' && picking)
      return (
        <>
          <ProgramScreen
            overview={overview}
            report={report}
            picked={picked}
            setPicked={setPicked}
            checking={checking}
            busy={busy}
            error={actionError || checkError}
            next={startPicked}
            back={backToFirst}
          />
          {warning ? (
            <WarningDialog
              title="Claude Code나 GPT 중 하나는 골라 주세요"
              detail="둘 중 하나가 있어야 AccountSwitch를 쓸 수 있어요."
              close={() => setWarning(false)}
            />
          ) : null}
        </>
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
    const listMode = auto ? 'auto' : 'check';
    const outcome = lastRun ? runOutcome(lastRun) : undefined;
    const selected = checkedInOrder(catalog, checked);
    const startable = canStart(catalog, checked);
    // A run in progress shows on these rows (SPEC 3.2): its items take their run state in place.
    const inRun = new Map((run?.items ?? []).map((entry) => [entry.id, entry]));
    const waiting = run?.phase === 'waiting';
    const runActions = (id: string) =>
      run && waiting && !run.cancelling && inRun.get(id)?.status === 'failed' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => api('/setup/run/retry', 'POST', { item: id }))}
          >
            다시 시도
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void act(() => api('/setup/run/skip', 'POST', { item: id }))}
          >
            건너뛰기
          </button>
          {logButton}
        </>
      ) : undefined;
    const anythingToInstall = catalog.items.some((item) => {
      const action = actionFor(item, results.get(item.id), listMode);
      return (
        (action.kind === 'install' || action.kind === 'register-again') &&
        isListed(catalog, item.group, openGroups)
      );
    });

    const row = (item: SetupItem) => {
      const progress = inRun.get(item.id);
      if (progress)
        return (
          <StepRow key={item.id} view={stepFromRun(item, progress)} actions={runActions(item.id)} />
        );
      const result = results.get(item.id);
      const action = actionFor(item, result, listMode);
      const isChecked = checked.has(item.id);
      const view = stepFromCheck(catalog, item, result, {
        ...(auto ? { checked } : {}),
        ...(lastItems.get(item.id) ? { lastRun: lastItems.get(item.id) } : {}),
      });
      const canInstall = action.kind === 'install' || action.kind === 'register-again';
      const verb = action.kind === 'register-again' ? '다시 등록' : '설치';
      const control = !canInstall ? undefined : auto ? (
        <label className="step-check">
          <input
            type="checkbox"
            aria-label={`${item.label} ${verb}`}
            disabled={!!run}
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
          disabled={busy || checking || !!run || !!result?.waitingFor?.length}
          onClick={() => requestRun([item.id], 'check')}
        >
          {verb}
        </button>
      );
      return <StepRow key={item.id} view={view} active={auto && isChecked} control={control} />;
    };

    const listed = catalog.items.filter((item) => {
      const group = catalog.groups.find((entry) => entry.id === item.group);
      return !group?.optional || group.cli;
    });
    const programs = catalog.groups.filter((group) => group.optional && !group.cli);
    const lastByItem = new Map((lastRun?.items ?? []).map((entry) => [entry.id, entry]));

    return (
      <>
        <PageHead
          title={
            run
              ? waiting
                ? '설치가 멈췄어요'
                : '설치하고 있어요'
              : (outcome?.title ?? (auto ? '설치할 항목을 고르세요' : '점검 결과'))
          }
          detail={
            run
              ? waiting
                ? '실패한 항목을 다시 시도하거나 건너뛰면 이어서 설치해요.'
                : '이 화면을 떠나도 설치는 계속돼요. 돌아오면 이어서 보여 드려요.'
              : (outcome?.detail ??
                (auto
                  ? '없는 항목에 미리 체크해 두었어요. 시작을 눌러야 설치가 시작돼요.'
                  : '확인만 했어요. 아무것도 바꾸지 않았어요. 필요한 것만 골라 설치할 수 있어요.'))
          }
          {...(run ? {} : { back: backToFirst })}
        />
        {run ? (
          <p className="sr-only" aria-live="polite">
            {runAnnouncement(catalog, run)}
          </p>
        ) : null}
        <div className="stepper" {...(run ? { 'data-live': 'true' } : {})}>
          <section className="step-section">
            <GroupLabel
              label={catalog.groups.find((group) => !group.optional)?.label ?? ''}
              count={listed.length}
            />
            <ol className="step-list">{listed.map(row)}</ol>
          </section>
          {programs.length ? (
            <section className="step-section">
              <GroupLabel label="필요하면 더 고르세요" count={programs.length} />
              <ol className="step-list">
                {programs.map((group) => {
                  const step = stepFromGroup(
                    catalog,
                    group,
                    report,
                    lastByItem,
                    listMode,
                    openGroups,
                  );
                  // Its items in the run: unfolded, and the row's own node follows them.
                  const runs = step.items
                    .map((item) => inRun.get(item.id)?.status)
                    .filter((status) => status !== undefined);
                  const view = !runs.length
                    ? step.view
                    : runs.includes('failed')
                      ? { ...step.view, node: 'failed' as const }
                      : runs.some((status) => status === 'running' || status === 'pending')
                        ? { ...step.view, node: 'running' as const, meta: '설치하는 중' }
                        : step.view;
                  const open = step.attention || unfolded.has(group.id) || runs.length > 0;
                  return (
                    <StepRow
                      key={group.id}
                      view={view}
                      control={
                        step.install.length ? (
                          <button
                            type="button"
                            aria-label={`${group.label} 설치`}
                            disabled={busy || checking || !!run}
                            onClick={() => requestRun(step.install, listMode)}
                          >
                            설치
                          </button>
                        ) : undefined
                      }
                      actions={
                        step.attention || runs.length ? undefined : (
                          <button
                            type="button"
                            className="text-button"
                            aria-expanded={open}
                            onClick={() => {
                              const next = new Set(unfolded);
                              if (open) next.delete(group.id);
                              else next.add(group.id);
                              setUnfolded(next);
                            }}
                          >
                            {open ? '접기' : '항목 보기'}
                          </button>
                        )
                      }
                    >
                      {open ? (
                        <ol className="step-list step-sublist">
                          {groupItems(
                            catalog,
                            group.id,
                            usingGroups(catalog, report, openGroups),
                          ).map(row)}
                        </ol>
                      ) : null}
                    </StepRow>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>
        {confirming && !run ? (
          <ConfirmPanel
            entries={confirming.entries}
            busy={busy}
            confirm={() => void startRun(confirming.items, confirming.mode, confirming.entries)}
            cancel={() => setConfirming(null)}
          />
        ) : null}
        {logPanel}
        {run ? (
          <SummaryBar
            line={runSummary(run)}
            detail={
              run.cancelling
                ? '취소하는 중이에요. 지금 하던 작업이 끝나면 멈춰요.'
                : connectionLost
                  ? '연결이 끊겼어요. 다시 연결하는 중이에요.'
                  : undefined
            }
            error={actionError}
          >
            {logButton}
            <button
              type="button"
              disabled={busy || run.cancelling}
              onClick={() => void act(() => api('/setup/cancel', 'POST', {}))}
            >
              {run.cancelling ? '취소하는 중' : '취소'}
            </button>
          </SummaryBar>
        ) : (
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
        )}
      </>
    );
  }

  return (
    <div ref={root} className="setup-page">
      {content()}
    </div>
  );
}
