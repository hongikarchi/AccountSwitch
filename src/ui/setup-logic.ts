import type {
  AutoOpen,
  CheckReport,
  CheckResult,
  RunItemProgress,
  RunProgress,
  RunRequest,
  SetupCatalog,
  SetupGroup,
  SetupItem,
  SetupMode,
  SetupOverview,
} from '../core/setup/types.ts';

// The rules of the 설치 tab with no React in them, so they can be tested without a page: what gets
// checked, what may be installed, what a row says. Everything is derived from the catalog; no item
// id is named here (SPEC 3.3).

export const ELEVATION_NOTE =
  "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요.";
const ELEVATION_DECLINED_MESSAGE = "권한 확인에서 '아니요'를 눌렀어요";
const FAILED_MESSAGE = '설치하지 못했어요.';
const REQUEST_FAILED_MESSAGE = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

/** The stepper's circle. DESIGN 5.6 has the first five; the others are the check states it adds. */
export type NodeState =
  | 'done'
  | 'running'
  | 'pending'
  | 'failed'
  | 'needs-user'
  | 'mismatch'
  | 'unknown'
  | 'skipped';

export interface StepNote {
  text: string;
  tone: 'muted' | 'danger';
}

/** What one row shows, whichever screen it is on. */
export interface StepView {
  id: string;
  label: string;
  description: string;
  node: NodeState;
  meta: string;
  notes: StepNote[];
  /** Conditions of an item that has several, shown while not all of them hold. */
  parts: { label: string; ok: boolean }[];
  /** A step the user has to do; its URL opens outside the app. */
  manual?: { message: string; url?: string };
  /** The elevation sentence of SPEC 3.6 is showing. */
  elevating: boolean;
}

export type InstallAction =
  | { kind: 'none' }
  | { kind: 'manual'; message: string; url?: string }
  /** `warning`: shown and confirmed first, because another version was found. */
  | { kind: 'install'; warning?: string }
  /** An MCP registration with 버전 다름: confirmed, then sent in `replace`. */
  | { kind: 'register-again' };

/** The state is not known, which is not the same as missing. */
export function isUnknown(status: CheckResult['status'] | undefined) {
  return status === 'timeout' || status === 'error' || status === 'unsupported';
}

export function isRunActive(run: RunProgress | null | undefined): run is RunProgress {
  return run?.phase === 'running' || run?.phase === 'waiting';
}

function manualStep(item: SetupItem) {
  for (const step of item.install.steps) if (step.kind === 'manual') return step;
  return undefined;
}

export function resultsById(report: CheckReport | null | undefined) {
  return new Map((report?.results ?? []).map((result) => [result.id, result]));
}

/**
 * What can be done about a row. An install offered here is the only way into a run, and it never
 * covers an existing program unless the catalog says how: auto mode leaves a user's install alone
 * (SPEC 3.3), and a state nobody could check gets 다시 확인, not an install. The runner keeps another
 * version in auto mode whatever is asked, so offering it there would be a button that does nothing.
 */
export function actionFor(
  item: SetupItem,
  result: CheckResult | undefined,
  mode: SetupMode = 'check',
): InstallAction {
  if (result?.status === 'missing') {
    if (item.install.automatic) return { kind: 'install' };
    const step = manualStep(item);
    return step ? { kind: 'manual', message: step.message, url: step.url } : { kind: 'none' };
  }
  if (result?.status === 'version-mismatch') {
    if (item.check.kind === 'mcp') return { kind: 'register-again' };
    if (item.install.warnIfOtherVersion && mode === 'check')
      return { kind: 'install', warning: item.install.warnIfOtherVersion };
  }
  return { kind: 'none' };
}

const isOptional = (groups: SetupGroup[], id: string) =>
  groups.find((group) => group.id === id)?.optional ?? false;

/** The items on screen: every always-offered group, plus the optional groups the user ticked. */
export function visibleItems(catalog: SetupCatalog, openGroups: ReadonlySet<string>) {
  return catalog.items.filter(
    (item) => !isOptional(catalog.groups, item.group) || openGroups.has(item.group),
  );
}

/**
 * Auto mode's first checklist: what is missing, in the groups on screen. 버전 다름 and unknown stay
 * unchecked. A missing item only the user can install counts as checked too and has no box: the run
 * reports it as `needs-user`, and what depends on it then says what it waits for (SPEC 3.4).
 */
export function defaultChecked(
  catalog: SetupCatalog,
  report: CheckReport | null | undefined,
  openGroups: ReadonlySet<string>,
) {
  const results = resultsById(report);
  return new Set(
    visibleItems(catalog, openGroups)
      .filter((item) => results.get(item.id)?.status === 'missing')
      .map((item) => item.id),
  );
}

/** The optional groups of the program screen (SPEC 3.2): programs first, then the rest. */
export function pickerGroups(catalog: SetupCatalog) {
  const optional = catalog.groups.filter((group) => group.optional);
  return {
    programs: optional.filter((group) => group.program),
    others: optional.filter((group) => !group.program),
  };
}

/** Ticking a group shows it and checks what is missing in it; unticking drops all of it. */
export function toggleGroup(
  catalog: SetupCatalog,
  report: CheckReport | null | undefined,
  state: { checked: ReadonlySet<string>; openGroups: ReadonlySet<string> },
  group: string,
  on: boolean,
) {
  const results = resultsById(report);
  const openGroups = new Set(state.openGroups);
  const checked = new Set(state.checked);
  if (on) openGroups.add(group);
  else openGroups.delete(group);
  for (const item of catalog.items) {
    if (item.group !== group) continue;
    if (on && results.get(item.id)?.status === 'missing') checked.add(item.id);
    if (!on) checked.delete(item.id);
  }
  return { checked, openGroups };
}

/** Checked items in catalog order. A run of only things the user must do installs nothing. */
export function checkedInOrder(catalog: SetupCatalog, checked: ReadonlySet<string>) {
  return catalog.items.filter((item) => checked.has(item.id)).map((item) => item.id);
}
export function canStart(catalog: SetupCatalog, checked: ReadonlySet<string>) {
  return catalog.items.some((item) => checked.has(item.id) && item.install.automatic);
}

export interface Confirmation {
  id: string;
  label: string;
  text: string;
  replace: boolean;
}

/** What has to be agreed to before these items run (SPEC 3.3). Empty: nothing to ask. */
export function confirmationsFor(
  catalog: SetupCatalog,
  report: CheckReport | null | undefined,
  ids: readonly string[],
  mode: SetupMode = 'check',
): Confirmation[] {
  const results = resultsById(report);
  return catalog.items.flatMap((item): Confirmation[] => {
    if (!ids.includes(item.id)) return [];
    const action = actionFor(item, results.get(item.id), mode);
    if (action.kind === 'register-again') {
      const version =
        item.pinnedVersion && item.pinnedVersion !== 'latest'
          ? `${item.pinnedVersion} 버전으로 `
          : '';
      const text = `Claude Code에 등록된 내용을 지우고 ${version}다시 등록해요.`;
      return [{ id: item.id, label: item.label, text, replace: true }];
    }
    if (action.kind === 'install' && action.warning)
      return [{ id: item.id, label: item.label, text: action.warning, replace: false }];
    return [];
  });
}

export function runRequest(
  items: string[],
  mode: SetupMode,
  confirmations: Confirmation[],
): RunRequest {
  const replace = confirmations.filter((entry) => entry.replace).map((entry) => entry.id);
  return { items, mode, ...(replace.length ? { replace } : {}) };
}

/** "오후 05:59", the form the 계정 tab uses for times. */
export function clock(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hour = date.getHours();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${hour < 12 ? '오전' : '오후'} ${two(hour % 12 || 12)}:${two(date.getMinutes())}`;
}

const line = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

function labels(catalog: SetupCatalog, ids: string[]) {
  return ids.map((id) => catalog.items.find((item) => item.id === id)?.label ?? id);
}

function isPartial(item: SetupItem, result: CheckResult) {
  if (result.parts?.some((part) => part.ok)) return true;
  const total = item.check.kind === 'pip' ? item.check.packages.length : 0;
  return !!result.missingPackages?.length && result.missingPackages.length < total;
}

function checkMeta(item: SetupItem, result: CheckResult) {
  const found = result.foundVersion;
  switch (result.status) {
    case 'installed':
      return line('설치됨', found);
    case 'missing':
      return isPartial(item, result) ? '일부 없음' : '없음';
    case 'version-mismatch': {
      const pin = result.pinnedVersion;
      return line(
        '버전 다름',
        found && `찾은 버전 ${found}`,
        pin && pin !== 'latest' ? `필요한 버전 ${pin}` : undefined,
      );
    }
    default:
      return line('확인하지 못함', found && `찾은 버전 ${found}`);
  }
}

/** A row from the check results, with what the last run said about it while it is not installed. */
export function stepFromCheck(
  catalog: SetupCatalog,
  item: SetupItem,
  result: CheckResult | undefined,
  options: { checked?: ReadonlySet<string>; lastRun?: RunItemProgress } = {},
): StepView {
  const base = { id: item.id, label: item.label, description: item.description, elevating: false };
  if (!result) return { ...base, node: 'pending', meta: '확인하는 중', notes: [], parts: [] };
  // Only auto mode's checklist passes `checked`.
  const action = actionFor(item, result, options.checked ? 'auto' : 'check');
  const notes: StepNote[] = [];
  let node: NodeState =
    result.status === 'installed'
      ? 'done'
      : result.status === 'version-mismatch'
        ? 'mismatch'
        : isUnknown(result.status)
          ? 'unknown'
          : action.kind === 'manual'
            ? 'needs-user'
            : 'pending';
  if (result.message) notes.push({ text: result.message, tone: 'muted' });
  if (result.notOnPath)
    notes.push({
      text: '설치되어 있지만 새 터미널에서 바로 실행되지 않을 수 있어요.',
      tone: 'muted',
    });
  if (result.status !== 'installed') {
    if (result.missingPackages?.length)
      notes.push({ text: `없는 패키지: ${result.missingPackages.join(', ')}`, tone: 'muted' });
    const waiting = result.waitingFor ?? [];
    if (waiting.length) {
      // In the checklist a dependency that is itself checked gets installed first anyway, unless
      // only the user can install it.
      const coming = waiting.every(
        (id) =>
          options.checked?.has(id) &&
          catalog.items.find((entry) => entry.id === id)?.install.automatic,
      );
      const names = labels(catalog, waiting).join(', ');
      notes.push({
        text: coming ? `${names} 설치가 끝나면 이어서 설치해요.` : `먼저 필요해요: ${names}`,
        tone: 'muted',
      });
    }
    const last = options.lastRun;
    if (last?.status === 'failed') {
      node = 'failed';
      notes.push({ text: runFailure(last), tone: 'danger' });
    } else if (last?.status === 'needs-user') {
      node = 'needs-user';
      if (last.message && last.message !== (action.kind === 'manual' ? action.message : ''))
        notes.push({ text: last.message, tone: 'muted' });
    } else if (last?.status === 'skipped' && last.message && !waiting.length) {
      // With a dependency still missing, the line above already says what it waits for.
      notes.push({ text: last.message, tone: 'muted' });
    }
    if (result.status === 'version-mismatch' && action.kind === 'none')
      notes.push({ text: '이미 있는 프로그램은 그대로 둬요.', tone: 'muted' });
  }
  return {
    ...base,
    node,
    meta: checkMeta(item, result),
    notes,
    parts:
      result.parts && !result.parts.every((part) => part.ok)
        ? result.parts.map(({ label, ok }) => ({ label, ok }))
        : [],
    ...(action.kind === 'manual' ? { manual: { message: action.message, url: action.url } } : {}),
  };
}

function runFailure(progress: RunItemProgress) {
  return (
    progress.message ??
    (progress.reason === 'ELEVATION_DECLINED' ? ELEVATION_DECLINED_MESSAGE : FAILED_MESSAGE)
  );
}

/** A row of the run screen. An id the catalog does not know still gets a row. */
export function stepFromRun(item: SetupItem | undefined, progress: RunItemProgress): StepView {
  const base = {
    id: progress.id,
    label: item?.label ?? progress.id,
    description: item?.description ?? '',
    elevating: false,
    parts: [],
  };
  const note = (tone: StepNote['tone'], text: string | undefined): StepNote[] =>
    text ? [{ text, tone }] : [];
  switch (progress.status) {
    case 'done':
      return {
        ...base,
        node: 'done',
        meta: line('완료', progress.foundVersion, clock(progress.finishedAt)),
        notes: note('muted', progress.message),
      };
    case 'running':
      return {
        ...base,
        node: 'running',
        meta: line('설치하는 중', clock(progress.startedAt) && `${clock(progress.startedAt)} 시작`),
        notes: note('muted', progress.message),
        elevating: !!item?.mayElevate,
      };
    case 'failed':
      return {
        ...base,
        node: 'failed',
        meta: line('실패', clock(progress.finishedAt)),
        notes: note('danger', runFailure(progress)),
      };
    case 'skipped':
      return { ...base, node: 'skipped', meta: '건너뜀', notes: note('muted', progress.message) };
    case 'needs-user': {
      const step = item && manualStep(item);
      return {
        ...base,
        node: 'needs-user',
        meta: '직접 해 주세요',
        notes: note('muted', progress.message === step?.message ? undefined : progress.message),
        ...(step ? { manual: { message: step.message, url: step.url } } : {}),
      };
    }
    default:
      return { ...base, node: 'pending', meta: '기다리는 중', notes: [] };
  }
}

/** Rows split by group in catalog order, with each group shown once. */
export function byGroup<Row extends { group: string }>(catalog: SetupCatalog, rows: Row[]) {
  return catalog.groups.flatMap((group) => {
    const inGroup = rows.filter((row) => row.group === group.id);
    return inGroup.length ? [{ group, rows: inGroup }] : [];
  });
}

export function groupsOfRun(catalog: SetupCatalog, run: RunProgress) {
  const ids = new Set(run.items.map((entry) => entry.id));
  return catalog.items.filter((item) => ids.has(item.id)).map((item) => item.group as string);
}

export function summaryLine(total: number, done: number) {
  return `${total}개 중 ${done}개 완료`;
}

export function checkSummary(
  catalog: SetupCatalog,
  report: CheckReport | null | undefined,
  openGroups: ReadonlySet<string>,
) {
  const results = resultsById(report);
  const items = visibleItems(catalog, openGroups);
  const done = items.filter((item) => results.get(item.id)?.status === 'installed').length;
  return summaryLine(items.length, done);
}

export function groupCount(
  catalog: SetupCatalog,
  report: CheckReport | null | undefined,
  group: string,
) {
  const results = resultsById(report);
  const items = catalog.items.filter((item) => item.group === group);
  const installed = items.filter((item) => results.get(item.id)?.status === 'installed').length;
  return report ? `${items.length}개 중 ${installed}개 설치됨` : `${items.length}개`;
}

export function runSummary(run: RunProgress) {
  const done = run.items.filter((entry) => entry.status === 'done').length;
  return summaryLine(run.items.length, done);
}

/** How a run that is over went, in one line. */
export function runOutcome(run: RunProgress) {
  const count = (status: RunItemProgress['status']) =>
    run.items.filter((entry) => entry.status === status).length;
  const parts: [number, string][] = [
    [count('done'), '완료'],
    [count('failed'), '실패'],
    [count('skipped'), '건너뜀'],
    [count('needs-user'), '직접 해야 할 일'],
    [count('pending') + count('running'), '시작하지 않음'],
  ];
  return {
    title: run.phase === 'cancelled' ? '설치를 취소했어요' : '설치를 마쳤어요',
    detail: line(...parts.filter(([n]) => n > 0).map(([n, name]) => `${name} ${n}개`)),
  };
}

/** The sentence a screen reader hears while a run goes on. */
export function runAnnouncement(catalog: SetupCatalog, run: RunProgress) {
  const name = (entry: RunItemProgress) =>
    catalog.items.find((item) => item.id === entry.id)?.label ?? entry.id;
  if (run.cancelling) return '취소하는 중이에요.';
  const failed = run.items.find((entry) => entry.status === 'failed');
  if (failed) return `${name(failed)} 설치에 실패했어요. ${runFailure(failed)}`;
  const running = run.items.find((entry) => entry.status === 'running');
  if (!running) return runSummary(run);
  const item = catalog.items.find((entry) => entry.id === running.id);
  return `${name(running)} 설치하는 중. ${item?.mayElevate ? ELEVATION_NOTE : ''}`.trim();
}

/** A failure's sentence: the page's own Korean for a known code, never a bare code. */
export function failureMessage(error: unknown, known: Record<string, string>) {
  if (!(error instanceof Error)) return REQUEST_FAILED_MESSAGE;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && !(code in known)) return REQUEST_FAILED_MESSAGE;
  return error.message || REQUEST_FAILED_MESSAGE;
}

// The page trusts the shape of src/core/setup/types.ts, but an answer that is not that shape at all
// must end in the error state, not in a crash inside a render.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function parseOverview(value: unknown): SetupOverview {
  const catalog = isRecord(value) ? value.catalog : undefined;
  if (!isRecord(catalog) || !Array.isArray(catalog.items) || !Array.isArray(catalog.groups))
    throw new Error(REQUEST_FAILED_MESSAGE);
  return value as unknown as SetupOverview;
}
export function parseReport(value: unknown): CheckReport {
  if (!isRecord(value) || !Array.isArray(value.results)) throw new Error(REQUEST_FAILED_MESSAGE);
  return value as unknown as CheckReport;
}
export function parseRun(value: unknown): RunProgress | null {
  const run = isRecord(value) ? value.run : undefined;
  if (run === null) return null;
  if (!isRecord(run) || !Array.isArray(run.items)) throw new Error(REQUEST_FAILED_MESSAGE);
  return run as unknown as RunProgress;
}
export function parseLog(value: unknown): string {
  if (!isRecord(value) || typeof value.text !== 'string') throw new Error(REQUEST_FAILED_MESSAGE);
  return value.text;
}
export function autoOpens(value: unknown) {
  const autoOpen = isRecord(value) ? value.autoOpen : undefined;
  return isRecord(autoOpen) && (autoOpen as unknown as AutoOpen).open === true;
}
