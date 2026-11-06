// The shapes of the setup catalog and of /api/v1/setup. Types only and no Node imports, so the page
// can `import type` from here. Everything in the catalog is plain data that survives JSON.

export type SetupGroupId = 'base' | 'py-gis' | 'py-3d' | 'py-hwp' | 'rhino' | 'blender';

export interface SetupGroup {
  id: SetupGroupId;
  label: string;
  description: string;
  /** Optional groups stay unchecked until the user ticks the group (SPEC 3.3). */
  optional: boolean;
}

/** One version command. `versionPattern` is a regular expression whose first group is the version. */
export interface VersionCommand {
  program: string;
  args: string[];
  versionPattern?: string;
}

// Paths below may hold %NAME% variables, plus %DOCUMENTS% for the user's real Documents folder.
export type CheckSpec =
  /** Every command must succeed; the first one gives the version. */
  | {
      kind: 'command';
      commands: VersionCommand[];
      /** Folders to look in when the program is not on PATH (SPEC 3.5 step 2). */
      knownFolders: string[];
      /** Also installed when one of these files exists, even if the command fails. */
      orFilesExist?: string[];
      /**
       * Which found versions count as fine, when wider than what gets installed: Node installs
       * exactly 24.22.1, but any 24.x is left alone. Without it, the item's `pinnedVersion`.
       */
      acceptVersion?: string;
    }
  /** Installed when `executable(provider)` in src/core/cli.ts resolves. */
  | { kind: 'cli'; provider: 'claude-cli' | 'codex-cli'; versionPattern: string }
  | {
      kind: 'environment';
      /** Must be on the user PATH. */
      userPathFolder: string;
      /** User variables that must hold these values. */
      userVariables: Record<string, string>;
      /** CurrentUser execution policies that allow local scripts. */
      allowedPolicies: string[];
    }
  /** `py -<python> -m pip show` must find every package. */
  | {
      kind: 'pip';
      launcher: string;
      knownFolders: string[];
      python: string;
      packages: string[];
    }
  | { kind: 'file'; path: string }
  /** `<root>\<version>[\<marker>]` must exist; another version folder means 버전 다름. */
  | { kind: 'versioned-folder'; root: string; version: string; marker?: string }
  /** A user-scope server in `~/.claude.json`, read inside DefaultLogin.exclusive (SPEC 3.7). */
  | {
      kind: 'mcp';
      name: string;
      /** Package and version expected in the registered command (uvx servers). */
      package?: string;
      version?: string;
      /** Address expected of an HTTP server. */
      url?: string;
    }
  /** Blender only ever runs from its known folder, `--version` only. */
  | {
      kind: 'blender';
      root: string;
      folderPattern: string;
      preferredFolder: string;
      program: string;
      versionPattern: string;
    }
  /** A module file in the add-ons folder that is also listed in userpref.blend. */
  | { kind: 'blender-addon'; addonsFolder: string; userPrefs: string; module: string }
  /** The four parts of SPEC 3.8. */
  | {
      kind: 'rhino-settings';
      settingsFile: string;
      /** Regular expression: the read-only warning is on. */
      readOnlyWarningPattern: string;
      /** Regular expression: `mcpstart` is in the start-up commands. */
      startupCommandPattern: string;
      starterFile: string;
      roleNoteFile: string;
      roleNoteStart: string;
      roleNoteEnd: string;
    };

/**
 * What an install step does, for the runner (T-040). The checks never execute these.
 * `declinedExitCodes`: the exit codes that mean the user said no to the elevation prompt, which ends
 * the item as ELEVATION_DECLINED and does not start the fallback (SPEC 3.6).
 */
export type InstallStep =
  /** `<program> <args>`; the arguments are complete, standard flags included (SPEC 3.3). */
  | { kind: 'winget'; program: string; id: string; args: string[]; declinedExitCodes: number[] }
  /** `irm <url> | iex`. `insideClaudeLock`: inside DefaultLogin.exclusive (SPEC 3.7). */
  | { kind: 'powershell-script'; url: string; insideClaudeLock?: boolean }
  /** Download `url`, then run `<program> <args>`, where `<file>` stands for the download. */
  | {
      kind: 'download-installer';
      url: string;
      program: string;
      args: string[];
      declinedExitCodes: number[];
    }
  | { kind: 'npm-global'; package: string }
  | { kind: 'pip'; launcher: string; python: string; packages: string[] }
  /** `<program> install <package> <version>` */
  | { kind: 'yak'; program: string; package: string; version: string }
  /** `claude <args>` inside DefaultLogin.exclusive (SPEC 3.7). */
  | { kind: 'claude-mcp-add'; args: string[] }
  | {
      kind: 'environment';
      userPathFolder: string;
      userVariables: Record<string, string>;
      executionPolicy: string;
    }
  /**
   * Download `url`, refuse it unless it hashes to `sha256`, save it as `saveAs` and let `blender`
   * install and enable `module` with telemetry consent off. Never `--factory-startup` (SPEC 3.3).
   */
  | {
      kind: 'blender-addon';
      url: string;
      sha256: string;
      saveAs: string;
      module: string;
      blender: string;
    }
  | { kind: 'rhino-settings' }
  /** Nothing to run: tell the user what to do. */
  | { kind: 'manual'; message: string; url?: string };

export interface InstallSpec {
  /** One Korean line on how this gets installed. */
  summary: string;
  /** False when the user has to do it (Rhino). */
  automatic: boolean;
  /** Shown before installing when another version of this program was found (SPEC 3.3). */
  warnIfOtherVersion?: string;
  /** Tried in order: a later step is the fallback of the one before. */
  steps: InstallStep[];
  /**
   * After a run reaches this item: a folder holding its program and on no PATH gets appended to the
   * user PATH (SPEC 3.5 step 4). `folder` may hold %NAME% variables and stays that way in the registry.
   */
  pathFolders?: { folder: string; program: string }[];
}

export interface SetupItem {
  id: string;
  label: string;
  description: string;
  group: SetupGroupId;
  dependsOn: string[];
  check: CheckSpec;
  install: InstallSpec;
  /** `latest`, a series such as `24.x`, an exact version, or null when versions do not apply. */
  pinnedVersion: string | null;
  mayElevate: boolean;
}

export interface SetupCatalog {
  groups: SetupGroup[];
  items: SetupItem[];
}

/**
 * - `installed`: 설치됨.
 * - `missing`: not there (or, with `parts` / `missingPackages`, not complete).
 * - `version-mismatch`: 버전 다름, there but not the pinned version. Auto mode leaves it alone.
 * - `timeout`: a command did not answer in time, so the state is unknown.
 * - `error`: could not be checked, so the state is unknown.
 * - `unsupported`: this platform has no setup feature.
 */
export type CheckStatus =
  | 'installed'
  | 'missing'
  | 'version-mismatch'
  | 'timeout'
  | 'error'
  | 'unsupported';

/** One condition of an item that has several (`env`, `rhino-settings`, `blender-mcp-addon`). */
export interface CheckPart {
  id: string;
  label: string;
  ok: boolean;
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  /** The version found on this PC, when there is one to report. */
  foundVersion?: string;
  /** The item's pin, repeated so a row can show "found / wanted". */
  pinnedVersion: string | null;
  /** A plain Korean sentence for the user, when the status alone does not explain it. */
  message?: string;
  /** Items of `dependsOn` that are missing, so this one has to wait. */
  waitingFor?: string[];
  /** `pip` items: packages not found. */
  missingPackages?: string[];
  parts?: CheckPart[];
  /** The program was found in a known folder but is not on PATH (SPEC 3.5 step 4). */
  notOnPath?: boolean;
}

export interface CheckReport {
  platform: string;
  /** False where the setup feature does not exist (macOS). */
  supported: boolean;
  startedAt: string;
  finishedAt: string;
  /** `registry`: PATH was rebuilt (SPEC 3.5); `inherited`: reading it failed, so it was kept. */
  pathSource: 'registry' | 'inherited' | 'none';
  /** In catalog order. */
  results: CheckResult[];
}

export type SetupMode = 'check' | 'auto';

export interface SetupStateItem {
  status: string;
  version?: string;
  at: string;
}

/** `setup-state.json` (SPEC 3.9). `finishedAt` is absent while a run is still going. */
export interface SetupState {
  version: 1;
  mode: SetupMode;
  finishedAt?: string;
  items: Record<string, SetupStateItem>;
}

export interface AutoOpen {
  /** Open the wizard by itself on start (SPEC 3.1). */
  open: boolean;
  stateFileExists: boolean;
  claudeInstalled: boolean;
}

/** GET /api/v1/setup */
export interface SetupOverview {
  platform: string;
  supported: boolean;
  catalog: SetupCatalog;
  /** The last check since the engine started, or null. Results are not kept across restarts. */
  lastCheck: CheckReport | null;
  /** null when the file is missing or unreadable; `stateFile` says which. */
  state: SetupState | null;
  stateFile: 'missing' | 'ok' | 'corrupt';
  /** Whether an install run is active: its phase is `running` or `waiting` (SPEC 3.4). */
  runActive: boolean;
  autoOpen: AutoOpen;
}

export type RunItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'needs-user';

export interface RunItemProgress {
  id: string;
  status: RunItemStatus;
  /** A plain Korean sentence for the user. */
  message?: string;
  /** Why it failed, for code: `ELEVATION_DECLINED` (SPEC 3.6), `TIMEOUT`, `HASH_MISMATCH`, ... */
  reason?: string;
  foundVersion?: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * - `running`: an item is being installed.
 * - `waiting`: stopped on a failed item until skip, retry or cancel.
 * - `finished`, `cancelled`: over; a new run may start.
 */
export type RunPhase = 'running' | 'waiting' | 'finished' | 'cancelled';

/** GET /api/v1/setup/run returns `{ run: RunProgress | null }`. */
export interface RunProgress {
  phase: RunPhase;
  mode: SetupMode;
  /** The current command is being stopped (SPEC 3.4). */
  cancelling: boolean;
  /** In catalog order. */
  items: RunItemProgress[];
  startedAt: string;
  finishedAt?: string;
}

/** POST /api/v1/setup/run */
export interface RunRequest {
  items: string[];
  mode: SetupMode;
  /** MCP items the user confirmed to register again (SPEC 3.3). */
  replace?: string[];
}
