---
name: progress-report
description: The user's progress report (진행 상황 보고) as tables only, in any project. Use when the user asks "진행상황 보고해줘", "얼마나 남았어", "다시 보고해봐", "보고해줘", or asks for remaining work, time left, or who must do what.
---

# Progress report (진행 상황 보고)

The report is tables only, in Korean, with no words outside them: no conclusion line, no questions, no explanations, no "정해 주실 것". If the user asked a question in the same message, answer it first in a few lines, then the tables.

## Gather the facts first (never from memory)
- Open work: the project's tracker if it has one (`gh issue list --state open` when the repo uses GitHub Issues; else the project's task list or TODO doc), plus what was asked or touched in this session.
- Where each change is: `git status --short`, `git log --oneline` on the working branch, open branches and agent worktrees (`git -C <worktree> log <base>..HEAD`). If the project tracks deploys (tags such as `deployed/*`, a deploy log, CI), read them to tell the stages apart.
- Running agents: say 진행 중 only from what you can see (commits, changed files), never predict their results.
- Read the project's CLAUDE.md for its own labels, deploy stages and synced artifacts, and use its words.

## The tables, in this order

**AI 할 일**
| 이슈 | 할 일 | 고치는 파일 | 상태 | 어디까지 | 남은 시간 |
|---|---|---|---|---|---|

- One row per file. 이슈 and 할 일 only on the first row of each item; the following rows of that item leave them empty. 고치는 파일, 상태, 어디까지 and 남은 시간 are filled on every row (repeat 끝남 / 개발; 남은 시간 "–" when done, "위와 함께" when one estimate covers the item).
- 이슈: the issue number, or "–" when the project has no tracker or the item has none.
- 할 일: short and plain, what it does for the user (for example "로그인 오류 문구 고치기", "목록에 검색 칸 추가").
- 고치는 파일: real paths in backticks, one per row, never a count like "4개". A deleted folder says "(삭제)", a new file "(새 파일)". No code change: "없음". Server work: "서버 (<where>)".
- 상태: 끝남 · 진행 중 · 마지막 테스트 중 · 대기 · 막힘.
- 어디까지: the project's stages (for example 개발 → 테스트 서버 → 정식 서버), or 닫음 (closed with no code); "–" when not yet merged. A project without servers uses 작업 중 → 커밋됨 → 반영됨.
- 남은 시간: AI working time. Review, checks and release are their own row when the project has them (usually 1~1.5시간).
- Last row **합계**, with only the summed time filled.
- Never use `<br>` in a cell: the terminal shows it as text.

**사람 할 일**
| 이슈 | 할 일 | 어디서 |
|---|---|---|

- Steps only the user can do (the project's labels for those steps, if any). 어디서 names the place or service: AWS, Cloudflare, Kakao developers, 관리자 화면, 실제 기기 …; one place per row, 이슈 and 할 일 empty on the extra rows. One line "없음" when there are none.

**사용자 결정** — one line "없음", or a table | 이슈 | 질문 | 추천 | with only the open decisions that block work now.

**다음 단계**
| 순서 | 이슈 | 할 일 | 누가 | 어디서 |
|---|---|---|---|---|

- 누가: AI or 사람. 어디서: the stage (개발, 테스트 서버, 정식 서버 …) or the service.

**아티팩트** — only when the project's CLAUDE.md lists synced artifacts (for example PRD · 디자인 시스템 · 화면 흐름): one column per artifact, each cell 고침 · 나중에 · 해당 없음 · 못 함, from that project's sync table for what changed since each artifact's stamp. Leave the table out otherwise.
