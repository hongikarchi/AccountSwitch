# ADR-002 Install with winget first, official installers as fallback; pin what workflows depend on

Status: accepted, 2026-11-06

## Context

The wizard targets a fresh Windows PC with no developer tools. winget ships with Windows 11 (App Installer) but can be missing from PATH, blocked on managed PCs, or absent in Windows Sandbox. Some tools must match exact versions: modeling pipelines are tested on Python 3.13 and Blender 5.2.3, and each Rhino MCP plugin must match its server package.

## Decision

- Use winget by full path (`%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`); if missing or failing, download the publisher's official installer.
- Claude Code uses the native installer (`irm https://claude.ai/install.ps1 | iex`), not npm: no Node dependency, self-updating, the method Anthropic recommends.
- Pins: Python 3.13, Node 24, Blender 5.2.3, Cordyceps 1.5.0, blender-mcp 1.5.5. Everything else installs latest.
- rhinomcp (amended 2026-11-09, user): no pin. The plugin installs the newest on Yak, and both servers are registered at the version of the plugin found on disk, so the pair always matches. It was pinned to 0.4.1.1 until 0.3.4.
- PATH is re-read from the registry by code after each install (SPEC 3.5); no reliance on the user restarting anything.
- Elevation prompts are expected; the user answers them. Prefer user-scope packages to reduce prompts.
- Every fixed-version installer the engine downloads carries the SHA-256 its project publishes, checked on disk right before it runs. All four are published, so none is computed from a download: Git's release notes, Node's `SHASUMS256.txt`, python.org's release page, Blender's `.sha256` file.
- winget's exit code decides whether the fallback may run. Reasons a second installer would bypass or collide with (policy, install in progress, file in use, disk full, restart needed, already installed) end the item instead (SPEC 3.6).

## Consequences

- Pins must be bumped deliberately in the manifest and SPEC together.
- Fallback download URLs need upkeep when publishers move files.
- A pin bump also needs the new hash from the publisher; a wrong hash makes the fallback refuse to run, and that is the intended failure.
- Node is pinned to an exact 24.x because winget has no 24-only id, `OpenJS.NodeJS.LTS` moved to 26 on 2026-10-28, and `--version` accepts only exact versions.
- The blender-mcp add-on is pinned by commit and SHA-256 because the project publishes no GitHub releases and its repository was renamed `mcp-for-blender`.
- rhinomcp: a new PC gets a release on the day it ships, untested by us. A bad release reaches new installs until the project fixes it; existing installs keep their pair.
- Git and Python gained fallback URLs because Windows Sandbox has no winget, so M3 could not otherwise pass there.
