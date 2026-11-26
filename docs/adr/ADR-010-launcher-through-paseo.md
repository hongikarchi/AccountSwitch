# ADR-010 Claude 열기 and GPT 열기 open a Paseo agent when Paseo is there

Status: accepted, 2026-11-26 (#45)

## Context

The user wants one install of AccountSwitch to leave a PC ready to work the Paseo way: a coordinator conversation per project folder, with task workspaces under it. Setting up this repository by hand took several corrections (branch names, plugins, where the coordinator sits). The existing buttons open a `cmd` terminal (ADR-005). The user decided (2026-11-26) to keep those two buttons, make them open a Paseo conversation with a model chosen on the same screen from Paseo's list, and keep the terminal for a PC without Paseo.

## Decision

- **The engine talks to Paseo; the shell only picks the folder.** The Paseo calls (models, status, workspace lookup, `run`, the deep link) live once, in TypeScript with tests (`src/core/launcher-paseo.ts`). The C# shell gains one message, `launcher.pick`, which shows the folder dialog it already has and hands the folder back to the page. Writing the Paseo calls in C# as well would have made two copies to keep in step, as the terminal launch already is.
- **The shell grants the foreground before answering** (`AllowSetForegroundWindow(ASFW_ANY)`). The engine is a background process; without the grant Windows keeps the Paseo window behind the one the user is looking at.
- **The Paseo window is opened with its deep link** `paseo://h/<serverId>/agent/<agentId>` passed to `Paseo.exe`, the way Paseo's own `open` command does. `paseo agent open` itself only looks under `%LOCALAPPDATA%` on Windows and failed here. No `paseo:` URL handler is registered on Windows, so the link cannot go through the shell's "open URL".
- **An existing local workspace for the folder is reused.** `paseo run --cwd` alone made a new workspace on every press.
- **One first message, and the agent decides.** The engine does not try to tell whether a folder is already set up the Paseo way; the `paseo-workflow` skill knows how, and the message asks the agent to use it only when needed.
- **Paseo whenever it is installed; the terminal only without it** (user, 2026-11-26). The model list needs Paseo's daemon, which runs only with the Paseo app, so the last good list is saved and a press with Paseo closed still goes to Paseo, which the engine then starts. Gating on a live list would have sent every press after a reboot to the terminal.
- **The agent starts in the provider's default mode** (`--mode` from `provider ls`), as in the Paseo app. `paseo run` alone starts in `default`, which would ask before every git command of the setup.

## Consequences

- The model list costs two short Paseo CLI runs; the engine keeps it for 10 minutes.
- When the Paseo daemon is not running, the first press starts Paseo and waits up to 20 seconds.
- macOS has no launch buttons yet (SPEC 4), so nothing changes there.
