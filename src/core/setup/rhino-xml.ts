// Edits of Rhino's settings file for SPEC 3.8 parts 1 and 2, on its text, so every byte outside the
// edit stays as it was. Shared by the check and the install. Measured on Rhino 8 (2026-11-09):
// Rhino leaves out an entry that holds its default when it saves, and the read-only warning is on by
// default, so a missing warning entry means on.

const WARNING_KEY = 'EnableFileLockingOpenWarning';
const WARNING_ON = `<entry key="${WARNING_KEY}">True</entry>`;
const STARTUP_KEY = 'StartupCommands';

interface Range {
  /** Where `<child ...>` starts and ends. */
  openStart: number;
  openEnd: number;
  /** Where `</child>` starts and ends; equal to the open tag's for `<child ... />`. */
  closeStart: number;
  closeEnd: number;
  selfClosing: boolean;
}

const CHILD_TAGS = /<child\b([^>]*?)(\/?)>|<\/child\s*>/g;

/** Where a `<child>` that opens at `openStart` (its tag ending at `openEnd`) closes. */
function closeOf(xml: string, openStart: number, openEnd: number): Range | undefined {
  const tags = new RegExp(CHILD_TAGS.source, 'g');
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(xml); tag; tag = tags.exec(xml)) {
    if (tag[0].startsWith('</')) depth--;
    else if (!tag[2]) depth++;
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

/**
 * The `<child key="...">` directly inside the stretch from `from` to `to`, not one nested deeper.
 * The whole file counts as one stretch whose direct children are its outermost ones.
 */
function findChild(xml: string, key: string, from: number, to: number): Range | undefined {
  const tags = new RegExp(CHILD_TAGS.source, 'g');
  tags.lastIndex = from;
  let depth = 0;
  for (let tag = tags.exec(xml); tag && tag.index < to; tag = tags.exec(xml)) {
    if (tag[0].startsWith('</')) {
      depth--;
      continue;
    }
    const matches = new RegExp(`^\\s+key="${key}"`).test(tag[1]);
    if (matches && depth === 0) {
      const openStart = tag.index;
      const openEnd = openStart + tag[0].length;
      if (tag[2])
        return { openStart, openEnd, closeStart: openStart, closeEnd: openEnd, selfClosing: true };
      return closeOf(xml, openStart, openEnd);
    }
    if (!tag[2]) depth++;
  }
  return undefined;
}

/** `<settings>` → `<settings>` → `<child key="Options">`, as Rhino 8 writes it; or anywhere. */
function findOptions(xml: string) {
  const anywhere = /<child\s+key="Options"[^>]*?(\/?)>/.exec(xml);
  if (!anywhere) return undefined;
  const openEnd = anywhere.index + anywhere[0].length;
  if (anywhere[1])
    return {
      openStart: anywhere.index,
      openEnd,
      closeStart: anywhere.index,
      closeEnd: openEnd,
      selfClosing: true,
    };
  return closeOf(xml, anywhere.index, openEnd);
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

/** The entry `key` directly in `child`, with its text (undefined for `<entry ... />`). */
function findEntry(xml: string, child: Range, key: string) {
  if (child.selfClosing) return undefined;
  const entry = new RegExp(`<entry\\s+key="${key}"\\s*(?:/>|>([^<]*)</entry>)`, 'g');
  entry.lastIndex = child.openEnd;
  for (
    let found = entry.exec(xml);
    found && found.index < child.closeStart;
    found = entry.exec(xml)
  )
    // An entry inside a deeper child is not this child's.
    if (isDirect(xml, child, found.index))
      return { start: found.index, end: found.index + found[0].length, value: found[1] };
  return undefined;
}

/** Whether `index` sits directly in `child`, outside every child nested in it. */
function isDirect(xml: string, child: Range, index: number) {
  const tags = new RegExp(CHILD_TAGS.source, 'g');
  tags.lastIndex = child.openEnd;
  let depth = 0;
  for (let tag = tags.exec(xml); tag && tag.index < index; tag = tags.exec(xml)) {
    if (tag[0].startsWith('</')) depth--;
    else if (!tag[2]) depth++;
  }
  return depth === 0;
}

type Edit = { xml: string; changed: boolean; problem?: undefined } | { problem: 'no-options' };

/** Part 1: on unless Options → FileSettings holds the entry with another value than True. */
export function readOnlyWarningOn(xml: string) {
  const options = findOptions(xml);
  if (!options || options.selfClosing) return true;
  const fileSettings = findChild(xml, 'FileSettings', options.openEnd, options.closeStart);
  if (!fileSettings) return true;
  const entry = findEntry(xml, fileSettings, WARNING_KEY);
  return !entry || entry.value?.trim().toLowerCase() === 'true';
}

/**
 * Part 1, on the text of the settings file. Only an entry that turns the warning off changes; a
 * missing one is Rhino's default, on. `problem`: the file does not look as measured, so it is left
 * alone.
 */
export function setReadOnlyWarning(xml: string): Edit {
  const options = findOptions(xml);
  if (!options || options.selfClosing) return { problem: 'no-options' };
  if (readOnlyWarningOn(xml)) return { xml, changed: false };
  const fileSettings = findChild(xml, 'FileSettings', options.openEnd, options.closeStart)!;
  const entry = findEntry(xml, fileSettings, WARNING_KEY)!;
  return { xml: xml.slice(0, entry.start) + WARNING_ON + xml.slice(entry.end), changed: true };
}

/** `_mcpstart`, `-_McpStart` and `mcpstart` are one command to Rhino. */
const bare = (command: string) => command.replace(/^[_\-!']+/, '').toLowerCase();

/** The text of Options → General → StartupCommands, or undefined when there is none. */
function startupCommands(xml: string) {
  const options = findOptions(xml);
  if (!options || options.selfClosing) return undefined;
  const general = findChild(xml, 'General', options.openEnd, options.closeStart);
  return general && findEntry(xml, general, STARTUP_KEY);
}

/** Part 2: whether Rhino runs `command` when it starts. */
export function hasStartupCommand(xml: string, command: string) {
  const value = startupCommands(xml)?.value ?? '';
  return value.split(/\s+/).some((word) => word && bare(word) === bare(command));
}

/**
 * Part 2: `command` appended to Rhino's "run these commands every time Rhino starts" list, once,
 * after what the user put there. The entry and its `General` go where Rhino puts them.
 */
export function addStartupCommand(xml: string, command: string): Edit {
  const options = findOptions(xml);
  if (!options || options.selfClosing) return { problem: 'no-options' };
  if (hasStartupCommand(xml, command)) return { xml, changed: false };
  const entryOf = (value: string) => `<entry key="${STARTUP_KEY}">${value}</entry>`;
  const general = findChild(xml, 'General', options.openEnd, options.closeStart);
  if (!general)
    return {
      xml: insertBefore(xml, options.closeStart, (indent) => [
        `${indent}<child key="General">`,
        `${indent}  ${entryOf(command)}`,
        `${indent}</child>`,
      ]),
      changed: true,
    };
  if (general.selfClosing)
    return {
      xml:
        xml.slice(0, general.openStart) +
        `<child key="General">${entryOf(command)}</child>` +
        xml.slice(general.closeEnd),
      changed: true,
    };
  const entry = findEntry(xml, general, STARTUP_KEY);
  if (!entry)
    return {
      xml: insertBefore(xml, general.closeStart, (indent) => [`${indent}${entryOf(command)}`]),
      changed: true,
    };
  const mine = entry.value?.trimEnd() ?? '';
  const value = mine ? `${mine} ${command}` : command;
  return { xml: xml.slice(0, entry.start) + entryOf(value) + xml.slice(entry.end), changed: true };
}
