# Working notes

AccountSwitch is a desktop app for Windows (C# WinForms + WebView2 shell, `src/desktop/shell/`) and macOS (Swift, `src/desktop/mac/`). Both run the same local Node server (`src/server/`, built into `AccountSwitch-engine.exe`) and the same React page (`src/ui/`). Today it manages several Claude Code and Codex CLI subscription accounts. Version 0.3 adds a setup wizard that prepares a fresh Windows PC for modeling with Claude Code, a launcher that opens Claude Code or Codex CLI in a folder, and a black-and-white redesign.

`README.md` describes shipped behavior. For the current work read only the document you need:

| Need | Read |
|---|---|
| How it behaves | `docs/SPEC.md` |
| How it looks | `docs/DESIGN.md` |
| Order, milestones, how to verify | `docs/PLAN.md` |
| What to do next | GitHub issues: `gh issue list` |
| Why a decision was made | `docs/adr/` |

## Language

- Talk to the user in Korean.
- Human-facing text (README, every UI string) is plain, intuitive Korean. Explain jargon or avoid it.
- Agent-facing documents (this file, SPEC, PLAN, DESIGN, ADR) and code comments are in English. GitHub issues are read by the user, so they are in plain Korean.
- Write Korean directly in tool input. Unicode escapes have produced wrong characters.

## Rules

- The user's current request comes first.
- **Docs first.** A behavior change updates SPEC before code. Look and feel goes to DESIGN, order and verification to PLAN, reasons to `docs/adr/`.
- **Work is tracked in GitHub issues**, not in a file. Open an issue for new work, tick its checklist and comment as it goes, and close it from the commit or PR that finishes it (`Closes #N`). Issues are public like the code.
- **Never break account switching.** `src/core/default-login.ts`, `account-profiles.ts`, `token-refresh.ts`, `keychain.ts`, `restore.ts` change only with tests that cover the change. The setup wizard never reads or writes credentials.
- Every write to `~/.claude.json` made by the setup wizard (for example `claude mcp add`) runs inside `DefaultLogin.exclusive('claude-cli', …)` so it cannot interleave with an account switch (SPEC 3.7).
- Installs never start on their own. They run only after the user presses a button, and only the items the user left checked.
- Pinned versions live in one place, the setup manifest (SPEC 3.3). Change the manifest and SPEC together.
- **Public repository.** No personal paths, names, e-mail addresses, client or project names, or keys in code, docs, tests, commit messages, or issues. Design references are linked by URL; never commit other people's images.
- Do not launch or kill Rhino or Blender by process name while testing. A killed Rhino leaves `.rhl` lock files that make files open read-only (ADR-003).
- Commit, tag, and publish only when asked. Pushing a tag `vX.Y.Z` releases to every installed copy through auto-update, so confirm with the user before tagging.
- Before reporting work done: `npm test`, `npm run typecheck`, `npm run format:check`; for shell changes also `npm run build:desktop`.

## Environment

Windows 11, Node 24.15+, .NET SDK (the shell targets .NET Framework 4.8), `dotnet tool restore` for `vpk`.

- Run from source: `npm start` (opens the page in the browser). Desktop window: `npm run build:desktop`, then `release\app\AccountSwitch.exe`.
- A dev build and the installed copy share the data folder `%LOCALAPPDATA%\AccountSwitch` unless `ACCOUNTSWITCH_DATA` is set, and **switching accounts in a dev build changes the real `~/.claude` and `~/.codex` logins.** Use a scratch `ACCOUNTSWITCH_DATA` and do not press 사용 unless the test needs it.
- Only one server runs per data folder; a second start attaches to the first.
- `winget` can be missing from PATH even when installed. Call `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`.
- Bash heredocs break on Korean text or quotes. Write files with the Write tool.
