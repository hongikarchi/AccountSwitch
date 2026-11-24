import { win32 } from 'node:path';

// SPEC 3.10: a Claude Code update that stopped after moving the old claude.exe aside and before
// putting the new one in its place. Read only; the repair is the `claude-restore` install step.

export interface StuckUpdate {
  /** Where claude.exe belongs. */
  target: string;
  /** The build the update was installing: `versions\<version>`. */
  build: string;
  version: string;
  /** Full paths of the `claude.exe.new.*` and `claude.exe.old.*` files. */
  leftovers: string[];
}

export interface FolderReader {
  exists: (path: string) => boolean;
  /** Names of the files directly inside a folder; empty when it cannot be read. */
  listFiles: (path: string) => string[];
}

const LEFTOVER = /^claude\.exe\.(new|old)\./i;
// Only a finished build is named by its version alone.
const BUILD = /^\d+\.\d+\.\d+$/;
const newestFirst = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true });

/** The native installer's folders, on Windows. */
export function claudeFolders(home: string) {
  return {
    bin: win32.join(home, '.local', 'bin'),
    versions: win32.join(home, '.local', 'share', 'claude', 'versions'),
  };
}

export function stuckClaudeUpdate(home: string, fs: FolderReader): StuckUpdate | undefined {
  const { bin, versions } = claudeFolders(home);
  const target = win32.join(bin, 'claude.exe');
  if (fs.exists(target)) return undefined;
  const leftovers = fs.listFiles(bin).filter((name) => LEFTOVER.test(name));
  if (!leftovers.length) return undefined;
  const version = fs
    .listFiles(versions)
    .filter((name) => BUILD.test(name))
    .sort(newestFirst)[0];
  if (!version) return undefined;
  return {
    target,
    build: win32.join(versions, version),
    version,
    leftovers: leftovers.map((name) => win32.join(bin, name)),
  };
}

export const stuckMessage = (version: string) =>
  `업데이트가 중간에 멈춰서 Claude Code가 빠졌어요. 받아 둔 새 버전(${version})으로 고칠 수 있어요. 계정은 그대로예요.`;
