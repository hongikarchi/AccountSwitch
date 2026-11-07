# AccountSwitch 0.3 specification

Status: draft for 0.3.0 (Windows). Values marked **verify** are believed correct but must be confirmed during implementation; replace the mark with the measured fact.

## 1. Scope

0.3.0 adds, on Windows:

| | Feature | Section |
|---|---|---|
| A | Setup wizard: check this PC, install what is missing, step by step | 3 |
| B | "Claude 열기" and "GPT 열기": pick a folder, open `cmd` there running the CLI | 4 |
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
- **자동으로 설정해 주세요**: first ask what the user works with (user, 2026-11-08). One screen shows a card for each optional group, in catalog order (Claude Code, GPT, Rhino, Blender), and an unavailable ZWCAD card that comes later (out of 0.3.0, ADR-004), with no descriptions. A card whose items are all there, as far as they apply (below), says 설치됨 and cannot be chosen; a card with something left to install can (user, 2026-11-08). Pressing **다음** needs Claude Code or GPT ticked or already there, because AccountSwitch means nothing without one of them: otherwise a warning window says so and nothing happens. With one, the check result goes through the same rule as the checklist: everything missing in the base group (Git, Python and the rest come along) and the ticked groups installs in catalog order, at once. 다음 stays disabled until the check has answered. When nothing can install (nothing missing, or only items the user has to install), 다음 shows the checklist instead of starting a run. After a run, and whenever the tab opens with `mode: auto` in `setup-state.json`, the screen is the checklist.

Rules for both modes:

- 버전 다름 offers an install only for MCP items (다시 등록, sent in `replace` after a confirmation) and, in 점검만 mode, items with `warnIfOtherVersion` (Blender, after its warning). Auto mode never installs over another version (3.3), so it offers neither that nor a button that would do nothing. Any other different version has no install offer, because the app does not replace a user's install.
- `timeout` and `error` mean the state is unknown, so they offer only 다시 확인, never an install.
- An item the user has to install (`install.automatic: false`, Rhino) has no checkbox, only its link. It is part of the run when its group is ticked, and the runner reports it `needs-user`.
- When `setup-state.json` exists, the tab skips the first screen and opens the checklist of its `mode`; 처음으로 goes back to the first screen.
- Unticking a dependency leaves its dependents ticked, and each row says what it needs first. The runner decides what happens to them (3.4).
- A connection applies only to a terminal program in use: ticked on the card screen, or already installed. So an item whose dependency is in an optional group not in use is neither counted nor installed by a card or by a group's button: with GPT and Rhino but not Claude Code, the Rhino plugins and the GPT connections install and the Claude Code connections do not.
- The checklist is one stepper (user, 2026-11-08). Under the base items come Claude Code and Codex CLI as ordinary rows. Under "필요하면 더 고르세요" come Rhino and Blender, one row each with no checkbox: the row says how many of its items are installed ("6개 중 4개 설치됨") and its **설치** button runs what is missing. Its items can be unfolded (항목 보기), each with its own row, which is where 다시 등록 and another version's warning are; a group with a failure, another version or an unknown state shows them unfolded.

### 3.3 Item catalog (setup manifest)

The catalog is data in `src/core/setup/manifest.ts`: id, Korean label and one-line description, group, `dependsOn`, check, install, pinned version, `mayElevate`. The page renders from the catalog; adding an item does not need UI code.

**Base group (always offered, comes along with Claude Code or GPT in auto mode):**

| id | Check (installed when) | Install | Version | Elevates |
|---|---|---|---|---|
| `git` | `git --version` succeeds, or `C:\Program Files\Git\cmd\git.exe` or `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` exists | winget `Git.Git`, fallback `https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/Git-2.56.0.4-64-bit.exe` with `/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` | latest | yes for an account in Administrators; a standard account installs per user with no prompt |
| `node` | `node -v` major is 24 | winget `OpenJS.NodeJS.LTS --version 24.22.1`, fallback `https://nodejs.org/dist/v24.22.1/node-v24.22.1-x64.msi` (pattern `dist/vX.Y.Z/node-vX.Y.Z-x64.msi`) with `msiexec /i <file> /passive /norestart` | 24.22.1 | yes |
| `uv` | `uv --version` and `uvx --version` | official script `irm https://astral.sh/uv/install.ps1 \| iex` (user scope, `%USERPROFILE%\.local\bin`) | latest | no |
| `python` | `py -3.13 --version` succeeds | winget `Python.Python.3.13` with `--scope user`, fallback `https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe /passive /norestart InstallAllUsers=0 PrependPath=1`. Folders: `%LOCALAPPDATA%\Programs\Python\Python313`, `%LOCALAPPDATA%\Programs\Python\Launcher` | 3.13.x | no (an older all-users `py` launcher already on the PC can prompt, because the installer upgrades it in place) |
| `env` | all three hold: CurrentUser execution policy allows local scripts; user PATH contains `%USERPROFILE%\.local\bin`; user variable `PYTHONUTF8=1` | set what is missing (3.5) | – | no |
| `py-base` | `py -3.13 -m pip show` finds all of: openpyxl pypdf pdfplumber pymupdf pillow numpy requests beautifulsoup4 python-dotenv | `py -3.13 -m pip install <missing>` | latest | no |
| `py-gis` | pip show pyshp pyproj shapely rtree | pip install | latest | no |
| `py-3d` | pip show rhino3dm trimesh | pip install | latest | no |

**Optional groups, the cards of 3.2 (unchecked until the user ticks the group). The Python map and 3D packages are part of the base group, and the HWP package is gone (user, 2026-11-07):**

| Group | id | Check | Install | Version |
|---|---|---|---|---|
| Claude Code | `claude` | `executable('claude-cli')` resolves (`src/core/cli.ts`) | `irm https://claude.ai/install.ps1 \| iex` (native installer, `%USERPROFILE%\.local\bin\claude.exe`) inside `DefaultLogin.exclusive` (3.7) | latest |
| GPT | `codex` | `executable('codex-cli')` resolves | `npm i -g @openai/codex` (after `node`; `%APPDATA%\npm`) | latest |
| Rhino | `rhino` | `C:\Program Files\Rhino 8\System\Rhino.exe` exists | not installable: show "Rhino 8을 먼저 설치하세요" with a link; later Rhino items wait for it | 8 |
| Rhino | `rhinomcp-plugin` | `%APPDATA%\McNeel\Rhinoceros\packages\8.0\rhinomcp\0.4.1.1\` exists | `C:\Program Files\Rhino 8\System\Yak.exe install rhinomcp 0.4.1.1` | 0.4.1.1 |
| Rhino | Rhino | `rhinomcp-mcp` | user-scope MCP server `rhino` exists in `~/.claude.json` | `claude mcp add -s user rhino -e RHINO_MCP_HOST=127.0.0.1 -- uvx rhinomcp@0.4.1.1` | 0.4.1.1 |
| Rhino | `rhinomcp-codex` | server `rhino` in `~/.codex/config.toml` | `codex mcp add rhino --env RHINO_MCP_HOST=127.0.0.1 -- uvx rhinomcp@0.4.1.1` | 0.4.1.1 |
| Rhino | `cordyceps-plugin` | `%APPDATA%\McNeel\Rhinoceros\packages\8.0\cordyceps\1.5.0\Cordyceps.gha` exists | `Yak.exe install cordyceps 1.5.0` | 1.5.0 |
| Rhino | `cordyceps-mcp` | user-scope MCP server `cordyceps` exists | `claude mcp add -s user --transport http cordyceps http://127.0.0.1:26929/mcp` | – |
| Rhino | `cordyceps-codex` | server `cordyceps` in `~/.codex/config.toml` | `codex mcp add cordyceps --url http://127.0.0.1:26929/mcp` | – |
| Rhino | `rhino-settings` | see 3.8 | see 3.8 | – |
| Blender | `blender` | `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe --version` reports 5.2.3. Nothing in that folder: the Uninstall keys of the registry are read for a Blender elsewhere (rules below) | winget `BlenderFoundation.Blender --version 5.2.3`, fallback `https://download.blender.org/release/Blender5.2/blender-5.2.3-windows-x64.msi` with `msiexec /i <file> /passive /norestart` (elevates, machine scope only) | 5.2.3 |
| Blender | `blender-mcp-addon` | `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\blender_mcp_addon.py` present and enabled in user prefs | download `https://raw.githubusercontent.com/ahujasid/mcp-for-blender/15c775ff78264346a1d09089a799c52c2fd9f797/addon.py` (the commit whose server is byte-identical to PyPI 1.5.5; the project publishes no GitHub releases), check SHA-256 `82d709a542fd268ed8e0e1da4fa9632df65b912fea850380baf6c47ab45a88fb`, save it as `blender_mcp_addon.py`. When no `5.2\config\userpref.blend` exists and an older version folder does, a separate `blender.exe -b --python-exit-code 1 --python-expr` first runs `bpy.ops.preferences.copy_prev()` (rules below). Then `blender.exe -b --python-exit-code 1 --python-expr` runs `addon_install`, `addon_enable(module='blender_mcp_addon')`, sets its `telemetry_consent` preference to `False`, and runs `wm.save_userpref`. Never `--factory-startup`: Blender then skips reading the user's prefs and the save overwrites them with factory values. **verify** this command in one real run (T-045) | 1.5.5 |
| Blender | `blender-mcp` | user-scope MCP server `blender` exists | `claude mcp add -s user blender -e DISABLE_TELEMETRY=true -- uvx blender-mcp@1.5.5` | 1.5.5 |
| Blender | `blender-mcp-codex` | server `blender` in `~/.codex/config.toml` | `codex mcp add blender --env DISABLE_TELEMETRY=true -- uvx blender-mcp@1.5.5` | 1.5.5 |

Rules:

- `python` reports missing, not 버전 다름, when only another Python exists, because 3.13 installs alongside it.
- `blender-mcp-addon` "enabled" is a read-only search of `userpref.blend` for the module name followed by NUL, so a check never starts Blender (**verify** that disabling the add-on removes the name, T-045).
- `dependsOn` gates order: `codex` after `node`; `py-*` after `python`; `*-mcp` after `claude` and, for uvx servers, `uv`; Rhino plugins after `rhino`; Blender add-on after `blender`.
- An item already installed with a different version than pinned shows **버전 다름** with the found version. Auto mode does not downgrade or replace a user's existing install, except the MCP registrations, which are re-added only after the user confirms. In a run: in `auto` mode such an item ends `skipped` with reason `OTHER_VERSION_KEPT`, and items depending on it still go ahead (a step that truly needs the pinned one reports it itself). In `check` mode, where the user pressed that item's own button, it installs. An MCP item registered differently ends `needs-user` with reason `REPLACE_NOT_CONFIRMED` in both modes unless named in `replace`; then `claude mcp remove -s user <name>` and the add run inside one lock.
- `blender-mcp-addon` also waits for Blender to be closed (`needs-user`, reason `BLENDER_RUNNING`), because Blender saves its preferences on exit and would undo the change. Detecting only; nothing is ever killed.
- Every winget install runs `<winget> install --id <id> -e --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity` plus the arguments in the table. `--version` takes an exact version only (`24` and `24.*` are refused), and `OpenJS.NodeJS.LTS` without it installs Node 26. There is no `OpenJS.NodeJS.24`.
- winget missing or failing moves to the fallback in the table, except after `ELEVATION_DECLINED` and the exit codes on the stop list (3.6).
- `BlenderFoundation.Blender` declares `UpgradeBehavior: uninstallPrevious`, so winget may remove another installed Blender. When a different Blender version is found, its install button warns about this first.
- A Blender outside `%ProgramFiles%\Blender Foundation` counts too, because winget can remove it. When that folder holds no Blender, the same PowerShell snapshot as 3.5 step 1 reads `HKLM` and `HKLM\WOW6432Node` and `HKCU` `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`, read only, for a `DisplayName` of `Blender`, optionally followed by a version and `LTS` (measured on the development PC: `Blender`, `DisplayVersion` `5.2.3`, `InstallLocation` with a trailing backslash; 276 ms). A hit reports 버전 다름 with its `DisplayVersion`, even when that equals the pin, since the add-on step needs the known folder. An entry whose `InstallLocation` has no `blender.exe` is a leftover and does not count. That Blender is never started. If the snapshot could not be read, the state is unknown: `error`, not `missing`.
- `blender-mcp-addon`: `wm.save_userpref` creates `5.2\config\userpref.blend`, after which Blender no longer offers to import settings from the previous version. So when that file is missing and `%APPDATA%\Blender Foundation\Blender` holds an older `X.Y` folder, the settings are copied first, in a run of their own, after the add-on passed its hash and before it is installed. That run is limited to 5 minutes. If it fails or times out nothing is lost (it only copies out of the old folder), it is logged, the add-on still installs, and the item's message says the settings did not come along. A cancel stays a cancel. **verify** in one real run (T-048): `copy_prev` works under `-b`, and the old settings are there afterwards.
- Every `download-installer` step has a required SHA-256, taken from what the project publishes. The installer is hashed on disk right before it runs and does not run on a mismatch (`failed`, reason `HASH_MISMATCH`, no later step). A pin and its hash change together here and in the manifest.

| Installer | SHA-256 | Published at |
|---|---|---|
| `Git-2.56.0.4-64-bit.exe` | `4961a4a8cc778d8b6e00a5819e5fe4d078b754555aff7aedc2d77a5d74c2de80` | the SHA-256 table of the `v2.56.0.windows.4` release notes (the GitHub asset digest agrees) |
| `node-v24.22.1-x64.msi` | `3bda4baf1ee709b33cf920dd633106ddb23951e322bff9c03ec9f64ab8981b01` | `https://nodejs.org/dist/v24.22.1/SHASUMS256.txt` |
| `python-3.13.17-amd64.exe` | `5da012101ba2e17113a9a1cd901e9ce1441086f2b7ecb5de06ec94163899a190` | the SHA-256 column of `https://www.python.org/downloads/release/python-31317/` (its API and SPDX file agree) |
| `blender-5.2.3-windows-x64.msi` | `a103d4ece8d9acffd2a95c9d8860355b1f209977cc983b4a3d1e1cfb441c8605` | `https://download.blender.org/release/Blender5.2/blender-5.2.3.sha256` |

- blender-mcp telemetry stays off. Its server defaults to on and sends data to the project's own database; its add-on defaults to consent for prompts, code and screenshots; its terms allow indefinite retention and AI training. The `-e` flag and the preference in the table turn both off. A user can turn them on later.
- Downloads come only from: winget and the installer URLs of its manifests (`nodejs.org`, `www.python.org`, `github.com` with `release-assets.githubusercontent.com`, `download.blender.org`), npm, PyPI, `yak.rhino3d.com`, `claude.ai` and its redirect `downloads.claude.ai`, `astral.sh` and its redirect `releases.astral.sh` (the script can also use `github.com/astral-sh/uv`), and `raw.githubusercontent.com` for the one pinned add-on commit. The engine enforces this on everything it fetches itself, on every redirect (`src/core/setup/install-download.ts`). So `irm <url> | iex` is done as: fetch the script through that check, then `iex` the saved copy. What npm, pip, winget, Yak and the two install scripts fetch afterwards is theirs to fetch.

### 3.4 Engine

New module `src/core/setup/` (manifest, checks, runner) and endpoints:

| Method, path | Does |
|---|---|
| `GET /api/v1/setup` | catalog, last check results, `setup-state.json`, whether a run is active |
| `POST /api/v1/setup/check` | run all checks (read only), return results. Body `{ "record": true }` also writes `setup-state.json`; the page sends it when the user picks 점검만 |
| `POST /api/v1/setup/run` `{ items: string[], mode: 'check' \| 'auto', replace?: string[] }` | start one run of the given items in catalog order; answers `{ run }`. 409 `SETUP_RUN_ACTIVE` if a run is active, 409 `UNSUPPORTED_PLATFORM` off Windows, 400 `INVALID_INPUT` for an empty list, an unknown id, or a `replace` id that is not an MCP item. `replace` names MCP items the user confirmed to re-add (3.3) |
| `GET /api/v1/setup/run` | `{ run: RunProgress \| null }` (`src/core/setup/types.ts`): phase, and per item `pending`, `running`, `done`, `failed`, `skipped`, `needs-user`, with message, reason, found version, start and end time |
| `POST /api/v1/setup/run/skip` `{ item }` | mark a failed item skipped and continue; answers `{ run }`. 409 `SETUP_RUN_NOT_WAITING` unless the run waits on that item |
| `POST /api/v1/setup/run/retry` `{ item }` | run a failed item again and continue; answers `{ run }`. 409 `SETUP_RUN_NOT_WAITING` as above |
| `POST /api/v1/setup/cancel` | stop after the current command ends; kill it (its own process tree only) if it outlasts 30 s; a download stops at once. Answers `{ run }`; 409 `SETUP_RUN_NOT_ACTIVE` without an active run. Items not reached end `skipped` with reason `CANCELLED`; they are not written to `setup-state.json` |
| `GET /api/v1/setup/log` | `{ text }`: the end of today's log (64 KB at most), for 로그 보기 |

- One run at a time. Commands run with `shell: false` where possible, `windowsHide: true`, a timeout per item (default 15 min), output captured to `logs\setup-YYYY-MM-DD.log` in the data folder. Logs never contain tokens or environment dumps.
- A failed item stops the run (`failed`, phase `waiting`), and the page offers 다시 시도, 건너뛰기, 로그 보기. A run is active while its phase is `running` or `waiting`; `finished` and `cancelled` are not active.
- A `needs-user` item (Rhino missing, Rhino running) does not stop the run. An item that depends on an item left `needs-user`, `failed` or `skipped` ends `skipped` with a message naming what it waits for, and the rest continue. A dependency outside the run is checked instead: it must report installed or 버전 다름.
- Each item: check first (installed is `done` without running anything; a check that cannot answer is `failed` with reason `CHECK_FAILED`, since an unknown state must not install over a user's program), then the steps in order. After a step that ran, whatever its exit code, the item is checked again: installed means `done`. Exit 0 and "not detected" moves to the next step. A check that cannot answer (`timeout`, `error`) ends the item as `failed` with reason `CHECK_FAILED` and starts no fallback, since a second installer on top of an unknown state is what this rule exists to prevent.
- That second check requires the command to succeed: `orFilesExist` (`git.exe` is there, `git --version` fails) does not count, so a broken install is not `done`. Once such an attempt was made, the check before a retry in the same engine session is held to the same bar. The plain check keeps `orFilesExist`, so an existing user's working state does not change because a version command is slow.
- The page polls `GET /api/v1/setup/run` every second while a run is active, like sign-in polling today.

Quitting during a run:

- **Marker.** While a run is active (`running` or `waiting`) the empty file `setup-running` exists in the data folder, so the shell knows even with the window hidden in the tray. The engine removes a leftover one when it starts. A failed marker write is logged and never stops a run.
- **The shell asks first.** On tray 종료, a window close that really quits (background mode off), and 재시작하여 업데이트: if the marker exists and the engine this shell started is running, it asks "설치가 아직 진행 중이에요. 지금 끝내면 설치가 중간에 멈출 수 있어요. 그래도 끝낼까요?" (the update wording says 업데이트), default 아니요. 아니요 changes nothing; an update stays ready for later. A stale marker costs one question, never a blocked quit.
- **No question** when the window only hides to the tray, when Windows shuts down or logs off, on a `--quit` signal (nobody may be there to answer; it stops the same gentle way), or when the shell only attached to another server, since quitting then stops nothing.
- **The engine closes gently.** Standard input closing, `SIGINT` and `SIGTERM` all stop a run like a cancel: downloads stop at once, nothing new starts, the current command may end, and what outlasts 10 s is killed (its own process tree only, never by name). The engine waits at most 12 s for the run, while sign-ins close in parallel, which fits inside the 15 s the shell waits (`Engine.Stop`). No run starts while closing (`SETUP_RUN_ACTIVE`).
- **`setup-state.json` tells the truth.** At that moment each item not finished is written with status `cancelled`, so the file is right even if the engine goes down before the run ends. The current item's real result replaces it if it ends in time; a killed one is `failed`. `finishedAt` is written when the run ends; without it the run was cut off. This differs from a user's cancel, which writes nothing for items not reached.
- **After a restart** `GET /api/v1/setup/run` is `{ run: null }` and `runActive` is `false`, because a run lives only in the engine that started it. The runner writes an item only when it ends or at the stop above, so no item is ever stored as `running`, and the page re-checks instead of reading item statuses from the file.
- An elevated installer cannot be killed from the unelevated engine and may finish on its own after the run reports `cancelled`. The next check shows what is really there.

### 3.5 PATH and environment

After every install item, and before every check:

1. Rebuild the engine's own `PATH` from the registry: machine `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path` plus user `HKCU\Environment\Path`, expanded. The running engine otherwise keeps the stale PATH it started with.
2. Look in the known install folders of the item (table above).
3. Run its version command.
4. If the program exists but its folder is on neither the machine nor the user PATH, append the folder to `HKCU\Environment\Path` (keep `REG_EXPAND_SZ`, never use `setx`, which truncates) and broadcast `WM_SETTINGCHANGE` so new terminals see it. Only an install run does this, never a check; the folders are `pathFolders` in the manifest. If the current value cannot be read, nothing is written.

`env` item: CurrentUser execution policy set to `RemoteSigned` only when it is `Undefined` or `Restricted` and no group policy overrides it (if a policy overrides, report `needs-user`). `PYTHONUTF8=1` is set as a user variable.

### 3.6 Elevation

Items with `mayElevate` show "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요." while running. A declined prompt ends the item as `failed` with reason `ELEVATION_DECLINED` and the message "권한 확인에서 '아니요'를 눌렀어요", and does not start the fallback. Prefer user-scope installs where a package offers them.

Exit codes that mean declined, as a Node child process reports them:

| Command | Exit code |
|---|---|
| winget, any package | `2316632332` (`0x8A15010C`, `INSTALL_CANCELLED_BY_USER`); winget maps MSI and bundle `1602` and Inno `2` and `5` to it |
| Git fallback (Inno Setup) | `2` |
| Node and Blender MSI fallback through `msiexec`, Python fallback bundle | `1602` or `1223` (**verify** by pressing 아니요 once on a real prompt, T-047) |

Other winget exit codes end the item without its fallback, because a second installer would bypass the reason. The item is still checked again first: installed means `done`. Any exit code not listed here still moves to the fallback. Values come from winget's own `returnCodes.md` (https://github.com/microsoft/winget-cli/blob/master/doc/windows/package-manager/winget/returnCodes.md, read 2026-11-06), shown as a Node child process reports them, unsigned.

| Hex | Unsigned | winget name | Reason | Ends as | Korean message says |
|---|---|---|---|---|---|
| `0x8A15002B` | `2316632107` | `UPDATE_NOT_APPLICABLE` | `WINGET_ALREADY_INSTALLED` | `failed` | it says installed but is not detected |
| `0x8A15010D` | `2316632333` | `INSTALL_ALREADY_INSTALLED` | `WINGET_ALREADY_INSTALLED` | `failed` | same |
| `0x8A150061` | `2316632161` | `PACKAGE_ALREADY_INSTALLED` | `WINGET_ALREADY_INSTALLED` | `failed` | same |
| `0x8A15010E` | `2316632334` | `INSTALL_DOWNGRADE` | `WINGET_NEWER_INSTALLED` | `needs-user` | a newer version is there and stays |
| `0x8A15010F` | `2316632335` | `INSTALL_BLOCKED_BY_POLICY` | `WINGET_BLOCKED_BY_POLICY` | `needs-user` | a company or school policy blocks it |
| `0x8A15003A` | `2316632122` | `BLOCKED_BY_POLICY` | `WINGET_BLOCKED_BY_POLICY` | `needs-user` | same |
| `0x8A150102` | `2316632322` | `INSTALL_INSTALL_IN_PROGRESS` | `WINGET_INSTALL_IN_PROGRESS` | `failed` | another install is running; try again after |
| `0x8A150101` | `2316632321` | `INSTALL_PACKAGE_IN_USE` | `WINGET_APP_IN_USE` | `failed` | the program is in use; close it and try again |
| `0x8A150103` | `2316632323` | `INSTALL_FILE_IN_USE` | `WINGET_APP_IN_USE` | `failed` | same |
| `0x8A150111` | `2316632337` | `INSTALL_PACKAGE_IN_USE_BY_APPLICATION` | `WINGET_APP_IN_USE` | `failed` | same |
| `0x8A150105` | `2316632325` | `INSTALL_DISK_FULL` | `WINGET_DISK_FULL` | `failed` | not enough disk space |
| `0x8A150109` | `2316632329` | `INSTALL_REBOOT_REQUIRED_TO_FINISH` | `WINGET_REBOOT_REQUIRED` | `needs-user` | restart the PC, then try again |
| `0x8A15010A` | `2316632330` | `INSTALL_REBOOT_REQUIRED_FOR_INSTALL` | `WINGET_REBOOT_REQUIRED` | `needs-user` | same |
| `0x8A15010B` | `2316632331` | `INSTALL_REBOOT_INITIATED` | `WINGET_REBOOT_REQUIRED` | `needs-user` | the PC may restart soon; save open files |

Restarts: no installer of ours may restart the PC by itself, since a file in use could otherwise cost the user an unsaved model. The MSI and Python fallbacks pass `/norestart` and Git's passes `/NORESTART`. Exit `3010` or `1641` from any step, and the three `REBOOT` codes above, mean a restart is pending: an item the check then finds is `done` and its message says to restart; otherwise it ends `needs-user` with reason `REBOOT_PENDING` (`WINGET_REBOOT_REQUIRED` for winget) and starts no fallback.

### 3.7 Writes to the Claude config

`claude mcp add` runs inside `DefaultLogin.exclusive('claude-cli', …)` so it never overlaps an account switch or a token refresh, both of which rewrite `~/.claude.json` under Claude Code's locks. It runs without `CLAUDE_CONFIG_DIR` (the user's own `~/.claude`), which is the folder every terminal uses whichever account is in use.

Checks do not run `claude mcp get`: measured, it starts the registered server as a health check, so `uvx` may download and run a package during what the user was told is a read-only check. Checks read the top-level `mcpServers` of `~/.claude.json` inside the same lock instead, and keep only `command`, `args` and `url` of the named server. `env` and `headers` may hold secrets and are dropped at once; nothing else in the file is used. The `claude` install item runs inside the same lock, because `install.ps1` ends by running `claude.exe install` and **verify** whether that step writes `~/.claude.json` (T-042).

Re-registering a server the user confirmed (3.3) is the one exception to dropping `env`. Inside the lock, before `claude mcp remove`, the raw entry of that server under `mcpServers` is kept in memory, whole, including its `env`. If the file cannot be read or understood, nothing is removed. If the add then fails, times out or is cancelled, `claude mcp add-json -s user <name> <json>` puts the entry back, still inside the lock, with its own 30 s limit and no cancel signal. The entry is never logged and never appears in a message or in progress; only how the command ended is logged. The item ends `failed`: reason `MCP_FAILED` saying it was put back, or `MCP_RESTORE_FAILED` saying plainly that it was not and that the user must register it again by hand.

GPT's connections live in `~/.codex/config.toml`, read and written the same way but with no lock: an account switch changes only Codex's `auth.json` (measured with codex-cli 0.163.0 in a scratch `CODEX_HOME`). Checks read that file and keep only `command`, `args` and `url` of the named `[mcp_servers.<name>]`. `codex mcp add` replaces an entry of the same name in place, so re-registering after the confirmation of 3.3 needs no removal and a failed add leaves the old entry. Its output is not logged. **verify** in one real run (T-048) that Codex reaches the servers.

### 3.8 Rhino settings (accepted 2026-11-06)

`rhino-settings` item, part of the Rhino group, four parts. It runs only while no `Rhino.exe` is running, because Rhino rewrites its settings file when it exits and would undo the change (otherwise `needs-user`: "Rhino를 닫고 다시 시도하세요"). Only the `Default` scheme file is edited; other schemes are left alone. A backup of the file is written next to it (`.accountswitch-bak`) before the first change.

Both files edited here (parts 1 and 4) are written only when a write can keep every other byte: decoding as UTF-8 and encoding again must give the same bytes, and the file must hold no NUL byte (UTF-16 without a byte order mark would otherwise pass). A UTF-16 file (what PowerShell 5.1 `>` writes) or a CP949 file is left alone, and the item ends `needs-user` saying so in plain Korean. Only a file that does not exist counts as missing: any other read error writes nothing, and says so.

Parts 1 and 4 are implemented. Until parts 2 and 3 are measured in a real Rhino session (T-049) the item applies 1 and 4 and ends `needs-user` with reason `SETTINGS_PARTS_OPEN`, telling the user what to do by hand. If the check reports all four parts, it is `done`.

1. **Read-only warning on.** `%APPDATA%\McNeel\Rhinoceros\8.0\settings\settings-Scheme__Default.xml`, `<child key="Options">` → `<child key="FileSettings">` → `<entry key="EnableFileLockingOpenWarning">True</entry>` (measured: the entry exists and was `False` on the development PC). A missing entry or `FileSettings` is added inside `Options`; only that text changes, so the rest of the file stays byte for byte. No file yet, or no `Options`: this part stays open and is named in the `needs-user` message. Without it Rhino opens a locked file read-only without telling the user (ADR-003).
2. **`mcpstart` at Rhino start**, so rhinomcp listens without a manual command. This is Rhino's "run these commands every time Rhino starts" list in the same file. **verify** the exact element: set the list once in Rhino Options with Rhino closed afterwards, diff the file, then write the same element. The likely name is `StartupCommands` (strings in `RhinoCore.dll`); no such entry exists in the file while the list is empty. Existing commands in the list are kept; `_mcpstart` is appended once.
3. **Grasshopper starter file** `Documents\AccountSwitch\cordyceps-start.gh` holding one Cordyceps component. Cordyceps has no auto start (measured: no assembly-priority or idle hook; its HTTP server starts when the component solves on a canvas). The file is made once from a real Grasshopper session and shipped as a template. With rhinomcp running, Claude can open it itself (`-_Grasshopper _Document _Open "<path>" _Enter` through rhinomcp `run_command`), which starts Cordyceps.
4. **Tool-role note** appended to `~/.claude/CLAUDE.md` (created if missing): Rhino document scripts and measurements through `rhino`, Grasshopper and viewport looks through `cordyceps`, open the starter file to start Cordyceps, never kill Rhino by process name. Only the text between `<!-- accountswitch:start -->` and `<!-- accountswitch:end -->` is ever written or replaced. A file that already exists gets the same `.accountswitch-bak` backup before its first change.

### 3.9 `setup-state.json`

In the data folder: `{ "version": 1, "mode": "check" | "auto", "finishedAt": ISO, "items": { "<id>": { "status": "...", "version": "...", "at": ISO } } }`. Written after each item, so a closed window resumes from the last state.

## 4. Launcher

- Two buttons at the bottom of the 계정 tab, left of 새로고침 (Windows only, in the desktop window and in a browser): **Claude 열기** runs Claude Code, **GPT 열기** runs Codex CLI. Each is disabled while its CLI is missing, with "설치 탭에서 <name>를 먼저 설치하세요".
- Pressing one opens the system folder dialog at once (`IFileOpenDialog` with `FOS_PICKFOLDERS`, the same dialog VS Code uses); choosing a folder opens the terminal. There is no menu and no list of recent folders (user, 2026-11-07: with one option a menu is only an extra click). The dialog itself starts where it was last used. Closing the dialog does nothing.
- Launch: `cmd.exe /K` with `WorkingDirectory` set to the folder and the resolved program path as the command, so no `cd` is needed and the window stays open after the program exits. Window title `Claude Code - <folder name>` or `Codex - <folder name>`. The terminal uses the login currently in use (the 사용 account of that service).
- Page to shell: WebView2 `window.chrome.webview.postMessage({ type: 'launcher.open', provider })` with `provider` `claude-cli` or `codex-cli`. The shell shows the dialog and launches. It answers only a failure: `{ type: 'launcher.failed', provider, reason }`. The shell accepts messages only from the app's own page origin.
- In the browser (`npm start`), where there is no shell, pressing the button opens a text field for a path, and the engine launches `cmd.exe` itself.

Engine routes (session cookie and origin rules as every other route):

| Method, path | Body | Answer |
|---|---|---|
| `GET /api/v1/launcher` | | `{ platform, installed: { 'claude-cli': boolean, 'codex-cli': boolean } }` |
| `POST /api/v1/launcher/open` | `{ provider, folder }` | `{ folder }` with the normalized path. Windows only |

Reasons, the same in `launcher.failed` and in the engine's `{ code }` (HTTP 409):

| Reason | Meaning |
|---|---|
| `CLI_UNAVAILABLE` | the program does not resolve |
| `FOLDER_NOT_FOUND` | not an existing folder |
| `FOLDER_INVALID` | not a full local path (`C:\…`), or characters no folder name can have |
| `FOLDER_NETWORK` | a `\\server\share` path; `cmd` cannot start in one and would silently fall back to the Windows folder, so it is refused. A mapped drive letter works |
| `LAUNCH_FAILED` | Windows could not start `cmd.exe` there |
| `UNSUPPORTED_PLATFORM` | engine only: not Windows |
| `DIALOG_FAILED` | shell only: the folder dialog could not open |
| `BUSY` | shell only: a dialog or launch is already under way |

Launch details, the same in the shell (`CliLauncher.cs`) and the engine (`src/core/launcher.ts`):

- The command line is a fixed string; the folder and the program path are never part of it, so a folder name with `&`, `^`, `%` or `!` cannot run anything. The folder travels as the working directory. The title and the program path travel in `ACCOUNTSWITCH_LAUNCH_TITLE` and `ACCOUNTSWITCH_LAUNCH_PROGRAM`, expanded only inside quotes, which `cmd` does not parse again.
- A hidden `cmd.exe` runs `start "<title>" "%ComSpec%" /D /S /V:OFF /K ""<program>""`. `start` is what gives the terminal its own console and sets the title without a `title` command, whose text `cmd` would parse. It also works from an engine that has a hidden console or shares the user's terminal.
- `cmd.exe` and the program are always absolute paths: `cmd` looks in the current folder first, and the chosen folder is untrusted, so a `claude.exe` inside it must not run. `/D` skips `AutoRun` commands, which could change the folder; `/V:OFF` keeps `!` literal.
- Environment for Claude Code: the same removal as `subscriptionEnvironment` in `src/core/cli.ts` (`ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_ENV_FILE`) plus `CLAUDECODE`, so a value inherited from another session cannot pin the terminal to one account or refuse to start. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` is then set, because Claude Code otherwise replaces the window title.
- Environment for Codex CLI: the same removal as `codexEnvironment` (`OPENAI_*`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `CODEX_AUTH_*`, `CODEX_THREAD_ID`, `CODEX_INTERNAL_*`, `CODEX_HOME`, `CODEX_CONFIG_*`) plus `CLAUDECODE`. `executable('codex-cli')` finds the binary inside the npm package, not npm's wrapper script, so when the program lies in that package the terminal gets what the wrapper would set: `CODEX_MANAGED_BY_NPM=1` and `CODEX_MANAGED_PACKAGE_ROOT`.
- The shell finds the programs as `executable()` does: `ACCOUNTSWITCH_CLAUDE_PATH`, `%USERPROFILE%\.local\bin\claude.exe`, the npm package's `claude.exe`, then `PATH`; and `ACCOUNTSWITCH_CODEX_PATH`, the npm package's `codex.exe`, the newest `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`, then `PATH`. It rebuilds `PATH` from the registry (machine, then user, then what the process already had) for the search and for the terminal, because an installer run after the shell started is otherwise invisible to it (see 3.5). The engine uses its own `PATH`, which setup keeps current.

## 5. Redesign

Every screen follows `DESIGN.md`. Functional constraints:

- Same endpoints and behavior; only markup and CSS change for the 계정 tab, with these exceptions: usage turns red at 100 % instead of 90 % (`DESIGN.md` §5.3 "red at limit"); login-expiry and lookup-failure notes are red; a list that never loads shows an error state with 다시 시도 instead of a guessed default row; the connection error has a 다시 시도 button; the theme follows a live system change until the user chooses; adding an account is folded behind a "+ 계정 추가" button, and Enter in the field adds it.
- Theme toggle: the two-state pill of `DESIGN.md` §5.2, at the right end of the header, same storage key; system theme until the user chooses.
- Fonts are bundled in the build (CSP forbids remote fonts).

## 6. Logo and icons

Deliverables in `assets/brand/`: master `logo.svg` (mark, drawn by hand), and from `npm run build:icons` (`scripts/build-icons.mjs`, results committed): `accountswitch.ico` (16, 20, 24, 32, 40, 48, 64, 256), `tray-light-taskbar.ico` and `tray-dark-taskbar.ico` (16, 20, 24, 32), macOS `icon.png` 1024 and the menu bar template `menubar-template.png` with `menubar-template@2x.png` (18 and 36). There is no wordmark file and no logo inside the page: the window title bar carries the icon and the name, and the page keeps the name as a hidden heading (`DESIGN.md` §5.1, §8).

The shell picks the tray icon from `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\SystemUsesLightTheme`: nonzero is a light taskbar; zero, a missing value or a failed read is a dark taskbar. The size follows the display scale (Windows' small-icon size, next listed size up, 32 above that). It re-checks both when Windows reports a settings change, and a new icon replaces the old without a restart. If the icon cannot be loaded, the tray shows the app icon.

`npm run build:icons` and the build scripts copy `accountswitch.ico` to `src/desktop/shell/accountswitch.ico` and `icon.png` to `src/desktop/mac/icon.png`. The macOS build copies the template images into the macOS app's `Contents/Resources`. The tray icons are embedded in the Windows exe by the project file, since the installed and portable layouts differ. See `DESIGN.md` §8 for how the mark is made.

## 7. Release 0.3.0

- Includes the 0.2.2 commits not yet released (latest release is 0.2.1): every account can sign in again (the one in use in place), a signed-out account shows 로그인 instead of 사용, "MM.DD 로그인 만료" within three days of a Claude login's end, errors in red, install hint for a missing CLI.
- Regression to check by hand before tagging: an added account whose login expired can be signed in again from its ⋯ menu, and, once signed out and not in use, removed.
- Version `0.3.0` in `package.json`; README updated for the new tabs; tag only after the user confirms (CLAUDE.md).
