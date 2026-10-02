# Builder "next" — step-based redesign (2026-09-30, Alex-approved direction)

Record of the redesign built on branch `explore/ui-refresh` at `builder/next/`,
next to the live `builder/` (untouched until Alex decides to swap). Direction
chosen from two clickable mockups (throwaway, never committed; deleted after the
decision): **B — steps + inspector**.

## Why

The live builder grew by accretion: a 20-button toolbar, the same field in up
to three places, version caveats in tooltips, pointer-only selection, and the
preview a screen below the editor. See the 2026-09-30 interface review.

## Decisions (Alex, 2026-09-30)

- **Three steps.** Start (paste a range, or the item's CMS fields) → Edit →
  Publish (only the fields to paste, each Changed / No change / Clear).
- **Publish = guided paste** for now. Direct CMS writes need a Webflow OAuth
  app or a small server piece (a static public page can't hold a token) —
  the parked v2; the step keeps its name so only the button's action changes.
- **Side-by-side previews**: desktop at **824px** (the live sites' article
  column: `minmax(0, 57.5rem)` minus 3rem padding each side) and phone at
  375px, both the site's pinned jsDelivr renderer; scaled down only when the
  window is too narrow, stacked below ~700px.
- **"Caption" is labelled "Table title"** (the client CMS fields are being
  renamed to match).
- **Footnotes are preview-only.** Authored in the CMS Rich Text field; never
  emitted (the old round trip dropped inline formatting). Exception: a legacy
  one-chunk Data blob with inline footnotes gets a "Copy footnotes" note on
  Publish so they aren't lost when Data is re-emitted.
- **One feature table** (`logic.js` `FEATURES`) drives disabled controls
  ("Needs renderer 0.6.0 or later — this site uses 0.5.0") and preview notes.

## Architecture

- Data logic unchanged: `builder/model.js`, `builder/serialize.js` (plus a
  new `rowWidthIssues()` export that `validate()` now uses).
- `builder/next/logic.js` — pure: FEATURES/supports/compatNotes, the publish
  plan (`publishValues`, `publishPlan`, `toPasteCount`), footnote-marker checks.
  Tests: `test/builder-next.test.mjs`.
- `builder/next/next.js` — DOM only. Selection follows focus (keyboard parity);
  inspector shows controls for the selected column / row / cell / range; Insert
  menu is click-driven and remembers the last caret; arrows/Enter move like a
  spreadsheet; pasting a multi-cell range fills the grid.
- Drafts: own localStorage key (`ccc-builder-next-draft`), so the live builder's
  draft is never clobbered. The renderer-version pick is shared.

## Import baseline rules

"Changed" compares builder output to builder output (format-only differences
never show). A legacy one-chunk Data import marks Data changed, and Table
title / Config changed unless their boxes were filled — the item's separate
fields don't hold those values yet.

## Round 1 feedback (Alex, 2026-10-01 — implemented)

- **Start imports Data + Config only.** Table title and Footnotes boxes removed
  (their sizes also disagreed). Title is edited in Edit; retyping an existing
  CMS title marks it "paste" (harmless). Footnotes stay a preview-only field
  in Table settings; the legacy inline-footnotes rescue on Publish is unchanged.
- **New tables default `stickyFirstCol` + `collapsibleGroups` on** (pasted
  range / blank / sample). Imports keep exactly what the item has.
- **"Tinted Group Band"** is the row-type name; support text "A tinted group
  band applies a tint and groups rows underneath." Turning a row into a band
  while collapsing is off flashes the "Let readers collapse group bands"
  checkbox (2.4s highlight, no motion).
- **Row-type / alignment controls size to content** (`justify-self: start`)
  instead of stretching across the inspector.
- **`config.firstColLabels: false`** (renderer, UNRELEASED → next tag, 0.7.0):
  first-column body cells render as plain `td.table_cell` instead of row-label
  headers — for grids that don't need row headings. Sticky, the width cap and
  the phone switcher key off `data-col`, unchanged. Builder control: "First
  column holds row labels" in Table settings, gated at 0.7.0; with labels off,
  col-0 cells get the per-cell "Treat as a label" toggle. Emitted by
  `configJSON` only when false.
- **Sticky-column shadow:** already the renderer default since 0.4
  (`6px 0 8px -6px rgba(0,0,0,.15)`) and confirmed present in the preview
  iframes — it reads faint at the ~80% preview scale. Strengthening the
  default would be a renderer release decision.

## Shipped (2026-10-01)

Promoted to `builder/` (same URL; the previous one-page builder lives in git
history, ≤ af5a713) and released alongside renderer **v0.7.0**
(`firstColLabels`). Drafts use the key `ccc-builder-next-draft`, so a draft
made during testing survives the move.

## Out of scope here

Renderer changes (sticky-header-at-natural-height, chip labels on multi-row
headers), direct CMS writes, retiring the live builder.
