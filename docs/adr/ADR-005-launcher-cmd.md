# ADR-005 The launcher opens cmd in the chosen folder through the shell's folder dialog

Status: accepted, 2026-11-06

## Context

First-time users should not need `cd`. VS Code's "Open Folder" is the familiar model. Windows Terminal (`wt.exe`) is not always available, and PowerShell blocks npm-installed `.ps1` shims under the default execution policy.

## Decision

- The shell opens the system folder picker (`IFileOpenDialog`, `FOS_PICKFOLDERS`) and starts `cmd.exe /K` with that folder as the working directory, running the resolved `claude.exe`.
- Recent folders (up to 8) are kept in the data folder.

## Consequences

- No execution-policy dependency in the launcher; npm `.cmd` shims work in cmd.
- The terminal uses whichever account is currently 사용; per-account terminals could later set `CLAUDE_CONFIG_DIR`.
