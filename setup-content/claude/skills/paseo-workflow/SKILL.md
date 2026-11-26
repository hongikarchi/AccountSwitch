---
name: paseo-workflow
description: Run a project the Paseo way — one coordinator tab in the main checkout plus one Paseo worktree workspace (and agent) per task, so each task's diff shows in Paseo's Changes panel. Use when the user asks to set up or use this workflow in a project ("Paseo 방식으로 세팅해줘", "작업 탭 만들어줘", "이거 맡겨"), to hand a task to a new tab, or to archive finished task tabs.
---

# Paseo workflow

One task, one workspace. The coordinator tab talks to the user, writes issues, hands out tasks, merges, deploys, and cleans up. It changes no code. Each task runs in its own Paseo workspace on a new git worktree and branch, with its own agent, so Paseo's Changes panel shows that task's diff.

Requires the Paseo MCP tools (`mcp__paseo__*`). If they are missing, say so and stop.

## Names

- **Prefix.** Read the project's CLAUDE.md first. If it names a branch prefix or an integration branch, use those. Otherwise the prefix is `{{branchPrefix}}` and the integration branch is `{{branchPrefix}}_develop`. Below, `<prefix>` means the one in use.
- **One name per task.** The workspace title, the branch, and the worktree slug are all `<prefix>_<task>`, with `<task>` a short name in lowercase letters, digits, and hyphens. Put the issue number in the agent's title and brief, not in the workspace title.
- **The folder is the one exception.** Paseo allows only lowercase letters, digits, `-`, and `/` in a worktree slug, so it turns `_` into `-`: branch `<prefix>_<task>` lives in folder `<prefix>-<task>`. Nothing in this workflow depends on the folder name; say so if the user asks. Do not install a plugin to change it.

## 1. Set up a project (once per repo)

The user says "Paseo 방식으로 세팅해줘". Do the whole setup in one go, without trial and error. The only question is the backup folder.

1. **Read** the project's CLAUDE.md, default branch (`gh repo view --json defaultBranchRef`), install command (lockfile and package manager, plus tool restores such as `dotnet tool restore`), CI, and any worktree-cleanup hooks.
2. **Ask** for the backup folder, unless the project's CLAUDE.md or memory already records it. It holds outputs git does not keep: renders, reference images, drawings such as DWG, uploads. It can be on a network share. Archiving a workspace deletes these files (section 3).
3. **Integration branch.** If `git ls-remote --heads origin <prefix>_develop` prints nothing, create it from the default branch and push it: `git fetch origin`, then `git push origin origin/<default>:refs/heads/<prefix>_develop`.
4. **Main checkout.** If `git status --porcelain` is empty, `git fetch` and `git switch <prefix>_develop` (it tracks the remote branch). If it is not clean, do not switch; tell the user which files are in the way.
5. **Plugins.** `.worktreeinclude` is read by Paseo's built-in `worktree-include` plugin, which runs only when Paseo's "Enable plugins" switch is on. Check with `paseo daemon config get pluginsEnabled` (`"value": true`). If it is off, tell the user; AccountSwitch's AI 작업 설정 turns it on.
6. **One small PR from a worktree** (section 2, steps 3 and 5, task `paseo-setup`), targeting `<prefix>_develop`, with:
   - **CLAUDE.md:** a short "Workspaces (Paseo)" rule in the project's style: the prefix if it is not `{{branchPrefix}}`; the coordinator works in the main checkout on `<prefix>_develop`, changes no code there, and never stashes, resets, or switches branches there; each task gets a Paseo workspace on a new worktree branched off `origin/<prefix>_develop`, named `<prefix>_<task>`; an agent already in a worktree works in place and opens its PR from it; the backup folder by its full path; when the PR is merged, the worktree's untracked and ignored outputs are copied to the backup folder, then the workspace is archived.
   - **`paseo.json`** at the repo root with the install command, for example `{"worktree": {"setup": "npm ci"}}`. Paseo reads it from the base branch's committed version, so it takes effect after the merge.
   - **`.worktreeinclude`** at the repo root, gitignore syntax, listing `.env*` and `.claude/settings.local.json` plus other gitignored local files the project needs. It copies only gitignored files that exist in the main checkout, and only after the main checkout has the file.
   - **Cleanup hooks:** if the repo has its own worktree-cleanup hook, make it skip `${PASEO_HOME:-~/.paseo}/worktrees`. Paseo removes those on archive.
7. Merge the PR when its checks pass, then fast-forward the main checkout (`git pull --ff-only`) and archive the setup workspace (section 3).
8. Record in the project's memory: prefix, integration branch, install command, backup folder.

## 2. Hand out a task

1. Make sure there is an issue or task record in the project's format.
2. Update the coordinator's checkout only with a fast-forward pull, and only if it is clean.
3. Create the workspace:
   - `mcp__paseo__create_workspace`
   - `isolation: "worktree"`, `mode: "branch-off"`
   - `baseBranch`: `"origin/<prefix>_develop"`, or the base branch the project names
   - `branchName`, `worktreeSlug`, and `title`: `<prefix>_<task>` (see Names)
   - `path`: the main checkout
   - `background: false`
4. Check that `.worktreeinclude` copied the gitignored files into the worktree. Copy any that are missing from the main checkout by hand. Never copy secrets you have not been asked to copy.
5. Create the agent with `mcp__paseo__create_agent`:
   - `workspaceId` from step 3
   - `provider: "claude/<model>"`, the current default model from `mcp__paseo__list_models`
   - `settings.modeId` that matches the user's usual mode
   - a title with the issue number
   - a self-contained brief: the issue number, "work in place, no new worktree, don't touch the main checkout", the files and rules that matter, how to verify, PR and merge rules (merge only when every check on the latest commit passes), what to update in the issue, and "reply at the end in the user's language, short".
6. Tell the user which tab was created, and that its Changes panel shows the work.

Independent tasks can run in parallel. Before handing out two tasks that may claim the same sequential numbers or the same files, assign them up front. Examples: ADR numbers, migration numbers, error codes, local ports.

## 3. When a task agent finishes

1. Verify; don't relay. Check that the PR merged, that every check on its final commit passed (`gh pr view <n> --json statusCheckRollup`), and that the deploy or health check succeeded where relevant.
2. Report to the user in plain words: what changed, what they should check, and anything the agent chose for them.
3. **Back up what git does not keep. Never skip this step.** Archiving deletes the worktree for good, gitignored files included. A user lost renders, reference images, and an uploaded drawing this way.
   1. List the worktree's untracked and ignored files: `git -C <worktree> status --ignored --porcelain`. `??` marks untracked, `!!` ignored; a path ending in `/` is a whole folder.
   2. Leave out folders that install or build rebuilds, at any depth: `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `.next`, `.turbo`, `.cache`, `target`, `.pytest_cache`. Also leave out the gitignored files copied in from the main checkout (section 2, step 4); the main checkout still has them.
   3. Copy the rest, keeping relative paths, to `<backup folder>/<task branch>/<YYYY-MM-DD>/`.
   4. Check that every file arrived with the same size.
   5. Tell the user what was copied and where. Say so when there was nothing to copy.

   If the project records no backup folder, ask the user before archiving. If a copy failed or a size differs, do not archive; tell the user which files. Never delete anything from the backup folder.
4. Archive the workspace (`mcp__paseo__archive_workspace`) only after step 3 succeeded. Paseo removes the worktree. If the user said they want to look at the Changes panel first, wait for their word.

## Notes

- The coordinator's branch is the integration branch work starts from, not the production branch. Production-only hotfixes get their own workspace branched from the production branch.
- Paseo tab names are Paseo's own: `/rename` does not change them. Use `mcp__paseo__update_agent` with `name`.
- Idle long-lived role tabs (FRONT, BACK, and so on) are not needed in this workflow. Close them once they have no open PR or worktree.
