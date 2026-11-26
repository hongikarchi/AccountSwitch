# ADR-008 The AI work settings live in this repository and are applied by the engine

Status: accepted, 2026-11-26 (#30)

## Context

The user kept the rules, Claude Code settings, skills and Paseo config they work with in a separate settings repository. Its `install.sh` linked the files into `~/.claude`, merged missing sections and keys, and asked y/N in the terminal. On Windows it does not work as it is:
- `python3` is missing, or is the Microsoft Store alias.
- `ln -s` needs Developer Mode or elevation.
- The setup tab has no terminal to answer y/N in.

Two copies had already drifted: the progress-report skill on the development PC differed from the repository's.

## Decision

- **Move the content into this repository** (`setup-content/`), not fetch it from a second repository (user, 2026-11-26).
  - One version, tested and shipped with the app.
  - It applies offline.
  - No repository address to enter, and no sign-in to read a private repository.
  - The cost is that it is public: personal wording was taken out (user: "사용자" everywhere; no firm or client names, ADR-006 rules).
- **The engine applies it, on Windows and macOS alike**, from the 설치 tab, which macOS now also shows with its own items. One implementation replaces `install.sh`, so the rules for merging live in one place (SPEC 3.11).
- **The global rule file is AccountSwitch's whole** (user, 2026-11-26). The previous file goes to the backup, and AccountSwitch's own marked blocks (the Rhino note, SPEC 3.8) are carried over. Two alternatives were rejected:
  - Merging by section headings could never update a section, and it kept both `## 언어` and `## Language`, the same rule under two names.
  - One marked block inside the user's file would still leave the user's duplicates beside it.

  Afterwards the file is treated like a skill: if the user has not changed it, it is updated; if they have, it is kept unless they choose 바꾸기.
- **Skills carry a manifest of what was written.** That tells an unchanged copy, which gets updates, from one the user edited, which is kept unless they choose 바꾸기. It is the same idea as Paseo's `.paseo-managed-files.json`.
- **Paseo is configured through `paseo daemon config set`**, because Paseo rewrites its own file while it runs.
- **Copies, not links.** Two-way sync between computers through links is dropped. A new app version brings new content, and re-applying updates what the user has not changed.

## Consequences

- A change to a skill or a rule ships with an app release, and so reaches every installed copy.
- The settings repository is archived after the move, so there is one source.
- `settings.json` defaults include auto mode and skip its confirmation prompts (user, 2026-11-26), on every PC where the user applies the item. 채워 넣기 never overwrites a value the user already has.
- macOS gets the 설치 tab with one item. Installing programs on macOS is separate work.
