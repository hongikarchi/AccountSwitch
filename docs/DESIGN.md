# AccountSwitch design (0.3)

Goal: a finished-looking black-and-white interface with a clear type hierarchy. Color appears only where it carries meaning: the provider identity (Claude, ChatGPT) and errors. The current UI reads as rough and generic; the fix is typography, spacing, and restraint, not decoration.

## 1. References

Linked, not copied (public repo). What to take from each:

| Reference | Take | Leave |
|---|---|---|
| [Toggle "Future⁰¹ Now⁰²"](https://i.pinimg.com/1200x/92/d8/ed/92d8ed58d67950900269c884a19cf69e.jpg) | Theme toggle shape: a pill track, one half filled black, a light knob carrying the active label, superscript index numbers, large grotesk labels | The poster layout around it |
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
3. Numbers are the content: large, tabular, aligned right.
4. One primary action per area, in solid black (white in dark mode).
5. Everything aligns to a 4 px grid and one left edge per column.

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
| Display | 32 / 36 | 600 | -0.03em | Wizard step title on its first screen, empty states |
| H1 | 24 / 30 | 600 | -0.02em | Provider name (Claude, ChatGPT), tab page title |
| H2 | 17 / 24 | 600 | -0.01em | Step title, section title |
| Number | 22 / 26 | 500 | -0.02em | Usage percent |
| Body | 14 / 20 | 400 | 0 | Rows, descriptions |
| Small | 12 / 16 | 400 | 0 | Meta: e-mail, plan, reset time, versions |
| Label | 11 / 14 | 500 | 0.04em, uppercase for Latin | Column labels, step index |

Superscript indices (`⁰¹`, `⁰²`) at 0.45 em, top-aligned, used in the theme toggle and the stepper counter.

## 5. Components

### 5.1 Header

Left: logo mark (24 px black tile) + wordmark "AccountSwitch" (H2). Center-left: tabs 계정 · 설치 as text with a 2 px underline on the active tab (설치 hidden on macOS). Right: **Claude Code 열기** (primary, Windows only), theme toggle. Header height 56 px, hairline below.

Below 600 px the wordmark is hidden from view and stays in the page as the heading, so the logo tile keeps its accessible name "AccountSwitch". With the wordmark the row needs 598 px; without it the row of logo, tabs, button and toggle fits a 480 px window, the shell's minimum, in full and on one line. It never wraps, and nothing shrinks.

The row has no room for a sentence. The launcher's disabled help and its failures sit on a line of their own directly under the hairline, so the header stays 56 px: Small, right-aligned, help in `--muted`, a failure in `--danger` with a 닫기 text button. A failure of the browser's path field shows inside the field's popover instead, which would otherwise cover that line.

### 5.2 Theme toggle

A pill 120 × 36 px. The track is `--inverse-bg`; a knob `--bg` 58 × 30 px slides between halves. Labels "Light⁰¹" and "Dark⁰²" (14 px, 500): the active label sits in the knob in `--text`, the other on the track in `--inverse-text` at 70 %. Knob moves with `transform` 260 ms `cubic-bezier(.2,.8,.2,1)`; the page colors cross-fade 200 ms. `role="switch"`, `aria-checked`, Korean `aria-label="화면 테마"`. With `prefers-reduced-motion`, no slide.

### 5.3 Account section (계정 tab)

- Two columns (Claude | ChatGPT) when the window is wider than 760 px, else stacked.
- Section head: provider mark dot (8 px, provider color) + name (H1) + count of accounts (Small, muted).
- Rows separated by hairlines, no row boxes. Row: name (Body 500) with 사용 중 as a small provider-colored text marker, meta line (Small, muted: e-mail · plan · login end), right side actions (사용 or 로그인 as secondary button, ⋯ menu).
- Usage under the row: label column (5시간, 7일, model limits; Label) · thin 4 px bar (track `--line`, fill provider color, red at limit) · percent (Number) · reset time (Small, muted). Fixed column widths so bars align across rows.
- Drag to reorder keeps today's behavior; the dragged row lifts with the menu shadow.

### 5.4 Buttons

- Primary: `--inverse-bg` fill, `--inverse-text`, 36 px high, 6 px radius.
- Secondary: transparent, 1 px `--line`, text `--text`; hover `--panel`.
- Text button: no border, `--muted`, hover `--text`.
- Disabled: 40 % opacity.

### 5.5 Menus and popovers

`--bg`, 1 px `--line`, 10 px radius, the one allowed shadow. Items 32 px high, hover `--panel`. Destructive item text in `--danger`.

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
- Optional groups appear as one collapsed row with a checkbox and a count ("6개 중 3개 설치됨") until ticked, even when partly installed, because opening one would check its missing items.
- Each group is its own list, so connectors break between groups.
- Summary bar at the bottom, sticking to the window's bottom edge: "8개 중 5개 완료" and the primary 시작 / 계속 button. A confirmation (Blender warning, MCP 다시 등록) is one inline panel above the bar, not a modal.
- 처음으로 is a text button at the right of the checklist title, back to the first screen.

The first screen of the wizard: Display title "이 PC를 준비할게요", two large choice rows (이미 세팅했어요 — 점검만 / 자동으로 설정해 주세요), each with one line of explanation.

### 5.7 Empty and error states

After the chart-card reference: a small outlined illustration tile, one bold line, one muted line, one secondary button. No color.

## 6. Motion

150–260 ms, ease-out, opacity and transform only. Tab change: content fades 150 ms. Step done: check draws in 200 ms, connector fills top to bottom 200 ms. No bouncing, no looping animation except the running ring.

## 7. Layout

Window minimum 480 × 560 (shell). Content max width 1040 px, side padding 24 px (16 px under 560 px). Vertical rhythm 8 / 16 / 24 / 40.

## 8. Logo and icons

**Chosen (user, 2026-11-06): concept 1** in `assets/brand/concepts/concept-1.png` (git-ignored): a black rounded-square tile holding a white horizontal pill track with a black circular knob on the right. Use it everywhere:

- App icon and macOS icon: the tile as is.
- Header: the tile at 24 px followed by the wordmark "AccountSwitch" set in Pretendard (H2), not a generated wordmark.
- Tray: the tile at 16–32 px. Light taskbar: black tile. Dark taskbar: inverted (white tile, black track, white knob).
- Redraw on a 24 px grid; the generated image has jagged edges and is a reference only.

Concept: the theme toggle is the brand. The mark is a pill switch — a white rounded track with a black knob on the right, on the black tile — reading as "switch" at any size and matching the toggle in the header. Two variants: knob left and knob right are the same mark mirrored, used for an optional hover animation.

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
