# ADR-012 Paseo 열기 opens the folder's workspace without making an agent

Status: accepted, 2026-11-26 (#45). Replaces the first message, the model list and the "Paseo whenever installed" buttons of ADR-010; the rest of ADR-010 (engine talks to Paseo, shell only picks the folder, foreground grant, agent link, workspace reuse) stands.

## Context

ADR-010 made Claude 열기 and GPT 열기 create a Paseo agent with a fixed first message and a model chosen in AccountSwitch. The user decided (2026-11-26) that the button should send no message and create no agent, and should leave the user in front of an empty chat in that folder, typing the first request. The user then reshaped the buttons into **Paseo 열기** and **터미널 열기**, with Claude or GPT and the model chosen in Paseo.

Measured on Paseo 0.17.4, by reading its desktop main process and renderer and by trying it:

- `Paseo.exe` accepts from outside only an agent link `paseo://h/<serverId>/agent/<agentId>` (no query allowed) or a folder path. The renderer has a route for an empty chat (`/h/<server>/workspace/<id>?open=draft:<id>`), but the main process ignores such a link.
- A folder path opens one more window on its last screen; the window does not receive the folder (`pendingPath: null` in Paseo's log).
- The provider and model of an empty chat come from the window's stored form preferences. No link, CLI option or documented setting (https://paseo.sh/docs) preselects them.
- Every way to create an agent (`paseo run`, the MCP `create_agent`) requires a first prompt.

## Decision

- **Register, then show.** The engine reuses or creates the folder's local workspace (`paseo workspace create`), which also registers the project. If the workspace has an agent, the engine opens its agent link, which puts the window on that workspace. If not, the shell brings the Paseo window forward and the user clicks the workspace in Paseo's sidebar (user's choice among the options offered, 2026-11-26).
- **No model select in AccountSwitch.** Since nothing can preselect it, the select, the model lookup, `launcher.json` and their tests are removed. Paseo remembers the last model chosen in its composer.
- **The setup moves into the rule file.** Without a first message, `setup-content/claude/CLAUDE.md` tells the agent to set up an unset-up repository the Paseo way on the first request, asking only what it needs.
- **Not done:** a Paseo plugin that could navigate the window to a draft. It would install trusted, unsandboxed code into the user's Paseo, outside AccountSwitch.

## Consequences

- One or two clicks inside Paseo remain when the folder has no agent yet. If a later Paseo accepts a workspace or draft link from outside, the engine can open it directly; `launcher-paseo.ts` already knows the server and workspace ids.
- An old `launcher.json` in the data folder is no longer read.
