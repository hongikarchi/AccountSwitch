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

macOS keeps the account features. Since #30 it also has the 설치 tab, showing only the items of the catalog whose `platforms` include `darwin` (3.11). The launcher stays hidden there (`navigator.userAgent` contains `Mac OS X`, or the engine reports `platform !== 'win32'`). The redesign applies to both.

Out of 0.3.0: CAD (AutoCAD, ZWCAD; ADR-004), Claude plugins, skills, `settings.json` templates, GitHub CLI, browser extensions, VS Code. Skills, `settings.json` and rules came with #30 (3.11).

## 2. Behavior that must not change

- Account model, switching, refresh, auto switch, usage polling, uninstall restore: as in `README.md` (기본 로그인 전환, 자동 전환, 사용량 조회).
- 0.3.1: the default login (the CLI's own before any switch) can be removed like an added account once it is signed out and not in use. Its folder is deleted, and `removedDefaults` in `profiles.json` keeps it out of the list, the order, auto switch and the uninstall restore (which then leaves the account in use as the CLI's login). It does not come back. A greyed ⋯ item says why under the menu (in use; still signed in).
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
- **자동으로 설정해 주세요**: first ask what the user works with (user, 2026-11-08). One screen shows a card for each optional group, in catalog order (Claude Code, GPT, Paseo, Rhino, Blender), and an unavailable ZWCAD card that comes later (out of 0.3.0, ADR-004), with no descriptions. The Paseo card starts ticked (`defaultPicked` of its group, user 2026-11-24, #23); the others start unticked. A card whose items are all there, as far as they apply (below), says 설치됨 and cannot be chosen; a card with something left to install can (user, 2026-11-08). Pressing **다음** needs Claude Code or GPT ticked or already there, because AccountSwitch means nothing without one of them: otherwise a warning window says so and nothing happens. With one, the check result goes through the same rule as the checklist: everything missing in the base group (Git, Python and the rest come along) and the ticked groups installs in catalog order, at once. 다음 stays disabled until the check has answered. When nothing can install (nothing missing, or only items the user has to install), 다음 shows the checklist instead of starting a run. After a run, and whenever the tab opens with `mode: auto` in `setup-state.json`, the screen is the checklist.

Rules for both modes:

- 버전 다름 offers an install only for MCP items (다시 등록, sent in `replace` after a confirmation) and, in 점검만 mode, items with `warnIfOtherVersion` (Blender, after its warning). Auto mode never installs over another version (3.3), so it offers neither that nor a button that would do nothing. Any other different version has no install offer, because the app does not replace a user's install.
- `timeout` and `error` mean the state is unknown, so they offer only 다시 확인, never an install.
- An item the user has to install (`install.automatic: false`, Rhino) has no checkbox, only its link. It is part of the run when its group is ticked, and the runner reports it `needs-user`.
- When `setup-state.json` exists, the tab skips the first screen and opens the checklist of its `mode`; 처음으로 goes back to the first screen.
- Unticking a dependency leaves its dependents ticked, and each row says what it needs first. The runner decides what happens to them (3.4).
- A connection applies only to a terminal program in use: ticked on the card screen, or already installed. So an item whose dependency is in an optional group not in use is neither counted nor installed by a card or by a group's button: with GPT and Rhino but not Claude Code, the Rhino plugins and the GPT connections install and the Claude Code connections do not.
- The checklist is one stepper (user, 2026-11-08). Under the base items come Claude Code and Codex CLI as ordinary rows. Under "필요하면 더 고르세요" come Paseo, Rhino and Blender, one row each with no checkbox: the row says how many of its items are installed ("6개 중 4개 설치됨") and its **설치** button runs what is missing. Its items can be unfolded (항목 보기), each with its own row, which is where 다시 등록 and another version's warning are; a group with a failure, another version or an unknown state shows them unfolded.
- A run shows on the same checklist; there is no separate run screen (user, 2026-11-08). Each item in the run takes its run state on its own row: the running ring while it installs, 기다리는 중, 완료, or 실패 with 다시 시도, 건너뛰기 and 로그 보기 while the run waits. A Rhino or Blender row with items in the run is unfolded and its node runs too. The title says 설치하고 있어요 (설치가 멈췄어요 while waiting), 처음으로 is gone, install buttons and checkboxes are off, and the summary bar shows the run's count with 취소. When the run ends the same list shows the result.

### 3.3 Item catalog (setup manifest)

The catalog is data in `src/core/setup/manifest.ts`: id, Korean label and one-line description, group, `dependsOn`, check, install, pinned version, `mayElevate`. The page renders from the catalog; adding an item does not need UI code.

**Base group (always offered, comes along with Claude Code or GPT in auto mode):**

| id | Check (installed when) | Install | Version | Elevates |
|---|---|---|---|---|
| `git` | `git --version` succeeds, or `C:\Program Files\Git\cmd\git.exe` or `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` exists | winget `Git.Git`, fallback the newest `Git-<version>-64-bit.exe` of git-for-windows (latest installers, below) with `/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` | latest | yes for an account in Administrators; a standard account installs per user with no prompt |
| `gh` | `gh --version` succeeds, or `C:\Program Files\GitHub CLI\gh.exe` or `%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe` exists | winget `GitHub.cli`, fallback the newest `gh_<version>_windows_amd64.msi` (latest installers) with `msiexec /i <file> /passive /norestart` | latest | yes |
| `node` | `node -v` major is 22 or newer (Codex CLI asks for 16 or newer) | winget `OpenJS.NodeJS.LTS` without a version (the newest LTS), fallback the newest LTS `node-v<version>-x64.msi` from nodejs.org (latest installers) with `msiexec /i <file> /passive /norestart` | latest LTS | yes |
| `uv` | `uv --version` and `uvx --version` | official script `irm https://astral.sh/uv/install.ps1 \| iex` (user scope, `%USERPROFILE%\.local\bin`) | latest | no |
| `python` | `py -3.13 --version` succeeds | winget `Python.Python.3.13` with `--scope user`, fallback `https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe /passive /norestart InstallAllUsers=0 PrependPath=1`. Folders: `%LOCALAPPDATA%\Programs\Python\Python313`, `%LOCALAPPDATA%\Programs\Python\Launcher` | 3.13.x | no (an older all-users `py` launcher already on the PC can prompt, because the installer upgrades it in place) |
| `env` | all three hold: CurrentUser execution policy allows local scripts; user PATH contains `%USERPROFILE%\.local\bin`; user variable `PYTHONUTF8=1` | set what is missing (3.5) | – | no |
| `py-base` | `py -3.13 -m pip show` finds all of: openpyxl pypdf pdfplumber pymupdf pillow numpy requests beautifulsoup4 python-dotenv | `py -3.13 -m pip install <missing>` | latest | no |
| `py-gis` | pip show pyshp pyproj shapely rtree | pip install | latest | no |
| `py-3d` | pip show rhino3dm trimesh | pip install | latest | no |

**Optional groups, the cards of 3.2 (unchecked until the user ticks the group, except Paseo, which starts ticked). The Python map and 3D packages are part of the base group, and the HWP package is gone (user, 2026-11-07):**

| Group | id | Check | Install | Version |
|---|---|---|---|---|
| Claude Code | `claude` | `executable('claude-cli')` resolves (`src/core/cli.ts`); when it does not because an update stopped midway, the row says so (3.10) | first `claude-restore`, which acts only after an update stopped midway (3.10); then `irm https://claude.ai/install.ps1 \| iex` (native installer, `%USERPROFILE%\.local\bin\claude.exe`) inside `DefaultLogin.exclusive` (3.7) | latest |
| GPT | `codex` | `executable('codex-cli')` resolves | `npm i -g @openai/codex` (after `node`; `%APPDATA%\npm`) | latest |
| Paseo | `paseo` | `Paseo.exe` exists in `%LOCALAPPDATA%\Programs\Paseo` or `%ProgramFiles%\Paseo` (the folders 3.11 runs Paseo's CLI from) | winget `Paseo.Paseo --scope user`, fallback the newest `Paseo-Setup-<version>-x64.exe` of getpaseo/paseo (latest installers) with `/S /currentuser` (rules below) | latest |
| Paseo | `paseo-settings` | `settings.daemon.keepRunningAfterQuit` is `true` in `%APPDATA%\Paseo\desktop-settings.json` | set that one value, only while Paseo is not running (rules below) | – |
| Rhino | `rhino` | `C:\Program Files\Rhino 8\System\Rhino.exe` exists | not installable: show "Rhino 8을 먼저 설치하세요" with a link; later Rhino items wait for it | 8 |
| Rhino | `rhinomcp-plugin` | a version folder exists in `%APPDATA%\McNeel\Rhinoceros\packages\8.0\rhinomcp\` | `C:\Program Files\Rhino 8\System\Yak.exe install rhinomcp` (the newest on Yak) | latest |
| Rhino | `rhinomcp-launcher` | `%LOCALAPPDATA%\AccountSwitch\mcp\rhinomcp-launch.py` holds exactly the current launcher (rules below) | write that file | – |
| Rhino | `rhinomcp-mcp` | user-scope MCP server `rhino` exists in `~/.claude.json` and runs the launcher | `claude mcp add -s user rhino -e RHINO_MCP_HOST=127.0.0.1 -- uv run --no-project --quiet <launcher>` | follows the plugin |
| Rhino | `rhinomcp-codex` | server `rhino` in `~/.codex/config.toml` runs the launcher | `codex mcp add rhino --env RHINO_MCP_HOST=127.0.0.1 -- uv run --no-project --quiet <launcher>` | follows the plugin |
| Rhino | `cordyceps-plugin` | a version folder in `%APPDATA%\McNeel\Rhinoceros\packages\8.0\cordyceps\` holds `Cordyceps.gha` | `Yak.exe install cordyceps` (the newest on Yak) | latest |
| Rhino | `cordyceps-mcp` | user-scope MCP server `cordyceps` exists | `claude mcp add -s user --transport http cordyceps http://127.0.0.1:26929/mcp` | – |
| Rhino | `cordyceps-codex` | server `cordyceps` in `~/.codex/config.toml` | `codex mcp add cordyceps --url http://127.0.0.1:26929/mcp` | – |
| Rhino | `rhino-settings` | see 3.8 | see 3.8 | – |
| Blender | `blender` | `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe --version` reports 5.2.3. Nothing in that folder: the Uninstall keys of the registry are read for a Blender elsewhere (rules below) | winget `BlenderFoundation.Blender --version 5.2.3`, fallback `https://download.blender.org/release/Blender5.2/blender-5.2.3-windows-x64.msi` with `msiexec /i <file> /passive /norestart` (elevates, machine scope only) | 5.2.3 |
| Blender | `blender-mcp-addon` | `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\blender_mcp_addon.py` present and enabled in user prefs | download `https://raw.githubusercontent.com/ahujasid/mcp-for-blender/15c775ff78264346a1d09089a799c52c2fd9f797/addon.py` (the commit whose server is byte-identical to PyPI 1.5.5; the project publishes no GitHub releases), check SHA-256 `82d709a542fd268ed8e0e1da4fa9632df65b912fea850380baf6c47ab45a88fb`, save it as `blender_mcp_addon.py`. When no `5.2\config\userpref.blend` exists and an older version folder does, a separate `blender.exe -b --python-exit-code 1 --python-expr` first runs `bpy.ops.preferences.copy_prev()` (rules below). Then `blender.exe -b --python-exit-code 1 --python-expr` runs `addon_install`, `addon_enable(module='blender_mcp_addon')`, sets its `telemetry_consent` preference to `False`, and runs `wm.save_userpref`. Never `--factory-startup`: Blender then skips reading the user's prefs and the save overwrites them with factory values. **verify** this command in one real run (#1) | 1.5.5 |
| Blender | `blender-mcp-start` | `%APPDATA%\Blender Foundation\Blender\5.2\scripts\startup\accountswitch_blender_mcp.py` holds exactly the current start script (rules below) | write that file; the folder is created if missing | – |
| Blender | `blender-mcp` | user-scope MCP server `blender` exists | `claude mcp add -s user blender -e DISABLE_TELEMETRY=true -- uvx --with mcp==1.30.0 blender-mcp@1.5.5` | 1.5.5 |
| Blender | `blender-mcp-codex` | server `blender` in `~/.codex/config.toml` | `codex mcp add blender --env DISABLE_TELEMETRY=true -- uvx --with mcp==1.30.0 blender-mcp@1.5.5` | 1.5.5 |

Rules:

- `gh` (user, 2026-11-09: a new user asking Claude to put a project on GitHub found no `gh`). The wizard only installs it. It never runs `gh auth login` and never reads or writes its token: the user signs in once, in the browser, by typing `! gh auth login --web --git-protocol https` in Claude Code (README). **verify** on a fresh PC that this opens the browser sign-in (#17).
- **Latest by default** (user, 2026-11-24, #25): an item installs the newest release unless a newer one is known to break something. The pins left: Python 3.13 (its Windows installers end at 3.13.17), and the Blender group until #26. A program already on the PC is not upgraded here (#27 adds that).
- **Latest installers.** The fallback installers of `git`, `gh` and `node` are found when the step runs, not written into the manifest. Each comes with the SHA-256 that its publisher states, from the publisher's own host:
  - `node`: the first entry of `https://nodejs.org/dist/index.json` whose `lts` is set gives `v<version>`. The installer is `https://nodejs.org/dist/v<version>/node-v<version>-x64.msi`, and its hash is the line for that file in `https://nodejs.org/dist/v<version>/SHASUMS256.txt`.
  - `git`, `gh` and `paseo`: `https://api.github.com/repos/git-for-windows/git/releases/latest`, `https://api.github.com/repos/cli/cli/releases/latest` and `https://api.github.com/repos/getpaseo/paseo/releases/latest`. The asset named `Git-<version>-64-bit.exe`, `gh_<version>_windows_amd64.msi` or `Paseo-Setup-<version>-x64.exe` (not the `Paseo-Setup-<version>.exe` that holds every architecture) gives the address (under `https://github.com/<repo>/releases/download/`), and its `digest` (`sha256:<hex>`) gives the hash.

  Anything that does not have this shape, from a version that is not `X.Y.Z` to an address that leaves the allowed hosts, ends the item `failed` with reason `LATEST_UNKNOWN`. Measured 2026-11-24: Node 26.13.1 LTS, Git 2.56.1.windows.1 (digest `c330c72e…a5a559`, the value in its release notes).
- **rhinomcp follows the plugin on disk** (user, 2026-11-24, #25). The plugin talks to the server, and rhinomcp says the two share one version: "an older plugin silently ignores parameters it does not know". Rhino updates its packages by itself, so a version written into the registration falls behind. Measured on the development PC: plugin 0.5.1, both servers registered at 0.4.1.1. So the registration names no version. It runs a launcher, `%LOCALAPPDATA%\AccountSwitch\mcp\rhinomcp-launch.py`, through `uv run --no-project --quiet`. `--no-project` matters because an MCP server starts in the user's project folder, whose own `pyproject.toml` uv would otherwise pick up.

  The launcher's text lives in `src/core/setup/rhinomcp-launcher.ts` and uses the Python standard library only. Each time it starts, it:
  1. reads the newest version folder of the plugin;
  2. asks `https://pypi.org/pypi/rhinomcp/<version>/json`, waiting at most 3 s, whether that version exists;
  3. if it does not, takes the newest PyPI release not newer than the plugin. A new release has reached Yak before PyPI by up to 20 hours (0.5.0);
  4. runs `uv tool run rhinomcp@<version>` with its own standard input and output, and exits with that server's code. With no plugin folder, or with no answer from PyPI, it runs that version as is, or `rhinomcp` when there is no folder, and uv's cache decides.

  The file is AccountSwitch's alone: any other text in it, an older launcher, is replaced whole. The fixed folder is not the data folder that `ACCOUNTSWITCH_DATA` can move, because the registration names the file. A registration that runs anything else, such as an older `uvx rhinomcp@0.4.1.1`, is 버전 다름 and is re-added only after the user confirms, like any MCP item.
- **Paseo** (user, 2026-11-24, #23). It installs after Claude Code and Codex CLI, its place in the catalog, and for the current user only, the scope its winget manifest calls `user` (`/currentuser`, folder `%LOCALAPPDATA%\Programs\Paseo`), so no elevation prompt. **verify** in Windows Sandbox that both ways install there (#1). **verify** there too that the silent installer does not start Paseo. A fresh Paseo has `pluginsEnabled` unset (measured with an empty `--home`), so 채워 넣기 of 3.11 turns it on.
  - Paseo on Windows keeps the PATH it started with. So when `claude` or `codex` was installed in a run (a step ran and the item is `done`) while `Paseo.exe` is running, that item's message also says Paseo has to be quit and started again to find it, daemon included, the PC restart being the simple way (`noteIfRunning` in the manifest, so no item id is named in code). With `keepRunningAfterQuit` on, closing the window leaves the daemon with the old PATH.
  - `paseo-settings` is "종료 후에도 데몬 계속 실행" of Paseo's 설정 → 데몬, off by default, so closing the window stops the agents. It is a desktop-app setting, not part of the daemon config of 3.11. It depends on `paseo`. Measured in Paseo 0.17.4 (its `desktop-settings` store): Paseo writes the file as two-space JSON with a final newline, by a temporary file and a rename, and resets `keepRunningAfterQuit` to its default whenever `migrations.daemonStopOnQuitDefaultApplied` is not `true`. So the item:
    1. ends `needs-user` (reason `PASEO_RUNNING`, or `PASEO_STATE_UNKNOWN` when `tasklist` does not answer) while `Paseo.exe` runs, saying where to turn it on in Paseo or to quit Paseo and try again. Nothing is ever killed;
    2. ends `needs-user` (reason `PASEO_SETTINGS_OPEN`) when the file is missing, or does not yet hold `daemonStopOnQuitDefaultApplied: true`, saying to start and quit Paseo once. It never creates the file;
    3. otherwise sets only `settings.daemon.keepRunningAfterQuit` to `true`, keeps every other key and Paseo's format, and writes under the same rules as 3.8: the UTF-8 round trip, and a `.accountswitch-bak` copy before the first change. A file that does not parse as such an object is left alone (`needs-user`, `PASEO_SETTINGS_OPEN`).
  - macOS is not done yet: it would take the DMG asset, `~/Library/Application Support/Paseo/desktop-settings.json` and `pgrep` for the running check (#23).
- `python` reports missing, not 버전 다름, when only another Python exists, because 3.13 installs alongside it.
- `blender-mcp-addon` "enabled" is a read-only search of `userpref.blend` for the module name followed by NUL, so a check never starts Blender (**verify** that disabling the add-on removes the name, #2).
- `dependsOn` gates order: `codex` after `node`; `py-*` after `python`; `*-mcp` after `claude` and, for uvx servers, `uv`; Rhino plugins after `rhino`; the rhinomcp servers after `rhinomcp-plugin` and `rhinomcp-launcher`; Blender add-on after `blender`, its start script after the add-on.
- An item already installed with a different version than pinned shows **버전 다름** with the found version. Auto mode does not downgrade or replace a user's existing install, except the MCP registrations, which are re-added only after the user confirms. In a run: in `auto` mode such an item ends `skipped` with reason `OTHER_VERSION_KEPT`, and items depending on it still go ahead (a step that truly needs the pinned one reports it itself). In `check` mode, where the user pressed that item's own button, it installs. An MCP item registered differently ends `needs-user` with reason `REPLACE_NOT_CONFIRMED` in both modes unless named in `replace`; then `claude mcp remove -s user <name>` and the add run inside one lock.
- `blender-mcp-addon` also waits for Blender to be closed (`needs-user`, reason `BLENDER_RUNNING`), because Blender saves its preferences on exit and would undo the change. Detecting only; nothing is ever killed.
- Every winget install runs `<winget> install --id <id> -e --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity` plus the arguments in the table. `--version` takes an exact version only (`24` and `24.*` are refused). On 2026-11-18 winget moved every Node 24 out of `OpenJS.NodeJS.LTS` into `OpenJS.NodeJS.24`, so the 0.3.x pin `OpenJS.NodeJS.LTS --version 24.22.1` stopped resolving (measured 2026-11-24), and only the fallback installed Node.
- winget missing or failing moves to the fallback in the table, except after `ELEVATION_DECLINED` and the exit codes on the stop list (3.6).
- `BlenderFoundation.Blender` declares `UpgradeBehavior: uninstallPrevious`, so winget may remove another installed Blender. When a different Blender version is found, its install button warns about this first.
- A Blender outside `%ProgramFiles%\Blender Foundation` counts too, because winget can remove it. When that folder holds no Blender, the same PowerShell snapshot as 3.5 step 1 reads `HKLM` and `HKLM\WOW6432Node` and `HKCU` `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`, read only, for a `DisplayName` of `Blender`, optionally followed by a version and `LTS` (measured on the development PC: `Blender`, `DisplayVersion` `5.2.3`, `InstallLocation` with a trailing backslash; 276 ms). A hit reports 버전 다름 with its `DisplayVersion`, even when that equals the pin, since the add-on step needs the known folder. An entry whose `InstallLocation` has no `blender.exe` is a leftover and does not count. That Blender is never started. If the snapshot could not be read, the state is unknown: `error`, not `missing`.
- `blender-mcp-addon`: `wm.save_userpref` creates `5.2\config\userpref.blend`, after which Blender no longer offers to import settings from the previous version. So when that file is missing and `%APPDATA%\Blender Foundation\Blender` holds an older `X.Y` folder, the settings are copied first, in a run of their own, after the add-on passed its hash and before it is installed. That run is limited to 5 minutes. If it fails or times out nothing is lost (it only copies out of the old folder), it is logged, the add-on still installs, and the item's message says the settings did not come along. A cancel stays a cancel. **verify** in one real run (#1): `copy_prev` works under `-b`, and the old settings are there afterwards.
- `blender-mcp-start` (0.3.2, user 2026-11-09: Blender should answer without pressing "Connect to Claude"). Blender imports every module in `scripts\startup` at each start and calls its `register()`. The script, whose text lives in `src/core/setup/blender-startup.ts`, does nothing under `-b`. In a Blender with a window it registers a one-second timer. The timer runs `bpy.ops.blendermcp.start_server()`, the operator behind that button, when the add-on `blender_mcp_addon` is enabled and `bpy.types.blendermcp_server` is not set yet. An error is only printed. The server then listens on `localhost:9876`, as it does after the button. A second Blender open at the same time fails to bind and only prints. The file belongs to AccountSwitch: another text in it (an older version) is replaced whole, and nothing else in the folder is touched. Writing it does not need Blender closed. It applies from the next Blender start, which the item's note says. Removing the file turns it off. The item depends on `blender-mcp-addon`.
- Every installer the engine downloads has a required SHA-256 from its publisher: written in the manifest for a pinned one (`download-installer`), found with the installer for the latest ones (`download-latest`, above). The installer is hashed on disk right before it runs and does not run on a mismatch (`failed`, reason `HASH_MISMATCH`, no later step). A pin and its hash change together here and in the manifest.

| Installer | SHA-256 | Published at |
|---|---|---|
| `python-3.13.17-amd64.exe` | `5da012101ba2e17113a9a1cd901e9ce1441086f2b7ecb5de06ec94163899a190` | the SHA-256 column of `https://www.python.org/downloads/release/python-31317/` (its API and SPDX file agree) |
| `blender-5.2.3-windows-x64.msi` | `a103d4ece8d9acffd2a95c9d8860355b1f209977cc983b4a3d1e1cfb441c8605` | `https://download.blender.org/release/Blender5.2/blender-5.2.3.sha256` |

- blender-mcp telemetry stays off. Its server defaults to on and sends data to the project's own database; its add-on defaults to consent for prompts, code and screenshots; its terms allow indefinite retention and AI training. The `-e` flag and the preference in the table turn both off. A user can turn them on later.
- Downloads come only from: winget and the installer URLs of its manifests (`nodejs.org`, `www.python.org`, `github.com` with `release-assets.githubusercontent.com`, `download.blender.org`), `github.com/getpaseo/paseo/releases/` for the Paseo installer, `api.github.com` for the three release lookups of the latest installers, npm, PyPI, `yak.rhino3d.com`, `claude.ai` and its redirect `downloads.claude.ai`, `astral.sh` and its redirect `releases.astral.sh` (the script can also use `github.com/astral-sh/uv`), and `raw.githubusercontent.com` for the one pinned add-on commit. The engine enforces this on everything it fetches itself, on every redirect (`src/core/setup/install-download.ts`). So `irm <url> | iex` is done as: fetch the script through that check, then `iex` the saved copy. What npm, pip, winget, Yak and the two install scripts fetch afterwards is theirs to fetch.

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
| Node and Blender MSI fallback through `msiexec`, Python fallback bundle | `1602` or `1223` (**verify** by pressing 아니요 once on a real prompt, #2) |

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

Checks do not run `claude mcp get`: measured, it starts the registered server as a health check, so `uvx` may download and run a package during what the user was told is a read-only check. Checks read the top-level `mcpServers` of `~/.claude.json` inside the same lock instead, and keep only `command`, `args` and `url` of the named server. `env` and `headers` may hold secrets and are dropped at once; nothing else in the file is used. The `claude` install item runs inside the same lock, because `install.ps1` ends by running `claude.exe install` and **verify** whether that step writes `~/.claude.json` (#1).

Re-registering a server the user confirmed (3.3) is the one exception to dropping `env`. Inside the lock, before `claude mcp remove`, the raw entry of that server under `mcpServers` is kept in memory, whole, including its `env`. If the file cannot be read or understood, nothing is removed. If the add then fails, times out or is cancelled, `claude mcp add-json -s user <name> <json>` puts the entry back, still inside the lock, with its own 30 s limit and no cancel signal. The entry is never logged and never appears in a message or in progress; only how the command ended is logged. The item ends `failed`: reason `MCP_FAILED` saying it was put back, or `MCP_RESTORE_FAILED` saying plainly that it was not and that the user must register it again by hand.

GPT's connections live in `~/.codex/config.toml`, read and written the same way but with no lock: an account switch changes only Codex's `auth.json` (measured with codex-cli 0.163.0 in a scratch `CODEX_HOME`). Checks read that file and keep only `command`, `args` and `url` of the named `[mcp_servers.<name>]`. `codex mcp add` replaces an entry of the same name in place, so re-registering after the confirmation of 3.3 needs no removal and a failed add leaves the old entry. Its output is not logged. **verify** in one real run (#1) that Codex reaches the servers.

### 3.8 Rhino settings (accepted 2026-11-06)

`rhino-settings` item, part of the Rhino group. Four parts are described; the wizard sets parts 1, 2 and 4, and part 3 stays the user's. It runs only while no `Rhino.exe` is running, because Rhino rewrites its settings file when it exits and would undo the change (otherwise `needs-user`: "Rhino를 닫고 다시 시도하세요"). Only the `Default` scheme file is edited; other schemes are left alone. A backup of the file is written next to it (`.accountswitch-bak`) before the first change.

Both files edited here (the settings file for parts 1 and 2, the note files for part 4) are written only when a write can keep every other byte: decoding as UTF-8 and encoding again must give the same bytes, and the file must hold no NUL byte (UTF-16 without a byte order mark would otherwise pass). A UTF-16 file (what PowerShell 5.1 `>` writes) or a CP949 file is left alone, and the item ends `needs-user` saying so in plain Korean. Only a file that does not exist counts as missing: any other read error writes nothing, and says so.

The item is `done` when parts 1, 2 and 4 hold (0.3.2, #3). Measured on Rhino 8 (2026-11-09: the start command set once in Options, Rhino closed, the file diffed): **Rhino leaves out every entry that holds its default when it saves.** The warning entry `True` that 0.3.0 and 0.3.1 wrote was dropped at the next exit, and so was an unrelated `False` default, so the 0.3.1 check kept reporting part 1 missing. Problems with the settings file (none yet, a file left alone) end `needs-user` with reason `SETTINGS_PARTS_OPEN`. Parts 1 and 2 are read and written by `src/core/setup/rhino-xml.ts`, which takes a child or an entry only when it sits directly in its parent.

1. **Read-only warning on.** `%APPDATA%\McNeel\Rhinoceros\8.0\settings\settings-Scheme__Default.xml`, `<child key="Options">` → `<child key="FileSettings">` → `<entry key="EnableFileLockingOpenWarning">`. On is Rhino's default, so a missing entry or `FileSettings`, or no file yet, counts as on and nothing is added. Only an entry with another value than `True` (measured: `False` on the development PC before 0.3.0) is replaced by `True`; only that text changes, so the rest of the file stays byte for byte. Without the warning Rhino opens a locked file read-only without telling the user (ADR-003).
2. **`mcpstart` at Rhino start**, so rhinomcp listens without a manual command. Measured: Rhino's "run these commands every time Rhino starts" list is `<child key="Options">` → `<child key="General">` → `<entry key="StartupCommands">_mcpstart</entry>`, with `General` the last child of `Options`. It holds when a word of that text is `mcpstart`, ignoring case and leading `_`, `-`, `!` or `'`. Otherwise `_mcpstart` is appended, after a space, to what the user has there. A missing entry is added in `General`, and a missing `General` as the last child of `Options`, in the file's indent and line ending. No file yet, or no `Options`: this part stays open and the `needs-user` message says "Rhino를 한 번 켰다가 끄면 설정 파일이 생겨요". Parts 1 and 2 go into one write with one backup. Without the rhinomcp plugin Rhino only reports an unknown command at start.
3. **Cordyceps placed by the user** (user, 2026-11-09). Cordyceps has no auto start (measured: no assembly-priority or idle hook; its HTTP server starts when its component solves in an enabled Grasshopper document). The user opens Grasshopper and places the component, best before opening Claude Code or Codex. A session connects to its MCP servers only when it starts, and one that was off then stays off for the session even after it starts (measured): Claude Code's `/mcp` reconnects it, Codex needs a new session. That is what the note of part 4 asks for, and the success the user looks for is `cordyceps` not marked failed in `/mcp`. Tried and dropped: rhinomcp's `gh_create_document` → `gh_add_component` → `gh_run_solution` leaves the document disabled without the editor open, so Cordyceps never solves (measured); a script that enables it works, but starting it from Claude 열기 before the terminal opened did not hold up in the real window, and the user chose placing it by hand. Nothing is written for this part.
4. **Tool-role note** for each terminal program that is installed: appended to `~/.claude/CLAUDE.md` for Claude Code and to `~/.codex/AGENTS.md` for Codex CLI (created if missing), the files each reads in every folder (Codex: https://developers.openai.com/codex/guides/agents-md; an `AGENTS.override.md` next to it would take its place). Nothing is written into a project folder. The same text in both (`src/core/setup/role-note.ts`): Rhino document scripts and measurements through `rhino`, Grasshopper and viewport looks through `cordyceps`, rhinomcp starts with Rhino (otherwise ask the user to open Rhino, or to type `mcpstart` in a Rhino opened before setup), when `cordyceps` is not connected ask the user to open Grasshopper, place the Cordyceps component and reconnect (`/mcp` in Claude Code, a new session in Codex), using `rhino` for Grasshopper meanwhile, never kill Rhino by process name. The check compares the whole text between the markers, so a note written by an older version counts as missing and is written again. Only the text between `<!-- accountswitch:start -->` and `<!-- accountswitch:end -->` is ever written or replaced. A file that already exists gets the same `.accountswitch-bak` backup before its first change.

### 3.9 `setup-state.json`

In the data folder: `{ "version": 1, "mode": "check" | "auto", "finishedAt": ISO, "items": { "<id>": { "status": "...", "version": "...", "at": ISO } } }`. Written after each item, so a closed window resumes from the last state.

### 3.10 A Claude Code update that stopped midway (#22)

Measured on Windows (2026-11-24), and open upstream as anthropics/claude-code#105554. The native installer updates itself in four steps:

1. It writes the new build to `%USERPROFILE%\.local\share\claude\versions\<version>`.
2. It copies the build to `claude.exe.new.<pid>.<time>.<random>` next to `claude.exe`.
3. It renames the running `claude.exe` to `claude.exe.old.<time>.<pid>`.
4. It renames the `.new` file to `claude.exe`.

A Claude Code that ends between steps 3 and 4 leaves no `claude.exe`. In the measured case its terminal closed about 0.1 s after the old file moved. Every terminal, VS Code and Paseo then report Claude Code missing. Before 0.3.6 the 계정 tab showed "Claude Code가 설치되어 있지 않습니다" in place of the accounts, which looked like being signed out. The logins are untouched.

- **Stuck** applies on Windows only, when all three hold:
  - `%USERPROFILE%\.local\bin\claude.exe` does not exist.
  - That folder holds a file named `claude.exe.new.*` or `claude.exe.old.*`.
  - The `versions` folder holds a file named only by a version (`2.1.331`).

  The newest such file, in numeric order, is the build to restore. The detection lives in `src/core/setup/claude-update.ts` and only reads.
- **Check.** While stuck, the `claude` item stays `missing` with the message "업데이트가 중간에 멈춰서 Claude Code가 빠졌어요. 받아 둔 새 버전(<version>)으로 고칠 수 있어요. 계정은 그대로예요."
- **Install.** The first step, `claude-restore`, does nothing unless the PC is stuck. When it does nothing, the install script runs as before. When stuck, it:
  1. copies the build to a temporary name in `.local\bin` and renames that to `claude.exe`. If a `claude.exe` appeared in the meantime, that one is kept and the copy removed;
  2. runs `claude.exe --version`. A failure removes the file it placed and moves on to the install script;
  3. on success, removes every `claude.exe.new.*` and `claude.exe.old.*` it can. A running Claude Code holds its own `.old` file, so that file cannot be removed; it stays and is only logged.

  It downloads nothing and writes neither `~/.claude.json` nor any login, so it takes no lock.
- **계정 tab.** While stuck and `executable('claude-cli')` finds no other Claude Code, `GET /api/v1/providers` (also with `?installed=1`) adds `stuck: true` to `claude-cli`.
  - The Claude section keeps showing its accounts, since switching works without the CLI. Above them, a notice says "Claude Code 업데이트가 중간에 멈췄어요. 계정은 그대로예요." with a **고치기** button.
  - 고치기 starts the same run the 설치 tab would, `POST /api/v1/setup/run { items: ['claude'], mode: 'auto' }`, and polls `GET /api/v1/setup/run` every second.
  - When the item ends `done`, the notice goes and the page asks `?installed=1` again at once.
  - Any other end shows "고치지 못했어요. 설치 탭에서 확인해 주세요." A failed item keeps the run waiting, so the 설치 tab shows it with 다시 시도 and 건너뛰기.
  - A 409 `SETUP_RUN_ACTIVE` shows "설치 탭에서 설치가 진행 중이에요. 끝난 뒤 다시 눌러 주세요."
  - This is the only run that starts outside the 설치 tab, and it too starts only from a press.

### 3.11 AI work settings (#30)

The rules, settings and skills for working with Claude Code, Codex CLI and Paseo, applied from the 설치 tab on Windows and macOS. They were the user's own settings repository (copied at its commit `c654bf9`, user 2026-11-26), and now live in this repository, so they are versioned, tested and shipped with the app and apply offline.

**Content**, in `setup-content/`, bundled into the engine at build time:

| File | Goes to | How |
|---|---|---|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md`; also `~/.codex/AGENTS.md` when Codex CLI is installed | the whole file, keeping AccountSwitch's own blocks (below) |
| `claude/settings.json` | `~/.claude/settings.json` | key by key (below) |
| `claude/skills/<name>/…` | `~/.claude/skills/<name>/`; also `~/.agents/skills/<name>/` when Codex CLI is installed | folder by folder (below) |
| `paseo/config.json` | Paseo's daemon config | key by key, through Paseo's own CLI (below) |

The only placeholder is `{{branchPrefix}}`, filled in when the files are written. No other text of the content changes on the way, and the content holds no personal, firm, client or project name, path or address (public repository).

**Item.** `ai-settings`, the one item of a new optional group `ai` ("AI 작업 설정", "Claude·GPT·Paseo로 일하는 규칙과 스킬을 넣어요."), on `win32` and `darwin`. It depends on nothing: each part that needs a program says so in its row and is skipped without it.

**Screen.** The item's row unfolds a panel, the only place where the choices are made:

1. **브랜치 접두어**, a text field. Accepted: `^[a-z0-9][a-z0-9-]{0,30}$`. Under it, live: "통합 브랜치: `<prefix>_develop`" and "작업 브랜치: `<prefix>_<작업 이름>`". The suffix `_develop` and the `_` are fixed (user, 2026-11-26). The 설치 button is off until the prefix is valid.
2. **방식**, two choices: **채워 넣기** (default: what is there stays, only what is missing is added) and **바꾸기** (this content's values win; what the content does not name stays).
3. **계획**, a table with one row per target, recomputed when the prefix or the mode changes, before anything is written:

| Action | Meaning |
|---|---|
| 추가 | not there; written |
| 같음 | already as the content says; nothing written |
| 채워 넣기 | there; the row names what gets added |
| 새 버전 | a file or skill AccountSwitch wrote earlier, unchanged by the user since, and the content has changed; replaced |
| 내 것 유지 | there and changed by the user since AccountSwitch wrote it, or a skill AccountSwitch did not write; left alone (채워 넣기) |
| 바꾸기 | replaced; the old one is backed up. Under 바꾸기 for what 채워 넣기 keeps, and in both modes for a rule file AccountSwitch did not write (below) |
| 건너뜀 | the program that part needs is missing, or its file cannot be read; the row says which |

Before 설치 is pressed, a row with something to do (추가, 채워 넣기, 새 버전, 바꾸기) can be switched to 내 것 유지 and back (`canKeep`). 같음, 건너뜀 and 내 것 유지 rows have nothing to switch. A saved id that the plan no longer has, because a file changed in between, is ignored.

The prefix, the mode and what was written are kept in the data folder, `ai-settings.json`: `{ "version": 1, "branchPrefix": "...", "mode": "fill" | "replace", "written": { "<target>": "<sha256>" } }`. Pressing 설치 saves the prefix and the mode and starts an ordinary run of `ai-settings` (3.4), so it is logged, one run at a time, and needs a press like every install.

**`CLAUDE.md` and `AGENTS.md` are AccountSwitch's whole** (user, 2026-11-26): one global rule file without duplicate rules, with the old one kept in the backup. Merging by section could not do that: the user's `## 언어` and the content's `## Language` are the same rule under two names.
- The file written is the content, then AccountSwitch's own marked blocks from the file it replaces, in their order. Today that is the Rhino note of 3.8, between `<!-- accountswitch:start -->` and `<!-- accountswitch:end -->`. So replacing the file never undoes another item.
- A file AccountSwitch did not write is 바꾸기 in both modes.
- A file AccountSwitch wrote is compared through its SHA-256, which is recorded in `written`. The hash is taken without AccountSwitch's marked blocks, so a Rhino note added later is no change by the user.
  - Same hash: the user has not changed the file. It is 같음 when it equals the content and 새 버전 otherwise.
  - Different hash: the user changed it. It is 내 것 유지 under 채워 넣기 and 바꾸기 under 바꾸기, like a skill.
- The same UTF-8 round-trip rule as 3.8 holds. A file that would not survive it is left alone, and its row says so.

**`settings.json`.** Read as JSON; a file that does not parse is 건너뜀, never overwritten. Objects merge key by key, and anything else (strings, numbers, booleans, arrays) is one value.
- 채워 넣기 adds each key the file lacks.
- 바꾸기 also sets each key the content names to the content's value.
- Keys the content does not name stay in both modes, so the user's permissions, hooks and plugins remain.

The write keeps the file's indentation (two spaces when unknown) and replaces it in one step.

**Skills.** A skill folder written by AccountSwitch carries `.accountswitch-managed.json`: `{ "version": 1, "files": { "<relative path>": "<sha256 of what was written>" } }`. A folder:
- missing: 추가.
- with that file, and every listed file still hashing to its value: written by us and not changed since. 같음 when it equals the content, otherwise 새 버전.
- otherwise, the user's own, changed by the user, or another tool's: 내 것 유지 under 채워 넣기, 바꾸기 under 바꾸기.

Writing replaces the folder's files with the content's and rewrites the manifest. Files in the folder that the content does not have are left alone.

**Paseo.** Only when the desktop app's bundled CLI is there; otherwise 건너뜀.
- On Windows it is `…\Paseo\resources\bin\paseo.cmd` under `%ProgramFiles%` or `%LOCALAPPDATA%\Programs`. It is run as what that file runs: `Paseo.exe` with `ELECTRON_RUN_AS_NODE=1` and the CLI script. A `.cmd` cannot take a JSON argument safely (measured: the quotes break).
- On macOS it is `/Applications/Paseo.app/Contents/Resources/bin/paseo`, or the same under `~/Applications`.

`paseo daemon config get --json` reads what is configured, from its `value`. Then, for each leaf of `paseo/config.json` (an array counts as one leaf):
- 채워 넣기 runs `paseo daemon config set <path> <JSON value>` for a path that is not set.
- 바꾸기 also runs it for a path whose value differs.

A map with names for keys, `agents.providers`, is different (measured: "Unknown configuration path … Replace its containing object with JSON for dynamic keys"). Its current value is merged with the content's, as `settings.json` is, and it is set whole, so the user's other providers stay.

Then `paseo reload`. Paseo's own command is used because Paseo rewrites its file while it runs. The phone relay is off in the content (`daemon.relay.enabled: false`, user 2026-11-26). 채워 넣기 keeps a relay the user turned on, and 바꾸기 turns it off. `pluginsEnabled: true` is Paseo's 설정 → Plugins → Enable plugins (#44). Without it Paseo's built-in `worktree-include` plugin does not run, and that plugin is what copies the gitignored files a project lists in `.worktreeinclude` into a new worktree (measured with Paseo 0.17.4, 2026-11-26: on, a new worktree got the listed `.env`). It follows the same fill and replace rule: unset is turned on, and a `false` the user chose stays under 채워 넣기. "종료 후에도 데몬 계속 실행" is a desktop-app setting, not part of this config: the `paseo-settings` item of 3.3.

**Routes** (session cookie and origin rules as every other route):

| Method, path | Body | Answer |
|---|---|---|
| `GET /api/v1/setup/ai-settings?prefix=<p>&mode=fill\|replace` | | `{ branchPrefix, mode, rows }`. `branchPrefix` and `mode` are the saved values (`null` and `fill` before the first save). `rows` is the plan for the asked prefix and mode; without `prefix` the saved one is used, and with none saved `rows` is empty. Each row is `{ id, part: 'rules' \| 'settings' \| 'skill' \| 'paseo', target, action, detail?, canKeep }`. `target` is shown with `~` for the home folder. 400 `INVALID_INPUT` for an invalid prefix. Read only |
| `PUT /api/v1/setup/ai-settings` | `{ branchPrefix, mode, keep: string[] }` | saves them; `keep` lists the row ids switched to 내 것 유지 for the next run. 409 `SETUP_RUN_ACTIVE` while a run is active |

The page then starts the run with `POST /api/v1/setup/run { items: ['ai-settings'], mode }`, `mode` being the screen's own (`check` on macOS), so applying the settings does not change how the 설치 tab opens next time.

**Bundling.** `setup-content/` is read from disk when the engine runs from source, and from the engine's SEA assets (`setup-content/<path>`, next to `ui/<path>`, `scripts/build-exe.mjs`) when packaged. Its files are listed at build time, so adding a skill needs no code change.

**Backup.** Before a file is first written in a run, it is copied to `~/.claude/backups/accountswitch-ai-settings-<YYYYMMDD-HHMMSS>/`, under `claude/…`, `codex/…`, `agents/…` or `paseo/config.json`. A skill folder is copied whole before it is replaced. A failed backup writes nothing for that target, and the run reports it.

**Check.** `installed` when every row is settled under the saved prefix and mode: 같음, 건너뜀 or 내 것 유지, or switched to 내 것 유지 by the user (kept until the next save). Otherwise `missing`, with the rows as `parts`. Also `missing` while no prefix is saved. Read only, like every check.

**macOS.** The 설치 tab shows the items whose `platforms` include `darwin`: for now only `ai-settings`. The rest of the catalog stays Windows-only. Installing programs on macOS (Claude Code, Codex CLI, GitHub CLI, Paseo) is a separate issue. On macOS the engine skips the Windows-only parts of 3.4 and 3.5: the PATH rebuild from the registry and the run marker the Windows shell reads.

## 4. Launcher

- Two buttons at the bottom of the 계정 tab, left of 새로고침 (Windows only, in the desktop window and in a browser): **Claude 열기** runs Claude Code, **GPT 열기** runs Codex CLI. Each is disabled while its CLI is missing, with "설치 탭에서 <name>를 먼저 설치하세요".
- With Paseo on the PC, the buttons open a Paseo conversation instead of a terminal (4.1, #45). Without it they open the terminal as described here (user, 2026-11-26).
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

### 4.1 Through Paseo (#45)

When Paseo's desktop app is on the PC, **Claude 열기** and **GPT 열기** start a Paseo agent in the chosen folder and show it in the Paseo window. There is no separate "Paseo 열기" button (user, 2026-11-26). Why the work is split this way: ADR-010.

**Finding Paseo.** As in 3.11: the bundled CLI under `%ProgramFiles%\Paseo` or `%LOCALAPPDATA%\Programs\Paseo`, run as `Paseo.exe` with `ELECTRON_RUN_AS_NODE=1`, never through `paseo.cmd`. Every call has no shell and passes each value as its own argument, so a folder or a message with Korean, spaces, `&` or `%` arrives as it is (measured). The CLI's environment drops `PASEO_AGENT_ID`, `PASEO_AGENT_CWD`, `PASEO_WORKSPACE_ID`, `PASEO_CLI` and `PASEO_DESKTOP_CLI`: measured, an engine started from inside a Paseo agent otherwise creates the agent in that agent's own workspace, whatever `--cwd` says.

**Models.** A select left of each button, shown only when there is a list for that service.
- The list comes from Paseo: `paseo provider ls --json`, then `paseo provider models claude --json` or `codex --json` for a provider whose `status` is `available`. Each entry shows `model` (e.g. "Opus 5.5") and sends `id`. `provider ls` also gives each provider's `defaultMode`.
- Both need Paseo's daemon, which runs only while the Paseo app does (measured). So the last good lookup is saved, and used while Paseo is closed.
- The engine keeps a good lookup for 10 minutes. A failed lookup is not kept.
- The data folder's `launcher.json` holds the choice and the last lookup: `{ "version": 1, "models": { "<service>": "<id>" }, "lists": { "<service>": [{ "id", "label" }] }, "modes": { "<service>": "<mode>" } }`. The choice is saved when the select changes. A saved model that the list no longer has falls back to the first in the list, which is Paseo's newest.

**Which way a button opens.** Paseo whenever Paseo is found; the terminal of 4 only without it (user, 2026-11-26). A button with no list yet (Paseo never answered on this PC) opens Paseo without a model, so Paseo uses its default. A button stays disabled while its CLI is missing, as in 4, since Paseo runs that CLI.

**Opening, in the engine:**
1. The folder must pass the same rules as 4 (`FOLDER_*`).
2. `paseo status --json` gives `serverId`. When the daemon does not answer (`DAEMON_UNREACHABLE` or no `serverId`), the engine starts `Paseo.exe` and asks again every second for up to 20 seconds.
3. `paseo workspace ls --json`: a workspace with `isolation` `local`, not `background`, whose `cwd` is the folder (compared without case), is reused with `--workspace <id>`. Measured: without it, every run adds another workspace for the same folder.
4. `paseo run --cwd <folder> [--workspace <id>] --provider claude[/<model>] | codex[/<model>] [--mode <defaultMode>] --title "관제탑 - <folder name>" --no-wait --json <first message>`. `--mode` is the provider's `defaultMode` from the last lookup (`auto` for Claude, `auto-review` for Codex, measured), so the agent starts as one made in the Paseo app does; without it `run` starts in `default`, which asks before every command. The answer is read from the first line that starts with `{` or `[`; `run` also prints lines such as "Created workspace <id> - <folder name>", and a folder name can hold brackets. No `agentId` is a failure.
5. `Paseo.exe paseo://h/<serverId>/agent/<agentId>`, detached, with `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE` and `PASEO_NODE_ENV` removed, as Paseo's own `open` command does. The running Paseo window takes the link and shows that agent. `paseo agent open` is not used: on Windows it looks only under `%LOCALAPPDATA%` and fails for a Program Files install (measured, Paseo 0.17.4).

The first message, the same for both services (proposed by Claude, 2026-11-26; the user may reword it):

> 이 폴더에서 관제탑으로 일해 주세요. 이 폴더가 git 저장소인데 아직 Paseo 방식으로 세팅되지 않았으면 먼저 paseo-workflow 스킬로 세팅하세요. 다른 폴더는 건드리지 마세요. 그다음 무엇을 할지 물어봐 주세요.

The agent judges whether the folder is set up; the skill (3.11) holds how. "다른 폴더는 건드리지 마세요" is there because a test agent in a plain scratch folder went looking in another project folder that Claude Code had been given as an extra working folder (measured, 2026-11-26; it only read). The agent uses the login in use, as the terminal does.

**Page to shell.** The page sends `{ type: 'launcher.pick', provider }`. The shell shows the folder dialog and answers `{ type: 'launcher.picked', provider, folder }`; a closed dialog answers nothing, and a failure is `launcher.failed` with `DIALOG_FAILED` or `BUSY`. Before answering, the shell calls `AllowSetForegroundWindow(ASFW_ANY)`, because the shell holds the foreground right after the user's click and Windows otherwise keeps the Paseo window behind. The page then calls the engine and shows its failure under the buttons. In a browser the path field of 4 sends the path to the same route.

**Routes** (session cookie and origin rules as every other route):

| Method, path | Body | Answer |
|---|---|---|
| `GET /api/v1/launcher` | | as in 4, plus `paseo: boolean`, whether Paseo's CLI was found |
| `GET /api/v1/launcher/models` | | `{ 'claude-cli': { models: [{ id, label }], chosen }, 'codex-cli': … }`, live or the last saved; `models` empty and `chosen` null when there is no list |
| `PUT /api/v1/launcher/models` | `{ provider, model }` | saves the choice; `{}` |
| `POST /api/v1/launcher/paseo` | `{ provider, folder, model? }` | `{ folder, agentId }`. Windows only |

Reasons added to those of 4: `PASEO_UNAVAILABLE` (Paseo's CLI is not found) and `PASEO_FAILED` (the daemon did not answer in time, or `run` gave no agent).

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
