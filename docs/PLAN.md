# Plan for 0.3.0 (Windows)

Order is chosen so the riskiest unknowns are measured early and every milestone leaves a working app. Each milestone ends with the checks in §3 and a short note in `TASK.md`.

## 1. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Docs: PRD, SPEC, DESIGN, PLAN, TASK, ADR, CLAUDE.md | Committed on a branch when the user asks |
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
