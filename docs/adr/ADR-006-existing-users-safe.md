# ADR-006 New features are additive; existing users keep their logins

Status: accepted, 2026-11-06

## Context

Installed copies update themselves. 0.3.0 reaches every user of 0.2.x the moment a tag is pushed. Users worry that a new front screen or installer could disconnect Claude Code.

## Decision

- The account modules and their API stay as they are; the redesign changes markup and CSS only.
- The wizard opens by itself only on a PC without Claude Code and without `setup-state.json`; everyone else lands on 계정 as before.
- The wizard never reads or writes credentials. Its only writes to the Claude config are MCP registrations, serialized with account switching (`DefaultLogin.exclusive`).
- Reinstalling Claude Code with the native installer does not touch `~/.claude` logins.
- Theme key, data folder, and settings files keep their names.

## Consequences

- Release checklist includes switching accounts, signing in again, and auto switch on an updated copy before tagging.
