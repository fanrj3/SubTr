# SubTr Design Contract

Persistent design contract for SubTr UI. Follow it for every new surface.
Tokens live in `src/app/globals.css` (CSS variables) and are surfaced to
Tailwind v4 via `--color-*`.

## Type scale

| Role | Size / line | Usage |
|---|---|---|
| Display | 20px / 1.2, 600 | Empty-state headline |
| Title | 16px / 1.3, 600 | Pane header |
| Heading | 14px / 1.35, 600 | Section title |
| Row title | 13px / 1.4, 500 | Setting row title |
| Body | 13px / 1.5, 400 | Description copy |
| Small | 12px / 1.45, 400 | Hints, secondary labels |
| Micro | 11px / 1.4, 500 | Nav group titles, status chips |

Font stack: `Geist` / system UI (see `layout.tsx`).

## Spacing scale

`2, 4, 6, 8, 12, 16, 20, 24, 32` px. Pane padding `16` (mobile) / `24`
(desktop). Row vertical padding `10–12`, horizontal `14`. Section gap `16`.

## Radii

| Token | Value | Usage |
|---|---|---|
| sm | 8px | Rows' inner controls |
| md | 10px | Surfaces, rail item, dialogs |
| lg | 14px | Large media (plugin iframe) |
| pill | 999px | Chips, switches, sliders |

## Color roles

- `--background` / `--foreground`: page base.
- `--card`: soft settings surface (slightly raised vs page in light, inset in dark).
- `--card-border`: hairline dividers and surface borders.
- `--muted`: secondary text.
- `--accent` / `--accent-dim`: primary action, active nav item, slider fill.
- `--danger` / `--danger-soft`: destructive actions only, always at a section's bottom.
- `--success` / `--success-soft`: plugin status "ok".

Never decorate with gradients/glow. Plugin iframes stay `sandbox="allow-scripts"`.

## Navigation rail

- Vertical Base UI Tabs, width `208px` expanded, `48px` icon-only below a
  `700px` viewport (tooltips = native `title` + `aria-label`).
- Items: icon + label, `10px` radius, `28px` height, active = `accent-dim`
  background + accent icon/text.
- Group titles: `11px` uppercase `muted`, `16px` top margin.
- Rail footer: app name + version, separated by a hairline.
- Active section persists in `localStorage` (`subtr.settings.section.v1`).

## Pane

- Sticky pane header (`Title`) with a gradient fade below it (no hard border).
- Scrollable content, centered, no horizontal scroll.
- Sections stack with `16px` gap; each section is one surface.

## Scroll isolation (settings)

- `/settings` is a viewport-height, `overflow-hidden` shell — the document
  itself never scrolls (`h-[100dvh]`).
- The pane (`main`) is the only normal scroll region; the sticky pane header
  lives inside it.
- The nav rail scrolls independently when it overflows; both scroll regions use
  `overscroll-contain` so wheel/trackpad gestures never chain between them.
- Holds at 400px, 714px, and 1440px.

## Position player breakpoints (container queries)

- `<560px`: fully stacked — board, presets (2-col), preview text, play + scrubber,
  metrics.
- `≥560px`: board left with the 2×3 preset grid adjacent (`w-56`); preview text,
  play + scrubber, and metrics stay **full-width rows under the board**.
- `≥720px`: same layout with a wider preset column (`w-64`).
- No permanent narrow rail; the board keeps its aspect block and no control
  collides at 400/714/838/1440.

## Row primitive

- One soft surface per section: `rounded-[10px] border border-card-border bg-card`.
- Rows: `title + muted description` left, right-aligned control; hairline
  `border-b` between rows; last row borderless.
- Below a **420px container width** a row stacks: title/description get a full
  line, the control moves below (never crushes the title).
- Long controls (base URL, textareas) render full-width under the row.
- Destructive rows live at the bottom of their section with consequence copy.

## Advanced gating

Rarely-used knobs go inside a Base UI `Collapsible` labelled "Advanced".
Closed by default; discovery stays one click away.

## Overflow

- Settings surfaces and rows never scroll horizontally: scroll regions set
  `overflow-x-hidden`, row controls shrink/wrap, and the rail/pane use
  `scrollbar-gutter: stable` so widths don't shift.
- Only the pane and the rail scroll vertically, independently.

## Motion

- Durations: `120ms` (micro), `140ms` (navigation fade), `160ms`
  (surface/collapse), `200ms` (dialog).
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Client navigation fades the **content area only** (`PageFade`, opacity
  0.6 → 1). Headers/top bars never animate, translate, or scale.
- Respect `prefers-reduced-motion`: collapse/transition to `0ms`, no transforms,
  no navigation fade.

## Voice captions (two zones)

- One persistent card while voice is on, anchored by its **bottom edge** (fixed
  ±2 px as content grows).
- **Top zone:** live English transcript for the current sentence — centered,
  muted, fixed 2-line height with `items-end` so it grows upward and clips at
  the top; **append-only** within an utterance (regressive payloads ignored).
- **Bottom zone:** the translation. Finalized sentences are fixed lines (older
  scroll out upward); the current sentence shows a subdued *tentative*
  translation in place.
- Translation boundaries: translate on `close` (final, frozen), and at most one
  tentative per ~2 s **and** only after ≥20 new source chars. Tentative results
  replace in place (no fade/scroll/height animation); pending keeps the previous
  text visible. Per-line sequence guard drops stale results.
- Scrolling happens only on discrete line appends (`smooth`; `auto` under
  `prefers-reduced-motion`). No transitions on text updates themselves.
- **Never dismiss** between utterances. Only `stop: true` (or leaving) fades out
  (≤300 ms) and clears, keeping the voice flag through teardown (single mount);
  Esc/✕ fade locally and reopen on the next payload. Pin is a no-op in voice.
- Non-voice payloads keep the existing show → teleprompter/hold → auto-hide flow.

## Plugin text (`overlay.subtitle`)

- Plugin text renders **verbatim** in the shared subtitle card: no translation,
  no translate-mode gate, no fallback string. `tone: "normal"` = normal subtitle
  color, `tone: "muted"` = the dimmed transcript styling.
- `stickyMs` (optional) auto-dismisses after that long (fade, ≤200 ms); without
  it the text stays until replaced or `clear()`.
- `clear()` fades cleanly with the same single-mount hard-cut rules as voice
  (no re-created card, no "No translation returned").
- Newest wins: a plugin show resets an active voice session, and a voice payload
  or a normal capture replaces plugin text. Non-voice selection/test flows are
  unchanged.

## Pace slider mapping

- `textScale` is a **speed factor**: scroll/display durations are
  `base / textScale`, so `5.00×` scrolls 5× faster and `0.20×` is 5× slower.
- The reading-pace slider is log-symmetric: position maps
  `scale = exp(ln 0.2 + p·(ln 5 − ln 0.2))`, so `1.00×` is exactly centered,
  `0.20×` far left, `5.00×` far right, with ticks at 0.2/0.5/1/2/5.
- Scroll-speed readout is `3 × textScale` px/s, shown with one decimal.

## Focus

- All interactive elements: `focus-visible:ring-2 ring-accent ring-offset-1
  ring-offset-background`, never removed.
- Dialogs trap focus (Base UI Dialog) and restore it on close.
