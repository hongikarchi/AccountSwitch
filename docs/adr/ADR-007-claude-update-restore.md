# ADR-007 A Claude Code update that stopped midway is restored from the build already downloaded

Status: accepted, 2026-11-24 (#22)

## Context

On Windows, Claude Code's native installer updates itself by moving the running `claude.exe` aside and then renaming the new build into its place. A Claude Code that ends between those two renames leaves no `claude.exe` (SPEC 3.10; open upstream as anthropics/claude-code#105554). It happened on the development PC when a Paseo terminal closed about 0.1 s after the old file moved. The 계정 tab then replaced the Claude accounts with "Claude Code가 설치되어 있지 않습니다", which the user read as being signed out.

## Decision

- Recognize the state from the files alone: no `claude.exe`, a `.new` or `.old` leftover next to it, and a build in `~/.local/share/claude/versions`.
- Restore by copying that build into place, not by downloading again. The build is the file the update itself was installing. Restoring it takes a second, works offline, and changes no other file. The install script stays as the fallback.
- The 계정 tab keeps showing the accounts and offers 고치기. 고치기 starts the ordinary setup run of the `claude` item, so the repair is logged, recorded in `setup-state.json`, one run at a time, and visible in the 설치 tab when it fails. A separate repair endpoint would have duplicated all of that.
- Nothing is fixed without a press, as with every install.
- Leftover `.new` and `.old` files are removed after a restore. A file a running Claude Code still holds cannot be deleted on Windows, so it stays and is only logged.

## Consequences

- The detection runs on every 계정 tab poll while Claude Code is missing. It only lists two folders.
- If Claude Code changes how it stores builds, the detection finds nothing and the page falls back to the old "not installed" state, where the install script still repairs the PC.
- Turning Claude Code's auto-update off was rejected: users would stop getting fixes, and Paseo's own update button runs the same updater.
