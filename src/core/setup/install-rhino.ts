import { win32 } from 'node:path';
import { StepStop, type InstallFiles } from './install-deps.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import { isProgramRunning } from './install-windows.ts';
import { addStartupCommand, setReadOnlyWarning } from './rhino-xml.ts';
import { roleNote } from './role-note.ts';
import type { CheckSpec } from './types.ts';

export { roleNote, setReadOnlyWarning, addStartupCommand };

// The rhino-settings item (SPEC 3.8): parts 1 (the read-only warning) and 2 (mcpstart at Rhino
// start) in Rhino's settings file, and part 4 (the tool-role note). Part 3 is the agent's: the note
// tells it how to start Cordyceps. Rhino is only ever looked at, never stopped.

const occurrences = (text: string, part: string) => text.split(part).length - 1;

/**
 * Part 4: only the text between the two markers is ever written or replaced. Markers that are not
 * exactly one pair in order leave the file alone, because their meaning is then a guess.
 */
export function applyMarkedBlock(
  current: string | undefined,
  start: string,
  end: string,
  body: string,
): { text: string; changed: boolean; problem?: undefined } | { problem: 'markers' } {
  const source = current ?? '';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.replace(/\r?\n/g, newline);
  const starts = occurrences(source, start);
  const ends = occurrences(source, end);
  if (starts === 0 && ends === 0) {
    const gap = !source ? '' : source.endsWith('\n') ? newline : newline + newline;
    return {
      text: `${source}${gap}${start}${newline}${lines}${newline}${end}${newline}`,
      changed: true,
    };
  }
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);
  if (starts !== 1 || ends !== 1 || endAt < startAt) return { problem: 'markers' };
  const text =
    source.slice(0, startAt + start.length) + newline + lines + newline + source.slice(endAt);
  return { text, changed: text !== source };
}

export const BACKUP_SUFFIX = '.accountswitch-bak';

/**
 * A file this code may rewrite. `missing` is only a file that does not exist; `read-error` could be
 * anything, and must not be taken for an empty file. `not-text`: decoding and encoding again would
 * not give the same bytes (UTF-16, CP949), so a write would destroy the rest. A NUL byte counts too,
 * because UTF-16 without a byte order mark can pass that test.
 */
function readForEdit(files: InstallFiles, path: string) {
  let bytes: Buffer | undefined;
  try {
    bytes = files.read(path);
  } catch {
    return { state: 'read-error' as const };
  }
  if (!bytes) return { state: 'missing' as const };
  const text = bytes.toString('utf8');
  if (bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes))
    return { state: 'not-text' as const };
  return { state: 'text' as const, text };
}

/** Only a change gets here. The backup is of the file before the first change, so it is kept after. */
function writeWithBackup(files: InstallFiles, path: string, text: string) {
  const backup = path + BACKUP_SUFFIX;
  if (!files.read(backup)) files.copy(path, backup);
  files.write(path, text);
}

/** Parts 1 and 2 on the real file, in one write: backup before the first change, and only if one. */
function applySettingsFile(context: StepContext, path: string, startupCommand: string) {
  const { files } = context.deps;
  const file = readForEdit(files, path);
  if (file.state === 'missing') return 'no-file' as const;
  if (file.state === 'read-error') return 'read-error' as const;
  if (file.state === 'not-text') return 'unreadable' as const;
  const warning = setReadOnlyWarning(file.text);
  if (warning.problem) return 'unreadable' as const;
  const startup = addStartupCommand(warning.xml, startupCommand);
  if (startup.problem) return 'unreadable' as const;
  if (!warning.changed && !startup.changed) return 'done' as const;
  try {
    writeWithBackup(files, path, startup.xml);
  } catch {
    return 'read-error' as const;
  }
  if (warning.changed) context.log.line('Rhino 읽기 전용 경고를 켰어요.');
  if (startup.changed) context.log.line(`Rhino가 켜질 때 ${startupCommand}를 실행하게 했어요.`);
  return 'done' as const;
}

/** Part 4 on the real file. What came of it for the user to read; nothing when all went well. */
function applyRoleNote(
  context: StepContext,
  name: string,
  path: string,
  spec: Extract<CheckSpec, { kind: 'rhino-settings' }>,
) {
  const { files } = context.deps;
  const place = `${name} 안내 파일(${win32.basename(path)})`;
  const file = readForEdit(files, path);
  if (file.state === 'read-error')
    return `${place}을 읽지 못해서 그대로 뒀어요. 다시 시도해 보세요.`;
  if (file.state === 'not-text')
    return `${place}의 글자 형식이 UTF-8이 아니어서 그대로 뒀어요. 메모장에서 UTF-8로 저장한 뒤 다시 시도하세요.`;
  const note = applyMarkedBlock(
    file.state === 'text' ? file.text : undefined,
    spec.roleNoteStart,
    spec.roleNoteEnd,
    roleNote(),
  );
  if (note.problem) return `${place}의 표시가 어긋나 있어서 그대로 뒀어요.`;
  if (!note.changed) return undefined;
  try {
    if (file.state === 'text') writeWithBackup(files, path, note.text);
    else files.write(path, note.text);
  } catch {
    return `${place}을 바꾸지 못해서 그대로 뒀어요. 다시 시도해 보세요.`;
  }
  context.log.line(`${name} 도구 안내를 적었어요.`);
  return undefined;
}

export async function applyRhinoSettings(context: StepContext): Promise<StepResult> {
  const spec: Extract<CheckSpec, { kind: 'rhino-settings' }> | undefined =
    context.item.check.kind === 'rhino-settings' ? context.item.check : undefined;
  if (!spec) throw new StepStop('failed', 'INSTALL_FAILED', '설정할 수 없는 항목이에요.');

  const running = await isProgramRunning(context, 'Rhino.exe');
  // Not knowing is treated as running: Rhino would undo the change when it exits.
  if (running !== false)
    throw new StepStop(
      'needs-user',
      running ? 'RHINO_RUNNING' : 'RHINO_STATE_UNKNOWN',
      'Rhino를 닫고 다시 시도하세요',
    );

  const open: string[] = [];
  const warning = applySettingsFile(context, context.path(spec.settingsFile), spec.startupCommand);
  if (warning === 'no-file')
    open.push('Rhino를 한 번 켰다가 끄면 설정 파일이 생겨요. 그다음 다시 시도하세요.');
  if (warning === 'unreadable') open.push('Rhino 설정 파일의 모양이 예상과 달라서 그대로 뒀어요.');
  if (warning === 'read-error')
    open.push('Rhino 설정 파일을 읽거나 쓰지 못해서 그대로 뒀어요. 다시 시도해 보세요.');

  const { check } = context.deps;
  for (const note of spec.roleNotes) {
    if (!check.executable(note.provider)) continue;
    const problem = applyRoleNote(context, note.name, context.path(note.file), spec);
    if (problem) open.push(problem);
  }

  if (!open.length) return { ran: true };
  return {
    ran: true,
    needsUser: { reason: 'SETTINGS_PARTS_OPEN', message: open.join(' ') },
  };
}
