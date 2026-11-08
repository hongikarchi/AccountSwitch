import { win32 } from 'node:path';
import { StepStop, type InstallFiles } from './install-deps.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import { isProgramRunning } from './install-windows.ts';
import { roleNote } from './role-note.ts';
import type { CheckSpec } from './types.ts';

export { roleNote };

// The rhino-settings item (SPEC 3.8): part 1 (the read-only warning) and part 4 (the tool-role
// note). Parts 2 (mcpstart at Rhino start) and 3 (a Grasshopper starter file) are not set (#3); the
// note asks the agent to have the user start them. Rhino is only ever looked at, never stopped.

const WARNING_KEY = 'EnableFileLockingOpenWarning';
const WARNING_ON = `<entry key="${WARNING_KEY}">True</entry>`;

interface Range {
  /** Where `<child ...>` starts and ends. */
  openStart: number;
  openEnd: number;
  /** Where `</child>` starts and ends; equal to the open tag's for `<child ... />`. */
  closeStart: number;
  closeEnd: number;
  selfClosing: boolean;
}

/** The first `<child key="...">` in a stretch of the file, with its own closing tag. */
function findChild(xml: string, key: string, from: number, to: number): Range | undefined {
  const open = new RegExp(`<child\\s+key="${key}"[^>]*?(/?)>`, 'g');
  open.lastIndex = from;
  const match = open.exec(xml);
  if (!match || match.index >= to) return undefined;
  const openStart = match.index;
  const openEnd = openStart + match[0].length;
  if (match[1])
    return { openStart, openEnd, closeStart: openStart, closeEnd: openEnd, selfClosing: true };
  const tags = /<child\b[^>]*?(\/?)>|<\/child\s*>/g;
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(xml); tag; tag = tags.exec(xml)) {
    if (tag[0].startsWith('</')) depth--;
    else if (!tag[1]) depth++;
    if (depth === 0)
      return {
        openStart,
        openEnd,
        closeStart: tag.index,
        closeEnd: tag.index + tag[0].length,
        selfClosing: false,
      };
  }
  return undefined;
}

const lineStart = (text: string, index: number) => text.lastIndexOf('\n', index - 1) + 1;

/** The spaces in front of a tag that starts its own line. */
function indentOf(text: string, index: number) {
  const start = lineStart(text, index);
  const before = text.slice(start, index);
  return /^[ \t]*$/.test(before) ? { start, indent: before } : undefined;
}

/** Put a piece of XML just before a closing tag, keeping the file's line ending and indent. */
function insertBefore(xml: string, closeStart: number, lines: (indent: string) => string[]) {
  const newline = xml.includes('\r\n') ? '\r\n' : '\n';
  const own = indentOf(xml, closeStart);
  if (!own) return xml.slice(0, closeStart) + lines('').join('') + xml.slice(closeStart);
  const text = lines(own.indent + '  ')
    .map((line) => line + newline)
    .join('');
  return xml.slice(0, own.start) + text + xml.slice(own.start);
}

/**
 * Part 1, on the text of the settings file. Only the entry changes, so the rest stays byte for byte.
 * `problem`: the file does not look as measured, so it is left alone.
 */
export function setReadOnlyWarning(
  xml: string,
): { xml: string; changed: boolean; problem?: undefined } | { problem: 'no-options' } {
  const options = findChild(xml, 'Options', 0, xml.length);
  if (!options || options.selfClosing) return { problem: 'no-options' };
  const fileSettings = findChild(xml, 'FileSettings', options.openEnd, options.closeStart);
  if (!fileSettings)
    return {
      xml: insertBefore(xml, options.closeStart, (indent) => [
        `${indent}<child key="FileSettings">`,
        `${indent}  ${WARNING_ON}`,
        `${indent}</child>`,
      ]),
      changed: true,
    };
  if (fileSettings.selfClosing)
    return {
      xml:
        xml.slice(0, fileSettings.openStart) +
        `<child key="FileSettings">${WARNING_ON}</child>` +
        xml.slice(fileSettings.closeEnd),
      changed: true,
    };
  const entry = new RegExp(`<entry\\s+key="${WARNING_KEY}"\\s*(?:/>|>([^<]*)</entry>)`, 'g');
  entry.lastIndex = fileSettings.openEnd;
  const found = entry.exec(xml);
  if (found && found.index < fileSettings.closeStart) {
    if (found[1]?.trim().toLowerCase() === 'true' && found[0].startsWith('<entry key='))
      return { xml, changed: false };
    return {
      xml: xml.slice(0, found.index) + WARNING_ON + xml.slice(found.index + found[0].length),
      changed: true,
    };
  }
  return {
    xml: insertBefore(xml, fileSettings.closeStart, (indent) => [`${indent}${WARNING_ON}`]),
    changed: true,
  };
}

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

/** Part 1 on the real file: backup before the first change, and only if something changes. */
function applyWarning(context: StepContext, path: string) {
  const { files } = context.deps;
  const file = readForEdit(files, path);
  if (file.state === 'missing') return 'no-file' as const;
  if (file.state === 'read-error') return 'read-error' as const;
  if (file.state === 'not-text') return 'unreadable' as const;
  const result = setReadOnlyWarning(file.text);
  if (result.problem) return 'unreadable' as const;
  if (!result.changed) return 'done' as const;
  try {
    writeWithBackup(files, path, result.xml);
  } catch {
    return 'read-error' as const;
  }
  context.log.line('Rhino 읽기 전용 경고를 켰어요.');
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
  const warning = applyWarning(context, context.path(spec.settingsFile));
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
