# Tasks

Status marks: `[ ]` open, `[~]` in progress, `[x]` done, `[?]` waiting for the user. Keep IDs stable; add new ones at the end of a group.

## Decisions from the user (2026-11-06)

- [x] T-001 Rhino settings item: all four parts, automatic (SPEC 3.8).
- [x] T-002 Logo concepts through Codex `image_gen`: approved. First run of four concepts saved to `assets/brand/concepts/` (git-ignored).
- [x] T-003 ZWCAD edition: Professional, so COM when CAD is added (ADR-004).
- [x] T-004 Windows Sandbox: approved for testing. Enable it at the start of M3, with the user present (administrator prompt and a restart).

## M0 Docs

- [x] T-010 CLAUDE.md, SPEC, DESIGN, PLAN, TASK, ADR-001 to 006.
- [x] T-011 PRD `docs/prd.html`, published as `[AccountSwitch]-PRD`.
- [x] T-012 Commit docs on a branch (only when the user asks).

## M1 Design and 계정 tab

- [x] T-020 Bundle Pretendard `woff2` into the Vite build; confirm the CSP still holds.
- [x] T-021 Replace `src/ui/style.css` tokens with DESIGN §3, light and dark.
- [x] T-022 Header: logo tile, wordmark, 계정 · 설치 tabs (설치 hidden on macOS), theme toggle per DESIGN §5.2 with motion and reduced-motion fallback.
- [x] T-023 Account sections per DESIGN §5.3: two columns over 760 px, hairline rows, aligned usage columns, provider color only on mark, bar, 사용 중.
- [x] T-024 Buttons, menus, empty and error states per DESIGN §5.4–5.7.
- [x] T-025 Screenshots light and dark at 480 and 1100 px; confirm `src/core` and `src/server` untouched.

## M2 Setup checks

- [x] T-030 `src/core/setup/manifest.ts` with every item of SPEC 3.3 (ids, labels, groups, dependsOn, pins, mayElevate).
- [x] T-031 Checks for each item; registry PATH re-read (SPEC 3.5); unit tests with fake command runners. MCP checks read `~/.claude.json` instead of running `claude mcp get`, which starts the server (SPEC 3.7).
- [x] T-032 Endpoints `GET /api/v1/setup`, `POST /api/v1/setup/check`; server tests.
- [x] T-033 설치 tab: first screen (two modes), stepper per DESIGN §5.6 rendering check results. Run screens are built too, checked against faked run routes until the runner is merged.
- [x] T-034 Auto-open rule (SPEC 3.1) and `setup-state.json`.
- [x] T-035 Verify check results on this PC; record which items report 버전 다름 and why. 2026-11-06: no item reports 버전 다름; a run takes under a second and left `~/.claude.json` untouched. Node 24.15.0 passes against pin 24.22.1 because any 24.x is accepted; `python` is missing because only 3.14 is reachable through `py`. The Sandbox half of M2 still waits for T-048.

## M3 Installs

Code for T-040 to T-047 is done and tested with fakes only. Nothing has really been installed; T-048 is the first real run.

- [~] T-040 Runner: one run at a time, per-item timeout, logs, cancel, retry, skip (SPEC 3.4).
- [~] T-041 winget by full path with fallback downloads (ADR-002); verify package ids and the Node 24 pin.
- [~] T-042 Base items `git`, `node`, `uv`, `python`, `claude`, `codex`.
- [~] T-043 `env` item: execution policy, user PATH append with `WM_SETTINGCHANGE`, `PYTHONUTF8`.
- [~] T-044 Python base and bundles.
- [~] T-045 Blender 5.2.3, blender-mcp add-on install and enable, MCP registration.
- [~] T-046 Rhino: detect Rhino 8, Yak installs (verify syntax), MCP registrations inside `DefaultLogin.exclusive` (SPEC 3.7).
- [~] T-049 `rhino-settings` (SPEC 3.8): backup, read-only warning, startup `_mcpstart` (find the element by setting it once in Rhino Options and diffing the settings file), starter `.gh` made once in a real Grasshopper session, `~/.claude/CLAUDE.md` marked block. Refuse while Rhino runs. Parts 1 and 4 are done with fakes; parts 2 and 3 wait for a Rhino session with the user, so the item ends `needs-user` until then.
- [~] T-047 Elevation messages and `ELEVATION_DECLINED` handling (SPEC 3.6).
- [ ] T-048 Windows Sandbox run of auto mode end to end; note timings. Checklist in PLAN §2; start only with the user present (T-004).

## M4 Launcher

- [~] T-050 Shell: `WebMessageReceived` handler, `IFileOpenDialog` folder picker, `cmd.exe /K` launch with title.
- [x] T-051 Engine: `POST /api/v1/launcher/recent`, `launcher.json`; browser fallback launch.
- [~] T-052 Page: header button with recent-folder menu; disabled state when Claude Code is missing. Code done and checked with a faked shell; the real window, dialog and terminal still need a look by hand.

## M5 Logo and icons

- [x] T-060 Concept images via Codex `image_gen`: four generated 2026-11-06 in `assets/brand/concepts/`; the user chose concept 1 (DESIGN §8).
- [x] T-061 Hand-drawn SVG mark; ICO, tray (light and dark), macOS icon and template (SPEC §6). The wordmark is live Pretendard text in the header, so there is no `wordmark.svg`.
- [~] T-062 Shell picks tray icon by taskbar theme; build scripts copy icons. Code done; the live theme change on a real taskbar still needs a look by hand.

## M6 Release

- [ ] T-070 README for 0.3.0; version bump.
- [ ] T-071 Release checklist (PLAN §4), including the 0.2.2 regression on an expired account.
- [ ] T-072 Tag `v0.3.0` after the user confirms.
