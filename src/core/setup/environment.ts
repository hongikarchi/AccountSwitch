import { win32 } from 'node:path';
import { z } from 'zod';
import type { CommandRunner } from './commands.ts';

// PATH and the user's settings as Windows has them now (SPEC 3.5 step 1). The engine keeps the PATH
// it started with, which goes stale when something is installed while it runs. Reading only: the
// one thing changed is the engine's own PATH, in memory.

export type Env = Record<string, string | undefined>;

/** Look a variable up the way Windows does, in any letter case. */
export function getEnv(env: Env, name: string) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** Replace PATH, also in a plain copy of the environment (where the key may read `Path`). */
export function setEnginePath(env: Env, value: string) {
  env[Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'] = value;
}

/** Fill in %NAME% variables. A variable nobody knows stays as it is, so no such file is found. */
export function expandPath(template: string, env: Env, home: string, documents?: string) {
  const fallback: Record<string, string> = {
    userprofile: home,
    appdata: win32.join(home, 'AppData', 'Roaming'),
    localappdata: win32.join(home, 'AppData', 'Local'),
    programfiles: 'C:\\Program Files',
    systemroot: 'C:\\Windows',
    documents: documents ?? win32.join(home, 'Documents'),
  };
  return template.replace(/%([^%]+)%/g, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'documents') return fallback.documents;
    return getEnv(env, name) || fallback[lower] || whole;
  });
}

const snapshotSchema = z.object({
  machinePath: z.string().nullable(),
  userPath: z.string().nullable(),
  /** `userVariables` of the `env` item. */
  pythonUtf8: z.string().nullable(),
  documents: z.string().nullable(),
  /** Scope name to policy, from `Get-ExecutionPolicy -List`. */
  executionPolicy: z.record(z.string(), z.string()),
});
export type WindowsSnapshot = z.infer<typeof snapshotSchema>;

// .NET returns the two paths from HKLM\...\Session Manager\Environment and HKCU\Environment with
// their %VARIABLES% expanded. `reg query` would print them in the console code page, which breaks
// on a Korean user name, so the output is set to UTF-8 here.
const SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)',
  '$policy=@{}',
  'Get-ExecutionPolicy -List|ForEach-Object{$policy[$_.Scope.ToString()]=$_.ExecutionPolicy.ToString()}',
  "@{machinePath=[Environment]::GetEnvironmentVariable('Path','Machine');" +
    "userPath=[Environment]::GetEnvironmentVariable('Path','User');" +
    "pythonUtf8=[Environment]::GetEnvironmentVariable('PYTHONUTF8','User');" +
    "documents=[Environment]::GetFolderPath('MyDocuments');" +
    'executionPolicy=$policy}|ConvertTo-Json -Compress',
].join(';');
const SNAPSHOT_TIMEOUT_MS = 15000;

/** Undefined when PowerShell cannot answer; the caller then keeps what it has. */
export async function readWindowsSnapshot(run: CommandRunner, env: Env, home: string) {
  const result = await run({
    program: expandPath(
      '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      env,
      home,
    ),
    args: ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT_SCRIPT],
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
  });
  if (result.code !== 0) return undefined;
  try {
    return snapshotSchema.parse(JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))));
  } catch {
    return undefined;
  }
}

/** Machine then user, expanded, each folder once. Undefined when the registry gave nothing. */
export function rebuildPath({ machinePath, userPath }: WindowsSnapshot, env: Env, home: string) {
  const seen = new Set<string>();
  const folders = `${machinePath ?? ''};${userPath ?? ''}`
    .split(';')
    .map((folder) => expandPath(folder.trim().replace(/^"(.*)"$/, '$1'), env, home))
    .filter((folder) => {
      const key = folder.toLowerCase();
      if (!folder || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return folders.length ? folders.join(';') : undefined;
}

/** Whether a folder is on a `;` list, ignoring letter case and a trailing backslash. */
export function pathHasFolder(list: string | null | undefined, folder: string) {
  const normal = (value: string) =>
    value
      .trim()
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  return (list ?? '').split(';').some((entry) => normal(entry) === normal(folder));
}
