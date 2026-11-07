# AccountSwitch design (0.3)

Goal: a finished-looking black-and-white interface with a clear type hierarchy. Color appears only where it carries meaning: the provider identity (Claude, ChatGPT) and errors. The current UI reads as rough and generic; the fix is typography, spacing, and restraint, not decoration.

## 1. References

Linked, not copied (public repo). What to take from each:

| Reference | Take | Leave |
|---|---|---|
| [Toggle "Future⁰¹ Now⁰²"](https://i.pinimg.com/1200x/92/d8/ed/92d8ed58d67950900269c884a19cf69e.jpg) | Theme toggle shape: a pill track, one half filled black, a light knob carrying the active label | The poster layout around it, the index numbers, the large labels |
| [Chart card states](https://i.pinimg.com/1200x/b8/3e/db/b83edbf399c1e945d201bac072035895.jpg) | Hairline cards on near-white, small grey title over a big number, segmented control, designed empty and error states with a single Retry | Blue line color |
| [Line chart, Apple style](https://i.pinimg.com/1200x/66/fd/e1/66fde1530b712f66dbf13bb76dce9206.jpg) | One dark line, grey for the projected part, labels on thin leader lines, no gridlines | – |
| [Store Performance Overview](https://i.pinimg.com/1200x/8a/23/e5/8a23e52d956bbf5235d45b21c42ddee4.jpg) | Type scale: very large tight headline, small labels, big numbers with older values in grey, square monochrome icon tiles, light grey panels without borders | – |
| [Invoice](https://i.pinimg.com/736x/e7/a4/de/e7a4de6b454e80380ef1ee6b443bee9c.jpg) | Black and white with one accent color used only for the key value; table rules instead of boxes; uppercase small labels | Heavy display font |
| [Management overview](https://i.pinimg.com/1200x/99/76/dc/9976dce1cf96a85d3f5352633c333cf8.jpg) | Thin weights for large headings, quiet grey surfaces, list rows with a chevron | Glass blur, colored dots everywhere |
| [Dashboard with operator panel](https://i.pinimg.com/1200x/69/a0/24/69a0241335efeaeebcb8ae9acd67371c.jpg) | Black logo tile, header with small icon buttons, stat cards with a footer link row, list rows with icon tile + two lines + right-aligned meta | – |
| [Vertical stepper](https://i.pinimg.com/736x/f1/73/fb/f173fb802075068d692f15ad585588e4.jpg) | Setup wizard layout (§5.6) | Blue; ours is black |

Avoid (the "AI-made" look): gradients, glass blur, glow, colored shadows, emoji, an icon on every line, every surface a rounded card, pastel badges for everything, centered marketing copy.

## 2. Principles

1. Hierarchy by type size and weight first, then grey value, then space. Borders last.
2. Black, white, and greys. Provider color only on the provider mark, its usage bar fill, and its 사용 중 marker. Red only for errors and limits.
3. Numbers are the content: clear, tabular, aligned right. They never outgrow the section title; the bar beside them already carries the weight.
4. One primary action per area, in solid black (white in dark mode).
5. Everything aligns to a 4 px grid and one left edge per column.
6. Room first (user, 2026-11-06: the first build felt cramped and its big type too big). When a screen feels full, remove or fold something before shrinking anything. A one-off action stays folded until asked for. Each account is one outlined box (5.3), the one thing on a page that is a box; elsewhere a hairline only separates two things and never closes a list.

## 3. Tokens

```css
:root {                 /* light */
  --bg: #ffffff;
  --panel: #f6f6f6;      /* light grey panel, no border */
  --line: #e5e5e5;       /* hairline */
  --line-strong: #111111;
  --text: #111111;
  --muted: #6e6e6e;      /* secondary text */
  --faint: #a8a8a8;      /* tertiary, disabled, old values */
  --inverse-bg: #111111;
  --inverse-text: #ffffff;
  --danger: #d4351c;
  --claude: #d97757;
  --chatgpt: #10a37f;
}
[data-theme='dark'] {
  --bg: #0c0c0c;
  --panel: #161616;
  --line: #262626;
  --line-strong: #f2f2f2;
  --text: #f2f2f2;
  --muted: #9b9b9b;
  --faint: #5c5c5c;
  --inverse-bg: #f2f2f2;
  --inverse-text: #0c0c0c;
  --danger: #ff6a55;
  --claude: #e08a6d;
  --chatgpt: #2fbf98;
}
```

Radii: 6 px controls, 10 px panels, 999 px pills. Shadows: none, except menus and the folder popover (`0 8px 24px rgb(0 0 0 / 0.12)`).

## 4. Type

Font: Pretendard (Korean and Latin, OFL), bundled as `woff2` in the build because the CSP blocks remote fonts. Fallback `'Malgun Gothic', system-ui, sans-serif`. Numbers use `font-variant-numeric: tabular-nums`.

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | 24 / 32 | 600 | -0.02em | Wizard step title on its first screen, empty states |
| H1 | 18 / 26 | 600 | -0.01em | Provider name (Claude, ChatGPT), tab page title |
| H2 | 15 / 22 | 600 | 0 | Step title, section title |
| Number | 15 / 20 | 500 | 0 | Usage percent |
| Body | 14 / 22 | 400 | 0 | Rows, descriptions |
| Small | 12 / 18 | 400 | 0 | Meta: e-mail, plan, reset time, versions |
| Label | 12 / 16 | 500 | 0, uppercase for Latin | Column labels, step index |

A superscript count at 0.75 em, top-aligned, in the stepper group label only. It says how many items the group has. The theme toggle has no numbers: there they meant nothing (user, 2026-11-06).

## 5. Components

### 5.1 Header

Two things only. Left: tabs 계정 · 설치 as text with a 2 px underline on the active tab (설치 hidden on macOS). Right: the theme toggle (5.2). Header height 64 px, hairline below. The launch buttons sit with 새로고침 (5.3).

The window's title bar right above already carries the icon and the name "AccountSwitch", so the page has no logo (user, 2026-11-07). The name stays in the page as a heading hidden from view.

### 5.2 Theme toggle

At the right end of the header, on both tabs. A pill 96 × 28 px. The track is `--inverse-bg`; a knob `--bg` 46 × 24 px slides between halves. Labels "Light" and "Dark" (12 px, 500): the active label sits in the knob in `--text`, the other on the track in `--inverse-text` at 70 %. Knob moves with `transform` 260 ms `cubic-bezier(.2,.8,.2,1)`; the page colors cross-fade 200 ms. `role="switch"`, `aria-checked`, Korean `aria-label="화면 테마"`. With `prefers-reduced-motion`, no slide.

### 5.3 Account section (계정 tab)

- Two columns (Claude | ChatGPT), 32 px apart, when the window is wider than 880 px, else stacked 48 px apart. The shell opens at 760 px, so stacked is the usual view.
- Section head: provider mark dot (8 px, provider color) + name (H1) + count of accounts (Small, muted).
- Each account is one box: 1 px `--line`, 10 px radius, 20 px padding, 12 px between boxes. The user missed the per-account boxes of 0.2 once they were gone (2026-11-06). Row: name (Body 500) with 사용 중 as a small provider-colored text marker, meta line (Small, muted: e-mail · plan · login end), right side actions (사용 or 로그인 as secondary button, ⋯ menu).
- Usage under the row, 12 px below it, its lines 6 px apart: inside a box, things sit a little closer than the space around it (user, 2026-11-07). Label column (5시간, 7일, model limits; Label) · thin 4 px bar (track `--line`, fill provider color, red at limit) · percent (Number) · reset time (Small, muted). Fixed column widths so bars align across rows.
- Adding an account is folded into one text button "+ 계정 추가" under the list. Pressing it opens the name field with 추가 and 취소; it closes again once the account is added.
- The window a line stands for is named by what the service reports: "5시간", "7일". A service that does not report a shorter window has no line for it, so a line never stands empty and "짧은 한도" is gone (user, 2026-11-07).
- The bottom row of the tab: 자동 전환 on the left; **Claude 열기** and **GPT 열기** (both primary: they are peers, Windows only) then 새로고침 on the right. Pressing a launch button goes straight to the folder dialog, with no menu. Their disabled help and their failures sit on a line of their own under the buttons: Small, right-aligned, help in `--muted`, a failure in `--danger` with a 닫기 text button. A failure of the browser's path field shows inside the field's popover instead.
- The bottom row is one family (user, 2026-11-07): Claude 열기, GPT 열기 and 새로고침 have exactly the theme toggle's size and shape, a 96 × 28 px pill with 12 px 500 text. Fills stay as in 5.4: the launch buttons primary, 새로고침 secondary. 자동 전환 uses the same 12 px 500 text and its threshold select the same 28 px pill. Buttons elsewhere keep 5.4 for now.
- Under the buttons, right-aligned: the time of the last check, so that turning on 자동 전환 pushes nothing (user, 2026-11-07). Notes about auto switch and failures take the same line from the left.
- Drag to reorder keeps today's behavior; the dragged row lifts with the menu shadow.

### 5.4 Buttons

- Primary: `--inverse-bg` fill, `--inverse-text`, 36 px high, 6 px radius.
- Secondary: transparent, 1 px `--line`, text `--text`; hover `--panel`.
- Text button: no border, `--muted`, hover `--text`.
- Disabled: 40 % opacity.

### 5.5 Menus and popovers

`--bg`, 1 px `--line`, 10 px radius, the one allowed shadow. Items 36 px high, hover `--panel`. Destructive item text in `--danger`.

### 5.6 Setup stepper (설치 tab)

Vertical, after the reference stepper, in black and white:

- Node 24 px circle on the left, connector 1 px between nodes.
- Done: filled `--text` circle with a check in `--bg`; connector below it `--text`.
- Running: 2 px `--faint` ring with a slowly rotating `--text` arc, because an arc does not show on a `--text` ring; a static full `--text` ring with `prefers-reduced-motion`; text column fully opaque.
- Pending: 1.5 px `--faint` ring; connector `--line`; text in `--muted`.
- Failed: 2 px `--danger` ring with `!`; message in `--danger`; actions 다시 시도 (secondary), 건너뛰기 (text), 로그 보기 (text).
- Needs user (e.g. Rhino missing): `--text` ring with an arrow; one link-style action.
- 버전 다름: `--text` ring with `≠`. Unknown (no answer from a check): `--faint` ring with `?`. Skipped: `--faint` ring with `–`.
- Each step: meta line (Small, muted: found version or time), title (H2), one-line description (Body, muted), group label above the first step of a group (Label).
- Optional groups appear as one collapsed row with a checkbox and a count ("6개 중 3개 설치됨") until ticked, even when partly installed, because opening one would check its missing items. The program screen below uses the same row.
- Each group is its own list, so connectors break between groups. 32 px between steps, 40 px between groups.
- Summary bar at the bottom, sticking to the window's bottom edge: "8개 중 5개 완료" and the primary 시작 / 계속 button. A confirmation (Blender warning, MCP 다시 등록) is one inline panel above the bar, not a modal.
- 처음으로 is a text button at the right of the checklist title, back to the first screen.

The first screen of the wizard: Display title "이 PC를 준비할게요", two large choice rows (이미 세팅했어요 — 점검만 / 자동으로 설정해 주세요), each with one line of explanation.

The program screen, after 자동으로 설정해 주세요: title "어떤 프로그램을 쓰세요?" with 처음으로 at its right, rows to tick for Rhino, Blender and CAD (disabled, "준비 중"), then the Python groups under the same "필요하면 더 고르세요" label as the checklist. The summary bar says what pressing 다음 will do, in plain words, with 항목 직접 고르기 (text) and 다음 (primary).

### 5.7 Empty and error states

After the chart-card reference: a small outlined illustration tile, one bold line, one muted line, one secondary button. No color.

## 6. Motion

150–260 ms, ease-out, opacity and transform only. Tab change: content fades 150 ms. Step done: check draws in 200 ms, connector fills top to bottom 200 ms. No bouncing, no looping animation except the running ring.

## 7. Layout

Window minimum 480 × 560 (shell). Content max width 1040 px, side padding 32 px (20 px under 560 px). Page top 40 px. Vertical rhythm 8 / 16 / 24 / 40 / 64.

## 8. Logo and icons

**Chosen (user, 2026-11-06): concept 1** in `assets/brand/concepts/concept-1.png` (git-ignored): a black rounded-square tile holding a white horizontal pill track with a black circular knob on the right. Use it everywhere:

- App icon and macOS icon: the tile as is.
- Inside the page: nowhere. The title bar carries it (5.1).
- Tray: the tile at 16–32 px. Light taskbar: black tile. Dark taskbar: inverted (white tile, black track, white knob).
- Redraw on a 24 px grid; the generated image has jagged edges and is a reference only.

Concept: the theme toggle is the brand. The mark is a pill switch — a white rounded track with a black knob on the right, on the black tile — reading as "switch" at any size and matching the theme toggle. Two variants: knob left and knob right are the same mark mirrored, used for an optional hover animation.

Geometry on the 24 px grid (`assets/brand/logo.svg`): tile 0,0,24,24 rx 5; track x=3 y=8 w=18 h=8 rx=4; knob cx=17 cy=12 r=3, concentric with the track's right cap. The track stays centered and the knob concentric at every size. Small sizes are placed on whole pixels by hand, in pixels of that size (the rest scale from the grid and round):

| Size | Tile rx | Track x, y, w, h | Knob cx, cy, r |
|---|---|---|---|
| 16 | 3 | 2, 5, 12, 6 | 11, 8, 2 |
| 20 | 4 | 2, 6, 16, 8 | 14, 10, 3 |
| 32 | 7 | 4, 10, 24, 12 | 22, 16, 4 |

The macOS icon sits on Apple's icon grid: the tile takes 824 of 1024 px, on a clear background. The menu bar template is the same mark in alpha only, with the track as a hole.

Process:

1. Explore the concept with GPT image generation through Codex (`codex exec`, built-in `image_gen`). This uses the user's ChatGPT subscription; ask the user before each run. Use the result only to choose direction.
2. Redraw the chosen mark by hand as SVG on a 24 px grid. A generated raster is not usable at 16 px.
3. Export with `npm run build:icons`: app icon (black tile, white track, black knob), ICO sizes 16–256 with hand-checked 16 and 24 px, tray icons with a black tile (light taskbar) and inverted, white tile, black track, white knob (dark taskbar), macOS icon and menu bar template. File list in SPEC §6.

Prompt draft for step 1 (English, no brand names):

> Minimal monochrome app icon for a desktop utility that switches between accounts. A single rounded pill-shaped toggle switch, black track, off-white circular knob, flat vector, no gradient, no shadow, no text, centered on a white square, Swiss modernist style, high contrast, works at 16 pixels.
