# ccc-tables Builder — design spec (2026-08-27, Alex-approved)

The Tier-2 authoring tool from the CCC Template wiki (`eguide-pattern.md` §11b, decisions
D10–D12; handoff `utilities/raw/2026-08-08-…-planned-tables-builder.md`): a standalone
static web page where Webflow **Marketer-seat** contributors (Lauren et al.) author
ccc-tables payloads without touching JSON — paste from Excel, click-configure, copy the
four CMS field values, paste into the site's `Tables` collection.

Deliberately **not** a Webflow App (Marketer seats can't run Designer extensions).
Interaction/distribution model: Lightning UX's free standalone builder page.

## Decisions (Alex, 2026-08-27)

- **Home/hosting:** `builder/` inside this (public) repo, served by **GitHub Pages** from
  `main` → `https://cohesivecc.github.io/ccc-tables/builder/`. No client data at rest —
  table data exists only in the visitor's session/localStorage.
- **Scope:** full spec — in-grid cell editing, group rows, merges (colspan/rowspan),
  multi-row headers, highlight column, caption/footnotes/config editors, token palette,
  live preview, four copy targets, round-trip import.
- **Stack:** vanilla no-build (plain HTML/CSS + ES modules), matching the repo.
- **Preview version:** picker of release tags (jsDelivr data API), defaulting to newest,
  so preview can match a site's exact pin (LSC pins 0.2.0).

## Architecture

```
builder/
  index.html      app shell; loads ../ccc-tables.js (classic script → window.cccTables
                  for LOGIC: parseTSV/parseData/resolveGrid), then the ES modules
  builder.css     builder chrome styles (never leaks into the preview iframe)
  builder.js      DOM app: grid rendering, selection, toolbars, side panel, outputs,
                  preview iframe, clipboard, localStorage autosave
  model.js        PURE: canonical state + grid operations (node-testable)
  serialize.js    PURE: state → Data (TSV|JSON) / Caption / Footnotes HTML / Config JSON;
                  TSV-representability; import normalization (node-testable)
test/builder.test.mjs   node --test suite for model.js + serialize.js
```

Two renderer copies, deliberately:
- **Logic** (parsing, grid resolution) = `../ccc-tables.js` from this checkout — always
  in sync with `main`, same file GitHub Pages serves.
- **Preview** = the pinned jsDelivr build inside an `iframe srcdoc` that reproduces the
  production embedding exactly: stand-in `table_*` styles + category palette (from
  `demo/index.html`), pinned `.css`/`.min.js`, a hidden data-carrier built from the
  **exact strings the copy buttons emit**, and a `<div ccc-table>` mount. The renderer's
  own `init()` renders it — its real error box included. Version switch = rebuild iframe
  (two renderer versions can't share one window).

## Canonical state (the renderer's JSON model, normalized)

```js
{
  caption: '',            // plain text
  headerRows: [{ cells: [{ text, colspan?, rowspan? }] }],   // always ≥ 1 row
  rows: [{ group?: true, cells: [{ text, colspan?, rowspan?, header? }] }],
  footnotes: [''],        // one entry per line; exported as <ul> rich text
  config: { stickyFirstCol, collapsibleGroups, mobileSwitcher, tsvGroups, highlightCol }
}
```

Import (`fromParsed`) normalizes `parseData` output: `columns` → a single headerRow;
inline `caption`/`footnotes`/`config` (v0.1 blobs) populate the side panel.

## Grid operations (model.js, pure)

- `setCell`, `addRow/deleteRow/moveRow`, `toggleGroup` (group ↔ normal keeps first-cell
  text; ungroup pads to the grid's column count)
- `insertCol(k)/deleteCol(k)/` on **absolute** grid columns via `resolveGrid`: a cell
  starting at k gets a sibling inserted / removed; a cell spanning across k grows /
  shrinks its colspan
- `mergeCells(section, rect)` — rectangle must cover whole cells; anchor gets
  colspan/rowspan, covered cells are removed. `unmerge` restores empty cells.
- `promoteRowToHeader` / `demoteHeaderRow` (multi-row headers)

## Output rules (serialize.js, pure)

Four outputs matching the v0.2 split-field CMS model:

1. **Data** — TSV when **round-trip-safe**: serialize to TSV, re-parse with the real
   `parseTSV` (same `tsvGroups` opt), deep-compare to the model; equal → TSV, else JSON
   with a visible reason ("JSON: merged cells" / "multi-row header" / "a row would
   re-parse as a group row" / "cell contains a tab or line break"). JSON form emits
   `columns` when the single header row has no spans, else `headerRows`; cells emit only
   non-default keys. Data never contains caption/footnotes/config (split-field model).
2. **Caption** — plain text.
3. **Footnotes** — `<ul><li>…</li></ul>` (the LSC canon shape); copied with a `text/html`
   ClipboardItem so pasting into the Webflow RichText field keeps formatting; raw HTML
   viewable.
4. **Config** — JSON of non-default keys only (`stickyFirstCol/collapsibleGroups/
   mobileSwitcher` when true, `tsvGroups` when false, `highlightCol` when set); empty
   config → empty output.

Copy buttons enable only after the emitted Data string re-validates through the real
`parseData` + `resolveGrid`; a warnings panel flags rows whose resolved width ≠ header
width (the LSC validation practice), non-blocking.

## UI (single page, three zones)

- **Header:** title · renderer-version picker (jsDelivr API, fallback = local version) ·
  New · Load sample · autosave indicator.
- **Main:** paste box (TSV or JSON, sniffed by the real `parseData`; collapses once a
  table loads) → editable grid (`contenteditable="plaintext-only"` cells; click / shift-
  click rectangle selection) with row/col/merge toolbar + **token toolbar** inserting
  `[check] [xmark] [dollar] [link:url|label] [tip:text|body] ^N` (D11: tokens only,
  never "insert component"; one-line legend each).
- **Side panel:** Caption input · Footnotes textarea (line = footnote) · Config
  checkboxes + highlightCol select · the four output blocks with copy buttons + status.
- **Bottom:** preview iframe, Desktop/Mobile(375px) width toggle. Note: colors come from
  the host site; the preview uses the demo stand-in palette.

Drafts autosave to `localStorage` (try/catch-wrapped; restore on load; New clears).

## Testing

- `test/builder.test.mjs` (node --test, `createRequire` for the renderer): serialization
  round-trips through the real parser, TSV-representability edge cases (span, multi-row
  header, group-misdetection, tab/newline in cell), grid ops across spans, merge/unmerge,
  group toggle, header promote/demote, import normalization. Fixtures mirror real LSC
  shapes (grouped rate table, colspan comparison, multi-row header) — synthetic values
  only (public repo).
- Local-only sweep (not committed): run every real LSC payload through import → export →
  re-parse → grid-compare.
- Browser verification of the UI + preview per the normal workflow.

## Out of scope (v1)

Data-API CMS writes (parked v2) · facet dimension (not a 0.2 renderer feature) · new
renderer tokens · any renderer change — the builder consumes the API as-is.

## Alex chores

- Enable GitHub Pages: repo Settings → Pages → Deploy from branch → `master`, `/ (root)`.
- Push (repo is public; nothing here contains client data).
