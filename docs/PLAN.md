# Plan for 0.3.0 (Windows)

Order is chosen so the riskiest unknowns are measured early and every milestone leaves a working app. Each milestone ends with the checks in §3 and a short note in `TASK.md`.

## 1. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Docs: SPEC, DESIGN, PLAN, TASK, ADR, CLAUDE.md | Committed on a branch when the user asks |
| M1 | Design system and redesign of the 계정 tab, theme toggle, header with tabs | Light and dark screenshots at 480 px and 1100 px match DESIGN; `src/core` and `src/server` unchanged |
| M2 | Setup engine, read only: manifest, checks, PATH re-read, `GET /setup`, `POST /setup/check`; 설치 tab shows the stepper with real status | Correct status on the development PC (most items present) and in Windows Sandbox (nothing present) |
| M3 | Installs, in this order: base (`git`, `node`, `uv`, `python`, `claude`, `codex`, `env`, `py-base`), Python bundles, Blender group, Rhino group | Each item installs in Windows Sandbox from nothing (winget missing there, so the fallback path is exercised), re-check reports it installed, a new cmd window finds it on PATH |
| M4 | Launcher: shell bridge, folder dialog, `cmd /K claude`, recent folders | Opens Claude Code in a folder with a Korean name and spaces; recent list survives restart |
| M5 | Logo and icons | Approved concept, hand-drawn SVG, ICO and tray icons legible at 16 px on light and dark taskbars |
| M6 | Release 0.3.0 | §4 checklist passed, user confirms, tag pushed |
| Later | CAD (ZWCAD) after a hands-on test (ADR-004); macOS setup; terminal per account | – |

M1 goes first because the wizard screens are built from the same components. M2 before M3 because checks are read-only and safe to run anywhere.

## 2. How to test without harming this PC

- Run dev builds with `ACCOUNTSWITCH_DATA` pointing to a scratch folder. Do not press 사용 in a dev build unless the test is about switching: it changes the real `~/.claude` and `~/.codex` logins.
- Do not run `npm run build:installer` output on this PC: it would replace the installed 0.2.1. Use the portable build in `release\app`.
- The shell's single-instance mutex is per Windows session, not per data folder. While the installed copy runs, `release\app\AccountSwitch.exe` only brings the installed window forward, so the old version is on screen. Quit the installed copy from its tray menu first, and start it again afterwards.
- At start the shell writes or deletes the Windows Run entry `AccountSwitch` from `desktop.json` in its data folder. A scratch data folder defaults to autostart off, so a dev window deletes a real entry; a copy of real data with autostart on points the entry at the dev build. Before a dev window on a PC with autostart on, note the entry and restore it afterwards.
- Installs are tested in **Windows Sandbox** (Windows 11 Pro feature "Windows Sandbox"; enabling it needs an administrator and a restart, ask the user first). A `.wsb` file maps the portable build read-only. The sandbox resets on close.
- Rhino cannot be licensed in the sandbox: there, test the "Rhino 8을 먼저 설치하세요" path; test plugin detection on this PC, where both plugins are installed.
- Never kill Rhino or Blender by name (CLAUDE.md).

### First real install run (T-048), in order

Everything in M3 has so far run against fakes only. Windows Sandbox proves:

1. The portable build with a scratch `ACCOUNTSWITCH_DATA`: a check reports everything missing and PATH comes from the registry.
2. Base group in auto mode. winget is absent, so ENOENT leads to each fallback: Git, Node MSI, Python. One fallback passes its hash check on the real file.
3. Node `spawn` of the Git and Python installers works, with no error 740 and no blocked hidden window. `/norestart` is accepted by the Python bundle; note its exit code when a restart is pending.
4. Downloads pass the allowlist on the real redirects: github.com to release-assets, claude.ai to downloads.claude.ai, astral.sh.
5. The `uv` and `claude` scripts work through `iex` on the saved copy with `-NonInteractive`. Record whether `claude.exe install` writes `~/.claude.json`; if it does not, drop the lock from that step (it can hold the account lock for up to 15 minutes, SPEC 3.7).
6. `codex` installs through `node npm-cli.js`.
7. `py-base` and the three bundles install. Note whether `pyhwp` and `rtree` build on 3.13.
8. `env`: the read-PATH script runs for real, the value stays `REG_EXPAND_SZ` with other entries untouched, the policy is `RemoteSigned`, `PYTHONUTF8=1`.
9. A new `cmd` window finds git, node, uv, uvx, py, claude and codex.
10. Blender group: MSI fallback, then the add-on command on 5.2.3. `userpref.blend` lists the module, the telemetry preference is off, existing preferences survive. `copy_prev` works under `-b` and old settings arrive; note how far back it accepts a version folder. Note the `DisplayName` of an LTS Blender if one can be installed.
11. `blender-mcp`, `rhinomcp-mcp`, `cordyceps-mcp` land in `~/.claude.json` and a check reports installed. `add-json` round trip: a real entry with `env`, passed as a JSON argument, comes back identical.
12. Rhino missing: `rhino` is `needs-user`, its plugins and settings are `skipped`, and the run finishes.
13. Cancel during a slow install: the tree dies after the grace period, and only that tree. Quit during a run: the dialog, then a gentle stop.
14. The log has no tokens and no environment values. Note timings.

The Sandbox cannot prove these; they need the user on a real PC:

- 아니요 on a real prompt for `msiexec` and the Python bundle (1602 or 1223, SPEC 3.6). Reports say the Sandbox runs without a prompt.
- Yak installs on a PC where Rhino is licensed.
- Rhino parts 2 and 3 (SPEC 3.8): set the startup commands once in Rhino Options, close Rhino, diff the settings file; make the starter `.gh` in a real Grasshopper session.
- Disable the add-on once and confirm the module name leaves `userpref.blend` (SPEC 3.3).

Known limit: a quit during an MCP restore can cut it short, because the engine waits at most 12 s and the restore may take up to 30 s (SPEC 3.7).

## 3. Checks at the end of every milestone

1. `npm test`, `npm run typecheck`, `npm run format:check`.
2. `npm run build:desktop`, run `release\app\AccountSwitch.exe`, look at the window in light and dark.
3. Screenshots of changed screens (Playwright against `npm start`, or the window), compared with DESIGN.
4. File and structure check: no personal paths or names in the diff (public repo), docs match code (SPEC tables vs manifest).

## 4. Release checklist (M6)

- Version `0.3.0` in `package.json`; README describes the 설치 tab, the launcher, and the new look.
- On an updated copy (portable build over a copy of the real data folder): accounts list, 사용 switches, 다시 로그인 on an expired account, remove a signed-out added account, auto switch toggle, usage bars.
- Fresh PC path in Windows Sandbox: auto mode end to end, then the launcher.
- Ask the user, then tag `v0.3.0`. GitHub Actions builds and publishes; installed copies update within six hours.
