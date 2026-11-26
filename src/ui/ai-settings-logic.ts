import type {
  AiSettingsAction,
  AiSettingsMode,
  AiSettingsPlan,
  AiSettingsRow,
  AiSettingsSave,
} from '../core/setup/types.ts';
import {
  ACTION_LABELS,
  BRANCH_PREFIX,
  integrationBranch,
  taskBranch,
} from '../core/setup/ai-settings-rules.ts';
import { REQUEST_FAILED_MESSAGE, failureMessage } from './setup-logic.ts';

// The AI 작업 설정 panel (SPEC 3.11) with no React in it: what the field accepts, what the preview
// says, what is asked of the engine and sent back to it, and which rows can be kept.

export const PREFIX_HINT = "영문 소문자, 숫자, '-'만 쓸 수 있어요.";
/** The task name the preview shows in place of a real one. */
export const TASK_EXAMPLE = '작업이름';
export const BACKUP_NOTE = '바꾸는 파일은 먼저 ~/.claude/backups/ 에 백업해요.';

/** The two choices of 방식, the default first. */
export const MODES: readonly { id: AiSettingsMode; title: string; detail: string }[] = [
  { id: 'fill', title: '채워 넣기', detail: '이미 있는 것은 두고 없는 것만 넣어요.' },
  { id: 'replace', title: '바꾸기', detail: '우리 설정으로 맞추고, 바꾸는 파일은 먼저 백업해요.' },
];

/** What was typed, without the spaces a paste leaves around it. Nothing else is changed. */
export const typedPrefix = (text: string) => text.trim();

export const isValidPrefix = (text: string) => BRANCH_PREFIX.test(typedPrefix(text));

export type PrefixView =
  | { valid: true; lines: { label: string; branch: string }[] }
  /** `error`: something was typed and it is not accepted; an empty field only gets the hint. */
  | { valid: false; hint: string; error: boolean };

/** Under the field: the two branch names while the prefix is valid, otherwise the one hint. */
export function prefixView(text: string): PrefixView {
  const prefix = typedPrefix(text);
  if (!BRANCH_PREFIX.test(prefix)) return { valid: false, hint: PREFIX_HINT, error: prefix !== '' };
  return {
    valid: true,
    lines: [
      { label: '통합 브랜치', branch: integrationBranch(prefix) },
      { label: '작업 브랜치', branch: taskBranch(prefix, TASK_EXAMPLE) },
    ],
  };
}

/**
 * The plan's path. Without a prefix it asks for the saved values, which prefill the panel when it
 * opens; with one, for the plan of that prefix and mode.
 */
export function planPath(prefix?: string, mode?: AiSettingsMode) {
  const query = new URLSearchParams();
  if (prefix !== undefined) query.set('prefix', typedPrefix(prefix));
  if (mode) query.set('mode', mode);
  const text = query.toString();
  return text ? `/setup/ai-settings?${text}` : '/setup/ai-settings';
}

/** Whether a row offers 내 것 유지. One that already keeps what is there has nothing to switch. */
export const canKeepRow = (row: AiSettingsRow) => row.canKeep && row.action !== 'keep';

export function keepableIds(rows: readonly AiSettingsRow[]) {
  return rows.filter(canKeepRow).map((row) => row.id);
}

/** The action a row shows, with the user's 내 것 유지 applied. */
export function shownAction(row: AiSettingsRow, kept: ReadonlySet<string>): AiSettingsAction {
  return canKeepRow(row) && kept.has(row.id) ? 'keep' : row.action;
}
export const actionLabel = (row: AiSettingsRow, kept: ReadonlySet<string>) =>
  ACTION_LABELS[shownAction(row, kept)];

/** The rows kept after a new plan: the same choice while the rows are the same, none otherwise. */
export function keptAfter(
  kept: ReadonlySet<string>,
  before: readonly AiSettingsRow[] | undefined,
  after: readonly AiSettingsRow[],
): ReadonlySet<string> {
  const same =
    !!before &&
    before.length === after.length &&
    before.every((row, index) => row.id === after[index].id);
  return same ? kept : new Set();
}

/** PUT /api/v1/setup/ai-settings: only the rows of this plan that can be kept, in its order. */
export function saveBody(
  prefix: string,
  mode: AiSettingsMode,
  kept: ReadonlySet<string>,
  rows: readonly AiSettingsRow[],
): AiSettingsSave {
  return {
    branchPrefix: typedPrefix(prefix),
    mode,
    keep: keepableIds(rows).filter((id) => kept.has(id)),
  };
}

/** A plan as received, with what it was asked for. */
export interface LoadedPlan {
  plan: AiSettingsPlan;
  prefix: string;
  mode: AiSettingsMode;
  /** The check it was made after (`CheckReport.finishedAt`): a new check asks again. */
  stamp: string | undefined;
}

/** Whether the plan on screen is the one for what the panel shows now, so 설치 may send it. */
export function planMatches(
  loaded: LoadedPlan | null | undefined,
  prefix: string,
  mode: AiSettingsMode,
  stamp: string | undefined,
): loaded is LoadedPlan {
  return (
    !!loaded &&
    loaded.prefix === typedPrefix(prefix) &&
    loaded.mode === mode &&
    loaded.stamp === stamp
  );
}

/** Why the plan could not be had: the prefix refused (400 INVALID_INPUT), or anything else. */
export function planFailure(error: unknown, known: Record<string, string>) {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  if (code === 'INVALID_INPUT') return { rejected: true, message: PREFIX_HINT };
  return { rejected: false, message: failureMessage(error, known) };
}

// Like parseOverview in setup-logic.ts: an answer that is not the shape of types.ts ends in the
// request-failed sentence, never in a crash inside a render.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const PARTS: readonly string[] = ['rules', 'settings', 'skill', 'paseo'];
const isMode = (value: unknown): value is AiSettingsMode => value === 'fill' || value === 'replace';
const isAction = (value: unknown): value is AiSettingsAction =>
  typeof value === 'string' && Object.hasOwn(ACTION_LABELS, value);

function isRow(value: unknown): value is AiSettingsRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.part === 'string' &&
    PARTS.includes(value.part) &&
    typeof value.target === 'string' &&
    isAction(value.action) &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    typeof value.canKeep === 'boolean'
  );
}

export function parsePlan(value: unknown): AiSettingsPlan {
  if (
    !isRecord(value) ||
    !(value.branchPrefix === null || typeof value.branchPrefix === 'string') ||
    !isMode(value.mode) ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isRow)
  )
    throw new Error(REQUEST_FAILED_MESSAGE);
  const rows = value.rows as AiSettingsRow[];
  // Row ids name the kept rows and the table's keys, so two of the same make no sense.
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error(REQUEST_FAILED_MESSAGE);
  return {
    branchPrefix: value.branchPrefix as string | null,
    mode: value.mode,
    rows: rows.map(({ id, part, target, action, detail, canKeep }) => ({
      id,
      part,
      target,
      action,
      ...(detail === undefined ? {} : { detail }),
      canKeep,
    })),
  };
}
