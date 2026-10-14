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
- Scrollable content, `max-w-3xl`, centered, no horizontal scroll.
- Sections stack with `16px` gap; each section is one surface.

## Row primitive

- One soft surface per section: `rounded-[10px] border border-card-border bg-card`.
- Rows: `title + muted description` left, right-aligned control; hairline
  `border-b` between rows; last row borderless.
- Long controls (base URL, textareas) render full-width under the row.
- Destructive rows live at the bottom of their section with consequence copy.

## Advanced gating

Rarely-used knobs go inside a Base UI `Collapsible` labelled "Advanced".
Closed by default; discovery stays one click away.

## Motion

- Durations: `120ms` (micro), `160ms` (surface/collapse), `200ms` (dialog).
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Respect `prefers-reduced-motion`: collapse/transition to `0ms`, no transforms.

## Focus

- All interactive elements: `focus-visible:ring-2 ring-accent ring-offset-1
  ring-offset-background`, never removed.
- Dialogs trap focus (Base UI Dialog) and restore it on close.
