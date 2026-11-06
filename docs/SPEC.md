# AccountSwitch 0.3 specification

Status: draft for 0.3.0 (Windows). Values marked **verify** are believed correct but must be confirmed during implementation; replace the mark with the measured fact.

## 1. Scope

0.3.0 adds, on Windows:

| | Feature | Section |
|---|---|---|
| A | Setup wizard: check this PC, install what is missing, step by step | 3 |
| B | "Claude Code 열기": pick a folder, open `cmd` there running `claude` | 4 |
| C | Black-and-white redesign of every screen, animated theme toggle | 5, `DESIGN.md` |
| D | Logo, app and tray icons | 6, `DESIGN.md` §8 |
| E | Ship the unreleased 0.2.2 fixes | 7 |

macOS keeps the account features only. The 설치 tab and the launcher are hidden there (`navigator.userAgent` contains `Mac OS X`, or the engine reports `platform !== 'win32'`). The redesign applies to both.

Out of 0.3.0: CAD (AutoCAD, ZWCAD; ADR-004), Claude plugins, skills, `settings.json` templates, GitHub CLI, browser extensions, VS Code.

## 2. Behavior that must not change

- Account model, switching, refresh, auto switch, usage polling, uninstall restore: as in `README.md` (기본 로그인 전환, 자동 전환, 사용량 조회).
- Data folder `%LOCALAPPDATA%\AccountSwitch` (`ACCOUNTSWITCH_DATA` overrides), `profiles\profiles.json`, account folders.
- API under `/api/v1/accounts/*`, the session cookie and bootstrap token flow, the `127.0.0.1`-only server, the CSP (`default-src 'self'`).
- Theme storage key `accountswitch-theme` with values `light` and `dark`.
- Single instance per data folder; tray, autostart, update behavior of the shell.

New features add files and endpoints; they do not edit the account modules except where a section below says so.

## 3. Setup wizard

### 3.1 Entry and navigation

- The header gets two tabs: **계정** and **설치**. The selected tab is kept in `localStorage` (`accountswitch-tab`).
- On start the page asks `GET /api/v1/setup`. The wizard opens by itself only when `setup-state.json` does not exist **and** Claude Code is not installed. Otherwise the 계정 tab opens as today. Existing users are never forced through the wizard.
- The 설치 tab can be opened at any time and shows the same checklist with current status.

### 3.2 Modes

The first screen of the wizard offers two choices:

- **이미 세팅했어요 (점검만)**: run every check (read only), show the result, offer an install button per missing item. Nothing installs unless pressed.
- **자동으로 설정해 주세요**: show the checklist with missing items checked (optional groups unchecked until the user ticks the group), then install the checked items in catalog order after one 시작 press.

### 3.3 Item catalog (setup manifest)

The catalog is data in `src/core/setup/manifest.ts`: id, Korean label and one-line description, group, `dependsOn`, check, install, pinned version, `mayElevate`. The page renders from the catalog; adding an item does not need UI code.

**Base group (always offered, checked by default in auto mode):**

| id | Check (installed when) | Install | Version | Elevates |
|---|---|---|---|---|
| `git` | `git --version` succeeds, or `C:\Program Files\Git\cmd\git.exe` exists | winget `Git.Git` | latest | yes |
| `node` | `node -v` major is 24 | winget Node.js 24 package (**verify** id; pin 24.x), fallback official MSI from `nodejs.org/dist/` | 24.x | yes |
| `uv` | `uv --version` and `uvx --version` | official script `irm https://astral.sh/uv/install.ps1 \| iex` (user scope) | latest | no |
| `python` | `py -3.13 --version` succeeds | winget `Python.Python.3.13` with `--scope user` | 3.13.x | no (**verify**) |
| `claude` | `executable('claude-cli')` resolves (`src/core/cli.ts`) | `irm https://claude.ai/install.ps1 \| iex` (native installer) | latest | no |
| `codex` | `executable('codex-cli')` resolves | `npm i -g @openai/codex` (after `node`) | latest | no |
| `env` | all three hold: CurrentUser execution policy allows local scripts; user PATH contains `%USERPROFILE%\.local\bin`; user variable `PYTHONUTF8=1` | set what is missing (3.5) | – | no |
| `py-base` | `py -3.13 -m pip show` finds all of: openpyxl pypdf pdfplumber pymupdf pillow numpy requests beautifulsoup4 python-dotenv | `py -3.13 -m pip install <missing>` | latest | no |

**Optional groups (unchecked until the user ticks the group):**

| Group | id | Check | Install | Version |
|---|---|---|---|---|
| Python GIS | `py-gis` | pip show pyshp pyproj shapely rtree | pip install | latest |
| Python 3D | `py-3d` | pip show rhino3dm trimesh | pip install | latest |
| Python 한글 문서 | `py-hwp` | pip show pyhwp | pip install | latest |
| Rhino | `rhino` | `C:\Program Files\Rhino 8\System\Rhino.exe` exists | not installable: show "Rhino 8을 먼저 설치하세요" with a link; later Rhino items wait for it | 8 |
| Rhino | `rhinomcp-plugin` | `%APPDATA%\McNeel\Rhinoceros\packages\8.0\rhinomcp\0.4.1.1\` exists | `C:\Program Files\Rhino 8\System\Yak.exe install rhinomcp 0.4.1.1` (**verify** syntax) | 0.4.1.1 |
| Rhino | `rhinomcp-mcp` | user-scope MCP server `rhino` exists in `~/.claude.json` | `claude mcp add -s user rhino -e RHINO_MCP_HOST=127.0.0.1 -- uvx rhinomcp@0.4.1.1` | 0.4.1.1 |
| Rhino | `cordyceps-plugin` | `%APPDATA%\McNeel\Rhinoceros\packages\8.0\cordyceps\1.5.0\Cordyceps.gha` exists | `Yak.exe install cordyceps 1.5.0` (**verify**) | 1.5.0 |
| Rhino | `cordyceps-mcp` | user-scope MCP server `cordyceps` exists | `claude mcp add -s user --transport http cordyceps http://127.0.0.1:26929/mcp` | – |
| Rhino | `rhino-settings` | see 3.8 | see 3.8 | – |
| Blender | `blender` | `blender.exe --version` reports 5.2.3 | winget `BlenderFoundation.Blender --version 5.2.3` (**verify**), fallback `https://download.blender.org/release/Blender5.2/blender-5.2.3-windows-x64.msi` | 5.2.3 |
| Blender | `blender-mcp-addon` | addon file present under `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\` and enabled in user prefs | fetch the add-on of the pinned blender-mcp release; `blender -b --factory-startup --python-expr` installs, enables, saves user prefs | 1.5.5 (**verify** add-on matches server) |
| Blender | `blender-mcp` | user-scope MCP server `blender` exists | `claude mcp add -s user blender -- uvx blender-mcp@1.5.5` | 1.5.5 |

Rules:

- `dependsOn` gates order: `codex` after `node`; `py-*` after `python`; `*-mcp` after `claude` and, for uvx servers, `uv`; Rhino plugins after `rhino`; Blender add-on after `blender`.
- An item already installed with a different version than pinned shows **버전 다름** with the found version. Auto mode does not downgrade or replace a user's existing install, except the MCP registrations, which are re-added only after the user confirms.
- Downloads come only from the hosts named in this table, winget, npm, PyPI, and GitHub releases of the named projects.

### 3.4 Engine

New module `src/core/setup/` (manifest, checks, runner) and endpoints:

| Method, path | Does |
|---|---|
| `GET /api/v1/setup` | catalog, last check results, `setup-state.json`, whether a run is active |
| `POST /api/v1/setup/check` | run all checks (read only), return results |
| `POST /api/v1/setup/run` `{ items: string[] }` | start one run of the given items in catalog order; 409 if a run is active |
| `GET /api/v1/setup/run` | progress: per item `pending`, `running`, `done`, `failed`, `skipped`, `needs-user`, with message, found version, start and end time |
| `POST /api/v1/setup/run/skip` `{ item }` | mark a failed item skipped and continue |
| `POST /api/v1/setup/run/retry` `{ item }` | run a failed item again and continue |
| `POST /api/v1/setup/cancel` | stop after the current command ends; kill it if it outlasts 30 s |

- One run at a time. Commands run with `shell: false` where possible, `windowsHide: true`, a timeout per item (default 15 min), output captured to `logs\setup-YYYY-MM-DD.log` in the data folder. Logs never contain tokens or environment dumps.
- A failed item stops the run (`failed`), and the page offers 다시 시도, 건너뛰기, 로그 보기.
- The page polls `GET /api/v1/setup/run` every second while a run is active, like sign-in polling today.

### 3.5 PATH and environment

After every install item, and before every check:

1. Rebuild the engine's own `PATH` from the registry: machine `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path` plus user `HKCU\Environment\Path`, expanded. The running engine otherwise keeps the stale PATH it started with.
2. Look in the known install folders of the item (table above).
3. Run its version command.
4. If the program exists but its folder is not on the user PATH, append the folder to `HKCU\Environment\Path` (keep `REG_EXPAND_SZ`, never use `setx`, which truncates) and broadcast `WM_SETTINGCHANGE` so new terminals see it.

`env` item: CurrentUser execution policy set to `RemoteSigned` only when it is `Undefined` or `Restricted` and no group policy overrides it (if a policy overrides, report `needs-user`). `PYTHONUTF8=1` is set as a user variable.

### 3.6 Elevation

Items with `mayElevate` show "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요." while running. A declined prompt (installer exit code for cancelled elevation, **verify** per installer) ends the item as `failed` with reason `ELEVATION_DECLINED` and the message "권한 확인에서 '아니요'를 눌렀어요". Prefer user-scope installs where a package offers them.

### 3.7 Writes to the Claude config

`claude mcp add` and `claude mcp get` run inside `DefaultLogin.exclusive('claude-cli', …)` so they never overlap an account switch or a token refresh, both of which rewrite `~/.claude.json` under Claude Code's locks. They run without `CLAUDE_CONFIG_DIR` (the user's own `~/.claude`), which is the folder every terminal uses whichever account is in use.

### 3.8 Rhino settings (accepted 2026-11-06)

`rhino-settings` item, part of the Rhino group, four parts. It runs only while no `Rhino.exe` is running, because Rhino rewrites its settings file when it exits and would undo the change (otherwise `needs-user`: "Rhino를 닫고 다시 시도하세요"). Only the `Default` scheme file is edited; other schemes are left alone. A backup of the file is written next to it (`.accountswitch-bak`) before the first change.

1. **Read-only warning on.** `%APPDATA%\McNeel\Rhinoceros\8.0\settings\settings-Scheme__Default.xml`, `<child key="FileSettings">` → `<entry key="EnableFileLockingOpenWarning">True</entry>` (measured: the entry exists and was `False` on the development PC). Without it Rhino opens a locked file read-only without telling the user (ADR-003).
2. **`mcpstart` at Rhino start**, so rhinomcp listens without a manual command. This is Rhino's "run these commands every time Rhino starts" list in the same file. **verify** the exact element: set the list once in Rhino Options with Rhino closed afterwards, diff the file, then write the same element. Existing commands in the list are kept; `_mcpstart` is appended once.
3. **Grasshopper starter file** `Documents\AccountSwitch\cordyceps-start.gh` holding one Cordyceps component. Cordyceps has no auto start (measured: no assembly-priority or idle hook; its HTTP server starts when the component solves on a canvas). The file is made once from a real Grasshopper session and shipped as a template. With rhinomcp running, Claude can open it itself (`-_Grasshopper _Document _Open "<path>" _Enter` through rhinomcp `run_command`), which starts Cordyceps.
4. **Tool-role note** appended to `~/.claude/CLAUDE.md` (created if missing): Rhino document scripts and measurements through `rhino`, Grasshopper and viewport looks through `cordyceps`, open the starter file to start Cordyceps, never kill Rhino by process name. Only the text between `<!-- accountswitch:start -->` and `<!-- accountswitch:end -->` is ever written or replaced.

### 3.9 `setup-state.json`

In the data folder: `{ "version": 1, "mode": "check" | "auto", "finishedAt": ISO, "items": { "<id>": { "status": "...", "version": "...", "at": ISO } } }`. Written after each item, so a closed window resumes from the last state.

## 4. Claude Code launcher

- A **Claude Code 열기** button in the header (Windows desktop window only). Disabled with "설치 탭에서 Claude Code를 먼저 설치하세요" when `claude` is missing.
- Pressing it opens a split menu: **폴더 선택…** and up to 8 recent folders (most recent first, missing folders dropped).
- 폴더 선택 opens the system folder dialog from the shell (`IFileOpenDialog` with `FOS_PICKFOLDERS`, the same dialog VS Code uses), not the old tree dialog.
- Launch: `cmd.exe /K` with `WorkingDirectory` set to the folder and the resolved `claude.exe` path as the command, so no `cd` is needed and the window stays open after `claude` exits. Window title `Claude Code - <folder name>`. The terminal uses the login currently in use (the 사용 account).
- Page to shell: WebView2 `window.chrome.webview.postMessage({ type: 'claude.open', folder?: string })`; the shell shows the dialog when `folder` is absent, launches, and posts back `{ type: 'claude.opened', folder }`, `{ type: 'claude.cancelled' }` (the user closed the dialog; show nothing) or `{ type: 'claude.failed', reason }`. The shell accepts messages only from the app's own page origin. The page stores recent folders through `POST /api/v1/launcher/recent` (data folder `launcher.json`).
- In the browser (`npm start`), where there is no shell, the button opens a text field for a path plus the recent list, and the engine launches `cmd.exe` itself.

Engine routes (session cookie and origin rules as every other route):

| Method, path | Body | Answer |
|---|---|---|
| `GET /api/v1/launcher` | | `{ platform, installed, recent: string[] }`; `installed` is whether Claude Code resolves |
| `POST /api/v1/launcher/recent` | `{ folder }` | `{ recent: string[] }`. Up to 8, most recent first, deduplicated (case-insensitive on Windows), missing folders dropped |
| `POST /api/v1/launcher/open` | `{ folder }` | `{ folder }` with the normalized path. Windows only. Does not add to the recent list; the page does that, as after `claude.opened` |

Reasons, the same in `claude.failed` and in the engine's `{ code }` (HTTP 409):

| Reason | Meaning |
|---|---|
| `CLI_UNAVAILABLE` | Claude Code does not resolve |
| `FOLDER_NOT_FOUND` | not an existing folder |
| `FOLDER_INVALID` | not a full local path (`C:\…`), or characters no folder name can have |
| `FOLDER_NETWORK` | a `\\server\share` path; `cmd` cannot start in one and would silently fall back to the Windows folder, so it is refused. A mapped drive letter works |
| `LAUNCH_FAILED` | Windows could not start `cmd.exe` there |
| `UNSUPPORTED_PLATFORM` | engine only: not Windows |
| `DIALOG_FAILED` | shell only: the folder dialog could not open |
| `BUSY` | shell only: a dialog or launch is already under way |

Launch details, the same in the shell (`ClaudeLauncher.cs`) and the engine (`src/core/launcher.ts`):

- The command line is a fixed string; the folder and the program path are never part of it, so a folder name with `&`, `^`, `%` or `!` cannot run anything. The folder travels as the working directory. The title and the program path travel in `ACCOUNTSWITCH_LAUNCH_TITLE` and `ACCOUNTSWITCH_LAUNCH_CLAUDE`, expanded only inside quotes, which `cmd` does not parse again.
- A hidden `cmd.exe` runs `start "<title>" "%ComSpec%" /D /S /V:OFF /K ""<claude.exe>""`. `start` is what gives the terminal its own console and sets the title without a `title` command, whose text `cmd` would parse. It also works from an engine that has a hidden console or shares the user's terminal.
- `cmd.exe` and `claude.exe` are always absolute paths: `cmd` looks in the current folder first, and the chosen folder is untrusted, so a `claude.exe` inside it must not run. `/D` skips `AutoRun` commands, which could change the folder; `/V:OFF` keeps `!` literal.
- Environment: the same removal as `subscriptionEnvironment` in `src/core/cli.ts` (`ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_ENV_FILE`) plus `CLAUDECODE`, so a value inherited from another session cannot pin the terminal to one account or refuse to start. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` is then set, because Claude Code otherwise replaces the window title.
- The shell finds Claude Code as `executable('claude-cli')` does: `ACCOUNTSWITCH_CLAUDE_PATH`, `%USERPROFILE%\.local\bin\claude.exe`, the npm package's `claude.exe`, then `PATH`. It rebuilds `PATH` from the registry (machine, then user, then what the process already had) for the search and for the terminal, because an installer run after the shell started is otherwise invisible to it (see 3.5). The engine uses its own `PATH`, which setup keeps current.

## 5. Redesign

Every screen follows `DESIGN.md`. Functional constraints:

- Same endpoints and behavior; only markup and CSS change for the 계정 tab.
- Theme toggle: the two-state pill of `DESIGN.md` §5.2, same storage key; system theme until the user chooses.
- Fonts are bundled in the build (CSP forbids remote fonts).

## 6. Logo and icons

Deliverables in `assets/brand/`: master `logo.svg` (mark), `wordmark.svg`, `accountswitch.ico` (16, 20, 24, 32, 40, 48, 64, 256), tray icons for light and dark taskbars (16, 20, 24, 32), macOS `icon.png` 1024 and a menu bar template image. The shell picks the tray icon from `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\SystemUsesLightTheme`. Build scripts copy them to `src/desktop/shell/accountswitch.ico` and `src/desktop/mac/icon.png`. See `DESIGN.md` §8 for how the mark is made.

## 7. Release 0.3.0

- Includes the 0.2.2 commits not yet released (latest release is 0.2.1): every account can sign in again (the one in use in place), a signed-out account shows 로그인 instead of 사용, "MM.DD 로그인 만료" within three days of a Claude login's end, errors in red, install hint for a missing CLI.
- Regression to check by hand before tagging: an added account whose login expired can be signed in again from its ⋯ menu, and, once signed out and not in use, removed.
- Version `0.3.0` in `package.json`; README updated for the new tabs; tag only after the user confirms (CLAUDE.md).
