import { StepStop } from './install-deps.ts';
import { readForEdit, writeWithBackup } from './install-rhino.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import { isProgramRunning } from './install-windows.ts';
import { keepRunningState, withKeepRunning } from './paseo-desktop.ts';

// SPEC 3.3 `paseo-settings`: one value of Paseo's desktop settings, only while Paseo is closed,
// because the running app keeps its own copy and writes it back. Nothing is ever killed.

const RUNNING =
  "Paseo가 켜져 있어서 바꾸지 않았어요. Paseo의 설정 → 데몬에서 '종료 후에도 데몬 계속 실행'을 켜거나, Paseo를 끈 뒤 다시 시도하세요.";
const NOT_READY = 'Paseo를 한 번 켰다가 끄면 설정 파일이 준비돼요. 그다음 다시 시도하세요.';
const UNREADABLE = 'Paseo 설정 파일의 모양이 예상과 달라서 그대로 뒀어요.';
const READ_ERROR = 'Paseo 설정 파일을 읽거나 쓰지 못해서 그대로 뒀어요. 다시 시도해 보세요.';

const open = (message: string) => new StepStop('needs-user', 'PASEO_SETTINGS_OPEN', message);

export async function applyPaseoSettings(context: StepContext): Promise<StepResult> {
  const { check } = context.item;
  if (check.kind !== 'paseo-settings')
    throw new StepStop('failed', 'INSTALL_FAILED', '설정할 수 없는 항목이에요.');

  const running = await isProgramRunning(context, 'Paseo.exe');
  // Not knowing is treated as running: Paseo would write its own copy back.
  if (running !== false)
    throw new StepStop('needs-user', running ? 'PASEO_RUNNING' : 'PASEO_STATE_UNKNOWN', RUNNING);

  const { files } = context.deps;
  const path = context.path(check.file);
  const file = readForEdit(files, path);
  if (file.state === 'read-error') throw open(READ_ERROR);
  if (file.state === 'not-text') throw open(UNREADABLE);
  const text = file.state === 'text' ? file.text : undefined;
  const state = keepRunningState(text);
  if (state === 'missing' || state === 'not-ready') throw open(NOT_READY);
  if (state === 'unreadable' || text === undefined) throw open(UNREADABLE);
  if (state === 'off') {
    try {
      writeWithBackup(files, path, withKeepRunning(text));
    } catch {
      throw open(READ_ERROR);
    }
    context.log.line('Paseo: 창을 닫아도 계속 실행하도록 켰어요.');
  }
  return { ran: true };
}
