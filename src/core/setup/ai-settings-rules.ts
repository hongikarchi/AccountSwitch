import type { AiSettingsAction } from './types.ts';

// SPEC 3.11: what the engine and the page share about the AI work settings. No Node imports, so
// the page can import it.

/** 브랜치 접두어: lowercase letters, digits and `-`, starting with a letter or digit. */
export const BRANCH_PREFIX = /^[a-z0-9][a-z0-9-]{0,30}$/;
/** Fixed by the user (2026-11-26): `<prefix>_develop` and `<prefix>_<task>`. */
export const INTEGRATION_SUFFIX = '_develop';

export const integrationBranch = (prefix: string) => `${prefix}${INTEGRATION_SUFFIX}`;
export const taskBranch = (prefix: string, task: string) => `${prefix}_${task}`;

/** The Korean word the plan table shows for each action. */
export const ACTION_LABELS: Record<AiSettingsAction, string> = {
  add: '추가',
  same: '같음',
  fill: '채워 넣기',
  update: '새 버전',
  keep: '내 것 유지',
  replace: '바꾸기',
  skip: '건너뜀',
};
