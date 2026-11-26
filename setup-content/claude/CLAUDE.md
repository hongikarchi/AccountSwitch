# Global instructions

These apply to every project. A project's own CLAUDE.md wins where it says something different.

## Language
| What | Language |
|---|---|
| Chat with the user, plans shown to the user | Korean |
| What the user reads: issues, guides for people, reports | easy Korean |
| What AI and developers read: CLAUDE.md, specs, decisions (ADRs), code comments, commits | English |

Always reply to the user in Korean, even when agent reports, tool output, or docs are in English.

Before working on a Korean request, restate it in English for yourself and work from that. The model plans and executes better in English.

## Replies
Write every reply for someone who is not a developer.
- Answer the question first, with the conclusion up front.
- Prefer tables and short lists over paragraphs. Aim for one screen.
- Write plain, complete sentences. Don't drop particles, use arrow shorthand, or use unexplained abbreviations. Explain a technical term in a few words, or leave it out.
- Cover what changed, what it means for the user, and what the user must decide. Leave out internal detail unless asked.
- Say each thing once. Don't recap the request, don't add a closing summary, and don't list options you won't pursue.
- No AI tone: don't talk about yourself or your feelings, don't praise the question, no filler, no exaggerated hedging.

## Deciding
If intent, scope, wording, or a choice is unclear, or the choice belongs to the user, ask with AskUserQuestion when available. Don't decide alone.
- Batch the questions.
- Give options with a recommendation.
- Keep working on the parts that are clear.

## Working in parallel
- When steps of the remaining work touch different files and need none of each other's results, don't do them one after another. Hand them to background agents and run them at the same time. Keep your own hands on the longest strand.
- Before splitting, settle the shared frame first: the types of shared state, function signatures, and file paths. Tell each agent which files it may change and which it must not touch. Never give the same file to two agents.
- Don't split off a check that takes a few minutes, a step whose result the very next step waits for, or edits to the same file.
- When you report progress, say who is doing what: you, which agent, and what each one is waiting for.

## Secrets
Never ask for, print, or paste secret values (keys, passwords, tokens) in chat, docs, issues, or logs.

## Docs
One fact, one place.
- Before writing a rule, value, command, path, or procedure, find where it already lives, and link to it instead of copying it.
- Facts the code enforces belong to the code or config.
- When a fact changes, update the one place it lives and fix every pointer to it.

## Branches
- The integration branch is `{{branchPrefix}}_develop`.
- Task branches are `{{branchPrefix}}_<task>`.
- A project's own CLAUDE.md wins where it names other branches.
- A Paseo workspace made with Paseo's button gets a random name (such as `splendid-pelican`): its branch is the same as its worktree folder name and has no `_`. Once the first message tells you the task, name it after the task, before anything else:
  - Only if the branch has no upstream and no PR: rename it to the task-branch name above with `git branch -m`, `<task>` in lowercase letters, digits, and hyphens.
  - Set the workspace title to the same name with Paseo's `rename_workspace` tool.
  - Leave the folder name. Skip the main checkout and branches already named by the rule.

## Projects not yet set up the Paseo way
When the Paseo tools (`mcp__paseo__*`) are available and the first request of a conversation comes in the main checkout of a git repository (`git rev-parse --git-dir` equals `--git-common-dir`) that has no `paseo.json` at its root, set it up with the `paseo-workflow` skill before doing the request:
- Ask only the values the skill needs and nothing else records, as choice questions (AskUserQuestion), batched, with a recommendation.
- Then set it up in one go, and then do the request.
- If the setup cannot run, say so in one line and still do the request.

## Work tracking (GitHub Issues)
When a project tracks work in GitHub Issues:
- Every request from the user, question owed to the user, and step only the user can do becomes an issue before the work starts. Make one issue per thing; no catch-all lists.
- Say what is done or open from `gh issue list`, not from memory.
- Write each issue in easy Korean, with these sections: 무엇, 왜, 어디, 남은 일, 완료 조건, 근거.
  - Each 남은 일 item names who it waits on: 사용자, Claude, 외부, or 팀원.
  - Use one status label and a milestone, if the project has them.
- Close an issue only when its 완료 조건 is verified. In commits, write `Refs #N` while anything is left, and `Closes #N` only when the commit finishes it.
- No personal data or secrets in issues.
