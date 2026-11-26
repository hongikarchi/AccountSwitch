---
name: paseo-workflow
description: Run a project the Paseo way — one coordinator tab in the main checkout plus one Paseo worktree workspace (and agent) per task, so each task's diff shows in Paseo's Changes panel. Use when the user asks to set up or use this workflow in a project ("Paseo 방식으로 세팅해줘", "작업 탭 만들어줘", "이거 맡겨"), to hand a task to a new tab, or to archive finished task tabs.
---

# Paseo workflow

One task, one workspace. The coordinator tab talks to the user, writes issues, hands out tasks, merges, deploys, and cleans up. It changes no code. Each task runs in its own Paseo workspace on a new git worktree and branch, with its own agent, so Paseo's Changes panel shows that task's diff.

Requires the Paseo MCP tools (`mcp__paseo__*`). If they are missing, say so and stop.

## 1. Set up a project (once per repo)

Read the project first: its CLAUDE.md, branch model (which branch work branches off and merges into, which branch deploys where), package manager, CI, and any existing worktree or cleanup hooks. Ask about anything you cannot find.

**Branches.** The base (integration) branch is `origin/{{branchPrefix}}_develop` unless the project's CLAUDE.md names another. Task branches and worktree slugs are `{{branchPrefix}}_<task>`. Ask the user for the base branch only when the project names no branch and `{{branchPrefix}}_develop` does not exist on the remote (`git ls-remote --heads origin {{branchPrefix}}_develop` prints nothing).

**Backup folder.** Ask the user, once per project, for a backup folder for outputs that git does not keep: renders, reference images, drawings such as DWG, uploads. The folder differs per project and can be on a network share. Archiving a workspace deletes these files (section 3).

Then, in one small PR (made from a worktree, not the main checkout):

1. **CLAUDE.md:** add a short "Workspaces (Paseo)" rule in the project's style, covering:
   - The coordinator works in the main checkout and changes no code there. It never stashes, resets, or switches branches there.
   - Each task gets a Paseo workspace on a new worktree, branched off the remote base branch (`origin/{{branchPrefix}}_develop` unless the project names another), on a branch named `{{branchPrefix}}_<task>`.
   - An agent already in a worktree works in place and opens its PR from it.
   - The backup folder for outputs git does not keep, by its full path.
   - When the PR is merged, the worktree's untracked and ignored outputs are copied to the backup folder, then the workspace is archived.
2. **`paseo.json`** at the repo root, with the project's install command, for example `{"worktree": {"setup": "pnpm install --frozen-lockfile"}}`. Paseo reads it from the base branch's committed version, so it takes effect only after the PR is merged.
3. **Cleanup hooks:** if the repo has its own worktree-cleanup hook, make it skip `${PASEO_HOME:-~/.paseo}/worktrees`. Paseo removes those on archive.
4. **Gitignored local files:** list them in `.worktreeinclude` (for example `.claude/settings.local.json`). It has not been reliable, so also copy them by hand (section 2, step 4).

Record the setup in the project's memory: base branch, naming, install command, and backup folder.

## 2. Hand out a task

1. Make sure there is an issue or task record in the project's format.
2. Update the coordinator's checkout only with a fast-forward pull, and only if it is clean.
3. Create the workspace:
   - `mcp__paseo__create_workspace`
   - `isolation: "worktree"`, `mode: "branch-off"`
   - `baseBranch`: `"origin/{{branchPrefix}}_develop"`, or the base branch the project names
   - `branchName` and `worktreeSlug`: `{{branchPrefix}}_<task>`, with `<task>` a short name in lowercase letters, digits, and hyphens
   - `title`: `#<issue> <short title>` in the user's language
   - `path`: the main checkout
   - `background: false`
4. Wait for the worktree's `.claude/` folder to appear. Then copy the main checkout's `.claude/settings.local.json` and any other needed gitignored files into it. Never copy secrets you have not been asked to copy.
5. Create the agent with `mcp__paseo__create_agent`:
   - `workspaceId` from step 3
   - `provider: "claude/<model>"`, the current default model from `mcp__paseo__list_models`
   - `settings.modeId` that matches the user's usual mode
   - a title
   - a self-contained brief: the issue number, "work in place, no new worktree, don't touch the main checkout", the files and rules that matter, how to verify, PR and merge rules (merge only when every check on the latest commit passes), what to update in the issue, and "reply at the end in the user's language, short".
6. Tell the user which tab was created, and that its Changes panel shows the work.

Independent tasks can run in parallel. Before handing out two tasks that may claim the same sequential numbers or the same files, assign them up front. Examples: ADR numbers, migration numbers, error codes, local ports.

## 3. When a task agent finishes

1. Verify; don't relay. Check that the PR merged, that every check on its final commit passed (`gh pr view <n> --json statusCheckRollup`), and that the deploy or health check succeeded where relevant.
2. Report to the user in plain words: what changed, what they should check, and anything the agent chose for them.
3. **Back up what git does not keep. Never skip this step.** Archiving deletes the worktree for good, gitignored files included. A user lost renders, reference images, and an uploaded drawing this way.
   1. List the worktree's untracked and ignored files: `git -C <worktree> status --ignored --porcelain`. `??` marks untracked, `!!` ignored; a path ending in `/` is a whole folder.
   2. Leave out folders that install or build rebuilds, at any depth: `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `.next`, `.turbo`, `.cache`, `target`, `.pytest_cache`. Also leave out the gitignored files you copied in from the main checkout (section 2, step 4); the main checkout still has them.
   3. Copy the rest, keeping relative paths, to `<backup folder>/<task branch>/<YYYY-MM-DD>/`.
   4. Check that every file arrived with the same size.
   5. Tell the user what was copied and where. Say so when there was nothing to copy.

   If the project records no backup folder, ask the user before archiving. If a copy failed or a size differs, do not archive; tell the user which files. Never delete anything from the backup folder.
4. Archive the workspace (`mcp__paseo__archive_workspace`) only after step 3 succeeded. Paseo removes the worktree. If the user said they want to look at the Changes panel first, wait for their word.

## Notes

- The coordinator's branch is the integration branch work starts from (`{{branchPrefix}}_develop` unless the project names another), not the production branch. Production-only hotfixes get their own workspace branched from the production branch.
- Paseo tab names are Paseo's own: `/rename` does not change them. Use `mcp__paseo__update_agent` with `name`.
- Idle long-lived role tabs (FRONT, BACK, and so on) are not needed in this workflow. Close them once they have no open PR or worktree.
