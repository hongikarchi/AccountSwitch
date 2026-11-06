# ADR-005 The launcher opens cmd in the chosen folder through the shell's folder dialog

Status: accepted, 2026-11-06

## Context

First-time users should not need `cd`. VS Code's "Open Folder" is the familiar model. Windows Terminal (`wt.exe`) is not always available, and PowerShell blocks npm-installed `.ps1` shims under the default execution policy.

## Decision

- The shell opens the system folder picker (`IFileOpenDialog`, `FOS_PICKFOLDERS`) and starts `cmd.exe /K` with that folder as the working directory, running the resolved `claude.exe`.
- Recent folders (up to 8) are kept in the data folder.
- A hidden `cmd` opens the terminal with `start`, on one fixed command line. The window title and the program path travel in environment variables expanded inside quotes, and the folder is only the working directory, so a folder name can never reach cmd's parser as a command. A `title` command would have had to pass through that parser.
- `/D` skips the user's `AutoRun` commands, which could change the folder. `cmd.exe` and `claude.exe` are absolute paths, because cmd searches the current folder first and a `claude.exe` planted in the chosen folder must not run.
- Network paths (`\\server\share`) are refused with `FOLDER_NETWORK`, because cmd cannot start in one and would silently run in the Windows folder. A mapped drive letter works.

## Consequences

- No execution-policy dependency in the launcher; npm `.cmd` shims work in cmd.
- The terminal uses whichever account is currently 사용; per-account terminals could later set `CLAUDE_CONFIG_DIR`.
- The terminal gets no `ANTHROPIC_*` or `CLAUDE_CODE_*` variables from the environment, matching the subscription-only rule elsewhere (`subscriptionEnvironment`). A user who relies on `ANTHROPIC_API_KEY` does not have it in this window.
- `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` keeps the required window title, at the cost of Claude Code's own changing title in these windows.
