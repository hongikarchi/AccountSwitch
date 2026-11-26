---
name: ui-review
description: Review a product's screens (landing page, web app, phone app) for design quality, "looks AI-made" patterns, UX writing, and information overload, then deliver a short report: at most 10 findings, one page each, a screenshot with the problem boxed in red. Use when the user asks for 화면 점검, UI/UX 점검, 디자인 점검, "AI 티" 점검, 정보량 점검, a design audit, or a UI review of any project. Report only; nothing is changed until the user picks items.
---

# UI review

Code first, pictures only where they pay. The source shows most craft problems faster and cheaper than screenshots, so scan the code first, then capture only the screens that need eyes.

## 1. Set up (ask only what you cannot find)

- **Scope.** Which surfaces (landing, web app, phone app, shared links). Default: the main flow.
- **Project rules first.** Read the project's design rules (DESIGN.md, design tokens, style guide, CLAUDE.md UI rules). They override the checklist. Note any rule the checklist contradicts instead of reporting it as a finding.
- Change no code during the review.

## 2. Code pass (no browser)

Use `references/checklist.md` (154 items in 14 groups). Run every "Grep" item against the UI source and the copy files. Examples: raw colours outside tokens, raw font sizes, duplicate buttons, long strings, missing empty, loading, or error states, missing labels, and fixed widths that break at 390.

- Record each hit with its file and line.
- Group repeats into one candidate with all its places.
- Map each candidate to the screen or screens where it shows. Those screens go on the capture list.

## 3. Capture (only what needs eyes)

- **Capture list:**
  - the screens from step 2
  - 5 to 8 main-flow screens for the "Look" items and the first-time-user questions: home, the main list, the main form, and the main detail
  - every screen, only when the user asks for "전체 화면"
- **Run it locally with sample data.** Start the project's dev server with its seed or demo data. Never capture real customer data. If no sample data exists, ask.
- **Browser:**
  - Use the browser tool the user's or project's rules prefer; otherwise any available one.
  - Capture at phone width (390) and desktop width (1280).
  - Use light mode unless the product is dark-first.
  - Script the captures. Don't drive them by hand.
- **On each captured screen:**
  - Confirm or drop the code candidates.
  - Check the "Look" items.
  - Ask the first-time-user questions:
    1. **지금 뭘 눌러야 하지?** Is there one obvious next action, or several competing ones?
    2. **이 기능은 어디 있지?** Is it findable? Is the same word used for the same thing everywhere?
    3. **한 화면에 읽을 게 너무 많지 않나?** Does any text repeat what the title already says?
- Record a finding only with evidence: a screenshot region, or a file and line.
- The optional scanners at the end of the checklist (impeccable detect, ui-craft-detect, axe, Lighthouse) download code. Ask before running any of them, and never run an `install` that writes into agent config.

## 4. Report: one finding per page, at most 10

The user reads pictures, not prose. Keep the report short enough to read in ten minutes.

- **Pick at most 10 findings.** Rank them by how much they hurt a first-time user. Merge repeats into one finding and list every place it appears. Drop the rest, or put them in a one-line list at the end.
- **Format:** a PDF (or one HTML page per finding) in `<project>-reports/ui-review-<YYYY-MM-DD>/` inside the user's Documents folder (macOS: `~/Documents`; Windows: `[Environment]::GetFolderPath('MyDocuments')` in PowerShell, which also finds it when OneDrive has moved it), in the user's language, in plain words. Do not open it automatically; give the path.
- **Page 1:** the scope in one line (screens, widths, sample data), then a table: number, screen, the problem in a few words, severity (높음 / 중간 / 낮음), and timing (지금 / 나중).
- **One page per finding:**
  - the screenshot, with a red box on the problem and a number
  - one line on what is wrong
  - one line on the suggested fix
  - severity and timing
  - for a repeat, small thumbnails of the other places
- No themes section, no per-screen essays, no "already good" section. One line of what is good is enough, on page 1.
- End with one line: nothing was changed, and the user picks by number.


## 5. After the user picks

Fix only the picked items, in the project's normal workflow (branch, tests, PR). If the user wants a check, retake the same screens and add a before/after page for each fixed item, with the same numbers.
