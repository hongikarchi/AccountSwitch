import { readdirSync, readFileSync } from 'node:fs';
import { getAsset, isSea } from 'node:sea';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// SPEC 3.11, bundling: the AI work settings of `setup-content/`. From source they are read from
// that folder; in the packaged engine from its SEA assets, listed by `setup-content/index.json`
// (scripts/build-exe.mjs).

/** Relative paths with `/`, such as `claude/skills/ui-review/SKILL.md`, to their text. */
export type AiContent = Map<string, string>;

export const CONTENT_INDEX = 'setup-content/index.json';

function walk(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)],
  );
}

/** Every file of a content folder, by its path relative to that folder. */
export function readContentFolder(root: string): AiContent {
  return new Map(
    walk(root).map((file) => [
      relative(root, file).replaceAll('\\', '/'),
      readFileSync(file, 'utf8'),
    ]),
  );
}

let loaded: AiContent | undefined;

export function loadAiContent(): AiContent {
  if (loaded) return loaded;
  if (isSea()) {
    const index = JSON.parse(getAsset(CONTENT_INDEX, 'utf8')) as string[];
    loaded = new Map(index.map((path) => [path, getAsset(`setup-content/${path}`, 'utf8')]));
  } else {
    loaded = readContentFolder(fileURLToPath(new URL('../../../setup-content/', import.meta.url)));
  }
  return loaded;
}
