import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AutoOpen, CheckReport, SetupMode, SetupState, SetupStateItem } from './types.ts';

// setup-state.json in the data folder (SPEC 3.9), and the rule that opens the wizard by itself.

const FILE = 'setup-state.json';

const schema = z.object({
  version: z.literal(1),
  mode: z.enum(['check', 'auto']),
  finishedAt: z.string().optional(),
  items: z.record(
    z.string(),
    z.object({ status: z.string(), version: z.string().optional(), at: z.string() }),
  ),
});

export function setupStateFile(directory: string) {
  return join(directory, FILE);
}

export type ReadState =
  | { file: 'missing'; state: null }
  | { file: 'corrupt'; state: null }
  | { file: 'ok'; state: SetupState };

/**
 * `corrupt` still counts as existing: a damaged file belongs to someone who has been here, and
 * existing users are never forced through the wizard.
 */
export function readSetupState(directory: string): ReadState {
  const path = setupStateFile(directory);
  if (!existsSync(path)) return { file: 'missing', state: null };
  try {
    return { file: 'ok', state: schema.parse(JSON.parse(readFileSync(path, 'utf8'))) };
  } catch {
    return { file: 'corrupt', state: null };
  }
}

/** Replaces the file in one step, so a closed window never leaves half of it. */
export function writeSetupState(directory: string, state: SetupState) {
  mkdirSync(directory, { recursive: true });
  const path = setupStateFile(directory);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(schema.parse(state), null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

/** After each item of a run: keeps what earlier items wrote, and the run is not finished yet. */
export function recordSetupItem(
  directory: string,
  mode: SetupMode,
  id: string,
  item: SetupStateItem,
) {
  const items = readSetupState(directory).state?.items ?? {};
  writeSetupState(directory, { version: 1, mode, items: { ...items, [id]: item } });
}

export function finishSetupState(directory: string, mode: SetupMode, at: string) {
  const items = readSetupState(directory).state?.items ?? {};
  writeSetupState(directory, { version: 1, mode, finishedAt: at, items });
}

/** The user chose 점검만: remember the results, so the wizard does not open by itself again. */
export function recordCheck(directory: string, report: CheckReport) {
  const items = { ...(readSetupState(directory).state?.items ?? {}) };
  for (const result of report.results)
    items[result.id] = {
      status: result.status,
      ...(result.foundVersion ? { version: result.foundVersion } : {}),
      at: report.finishedAt,
    };
  writeSetupState(directory, { version: 1, mode: 'check', finishedAt: report.finishedAt, items });
}

/**
 * SPEC 3.1: the wizard opens by itself only when the state file does not exist and Claude Code is
 * not installed, and only where the setup feature exists.
 */
export function shouldAutoOpen({
  platform,
  stateFileExists,
  claudeInstalled,
}: {
  platform: string;
  stateFileExists: boolean;
  claudeInstalled: boolean;
}): AutoOpen {
  return {
    open: platform === 'win32' && !stateFileExists && !claudeInstalled,
    stateFileExists,
    claudeInstalled,
  };
}
