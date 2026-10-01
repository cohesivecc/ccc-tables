# Changelog

Consumers pin by tag (`gh/cohesivecc/ccc-tables@X.Y.Z`). Every release is
backward compatible with published `Data` / `Config` blobs unless it says
otherwise. Entries before 0.6.2 are backfilled from the tag annotations — see
`git show vX.Y.Z` for detail.

## 0.7.0 — 2026-10-01

- **`config.firstColLabels: false` (new)** renders first-column body cells as
  plain cells instead of bold row-label headers — for grids that don't need
  row headings. Absent/true keeps today's behavior. Sticky first column, the
  width cap and the phone switcher are unchanged (they key off the column
  position, not the label treatment).
- **Builder rebuilt** as a step-based page (Start → Edit → Publish): inspector
  instead of the button toolbar, side-by-side desktop (824px) / phone (375px)
  previews on the pinned renderer, keyboard-first grid, renderer-version
  gating with reasons, publish list of only the changed fields. Footnotes are
  preview-only (authored in the CMS Rich Text field). Same URL; drafts moved
  to a new storage key. Renderer payloads are unaffected.

## 0.6.2 — 2026-09-29

- **Natural height by default.** `.ccc-table_scroll` no longer caps the table
  at `max-height: 70vh` with an internal vertical scroll; tables render at
  full height (horizontal scroll for wide tables is unchanged). Sites carrying
  the head override `.ccc-table_scroll{max-height:none;overflow-y:visible}` can
  delete it after bumping the pin.
- **`config.maxHeight` (new, opt-in)** restores an internal vertical scroll per
  table — the region a sticky header pins inside on a very long table:
  `true` (= the old 70vh), a bare number (`60` = 60vh), or a length
  (`"40rem"`). Screen only: on paper the table is never clipped. Exposed as
  `cccTables.maxHeightCss()`; the builder carries an imported value through
  the Config round trip.
- **The mobile plan switcher is screen-only** — `@media screen and
  (max-width: 767px)`. A ~720px print sheet used to match the phone query and
  print one plan column plus the chip toolbar; paper now gets the full table.
- **A centred or right-aligned first column works under the first-column
  cap.** The capped `.ccc-table_rh` box (`width: fit-content`) sat at the start
  of its cell, so `config.align: ["center", …]` didn't move it. It now gets
  `margin-inline: auto` (center) / `margin-inline-start: auto` (right); the
  stacked mobile layout resets it to left. The `"firstColMax": false`
  workaround is no longer needed.

## 0.6.1 — 2026-09-12

- Column headers (`columns` and `headerRows`) and mobile-switcher chips now run
  through `fmt()`, so cell tokens render there instead of as literal text.

## 0.6.0 — 2026-09-11

- `config.align` (per-column text alignment), `config.colDividers` (vertical
  rule on a column's left edge), the `[nbsp]` token, and a colspan-aware
  `highlightCol`.

## 0.5.0

- Symbol footnote markers (`^*` `^†` …), the `[reg:]` token, the first-column
  width cap (`config.firstColMax`, default 50%), and a footnote padding fix.

## 0.4.1

- A footnotes block that is a lone `<ul>` sits flush (margins only toward siblings).

## 0.4.0

- Span-aware mobile switcher; zero-specificity `:where()` skin plus themable
  color custom properties.

## 0.3.0

- Group rows may keep cells beyond their label; builder fixes.

## 0.2.2

- Footnotes render as an attached full-width footer row.

## 0.2.1

- An empty split-field Config carrier is ignored.

## 0.2.0

- First jsDelivr-packaged release.
