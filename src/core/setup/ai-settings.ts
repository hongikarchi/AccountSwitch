import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { AiContent } from './ai-content.ts';
import type { AiSettingsAction, AiSettingsMode, AiSettingsRow } from './types.ts';

// SPEC 3.11: the plan of the AI work settings against this PC, and applying it. The plan only
// reads; applying backs up what it replaces before writing it.

export const PREFS_FILE = 'ai-settings.json';
/** In a skill folder AccountSwitch wrote: what it wrote, by SHA-256. */
export const SKILL_MANIFEST = '.accountswitch-managed.json';
const PLACEHOLDER = '{{branchPrefix}}';
/** AccountSwitch's own marked blocks inside a rule file, such as the Rhino note of SPEC 3.8. */
const OWN_BLOCK =
  /<!-- accountswitch(?::[a-z0-9-]+)?:start -->[\s\S]*?<!-- accountswitch(?::[a-z0-9-]+)?:end -->/g;

export interface AiPrefs {
  branchPrefix: string | null;
  mode: AiSettingsMode;
  /** Row ids the user switched to 내 것 유지; they stay so until the next save. */
  keep: string[];
  /** Rule files AccountSwitch wrote, by row id, as `ruleHash` of what was written. */
  written: Record<string, string>;
}

export const DEFAULT_PREFS: AiPrefs = { branchPrefix: null, mode: 'fill', keep: [], written: {} };

/** `ai-settings.json` of the data folder; anything unreadable counts as nothing saved. */
export function parsePrefs(bytes: Buffer | undefined): AiPrefs {
  if (!bytes) return { ...DEFAULT_PREFS };
  try {
    const value = JSON.parse(bytes.toString('utf8')) as Partial<AiPrefs>;
    return {
      branchPrefix: typeof value.branchPrefix === 'string' ? value.branchPrefix : null,
      mode: value.mode === 'replace' ? 'replace' : 'fill',
      keep: Array.isArray(value.keep) ? value.keep.filter((id) => typeof id === 'string') : [],
      written:
        value.written && typeof value.written === 'object'
          ? Object.fromEntries(
              Object.entries(value.written).filter(([, hash]) => typeof hash === 'string'),
            )
          : {},
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const prefsText = (prefs: AiPrefs) =>
  JSON.stringify({ version: 1, ...prefs }, null, 2) + '\n';

export type PaseoState =
  | { kind: 'missing' }
  | { kind: 'unreadable' }
  | { kind: 'ok'; config: Record<string, unknown> };

/** What the plan reads of the PC. */
export interface AiReader {
  platform: string;
  home: string;
  read: (path: string) => Buffer | undefined;
  exists: (path: string) => boolean;
  /** Codex CLI is there, so its rule file and skills folder get a copy. */
  codex: boolean;
  paseo: PaseoState;
}

/** What applying a row writes. */
export type AiApply =
  | { kind: 'file'; path: string; text: string; hash?: string }
  | { kind: 'skill'; folder: string; files: [string, string][] }
  | { kind: 'paseo'; sets: { path: string; value: unknown }[] };

export type PlannedRow = AiSettingsRow & { apply?: AiApply };

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const normal = (text: string) => text.replace(/\r\n/g, '\n');
/** A rule file without AccountSwitch's own blocks, so a Rhino note added later is no change. */
export const ruleHash = (text: string) =>
  sha256(normal(text).replace(OWN_BLOCK, '').replace(/\s+$/, ''));
/** The content, then the blocks of the file it replaces, in their order. */
export function composeRules(content: string, current: string | undefined) {
  const blocks = current ? (normal(current).match(OWN_BLOCK) ?? []) : [];
  return content.replace(/\s+$/, '') + '\n' + blocks.map((block) => `\n${block}\n`).join('');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `ours` merged into `current`: 채워 넣기 adds what is missing, 바꾸기 also sets what differs. */
export function mergeSettings(
  current: Record<string, unknown>,
  ours: Record<string, unknown>,
  mode: AiSettingsMode,
  at = '',
): { result: Record<string, unknown>; changed: string[] } {
  const result: Record<string, unknown> = { ...current };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(ours)) {
    const path = at ? `${at}.${key}` : key;
    if (!Object.hasOwn(result, key)) {
      result[key] = value;
      changed.push(path);
    } else if (isObject(value) && isObject(result[key])) {
      const inner = mergeSettings(result[key], value, mode, path);
      result[key] = inner.result;
      changed.push(...inner.changed);
    } else if (mode === 'replace' && !equal(result[key], value)) {
      result[key] = value;
      changed.push(path);
    }
  }
  return { result, changed };
}

/** Every leaf of a config, an array counting as one. */
export function leaves(
  value: Record<string, unknown>,
  at = '',
): { path: string; value: unknown }[] {
  return Object.entries(value).flatMap(([key, inner]) => {
    const path = at ? `${at}.${key}` : key;
    return isObject(inner) ? leaves(inner, path) : [{ path, value: inner }];
  });
}
const lookup = (value: unknown, path: string) =>
  path.split('.').reduce<unknown>((at, key) => (isObject(at) ? at[key] : undefined), value);

const listed = (changed: string[]) =>
  changed.length > 3
    ? `${changed.slice(0, 3).join(', ')} 외 ${changed.length - 3}개`
    : changed.join(', ');

export interface Places {
  rules: string;
  agentsRules: string;
  settings: string;
  skills: string;
  agentsSkills: string;
  paseoConfig: string;
  /** How a place is shown: `~` for the home folder. */
  show: (path: string) => string;
  join: (...parts: string[]) => string;
}

export function placesOf(platform: string, home: string, paseoHome?: string): Places {
  const path = platform === 'win32' ? win32 : posix;
  return {
    rules: path.join(home, '.claude', 'CLAUDE.md'),
    agentsRules: path.join(home, '.codex', 'AGENTS.md'),
    settings: path.join(home, '.claude', 'settings.json'),
    skills: path.join(home, '.claude', 'skills'),
    agentsSkills: path.join(home, '.agents', 'skills'),
    paseoConfig: path.join(paseoHome || path.join(home, '.paseo'), 'config.json'),
    // With `/`: Korean fonts draw `\` as ₩, which read as a currency sign in the plan.
    show: (place) =>
      (place.toLowerCase().startsWith(home.toLowerCase())
        ? '~' + place.slice(home.length)
        : place
      ).replaceAll('\\', '/'),
    join: (...parts) => path.join(...parts),
  };
}

const fillPrefix = (text: string, prefix: string) => text.replaceAll(PLACEHOLDER, prefix);
/** A file that decodes and encodes back to the same bytes, with no NUL (SPEC 3.8's rule). */
const plainText = (bytes: Buffer) =>
  !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);

function rulesRow(
  id: string,
  label: string,
  path: string,
  reader: AiReader,
  places: Places,
  content: string,
  prefs: AiPrefs,
): PlannedRow {
  const base = { id, part: 'rules' as const, target: places.show(path) };
  const bytes = reader.read(path);
  if (!bytes) {
    const text = composeRules(content, undefined);
    return {
      ...base,
      action: 'add',
      canKeep: true,
      apply: { kind: 'file', path, text, hash: ruleHash(text) },
    };
  }
  if (!plainText(bytes))
    return {
      ...base,
      action: 'skip',
      canKeep: false,
      detail: `${label}이 UTF-8 파일이 아니라서 그대로 둬요.`,
    };
  const current = bytes.toString('utf8');
  const text = composeRules(content, current);
  if (normal(current) === text) return { ...base, action: 'same', canKeep: false };
  const recorded = prefs.written[id];
  const apply: AiApply = { kind: 'file', path, text, hash: ruleHash(text) };
  if (!recorded)
    return { ...base, action: 'replace', canKeep: true, detail: '원래 파일은 백업해요.', apply };
  if (recorded === ruleHash(current)) return { ...base, action: 'update', canKeep: true, apply };
  return prefs.mode === 'replace'
    ? {
        ...base,
        action: 'replace',
        canKeep: true,
        detail: '직접 고친 내용은 백업에 남아요.',
        apply,
      }
    : { ...base, action: 'keep', canKeep: false, detail: '직접 고친 파일이라 그대로 둬요.' };
}

function settingsRow(reader: AiReader, places: Places, content: string, mode: AiSettingsMode) {
  const path = places.settings;
  const base = { id: 'settings', part: 'settings' as const, target: places.show(path) };
  const ours = JSON.parse(content) as Record<string, unknown>;
  const bytes = reader.read(path);
  if (!bytes)
    return {
      ...base,
      action: 'add',
      canKeep: true,
      apply: { kind: 'file', path, text: JSON.stringify(ours, null, 2) + '\n' },
    } satisfies PlannedRow;
  let current: unknown;
  try {
    current = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
  } catch {
    current = undefined;
  }
  if (!isObject(current))
    return {
      ...base,
      action: 'skip',
      canKeep: false,
      detail: 'JSON으로 읽을 수 없는 파일이라 그대로 둬요.',
    } satisfies PlannedRow;
  const { result, changed } = mergeSettings(current, ours, mode);
  if (!changed.length) return { ...base, action: 'same', canKeep: false } satisfies PlannedRow;
  const indent = /^([ \t]+)"/m.exec(bytes.toString('utf8'))?.[1] ?? '  ';
  return {
    ...base,
    action: mode === 'fill' ? 'fill' : 'replace',
    canKeep: true,
    detail: listed(changed),
    apply: { kind: 'file', path, text: JSON.stringify(result, null, indent) + '\n' },
  } satisfies PlannedRow;
}

function skillRow(
  id: string,
  folder: string,
  files: [string, string][],
  reader: AiReader,
  places: Places,
  mode: AiSettingsMode,
): PlannedRow {
  const base = { id, part: 'skill' as const, target: places.show(folder) };
  const apply: AiApply = { kind: 'skill', folder, files };
  const at = (relative: string) => places.join(folder, ...relative.split('/'));
  // A skill is there when its manifest or one of its files is; every skill has a SKILL.md.
  const there = [SKILL_MANIFEST, ...files.map(([relative]) => relative)].some(
    (relative) => reader.read(at(relative)) !== undefined,
  );
  if (!there) return { ...base, action: 'add', canKeep: true, apply };
  let manifest: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(reader.read(at(SKILL_MANIFEST))?.toString('utf8') ?? '');
    manifest = isObject(parsed) && isObject(parsed.files) ? parsed.files : undefined;
  } catch {
    manifest = undefined;
  }
  const ours =
    !!manifest &&
    Object.entries(manifest).every(([relative, hash]) => {
      const bytes = reader.read(at(relative));
      return !!bytes && sha256(bytes) === hash;
    });
  if (ours) {
    const same = files.every(
      ([relative, text]) => reader.read(at(relative))?.toString('utf8') === text,
    );
    return same
      ? { ...base, action: 'same', canKeep: false }
      : { ...base, action: 'update', canKeep: true, apply };
  }
  return mode === 'replace'
    ? { ...base, action: 'replace', canKeep: true, detail: '원래 스킬은 백업해요.', apply }
    : {
        ...base,
        action: 'keep',
        canKeep: false,
        detail: '직접 고쳤거나 다른 곳에서 온 스킬이라 그대로 둬요.',
      };
}

function paseoRow(reader: AiReader, places: Places, content: string, mode: AiSettingsMode) {
  const base = { id: 'paseo', part: 'paseo' as const, target: places.show(places.paseoConfig) };
  if (reader.paseo.kind === 'missing')
    return {
      ...base,
      action: 'skip',
      canKeep: false,
      detail: 'Paseo가 없어서 건너뛰어요.',
    } satisfies PlannedRow;
  if (reader.paseo.kind === 'unreadable')
    return {
      ...base,
      action: 'skip',
      canKeep: false,
      detail: 'Paseo 설정을 읽지 못해서 그대로 둬요.',
    } satisfies PlannedRow;
  const { config } = reader.paseo;
  const ours = JSON.parse(content) as Record<string, unknown>;
  const sets: { path: string; value: unknown }[] = [];
  // Paseo sets the keys of a map only with the whole map (measured: "Replace its containing
  // object with JSON for dynamic keys"), so the user's own entries are merged in first.
  for (const path of PASEO_MAPS) {
    const value = lookup(ours, path);
    if (!isObject(value)) continue;
    const current = lookup(config, path);
    const { result, changed } = mergeSettings(isObject(current) ? current : {}, value, mode);
    if (changed.length) sets.push({ path, value: result });
  }
  for (const leaf of leaves(withoutPaths(ours, PASEO_MAPS))) {
    const current = lookup(config, leaf.path);
    if (current === undefined || (mode === 'replace' && !equal(current, leaf.value)))
      sets.push(leaf);
  }
  if (!sets.length) return { ...base, action: 'same', canKeep: false } satisfies PlannedRow;
  return {
    ...base,
    action: mode === 'fill' ? 'fill' : 'replace',
    canKeep: true,
    detail: listed(sets.map(({ path }) => path)),
    apply: { kind: 'paseo', sets },
  } satisfies PlannedRow;
}

/** Paseo's config keys whose children are names, not fixed keys (its `agents.providers`). */
const PASEO_MAPS = ['agents.providers'];

/** A copy without these dotted paths. */
function withoutPaths(value: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  const copy = structuredClone(value);
  for (const path of paths) {
    const keys = path.split('.');
    const parent = lookup(copy, keys.slice(0, -1).join('.'));
    const target = keys.length > 1 ? parent : copy;
    if (isObject(target)) delete target[keys.at(-1) as string];
  }
  return copy;
}

/** Skill folders of the content, each with its files (relative to the folder) and their text. */
function skillsOf(content: AiContent, prefix: string) {
  const skills = new Map<string, [string, string][]>();
  for (const [path, text] of content) {
    const match = /^claude\/skills\/([^/]+)\/(.+)$/.exec(path);
    if (!match) continue;
    const [, name, relative] = match;
    skills.set(name, [...(skills.get(name) ?? []), [relative, fillPrefix(text, prefix)]]);
  }
  return [...skills.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** The plan: one row per target, in a fixed order (SPEC 3.11). Reads only. */
export function planAiSettings(
  content: AiContent,
  reader: AiReader,
  prefs: AiPrefs & { branchPrefix: string },
  paseoHome?: string,
): PlannedRow[] {
  const places = placesOf(reader.platform, reader.home, paseoHome);
  const prefix = prefs.branchPrefix;
  const rules = fillPrefix(content.get('claude/CLAUDE.md') ?? '', prefix);
  const rows: PlannedRow[] = [
    rulesRow('rules:claude', '전체 규칙', places.rules, reader, places, rules, prefs),
  ];
  rows.push(
    reader.codex
      ? rulesRow('rules:codex', 'GPT 규칙', places.agentsRules, reader, places, rules, prefs)
      : {
          id: 'rules:codex',
          part: 'rules',
          target: places.show(places.agentsRules),
          action: 'skip',
          canKeep: false,
          detail: 'GPT(Codex CLI)가 없어서 건너뛰어요.',
        },
  );
  rows.push(settingsRow(reader, places, content.get('claude/settings.json') ?? '{}', prefs.mode));
  const skills = skillsOf(content, prefix);
  for (const [name, files] of skills)
    rows.push(
      skillRow(
        `skill:${name}`,
        places.join(places.skills, name),
        files,
        reader,
        places,
        prefs.mode,
      ),
    );
  if (reader.codex)
    for (const [name, files] of skills)
      rows.push(
        skillRow(
          `agents-skill:${name}`,
          places.join(places.agentsSkills, name),
          files,
          reader,
          places,
          prefs.mode,
        ),
      );
  else
    rows.push({
      id: 'agents-skills',
      part: 'skill',
      target: places.show(places.agentsSkills),
      action: 'skip',
      canKeep: false,
      detail: 'GPT(Codex CLI)가 없어서 건너뛰어요.',
    });
  rows.push(paseoRow(reader, places, content.get('paseo/config.json') ?? '{}', prefs.mode));
  return rows;
}

const SETTLED: AiSettingsAction[] = ['same', 'skip', 'keep'];
/** Rows still to do: neither settled nor switched to 내 것 유지 by the user. */
export const pendingRows = (rows: PlannedRow[], keep: string[]) =>
  rows.filter((row) => !SETTLED.includes(row.action) && !keep.includes(row.id));

/** What the check and the page call a row. */
export function rowLabel(row: AiSettingsRow) {
  if (row.id === 'rules:claude') return '전체 규칙';
  if (row.id === 'rules:codex') return 'GPT 규칙';
  if (row.id === 'settings') return 'Claude 설정';
  if (row.id === 'paseo') return 'Paseo 설정';
  if (row.id === 'agents-skills') return 'GPT 스킬';
  const [kind, name] = row.id.split(':');
  return kind === 'agents-skill' ? `GPT 스킬 ${name}` : `스킬 ${name}`;
}

/** The page's view of a row: what applying it would write stays in the engine. */
export const publicRow = ({ apply: _apply, ...row }: PlannedRow): AiSettingsRow => row;

/** Where a target goes inside the backup folder: `claude/…`, `codex/…`, `agents/…`, `paseo/…`. */
export function backupName(home: string, path: string, paseoConfig: string, join: Places['join']) {
  if (path === paseoConfig) return join('paseo', 'config.json');
  const inside = path.slice(home.length).replace(/^[\\/]+/, '');
  const [first, ...rest] = inside.split(/[\\/]/);
  return join(first.replace(/^\./, ''), ...rest);
}

export interface AiWriter {
  read: (path: string) => Buffer | undefined;
  write: (path: string, data: string) => void;
  copy: (from: string, to: string) => void;
  exists: (path: string) => boolean;
  /** Every file under a folder, by its path relative to it with `/`. */
  filesUnder: (folder: string) => string[];
  /** Runs Paseo's CLI with these arguments; the exit code tells. */
  paseo: (args: string[]) => Promise<{ code: number | null }>;
  log: (line: string) => void;
  backupFolder: string;
}

export interface AiOutcome {
  written: Record<string, string>;
  done: string[];
  failed: { id: string; message: string }[];
  backedUp: boolean;
}

/** Back up, then write, every row still to do. A row whose backup fails writes nothing. */
export async function applyAiSettings(
  rows: PlannedRow[],
  keep: string[],
  writer: AiWriter,
  places: Places,
  home: string,
  previous: Record<string, string>,
): Promise<AiOutcome> {
  const outcome: AiOutcome = { written: { ...previous }, done: [], failed: [], backedUp: false };
  const backup = (path: string) => {
    const to = places.join(
      writer.backupFolder,
      backupName(home, path, places.paseoConfig, places.join),
    );
    writer.copy(path, to);
    outcome.backedUp = true;
  };
  for (const row of pendingRows(rows, keep)) {
    const { apply } = row;
    if (!apply) continue;
    try {
      if (apply.kind === 'file') {
        if (writer.read(apply.path) !== undefined) backup(apply.path);
        writer.write(apply.path, apply.text);
        if (apply.hash) outcome.written[row.id] = apply.hash;
      } else if (apply.kind === 'skill') {
        if (writer.exists(apply.folder))
          for (const relative of writer.filesUnder(apply.folder))
            backup(places.join(apply.folder, ...relative.split('/')));
        const hashes: Record<string, string> = {};
        for (const [relative, text] of apply.files) {
          writer.write(places.join(apply.folder, ...relative.split('/')), text);
          hashes[relative] = sha256(text);
        }
        writer.write(
          places.join(apply.folder, SKILL_MANIFEST),
          JSON.stringify({ version: 1, files: hashes }, null, 2) + '\n',
        );
      } else {
        if (writer.read(places.paseoConfig) !== undefined) backup(places.paseoConfig);
        for (const { path, value } of apply.sets) {
          const result = await writer.paseo([
            'daemon',
            'config',
            'set',
            path,
            JSON.stringify(value),
          ]);
          if (result.code !== 0) throw new Error(`paseo daemon config set ${path}`);
        }
        // A daemon that is not running reads the file when it starts; that is no failure.
        const reloaded = await writer.paseo(['reload']);
        if (reloaded.code !== 0) writer.log('Paseo가 켜져 있지 않아서 다음에 켤 때 적용돼요.');
      }
      outcome.done.push(row.id);
      writer.log(`${rowLabel(row)}: ${row.action} (${row.target})`);
    } catch (error) {
      const message = `${rowLabel(row)}을(를) 넣지 못했어요.`;
      writer.log(`${message} ${(error as Error).message}`);
      outcome.failed.push({ id: row.id, message });
    }
  }
  return outcome;
}
