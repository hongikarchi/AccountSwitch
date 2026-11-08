import { join } from 'node:path';
import { cleanUp, StepStop } from './install-deps.ts';
import { downloadsFolder, fetchBytes, sha256Hex } from './install-download.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import { isProgramRunning } from './install-windows.ts';
import type { InstallStep } from './types.ts';

// The blender-mcp add-on (SPEC 3.3). Written against SPEC and tested with fakes; the Blender command
// itself still needs one real run (#1). The add-on file holds a third party's key, so it lives
// only in the data folder, for as long as the install takes, and never in this repository.

const MODULE_NAME = /^[A-Za-z_]\w*$/;

/**
 * What Blender runs. The path of the file travels in the environment, so no quoting can break it.
 * Telemetry consent goes off before the save, so the saved preferences never hold it on. Without
 * `--factory-startup` Blender reads the user's preferences first; with it, the save would overwrite
 * them with factory values.
 */
export function blenderExpression(module: string) {
  if (!MODULE_NAME.test(module)) throw new Error('INVALID_MODULE_NAME');
  return [
    'import bpy, os',
    "bpy.ops.preferences.addon_install(filepath=os.environ['ACCOUNTSWITCH_ADDON_FILE'], overwrite=True)",
    `bpy.ops.preferences.addon_enable(module='${module}')`,
    `bpy.context.preferences.addons['${module}'].preferences.telemetry_consent = False`,
    'bpy.ops.wm.save_userpref()',
  ].join('\n');
}

export function blenderArguments(module: string) {
  return ['-b', '--python-exit-code', '1', '--python-expr', blenderExpression(module)];
}

/** Blender's own "Load Previous Settings"; it only copies out of the old version's folder. */
export const COPY_PREVIOUS_EXPRESSION = 'import bpy\nbpy.ops.preferences.copy_prev()';

const COPY_PREVIOUS_MAX_MS = 5 * 60 * 1000;
const PREVIOUS_NOT_COPIED =
  '이전 버전 Blender의 설정을 가져오지 못했어요. 이전 설정은 그대로 남아 있고, 애드온 설치는 계속했어요.';

/** Whether a version folder such as `5.1` is older than the series, comparing numbers. */
export function isOlderSeries(folder: string, series: string) {
  const parse = (value: string) => /^(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const [old, current] = [parse(folder), parse(series)];
  if (!old || !current) return false;
  return old[0] < current[0] || (old[0] === current[0] && old[1] < current[1]);
}

/**
 * Saving the prefs below creates userpref.blend, after which Blender no longer offers to import the
 * previous version's settings, so they come along first (SPEC 3.3, **verify** #1). A failure loses
 * nothing and does not stop the add-on; it comes back as what to tell the user. A cancel stays one.
 */
async function copyPreviousSettings(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'blender-addon' }>,
  blender: string,
) {
  const { check } = context.deps;
  if (check.exists(context.path(step.userPrefs))) return undefined;
  const older = check
    .listFolders(context.path(step.versionsFolder))
    .some((folder) => isOlderSeries(folder, step.series));
  if (!older) return undefined;
  try {
    const result = await context.exec(
      {
        program: blender,
        args: ['-b', '--python-exit-code', '1', '--python-expr', COPY_PREVIOUS_EXPRESSION],
      },
      { label: 'blender: 이전 버전 설정 가져오기', maxMs: COPY_PREVIOUS_MAX_MS },
    );
    if (result.code === 0) return undefined;
  } catch (error) {
    if (!(error instanceof StepStop) || error.reason !== 'TIMEOUT') throw error;
  }
  context.log.line('이전 버전 Blender 설정을 가져오지 못했어요.');
  return PREVIOUS_NOT_COPIED;
}

export async function installBlenderAddon(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'blender-addon' }>,
): Promise<StepResult> {
  const { check, files, fetch: fetcher, directory } = context.deps;
  const blender = context.path(step.blender);
  if (!check.exists(blender))
    throw new StepStop(
      'needs-user',
      'BLENDER_NOT_FOUND',
      '애드온은 Blender 5.2에 설치돼요. Blender 5.2를 먼저 설치한 뒤 다시 시도하세요.',
    );
  const running = await isProgramRunning(context, 'blender.exe');
  // Blender saves its preferences on exit, which would undo the change. Not knowing counts as yes.
  if (running !== false)
    throw new StepStop(
      'needs-user',
      running ? 'BLENDER_RUNNING' : 'BLENDER_STATE_UNKNOWN',
      'Blender를 닫고 다시 시도하세요',
    );

  const bytes = await fetchBytes(step.url, {
    fetcher,
    cancel: context.cancelSignal,
    timeoutMs: context.remainingMs(),
  });
  // Looked at in memory first: a file with the wrong hash never reaches the disk.
  if (sha256Hex(bytes) !== step.sha256.toLowerCase())
    throw new StepStop(
      'failed',
      'HASH_MISMATCH',
      '내려받은 애드온이 기대한 파일과 달라서 설치하지 않았어요.',
    );

  if (!/^[\w.-]+\.py$/.test(step.saveAs)) throw new Error('INVALID_ADDON_FILE_NAME');
  const file = join(downloadsFolder(directory), step.saveAs);
  files.write(file, bytes);
  try {
    const note = await copyPreviousSettings(context, step, blender);
    const result = await context.exec(
      {
        program: blender,
        args: blenderArguments(step.module),
        env: { ...context.childEnv(), ACCOUNTSWITCH_ADDON_FILE: file },
      },
      { label: `blender: 애드온 ${step.module} 설치` },
    );
    return result.code === 0
      ? { ran: true, ...(note ? { note } : {}) }
      : {
          ran: !result.spawnError,
          failure: {
            reason: 'INSTALL_FAILED',
            message: 'Blender에 애드온을 설치하지 못했어요. 로그를 확인해 보세요.',
          },
        };
  } finally {
    cleanUp(files, context.log, file);
  }
}
