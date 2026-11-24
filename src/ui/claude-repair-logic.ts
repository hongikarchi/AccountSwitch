import type { RunProgress } from '../core/setup/types.ts';

// SPEC 3.10: the 계정 tab's 고치기 starts the setup run of the `claude` item and follows it.

export const REPAIR_ITEM = 'claude';
export const REPAIR_REQUEST = { items: [REPAIR_ITEM], mode: 'auto' } as const;
export const STUCK_NOTICE = 'Claude Code 업데이트가 중간에 멈췄어요. 계정은 그대로예요.';
export const REPAIR_FAILED = '고치지 못했어요. 설치 탭에서 확인해 주세요.';
export const REPAIR_BUSY = '설치 탭에서 설치가 진행 중이에요. 끝난 뒤 다시 눌러 주세요.';

/** What one answer of GET /setup/run means for 고치기. */
export function repairOutcome(run: RunProgress | null): 'running' | 'done' | 'failed' {
  const item = run?.items.find((entry) => entry.id === REPAIR_ITEM);
  // No run at all: the engine restarted, and the run went with it.
  if (!run || !item) return 'failed';
  if (item.status === 'done') return 'done';
  if ((item.status === 'pending' || item.status === 'running') && run.phase === 'running')
    return 'running';
  return 'failed';
}

/** Why starting the run failed, in the words of the notice. */
export function startFailure(error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === 'SETUP_RUN_ACTIVE' ? REPAIR_BUSY : REPAIR_FAILED;
}
