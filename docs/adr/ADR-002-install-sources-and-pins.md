# ADR-002 Install with winget first, official installers as fallback; pin what workflows depend on

Status: accepted, 2026-11-06

## Context

The wizard targets a fresh Windows PC with no developer tools. winget ships with Windows 11 (App Installer) but can be missing from PATH, blocked on managed PCs, or absent in Windows Sandbox. Some tools must match exact versions: modeling pipelines are tested on Python 3.13 and Blender 5.2.3, and each Rhino MCP plugin must match its server package.

## Decision

- Use winget by full path (`%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`); if missing or failing, download the publisher's official installer.
- Claude Code uses the native installer (`irm https://claude.ai/install.ps1 | iex`), not npm: no Node dependency, self-updating, the method Anthropic recommends.
- Pins: Python 3.13, Node 24, Blender 5.2.3, rhinomcp 0.4.1.1 (plugin and `uvx` server together), Cordyceps 1.5.0, blender-mcp 1.5.5. Everything else installs latest.
- PATH is re-read from the registry by code after each install (SPEC 3.5); no reliance on the user restarting anything.
- Elevation prompts are expected; the user answers them. Prefer user-scope packages to reduce prompts.

## Consequences

- Pins must be bumped deliberately in the manifest and SPEC together.
- Fallback download URLs need upkeep when publishers move files.
