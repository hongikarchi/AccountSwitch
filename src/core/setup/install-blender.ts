import { join } from 'node:path';
import { StepStop } from './install-deps.ts';
import { downloadsFolder, fetchBytes, sha256Hex } from './install-download.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import { isProgramRunning } from './install-windows.ts';
import type { InstallStep } from './types.ts';

// The blender-mcp add-on (SPEC 3.3). Written against SPEC and tested with fakes; the Blender command
// itself still needs one real run (T-045). The add-on file holds a third party's key, so it lives
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
    const result = await context.exec(
      {
        program: blender,
        args: blenderArguments(step.module),
        env: { ...context.childEnv(), ACCOUNTSWITCH_ADDON_FILE: file },
      },
      { label: `blender: 애드온 ${step.module} 설치` },
    );
    return result.code === 0
      ? { ran: true }
      : {
          ran: !result.spawnError,
          failure: {
            reason: 'INSTALL_FAILED',
            message: 'Blender에 애드온을 설치하지 못했어요. 로그를 확인해 보세요.',
          },
        };
  } finally {
    files.remove(file);
  }
}
