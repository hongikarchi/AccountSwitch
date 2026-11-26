# UI review checklist (154 items)

Compiled from the rule files of 10 public design skills (an 11th, WSH, was read but not used) plus the user's notes, then extended with our own additions (OWN). Rules were read as text and rewritten in our own words; none of the source skills need to be installed. Credits and licenses are under "Sources and licenses" at the end. Applies to landing pages, web apps and hybrid phone apps.

How to read an item: `ID | rule | how to check | severity | sources`.
Severity: H = looks AI-made or hurts the task, M = medium, L = low.
"Grep" means search the project's UI source (find it first: e.g. `src/`, `apps/*/src`, `packages/ui/src`). "Look" means check the rendered screen (phone ~375-390px, desktop ~1280-1440px).
The project's own design rules (DESIGN.md, design tokens, style guide) win over any item here. Where an item names a colour or token, read it against the project's tokens.

Source keys:
- THR = Threads series "AI 디자인 느낌 빼는 법" (relayed by the user)
- UC = educlopez/ui-craft, `skills/ui-craft/SKILL.md` and `skills/ui-craft/references/*.md`; scanner `scripts/detect/rules.mjs` (UC-scan)
- IMP = pbakaus/impeccable, `skill/reference/craft-floor.md`, `operate.md`, `typeset.md`, `layout.md`, `clarify.md`, `harden.md`, `adapt.md`; rule list in the CLI reference under `docs/` (IMP-scan)
- ANT = anthropics/skills, `skills/frontend-design/SKILL.md`
- EMIL = emilkowalski/skills, `skills/emil-design-eng/SKILL.md`, `ui-cheatsheet.md`, `skills/apple-design/SKILL.md`
- JAK = jakubkrehel/skills ("better-interface" family), `skills/better-{writing,layout,typography,colors,accessibility}/`
- SF = Superfuture/design-review, `design-review/skills/design-review/checklist.md`
- ADDY = addyosmani/web-quality-skills, `skills/accessibility/SKILL.md`
- SHAD = shadcn-ui/ui, `skills/shadcn/SKILL.md`
- MENG = MengTo/Skills, `agent-skills/web-design/beautiful-shadows/SKILL.md`
- WSH = wshobson/agents, `plugins/ui-design/skills/interaction-design/SKILL.md` (read, not used: no item cites it)
- TOSS = claudianus/toss-ux-writing-skill, `SKILL.md` and `references/*.md`
- OWN = our own addition (judgment, not from a source)

---

## 1. Anti-slop visual patterns (SLOP)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| SLOP-01 | Squint test: with the screen blurred, one thing dominates. Decide the single first-seen element per screen before styling. | Look: apply `filter: blur(8px)` in DevTools. If you see a flat field of similar boxes, or two things tie, fail. | H | THR, UC finish-bar Pass 1, IMP layout.md |
| SLOP-02 | No identical card grids (icon + heading + text repeated 3-6x) as page structure. | Look for 3+ equal-size sibling cards. Grep `grid-cols-3`, `repeat(3`, repeated `<Card>` with an icon child. | H | UC SKILL "Critical", IMP craft-floor "Refuse", THR |
| SLOP-03 | No nested cards, and no card around every section. Cards are for peer items in a collection. | Look: a rounded box inside a rounded box. Grep `Card` inside `Card`, or `rounded-` + `border` + `shadow` on both a wrapper and its child. | H | IMP craft-floor, UC "App UI built from stacked cards", THR |
| SLOP-04 | No purple/blue/cyan gradient fills, gradient text, or gradient hero metrics. If the brand accent itself is purple or blue, keep it flat and use it only on actions and selection. | Grep `linear-gradient`, `bg-gradient-to`, `background-clip: text`, `from-purple`, `to-cyan`, `from-violet`. | H | UC-scan `purple-cyan-gradient`, `gradient-text-metric`; IMP-scan `gradient-text`, `ai-color-palette`; ANT |
| SLOP-05 | No emoji or Unicode glyphs as feature icons. One icon family, one stroke weight, one container shape. | Look: emoji in headings, feature rows, buttons, empty states. Grep emoji ranges `[\u{1F300}-\u{1FAFF}]`, `✓ ✔ ★ →` in JSX text used as icons. Check all icons come from one library. | H | UC-scan `emoji-feature-icon`, finish-bar Pass 5; IMP craft-floor; THR |
| SLOP-06 | No glassmorphism, blur panels, soft gradient blobs/orbs, decorative glow, zero-offset coloured halos. | Grep `backdrop-filter`, `blur-`, `box-shadow: 0 0 \d+px <colour>`, `radial-gradient`, `blur-3xl`. | H | UC "Major", IMP-scan `dark-glow`, `radial-halo`, `radial-spotlight-glow` |
| SLOP-07 | No coloured thick side/top stripe on cards, list items, alerts (`border-left` over 1px in a colour). | Grep `border-l-4`, `border-left: [2-9]px`, `border-t-4`. Look at alert and metric cards. | H | IMP craft-floor, IMP-scan `side-tab`; UC "Major" |
| SLOP-08 | When every element shares the same corner rounding and the same soft shadow, the screen reads as generated. Let the rounding follow what the element is (a control, a card, a sheet), and show depth one way only: a border or a shadow, never a hairline border plus a wide, blurry shadow. | Grep distinct `rounded-*`/`border-radius` values and `shadow-*` counts per screen. Look at cards with a hairline border plus wide blur shadow. | M | ANT trait 4, UC "Uniform border-radius", IMP craft-floor (`codex` block), IMP-scan `gpt-thin-border-wide-shadow`, MENG |
| SLOP-09 | Drop the stock decorations: small spaced-out capitals sitting over a heading, section numbers like 01 / 02, meta lines joined with middle dots, labels made of one bold word plus a dash and a half-sentence, and an arrow tacked onto every link. Keep numbering only when the content really is a sequence of steps. | Grep `uppercase`, `tracking-widest`, `tracking-wider`, `text-transform: uppercase`, `0[1-9] [·/]`, ` · `, `→` in JSX text. | H | IMP craft-floor (ban), UC-scan `eyebrow-flood`, `section-number-eyebrow`, ANT, IMP-scan `kicker-above-heading`, `numbered-section-labels`. See conflict C1. |
| SLOP-10 | No fake product shots built from styled `<div>`s, no text-only "logo wall", no sketch-style SVG scenes, no stock-icon-in-rounded-square tile above each heading. | Look at hero and feature visuals. Grep for hero components with many `<div>`s and no `<img>`/`<picture>`. | H | UC "Major", IMP-scan `icon-tile-stack`, `shape-assembled-illustration` |
| SLOP-11 | Decorative chrome standing in for content: sparklines, progress rings, soft-shadow rounded boxes with no data behind them. | Look: any widget whose number or chart is not tied to a real field. | M | IMP craft-floor `reflex-decorative-chrome` |
| SLOP-12 | AI-typical hero scaffold: big number + small label + supporting stats + gradient accent. Use it only if it is truly the best form. | Look at the landing hero and the dashboard top row. | M | ANT, IMP craft-floor `ban-hero-metric` |
| SLOP-13 | Em-dash flood and "aphoristic" cadence in visible copy (3+ em dashes in UI strings; "X, not Y." slogans). | Grep `—` count in JSX/i18n strings; read the hero copy aloud. | M | UC-scan `copy/em-dash-flood`, IMP-scan `em-dash-overuse`, `aphoristic-cadence`, `marketing-buzzword` |
| SLOP-14 | Fade-and-slide-up on every section, hover lift on every card, bounce/elastic easing. | Grep `animate-bounce`, `cubic-bezier\(.*1\.[0-9]`, `whileInView`, `fade-up`, `translate-y-` with `transition`. | H | ANT, UC-scan `animate-bounce`, `bounce-elastic-easing` |
| SLOP-15 | Take colours from the product's own tokens, not from whichever palette is in fashion among generated sites (for example a warm off-white page with a burnt-orange accent). A trendy palette makes the product look like every other AI-made page. | Look at the palette versus the project's tokens; any colour outside tokens is a finding. | M | ANT calibration list, IMP-scan `cream-palette` |

## 2. Layout and cards (LAY)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| LAY-01 | Group by proximity and whitespace before adding boxes or divider lines. Use cards selectively by importance. | Look: remove each container mentally; if grouping survives, the box was decoration. Count cards per screen (suggest at most 1 level, and fewer than ~5 per viewport on phone). | H | THR, JAK better-layout "Group with space, not lines", UC "stacked cards" |
| LAY-02 | One primary action per view / per section. Primary = solid, secondary = outline or ghost; the primary is the most prominent interactive element. | Look: count solid accent buttons in a viewport. Grep `variant="default"` or `bg-accent` buttons. | H | JAK better-layout, UC copy.md, UC recipe-landing |
| LAY-03 | Show hierarchy through size, weight, contrast and position; adjacent levels differ by 1.5x or more in at least one signal. | Look: two adjacent text levels that look alike = fail. | H | UC finish-bar Pass 1, SF section 1 |
| LAY-04 | Order content by importance, not by data model. Reading order and DOM/focus order agree. | Tab through; compare to visual order. Grep `order-`, `flex-row-reverse`, `grid-area` reorders. | M | JAK better-layout, IMP layout.md |
| LAY-05 | Align to shared edges; no near-miss alignments. | Look: overlay a grid; check left edges of labels, inputs, cards. | M | SF section 1, JAK better-layout |
| LAY-06 | Use `gap`, not margin hacks. In shadcn code use `flex gap-*`, `size-*`, no `space-x/y`. | Grep `space-x-`, `space-y-`. | L | SHAD styling rules |
| LAY-07 | Cap content width (e.g. forms 480-560px, prose `65ch`) and never stretch to ultrawide. | Look at 1920px. Grep `max-w-`. | M | UC recipe-auth/typography, UC responsive.md |
| LAY-08 | Sidebar uses a subtle tint, not a full dark slab, unless dark mode is chosen. | Look at the app navigation. | L | UC dashboard.md |
| LAY-09 | Overlays (dropdown, popover) must not be clipped by `overflow: hidden/auto` ancestors. | Open each menu inside a table row or card. Grep `overflow-hidden` on ancestors of `absolute` menus; prefer `<dialog>`, popover API, portal. | M | IMP operate.md |
| LAY-10 | Modals are not the first answer. Use inline or progressive alternatives; use a modal for destructive confirms and focused tasks only. See conflict C8. | Grep `Dialog`/`Modal` usage and ask if a sheet, inline panel or page would do. | M | IMP craft-floor `modal-by-reflex`, `product-ban-modal-first-thought` |
| LAY-11 | Content bleeds, controls float; give borderless controls clearance; inset buttons from edges and safe areas. | Look at sticky footers and edge-flush cards at 375px. | L | JAK better-layout, IMP-scan `edge-flush-cards` |

## 3. Typography (TYPE)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| TYPE-01 | Use few font sizes per screen. The user's rule: at most 3. Sources allow 4-7 across a whole product (see conflict C2). OWN target: at most 3 sizes in any one phone screen, a named scale of 5-6 steps product-wide. | Grep distinct `text-[...]`/`font-size` values per page; look at one screen and count. | H | THR, UC typography "Type Hierarchy", SF section 2, UC-scan `type/crowded-ladder` |
| TYPE-02 | No bold-everywhere. Normal and at most medium (500) weight; display type is not bold. Hangul: only use weights the loaded font file has. See conflict C3. | Grep `font-bold`, `font-semibold`, `font-weight: [6-9]00`. Count distinct weights on screen (target 2, max 3). | H | THR comments, UC typography "Display type is not bold", UC-scan `type/bold-display` |
| TYPE-03 | The display step sits 2.5x-4x above the next step with nothing in between. One focal heading, not five headings at similar sizes. | Look at hero and page titles; compare ratio of largest to next size. | M | UC typography, UC-scan `type/display-not-separated`, IMP-scan `flat-type-hierarchy` |
| TYPE-04 | At most 2 families (one body face; optional one display; optional mono for code/data). No display font on UI labels, buttons, data. | Grep `font-family`, `@font-face`, `next/font`/`<link>` fonts. | M | UC typography, IMP operate.md `product-ban-display-fonts-ui`, JAK better-typography |
| TYPE-05 | `font-variant-numeric: tabular-nums` on every number that aligns or changes (money, counts, times, tables). | Grep `tabular-nums` in table/metric components; look at right-aligned columns. | H | UC, EMIL cheatsheet, JAK better-typography, SF section 2 |
| TYPE-06 | Body text is 16px (rem), inputs 16px on mobile (no iOS focus zoom). UI text may be 14px, captions 13px; avoid under 12px. | Grep `text-xs`, `text-[1[01]px]`, `font-size: 1[0-3]px` on body copy; check input font-size at 375px. | H | JAK better-typography "Size floors", UC forms.md, IMP typeset.md, IMP-scan `tiny-text`, `undersized-ui-text` |
| TYPE-07 | `text-wrap: balance` on headings, `text-wrap: pretty` on body. Never balance a paragraph. | Grep `text-balance`, `text-wrap`. Look for one-word last lines in headings. | L | UC, JAK, IMP typeset.md |
| TYPE-08 | Prose measure 45-75 characters (Latin); for Hangul use a shorter character count, about 30-40 syllables per line on desktop reading text. OWN note. | Grep `max-w-prose`, `ch`; measure a long help text. | M | UC typography, IMP-scan `line-length`; Korean figure is OWN |
| TYPE-09 | Unitless line-height by role: display 1.05-1.2, Latin body 1.5-1.65, CJK 1.7-1.85 (OWN: use about 1.6-1.7 for Hangul body). Never `leading-none`/`leading-tight` on text that can wrap. | Grep `leading-none`, `leading-tight`, `line-height: \d+px`. | M | UC typography (CJK 1.7-1.85), JAK better-typography, IMP-scan `tight-leading` |
| TYPE-10 | Letter-spacing: tighten only Latin display. Do not apply negative tracking to Hangul; do not use px tracking. | Grep `tracking-tight`, `tracking-tighter`, `letter-spacing` on elements that hold Korean. | M | UC typography ("Never adjust CJK spacing"), IMP-scan `extreme-negative-tracking`; JAK |
| TYPE-11 | No ALL CAPS on headings, buttons, nav, table headers. Table headers in sentence case, weight 500, secondary colour. (Hangul has no case; this applies to Latin strings and enum labels.) | Grep `uppercase`, `text-transform`. | M | UC-scan `uppercase-heading`, UC dashboard.md, IMP-scan `all-caps-body` |
| TYPE-12 | Load only the faces and weights used. Provide a metric-compatible fallback; set `font-display`; no faux bold. | Check network tab for font files; grep `@font-face` weights vs `font-weight` used; `font-synthesis`. | M | JAK, IMP typeset.md, UC typography |
| TYPE-13 | Truncation always has a way back (tooltip, expand, detail page). Flex children that hold text have `min-w-0`. | Look at long member and team names in tables and cards; grep `truncate`, `line-clamp`, `min-w-0`. | M | EMIL cheatsheet/UC typography, JAK better-typography |
| TYPE-14 | Use real typographic punctuation and `&nbsp;` in units/brand names; no straight quotes in prose. | Grep `"`/`'` in marketing copy; check "10 MB" style breaks. | L | UC typography |
| TYPE-15 | Do not justify text in app UI. | Grep `text-justify`, `text-align: justify`. | L | JAK, IMP-scan `justified-text` |

## 4. Colour and contrast (COLOR)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| COLOR-01 | Contrast floor: body and placeholder 4.5:1, large text and UI/icons 3:1, measured on the rendered pair (also for disabled, placeholder, on tinted surfaces). Where sources prefer APCA, still pass WCAG AA (see C9). | Run axe or Lighthouse; DevTools contrast picker on secondary text over secondary surfaces and cards; dark-mode pairs. | H | JAK better-colors, ADDY, SF section 4, IMP craft-floor, IMP-scan `low-contrast` |
| COLOR-02 | One accent, used for primary actions, selection and state only; 3-5 accent placements per viewport. | Look: count accent-coloured elements above the fold. Grep `text-accent`/`bg-accent` outside buttons, links, selected states. | H | UC Craft Test, IMP operate.md `product-color-accent-only` |
| COLOR-03 | Colour never carries meaning alone: pair status colour with text, icon or shape. | Look in greyscale (DevTools "emulate vision deficiencies"). | H | SF section 4, ADDY, UC state-design |
| COLOR-04 | Status as a small dot (6-8px) plus text label, not a loud coloured pill. Allowed: quiet tinted pill if it holds text. See C5. | Look at status columns. Grep `Badge`, `rounded-full px-2` with colour fills. | M | UC dashboard.md, UC "Colored pills on trend percentages" |
| COLOR-05 | Do not colour trend deltas green/red by default (cost up can be good or bad). Use plain secondary text. | Grep `text-green`, `text-red`, `▲▼`, `ArrowUp` near numbers. | M | UC dashboard.md, UC "Major" |
| COLOR-06 | No pure `#000` text/backgrounds; use tinted ink. Dark mode is a designed theme: tinted near-black, raised surfaces get lighter, borders instead of shadows. | Grep `#000`, `text-black`, `bg-black`; toggle dark mode on every screen. | M | UC-scan `pure-black-text`, finish-bar Pass 3, IMP craft-floor |
| COLOR-07 | Semantic tokens only; no raw colours in components. | Grep hex `#[0-9a-fA-F]{3,8}` and `rgb(` in UI source outside the token files; Tailwind `bg-blue-500`-style classes. | M | SHAD, SF section 10, UC tokens.md, IMP-scan `design-system-color` |
| COLOR-08 | Tint secondary text on coloured surfaces from the surface hue; never plain grey on a coloured background. | Look at text on the soft accent surface and status backgrounds. | M | IMP craft-floor, IMP-scan `gray-on-color` |
| COLOR-09 | Charts: one hue at several opacities or a small named palette. No rainbow, no pie/3D. | Look at every chart; grep chart libs for default palettes. | M | UC dashboard.md, UC-scan `dataviz/categorical-rainbow` |
| COLOR-10 | Set `color-scheme` and `theme-color` to match the theme so native controls and browser chrome follow it. | Grep `color-scheme`, `theme-color` in index.html and CSS. | L | UC SKILL "Design Rules", finish-bar Pass 3 |

## 5. Spacing and density (SPACE)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| SPACE-01 | Spacing comes from a token scale (4px base). No arbitrary 13px/27px values. | Grep `p-\[`, `m-\[`, `gap-\[`, `margin: \d+px` not in scale. | M | UC finish-bar Pass 4, SF section 3, IMP layout.md, IMP-scan `design-system-*` |
| SPACE-02 | Spacing rhythm: within-group < between-groups < between-sections at every nesting level; more space above a heading than below. | Look: scroll and check which level you are in from spacing alone. | H | UC finish-bar Pass 4, IMP craft-floor |
| SPACE-03 | Whitespace builds hierarchy instead of boxes and dividers. | Look for `border-b` on every row plus card plus shadow together. | M | THR, JAK better-layout |
| SPACE-04 | Density matches the task: dashboards 16-20px card padding and 40-48px rows; landing 80-160px between sections; phone is roomier. | Measure row height and section gaps. | M | UC dashboard.md "Content Density", UC recipe-landing, SF section 3 |
| SPACE-05 | Padding is not cramped against text edges (buttons, chips, inputs). | Look at small buttons; ensure at least about 8px vertical, 12px horizontal. | M | IMP-scan `cramped-padding`, `body-text-viewport-edge` |
| SPACE-06 | Do not use one repeated spacing value everywhere (monotonous spacing). | Grep the most frequent gap/padding class; if one value is more than ~70% of uses, review. | L | IMP-scan `monotonous-spacing` |

## 6. Copy and UX writing (COPY) including Korean

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| COPY-01 | Pick the one thing to show first; every other sentence on the screen supports it. | Read the screen; mark the single message; cut the rest. | H | THR |
| COPY-02 | Cut phrases that repeat the same meaning (title + subtitle + helper saying the same thing; "주문서를 작성하세요" under a heading "주문서 작성"). | Read heading, subtext, button, and empty text together; flag same-meaning pairs. Grep `description=`/helper strings beside titles. | H | THR, IMP clarify.md "redundant headings, intros, helper text" |
| COPY-03 | Replace what is recognisable at a glance with an icon or colour (status words, "필수" labels, legend text). Keep a text label where meaning is not obvious or for accessibility. | Look for long text where a standard icon or dot suffices. | M | THR |
| COPY-04 | Buttons are verb + object and keep the same name through the flow (button "저장" -> toast "저장했어요"). No "확인", "제출", "진행", "Click here". | Grep Korean `>확인<`, `>제출<`, `>진행<`, `>다음<`, `>OK<`, `Submit`, `Click here`. List verbs on all buttons and flag aliases (저장/수정/적용). | H | UC copy.md, JAK better-writing, TOSS hard rules, ANT writing section |
| COPY-05 | Use one register: 해요체 (friendly polite) everywhere in the product. No mixing 합니다체/하십시오체 and 반말. Landing page may choose 합니다체 deliberately, but decide once. | Grep `합니다`, `하십시오`, `습니다` vs `해요`, `이에요`, `돼요`; count per surface. | H | TOSS core rules (OWN: for business tools, confirm the register with the product owner) |
| COPY-06 | Prefer active verbs over passive or noun stacks: "설정했어요" not "설정됐어요"; "되어요" is wrong, use "돼요". Passive stays where the state is the point (기록돼요, 만료돼요). | Grep `됐어요`, `되었습니다`, `되어요`, `처리되었`, `완료되었`. | M | TOSS vocabulary.md, SKILL hard rules |
| COPY-07 | Frame a limit as a way forward: lead with the action that is open and what unlocks it, then the limit ("본인 인증을 마치면 보낼 수 있어요", not "인증하지 않으면 보낼 수 없어요"). Legal and policy limits are still stated plainly; a friendly tone must not hide them. | Read every error and disabled state. | M | TOSS decision-tree, review-rubric |
| COPY-08 | Casual honorifics: avoid "~시겠어요", "~시나요", "~셨나요" in form prompts. "파일을 보낼까요?" over "파일을 보내시겠어요?" | Grep `시겠어요`, `시나요`, `셨나요`, `께서`, `여쭙`. | L | TOSS SKILL, surface-patterns.md |
| COPY-09 | Dialogs: title names action and object; body says what is lost; buttons are verb + object. Secondary dismiss button is `닫기`, not `취소`, unless it really cancels an operation. Never "정말 삭제하시겠어요?" alone. | Open every confirm dialog; grep `정말`, `Are you sure`, `취소`. | H | JAK better-writing, TOSS surface-patterns, UC copy.md |
| COPY-10 | Errors: what happened + what to do next, next to the field; no blame, no "Oops", no raw codes as the headline; show an error ID only as secondary. Never "문제가 발생했습니다" alone. | Grep `문제가 발생`, `오류가 발생`, `Something went wrong`, `Oops`, `실패했습니다`. Trigger each error path. | H | JAK better-writing, UC state-design, TOSS surface-patterns |
| COPY-11 | Terminology glossary: one Korean word per concept (회원/사용자/고객, 주문/구매, 결제/지불). One word per action (삭제/제거/보관). | Grep each term; list variants and counts. | H | UC copy.md "Terminology Consistency", JAK better-writing |
| COPY-12 | Korean numbers, dates, money via `Intl` with `ko-KR`: `1,234,000원` (or `₩`) pick one; dates `2026. 11. 9.` or `11월 9일 (월)` pick one pattern; times 24h with consistent form; absolute date after about a week. | Grep `toLocaleString(`, `.toFixed`, hand-built date strings, `MM/DD`, `new Intl.`. | M | UC copy.md "Locale-Aware", EMIL cheatsheet (OWN: Korean formats) |
| COPY-13 | Build strings whole (no concatenated fragments, no `n === 1 ? "" : "s"`). Korean has no plural but keep variables structured for reordering. | Grep `+ ` string concatenation in JSX text, template literals building sentences. | L | JAK better-writing, IMP clarify.md |
| COPY-14 | Remove filler: "successfully", "Please", "성공적으로", "~해 주시기 바랍니다", exclamation points on routine saves. Success copy is restrained ("저장했어요"). | Grep `성공적으로`, `바랍니다`, `!` in toasts. | M | JAK better-writing, UC copy.md |
| COPY-15 | No placeholder or lorem copy shipped; no "Placeholder as label". Placeholder shows an example format. | Grep `lorem`, `TODO`, `placeholder="이름"` without label. | M | UC-scan `copy/placeholder-shipped`, `forms/placeholder-as-label`, JAK better-writing |
| COPY-16 | Do not mix Korean UI with English technical words where a common Korean word exists; avoid internal jargon (webhook, token, status codes) in user-facing strings. | Read the UI as a first-time user who does not know the team's internal terms. | M | ANT writing section, IMP clarify.md |
| COPY-17 | Link text names the destination; no two identical "자세히 보기" links. | Grep `자세히 보기`, `더 보기`, `here`. | L | JAK better-writing, UC-scan generic-CTA |

## 7. States: empty, loading, error, success (STATE)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| STATE-01 | Empty state = one line for what is empty, one line for what to do, one button. Add an icon only if it helps. No "No data". | Open every list with zero rows. Count lines (should be 2) and buttons (1). | H | THR, UC state-design, SHAD `Empty` |
| STATE-02 | Loading shows a skeleton that matches the final layout (after about 200ms, upper bound about 5s); empty shows a message. Never a centred spinner on a blank page. | Throttle network to Slow 3G; look for layout shift. Grep `Spinner`, `Loader` on page-level. | H | THR, UC state-design, SHAD `Skeleton`, IMP operate.md |
| STATE-03 | Error: specific cause + one-click retry; field errors inline at the field; keep form input on failure. | Kill the network, send a bad request, submit invalid forms. | H | UC state-design, JAK better-writing |
| STATE-04 | Distinguish offline, 401/403, 404, 500, validation, and rate limit; each has its own message and recovery. | Simulate each in DevTools. Grep error mapping in API client. | M | UC state-design, IMP harden.md |
| STATE-05 | Filtered-empty is different from first-run empty: "조건에 맞는 결과가 없어요" + "필터 지우기". | Apply a filter with no matches. | M | UC state-design |
| STATE-06 | Partial failure: one broken tile shows an inline error with retry; the rest of the page still renders. | Fail one dashboard API call. | M | UC state-design |
| STATE-07 | Success feedback is brief and quiet; toast stays long enough to read (4-6s) and is not the only record. Destructive success offers undo. | Trigger saves, deletes; time the toast. | M | UC state-design, JAK better-writing ("Undo beats confirmation") |
| STATE-08 | Design each control for every situation it can be in, not only at rest: pointer over it, keyboard focus on it, being pressed, waiting on a result, showing a failure, and switched off. A button that is waiting keeps its label and its width. | Grep component stories; hover/focus/disabled each button. | H | IMP operate.md `components-all-states`, SF section 6, UC state-design |
| STATE-09 | Disabled controls say why (helper text or tooltip). Prefer an enabled action that validates on press. | Look at disabled primary buttons in forms. | M | UC forms.md, UC copy.md. See C10. |
| STATE-10 | Data-fetching components handle loading, empty and error in code. | Grep components calling `useQuery`/`fetch` and check three branches. | M | UC-scan `state/missing-empty-or-error` |
| STATE-11 | Offline/poor-signal state for on-the-go phone use: show a banner and queue writes. | Toggle airplane mode in the app. | M | UC state-design (OWN: use on the move) |

## 8. Forms and inputs (FORM)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| FORM-01 | Single column; labels above inputs (within about 16px); submit button aligned with the field edge. | Look at each form at 375px and 1440px. | H | UC forms.md, JAK better-accessibility forms.md |
| FORM-02 | Every input has a visible `<label>`; placeholder is an example, never the label. | Grep `<input`/`<Input` with `placeholder` and no `<label>`/`aria-label`/`htmlFor`. | H | UC-scan `forms/placeholder-as-label`, JAK |
| FORM-03 | Validate on blur after first interaction, on submit for the rest; never on mount; summarise all errors at once; focus the first error. | Tab through an empty form and submit. | M | UC forms.md |
| FORM-04 | Errors below the field with colour + icon + text; `aria-invalid` and `aria-describedby`. Hints above or beside the field. | Grep `aria-invalid`, `aria-describedby`. | H | UC forms.md, SHAD forms rules, ADDY |
| FORM-05 | Correct `type`, `inputmode`, `autocomplete`, `enterKeyHint` per field (phone: `type="tel"`, `inputmode="numeric"`, `autocomplete="tel"`; names `name`; 인증번호 `one-time-code`). | Grep `<input` attributes; test on iPhone keyboard. | H | UC-scan `forms/autocomplete-missing`, UC accessibility.md, JAK (OWN: Korean fields) |
| FORM-06 | Never block paste (resident ID, account number, verification code). | Paste into each field. Grep `onPaste`, `preventDefault`. | M | UC forms.md |
| FORM-07 | Mark the minority: "(선택)" on optional fields, or mark both; never leave users guessing. Fewer than about 7 fields per step; show step count and cost up front ("3단계, 약 2분"). | Count fields per step. | M | UC forms.md |
| FORM-08 | Selection widgets by option count: 2-5 radios or segmented, 6-10 radios or select, over 10 searchable. Checkbox applies on submit, toggle applies at once. Positive labels. | Look at selects with 3 options, toggles inside forms. | M | UC forms.md, SHAD `ToggleGroup` |
| FORM-09 | Field width hints at content length (postal code narrow, address wide). Inputs sit on solid surfaces. | Look. | L | UC forms.md |
| FORM-10 | Autosave long forms (debounce 1-2s), show "저장했어요" quietly, resume where the user stopped; save on network drop. | Fill half, close, reopen. | M | UC forms.md |
| FORM-11 | Consent, payment and final-submit screens: show a summary of what the user is agreeing to above the action, one primary action, a large target, and a confirmation of what was done. | Walk the flow on a phone, including from in-app browsers (e.g. KakaoTalk) if links are shared there. | H | OWN (from MOB/STATE rules) |
| FORM-12 | Destructive and irreversible actions name the object; for the biggest ones ask to type the name. | Open delete flows. | M | UC copy.md, JAK better-writing, UC-scan `dark-pattern/destructive-no-confirm` |

## 9. Mobile and touch (MOB)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| MOB-01 | Touch targets at least 44x44px (visible mark may be smaller; expand the hit area), with spacing between. WCAG 2.5.8 AA minimum is 24px; Apple 44; Material 48. Use 44 (see C11). | Grep `h-8`, `w-8`, `size-6`, `p-1` on icon buttons; DevTools element sizes at 375px. | H | UC accessibility.md/responsive.md, JAK hit-areas.md, SF section 6, ADDY |
| MOB-02 | Primary and navigational actions sit in the bottom-centre thumb zone; destructive and cancel actions deliberately away from it. Sticky bottom primary bar on key flows. | Look at submit and approve screens one-handed on a real device. | H | UC responsive.md, IMP adapt.md |
| MOB-03 | Respect safe areas: `viewport-fit=cover`, `env(safe-area-inset-*)` on fixed/sticky bars and bottom nav; no content under the notch or home indicator. | Grep `safe-area-inset`, `viewport-fit`; test on iPhone with notch. | H | UC responsive.md, JAK better-layout |
| MOB-04 | Use `dvh`, not `100vh`, for full-height panes so the URL bar and keyboard do not cover things. Keyboard open must not hide the focused input or submit button. | Grep `100vh`, `h-screen`; open keyboard in forms. | H | UC responsive.md, JAK better-layout |
| MOB-05 | Inputs at 16px or larger (no auto-zoom); never `maximum-scale=1` / `user-scalable=no`. | Grep viewport meta; focus inputs on iOS. | H | UC forms.md, IMP harden.md (OWN: viewport meta) |
| MOB-06 | Hover is never the only way: no hover-only tooltips/menus; gate hover with `@media (hover: hover)`. | Grep `hover:` that reveals content, `group-hover`. | M | EMIL (Touch device hover states), UC responsive.md |
| MOB-07 | Gestures have visible alternatives; swipe only for reversible actions; drags need single-pointer alternatives. | Look for swipe-to-delete without a button. | M | UC responsive.md, JAK hit-areas.md |
| MOB-08 | Phone patterns: bottom nav or tab bar, bottom sheets instead of dropdowns, single column, back button in flows. | Look at navigation on 375px. | M | UC responsive.md, IMP adapt.md |
| MOB-09 | A hybrid app (Capacitor, WebView) feels native: no text selection on chrome, no tap-highlight flash, no rubber-band bounce of whole page, status-bar style matches theme, haptics on key confirms. | Grep `-webkit-tap-highlight-color`, `user-select`, `overscroll-behavior`; run on device. | M | EMIL apple-design (haptics, rubber-banding), OWN |
| MOB-10 | Do not simulate a phone UI inside a desktop browser for the web app; the same pages must be usable on mobile web (tables collapse to lists/cards, sidebar to drawer or bottom nav). | Resize the web app to 375px. | H | UC responsive.md, IMP-scan `first-viewport-column-overflow` |
| MOB-11 | Test on real devices and in in-app browsers your users open links from (e.g. KakaoTalk), Samsung Internet, Safari. | Manual device pass. | M | EMIL ("Test on real devices"), OWN |

## 10. Motion (MOTION)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| MOTION-01 | Animate only to show state, feedback, or spatial change; none for high-frequency actions. Product loads into a task without page-load choreography. | Grep `animate-`, `motion.`, `framer`, `@keyframes`; ask why each exists. | H | EMIL decision framework, IMP operate.md, ANT |
| MOTION-02 | Duration 100-300ms for UI (modals/drawers up to about 400ms); marketing may be longer. | Grep `duration-`, `transition: ... \d+ms`, `animation-duration`. | M | EMIL, UC (<=400ms), SF section 5 |
| MOTION-03 | Specific properties only; never `transition: all`. Animate `transform` and `opacity`, not `width/height/top/left`. | Grep `transition: all`, `transition-all`, `animate.*(width\|height\|top\|left)`. | H | UC-scan `transition-all`, `left-top-animation`, EMIL |
| MOTION-04 | Ease-out for entering; no ease-in on interactive UI; no bounce/elastic. | Grep `ease-in`, `cubic-bezier`, `spring` overshoot. | M | EMIL, SF section 5, UC-scan |
| MOTION-05 | Honour `prefers-reduced-motion` with a real fallback. | Grep `prefers-reduced-motion`, `motion-reduce:`; toggle the OS setting. | H | UC accessibility.md, ADDY (2.3), SF, JAK motion-and-zoom.md |
| MOTION-06 | Press feedback on buttons (`:active` scale about 0.97). Popovers scale from their trigger; do not animate from `scale(0)`. | Press buttons; open popovers. | L | EMIL |
| MOTION-07 | No `setTimeout`-driven animation; no layout shift when content appears. | Grep `setTimeout` near style changes; look for CLS. | L | UC-scan `setTimeout-animation` |
| MOTION-08 | Scroll-reveal sections on the landing at most once, not on every block. One authored moment per page. | Look at landing scroll. | M | ANT, IMP craft-floor `motion-no-section-fade` |

## 11. Accessibility (A11Y)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| A11Y-01 | Visible `:focus-visible` ring on every interactive element; never `outline: none` without a replacement. Focus not hidden by sticky bars. | Tab through each page. Grep `outline-none`, `outline: none`, `focus:outline-none` without `focus-visible:ring`. | H | UC-scan `a11y/outline-none-no-replacement`, `no-focus-visible`; JAK focus-and-keyboard.md; ADDY (2.4.7, 2.4.11) |
| A11Y-02 | Full keyboard operation, logical focus order, focus trapped in dialogs and restored on close. | Use only keyboard for each flow. | H | ADDY, JAK, SF section 7 |
| A11Y-03 | Semantic HTML: `button` vs `a`, headings in order (no h1 to h3 skip), landmarks (`nav aria-label`, `main`), `aria-current="page"`. | Grep `<div onClick`, `role="button"`; run axe. | H | UC-scan `a11y/heading-order-skip`, UC dashboard.md, SF section 7 |
| A11Y-04 | Icon-only buttons have an accessible name (`aria-label`) and a tooltip; no emoji in `aria-label`. | Grep icon buttons without `aria-label`/`sr-only`. | H | UC-scan `a11y/icon-only-button-no-label`, `aria-label-emoji` |
| A11Y-05 | Images have meaningful `alt` or empty `alt` for decoration; `<img>` has width/height or aspect-ratio. | Grep `<img` without `alt`, `width`. | M | UC-scan `perf/image-no-dimensions`, SF section 7 |
| A11Y-06 | Dialog, Sheet, Drawer always have a title; use native `<dialog>`/popover or a tested library. | Grep `DialogContent` without `DialogTitle`. | M | SHAD critical rules, UC-scan `a11y/modal-without-dialog` |
| A11Y-07 | Live regions for toasts, async results, errors (`aria-live`). | Test with VoiceOver / TalkBack. | M | ADDY (4.1.3), JAK screen-readers.md |
| A11Y-08 | Set `lang="ko"` on the document (and `lang="en"` on English runs) so screen readers and font fallback behave. | Grep `<html lang`. | M | ADDY (3.1.1), JAK (Language and bidi) |
| A11Y-09 | Works at 200% zoom and with larger OS text size; no clipped content at 320px. | Zoom to 200%; set iOS Dynamic Type large. | H | JAK better-layout, ADDY, SF section 7 |
| A11Y-10 | New in WCAG 2.2: authentication is not a cognitive test (allow paste/password managers/SMS code), no redundant entry, consistent help location. | Review login and identity-check steps. | M | ADDY (3.3.7, 3.3.8, 3.2.6) |

## 12. Responsive (RESP)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| RESP-01 | No horizontal page scroll at 320-1440px; nothing clipped or overlapped. Use `minmax(0,1fr)` and `min-width:0` for long content in grids/flex. | Resize; grep `w-screen`, `100vw`, fixed `width: \d+px`. | H | SF section 8, JAK better-layout |
| RESP-02 | Responsive change is structural (sidebar to drawer/bottom nav, table to list/cards), not only fluid font scaling. Product UI uses a fixed rem scale; only marketing display type is fluid. See C7. | Look at each breakpoint. Grep `clamp(` in app (not landing). | M | IMP operate.md, UC responsive.md |
| RESP-03 | Content-driven breakpoints plus container queries for reusable components. | Grep `@media (max-width` inside components; `@container`. | L | UC responsive.md, JAK better-layout |
| RESP-04 | Test mobile, tablet, laptop, ultra-wide; portrait and landscape. | Device matrix. | M | UC responsive.md |
| RESP-05 | Real long Korean strings at every breakpoint: names with 6-10 syllables, 30-character team or company names, large won amounts. Add 30-40% space budget where English labels may be swapped. | Fill fixtures with long data; check overflow. | M | IMP harden.md, UC typography |

## 13. Landing-page specifics (LAND)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| LAND-01 | Keep the hero simple: headline (at most 2 lines on desktop), subtext at most about 20 words (Korean: one or two short sentences), 1 primary + at most 1 secondary CTA, one visual. Nothing else rides the hero. | Count text elements above the fold at 1440 and 375. | H | THR, UC recipe-landing "Hero discipline" |
| LAND-02 | Hero shows the product doing its job: a real screenshot or real component crop (30-70% of the fold), not a stock image or div mockup. | Look. | H | UC recipe-landing, ANT |
| LAND-03 | One conversion action, one CTA label per intent, reused in nav, hero, and footer. CTA hierarchy: nav CTA, hero CTA, section CTAs do not tie. | Grep CTA labels ("문의하기", "상담 신청", "시작하기") and count variants. | H | UC-scan `copy/duplicate-cta-intent`, UC recipe-landing |
| LAND-04 | Social proof must be true and specific. No invented logos, testimonials, star ratings, user counts, or "trusted by N teams". Only claim what is built. | Review every number, logo, and quote against a real source. | H | UC recipe-landing/inspiration (specific proof), IMP-scan `theater-slop-phrase` |
| LAND-05 | Feature sections: 2-3 asymmetric rows with real visuals; no uniform 3-column icon grid; each section answers one question; a layout family appears once per page. | List section layouts; flag repeats. | H | UC recipe-landing, UC "Critical" |
| LAND-06 | No decorative scroll cue, version badge, or "Scroll to explore". No fake version stamps in the footer. | Grep `scroll`, `v1.`, `BETA`. | L | UC-scan `copy/scroll-cue`, UC recipe-landing |
| LAND-07 | Pricing: on the landing, highlight the recommended plan without hiding siblings. Follow the project's and app stores' rules on whether payment or plan UI may appear inside the app build. | Grep price/plan strings in app surfaces; check the project rules. | H | UC recipe-landing pricing, OWN |
| LAND-08 | No walls of text: at most 2-3 sentences per section; headline states the outcome, not a feature name. | Read each section. | M | UC "Major", THR |
| LAND-09 | Images: dimensioned, responsive (`srcset`), lazy below fold; hero image not lazy; LCP under 2.5s on 4G; fonts not blocking. | Lighthouse mobile run. | M | UC metadata/recipe-landing, ADDY |
| LAND-10 | Metadata and sharing: title, description, OG image (Korean), `lang`, favicon, canonical; KakaoTalk link preview checks. | Share the URL into a KakaoTalk chat; check OG tags. | M | UC metadata.md (OWN: KakaoTalk) |
| LAND-11 | Landing visual language matches the app (tokens, type, icon style) so the signup transition does not feel like two products. | Compare landing and app screenshots. | M | SF section 10, OWN |

## 14. B2B dashboard and table specifics (DASH)

| ID | Rule | Check | Sev | Source |
|---|---|---|---|---|
| DASH-01 | Name the user and the decision in the next 60 seconds. Hierarchy: one hero metric, 2-4 supporting metrics, 0-3 charts, deep-dive tables below. Not a grid of 8 equal KPI cards. | Look at the dashboard; count same-weight KPI cards. | H | UC dashboard.md "Signal-to-Noise Hierarchy" |
| DASH-02 | Show enough data for a decision above the fold (metric + chart/list + start of table). | Look at 1440x900. | M | UC dashboard.md |
| DASH-03 | Tables: left-align text, right-align numbers, tabular-nums; sentence-case headers; row hover; row height 40-48px; first column identifies the row. | Look; grep `<th`, `uppercase`. | H | UC dashboard.md, UC-scan |
| DASH-04 | Tables wrap in `overflow-x: auto`, sticky header past about 15 rows, `scrollbar-gutter: stable`, virtualise past about 200 rows; on phone, collapse to cards or key-column list. | Grep `<table` without overflow wrapper; test 500 rows at 375px. | H | UC dashboard.md, UC-scan `tables/no-overflow-handling` |
| DASH-05 | Filters/toolbar: ghost buttons, one date-range control, active filters visible, "필터 지우기" appears only when filters are active; filter state in URL. | Apply filters, reload, share link. | M | UC dashboard.md |
| DASH-06 | Bulk actions and row actions: visible on selection, destructive ones separated and confirmed. Keyboard and checkbox selection with shift-range. | Select rows. | M | UC dashboard.md (Desktop adaptation), OWN |
| DASH-07 | Money, time and count data: always unit + sign + period (원, 시간), rounded the same way everywhere; totals and subtotals align; negative numbers distinct. | Compare the same numbers across screens. | H | OWN, UC tabular-nums |
| DASH-08 | Status vocabulary for the product's core objects is defined once (dot colour + label) and reused on all surfaces. | Grep status strings and colour maps across apps. | H | UC copy.md terminology, IMP operate.md `product-color-state-vocab` |
| DASH-09 | Charts: area/line for time series, horizontal bars for categories, no pie/3D, no vertical grid lines, tooltips on hover/tap, accessible text summary. | Look at all charts. | M | UC dashboard.md, UC dataviz.md |
| DASH-10 | Use standard, familiar components; no invented affordances. Same button shape and control vocabulary on all screens. | Compare equivalent controls across surfaces. | M | IMP operate.md "The product slop test", `product-ban-inconsistent-components` |
| DASH-11 | Sidebar nav has icons + labels, `aria-current`, collapsible rail on tablet; breadcrumbs or titles show where you are. | Resize to 1024 and 768. | M | UC dashboard.md |
| DASH-12 | Time displayed as relative for recent and absolute after about a week; timezone Asia/Seoul unless stated. | Review timestamps in lists. | L | EMIL cheatsheet, UC copy.md |

---

## Where sources disagree

- C1. Eyebrows above headings: IMP bans them outright; UC allows at most 1 per 3 sections; ANT lists them as a tell. Recommendation: none in the app; at most one on the landing hero.
- C2. Font size count: THR says at most 3; UC says 4-6 steps; SF says 5-7; UC-scan flags crowded ladders. Recommendation: at most 3 per screen, a 5-6 step named scale product-wide.
- C3. Weight: THR says normal/medium only; UC/JAK say display not bold, at most 3 weights; UC dashboard.md still sets metric values at 700. Recommendation: follow THR (400/500 only), and let tabular-nums and size carry emphasis.
- C4. Cards: THR "fewer cards"; IMP "nested cards always wrong, cards are the lazy container"; UC "cards for peer items"; SHAD builds settings and dashboards out of Card. Recommendation: cards only for repeated peer items and one summary per screen.
- C5. Status badges: UC says dots not badges; core status values (such as order or payment status) are easier to read with a text label. Recommendation: dot + text, not a loud fill.
- C6. Dark sidebar: UC says avoid; IMP says second neutral layer is good. Both agree on tint, not black slab.
- C7. Fluid type: IMP says product UI uses fixed rem; UC allows `clamp()` for headings. Recommendation: fixed in app, fluid only for landing display.
- C8. Modals: IMP says modal is usually laziness; UC/JAK use modals for destructive confirmation. Recommendation: modal only for confirm/focused tasks; sheets on phone.
- C9. Contrast model: UC prefers APCA; JAK/ADDY/SF/IMP use WCAG 2 ratios. Recommendation: WCAG AA is the pass line; APCA only as a tie-breaker.
- C10. Disabled submit: UC prefers always-enabled with validation on press; others accept disabled with explanation. Recommendation: enabled + validate, except when an action is truly unavailable.
- C11. Touch target: 24px (WCAG 2.5.8 AA), 44px (Apple, AAA), 48dp (Material). Recommendation: 44.
- C12. Negative tracking: IMP allows -0.02 to -0.04em in Latin display; UC/IMP warn against tracking CJK. Recommendation: no negative tracking on Hangul.
- C13. Motion ceiling: EMIL under 300ms, UC at most 400ms, SF 150-250ms for UI. Recommendation: 150-250ms.
- C14. Korean copy voice: TOSS recommends 해요체 and `닫기`; legal and policy text (terms, notices) is often written in 합니다체. Recommendation: 해요체 in product UI; legal and policy text stays verbatim from its approved source (do not rewrite).

## Korean-specific notes not covered by English-first sources (OWN)

- `word-break: keep-all` plus `overflow-wrap: anywhere` on body/headings, so Hangul wraps at spaces not mid-word.
- Use a Hangul-capable UI font such as Pretendard (SIL OFL) or Noto Sans KR, subset, with weights 400/500 only; avoid fallback mixing of Latin and Hangul glyphs from different families.
- Hangul line-height about 1.6-1.7 and no negative tracking.
- `text-wrap: balance` works with `keep-all`; check on real Safari.
- Number/date/currency via `Intl` with `ko-KR`; won amounts use thousands separators; show 만/억 abbreviations only in dashboards and always with the full value on hover/detail.
- Landing page legal strings (통신판매업 신고, 사업자 정보, 개인정보처리방침) stay exactly as approved; do not rewrite.
- KakaoTalk in-app browser: test sign-in and submit flows, OG preview, back-button, and keyboard behaviour.

---

## Sources

| Source | URL | Stars (when compiled) | Licence | Good for | Optional scanner / tooling |
|---|---|---|---|---|---|
| UI Craft (Eduardo Calvo) | https://github.com/educlopez/ui-craft ; sites ui-craft.smoothui.dev, skills.smoothui.dev (not fetched; GitHub had all text) | 442 | MIT | Broadest anti-slop rule set (Critical/Major/Minor), dashboard/table/state/forms/copy references, 10-pass finish bar | Yes. `ui-craft-detect` (43 static rules, zero-dep Node; regex over JSX/CSS/HTML). Run: `npx ui-craft-detect <ui-src-dirs> --json`. Rules are English-copy-centred (Korean copy rules are not covered). |
| Impeccable (Paul Bakaus) | https://github.com/pbakaus/impeccable ; https://impeccable.style | 106,600 | Apache-2.0 | Strongest craft-floor ("Refuse" list), product-vs-brand distinction (Operate mode), 62-rule slop/quality detector, critique/audit/adapt/clarify/harden playbooks | Yes. `npx impeccable detect <ui-src-dir>` (pattern rules on JSX/CSS). For contrast, tiny-text, and layout rules, scan a running dev server: `npx impeccable detect http://localhost:<port>` (needs local Chrome/Edge). Use only `detect`; never `install` (writes hooks into agent config; telemetry noted in its README). It fetches an engine binary on first run: ask before running. |
| Anthropic frontend-design | https://github.com/anthropics/skills/tree/main/skills/frontend-design | 190,332 (repo) | Apache-2.0 (LICENSE.txt in the skill folder; repo shows no single licence) | The "AI cluster" calibration list and the UX-writing section; short | No tooling; prompt only. |
| Emil Kowalski skills (emil-design-eng, apple-design, animate, break-ui and more) | https://github.com/emilkowalski/skills | 55,216 | MIT | Motion and feel: easing, durations, press states, touch hover, springs, gesture handling; one-page `ui-cheatsheet.md` | No scanner. Read-only guidance; `break-ui/CATALOG.md` is a manual stress-test list. |
| Jakub Krehel skills ("better-interface" family) | https://github.com/jakubkrehel/skills | 11,842 | MIT | Best code-level detection tables: typography, layout, colours, accessibility (hit areas, focus, forms), writing; each ends with "Detection pattern -> Fix" grep patterns | No scanner binary, but the pattern tables can be turned into ripgrep checks. Review output format is a severity table. |
| Superfuture/design-review | https://github.com/Superfuture/design-review | 34 | MIT (stated in its `plugin.json`; the repo has no LICENSE file) | Compact 10-section rubric (hierarchy, type, spacing, colour, motion, states, a11y, responsive, copy, consistency); needs a browser to see the page | Claude Code skill using Playwright MCP screenshots; a CI variant exists (Superfuture/design-review-ci, not read). Can run against a local dev server. |
| Addy Osmani web-quality-skills (accessibility) | https://github.com/addyosmani/web-quality-skills | 3,061 | MIT | WCAG 2.2 checklist, contrast table, target size, manual test list, plus Lighthouse/Core Web Vitals skills | Uses Lighthouse and axe-core: `npx lighthouse http://localhost:<port> --only-categories=accessibility`, `npx @axe-core/cli http://localhost:<port>`. |
| shadcn skill | https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md | 127,702 (repo) | MIT | Component-composition rules (Empty, Skeleton, Alert, Field, Dialog titles, no raw colours); only relevant if the project uses shadcn | `npx shadcn@latest info` only if shadcn is installed; otherwise reference. |
| beautiful-shadows (MengTo) | https://github.com/MengTo/Skills/tree/main/agent-skills/web-design/beautiful-shadows | 7,333 (repo) | MIT | Three layered neutral shadow recipes; "avoid" list (no coloured glow, no stacking) | No tooling. Use only if the design wants shadows at all (most B2B screens should use a border instead). |
| interaction-design (wshobson) | https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/interaction-design | 42,350 (repo) | MIT | Read, not used: no item cites it. Generic microinteraction, loading, gesture, feedback patterns; weaker and more generic than EMIL | No tooling. Low priority. |
| Toss UX writing skill (Korean) | https://github.com/claudianus/toss-ux-writing-skill (also NariP/toss-ux-writing-skills, 1 star, MIT) | 2 | MIT | Only Korean-specific source: 해요체, active voice, positive framing, button and dialog patterns, error/empty/consent copy, review rubric. Unofficial, derived from the Toss developer UX writing guide. | Includes `scripts/toss_style_lint.py` (heuristic Python linter, local). Read it before running; run as `python3 -I scripts/toss_style_lint.py <file>` on exported UI strings. |
| Threads series "AI 디자인 느낌 빼는 법" | Relayed by the user | n/a | n/a | Text reduction rules, weights, size count, empty/loading rules | n/a |
| Uxwoodytips Instagram | Relayed by the user | n/a | n/a | "Name the UI pattern" prompting (see use note below) | n/a |

Use note for the uxwoodytips idea: when asking an agent to fix a screen, name the pattern ("empty state with one CTA", "bottom sheet", "sticky bottom action bar", "skeleton", "segmented control", "master-detail", "inline validation", "command palette") instead of "make it prettier". The checklist item names above can be reused as those pattern names.

Not read in depth (found but skimmed or skipped): nextlevelbuilder/ui-ux-pro-max-skill (147,207 stars, MIT; large rule/data bundle, not audited), content-designer/ux-writing-skill (259 stars, MIT; English UX writing), dickwu/apple-design-skill (3,027 stars; HIG reviewer for native frameworks, not for Capacitor web UI), educlopez/ui-craft `references/heuristics.md`, `coverage.md`, `motion.md` (partially read via grep only).

## Sources and licenses

The rules here are shortened and rewritten in our own words; no source file is included.

| Source | Copyright holder | License | URL |
|---|---|---|---|
| UI Craft | (c) 2026 Eduardo Calvo | MIT | https://github.com/educlopez/ui-craft |
| Impeccable | (c) 2025 Paul Bakaus | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | https://github.com/pbakaus/impeccable |
| Anthropic frontend-design skill | Anthropic | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | https://github.com/anthropics/skills/tree/main/skills/frontend-design |
| Emil Kowalski skills | Emil Kowalski | MIT | https://github.com/emilkowalski/skills |
| Jakub Krehel skills | Jakub Krehel | MIT | https://github.com/jakubkrehel/skills |
| Superfuture design-review | Joey Primiani (author) | MIT, as stated in its `plugin.json` (the repo has no LICENSE file) | https://github.com/Superfuture/design-review |
| web-quality-skills | Addy Osmani | MIT | https://github.com/addyosmani/web-quality-skills |
| shadcn skill | (c) 2023 shadcn | MIT | https://github.com/shadcn-ui/ui/tree/main/skills/shadcn |
| beautiful-shadows | Meng To | MIT | https://github.com/MengTo/Skills/tree/main/agent-skills/web-design/beautiful-shadows |
| toss-ux-writing-skill | claudianus | MIT | https://github.com/claudianus/toss-ux-writing-skill |

- The MIT permission notice and the Apache-2.0 attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- toss-ux-writing-skill is an unofficial summary of Toss's UX writing guide. It is not published by Toss, and this checklist is not affiliated with Toss.
- WSH (wshobson/agents) was read, but no item uses it, so it is not credited above. No item uses the other skills under "Not read in depth" (apart from the UI Craft files) either.
- THR and the uxwoodytips note are tips passed on by the user, not published rule files; no text from them is copied.

