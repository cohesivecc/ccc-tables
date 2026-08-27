# ccc-tables Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A no-build static builder page (`builder/`) where Marketer-seat users paste an Excel range, click-configure a ccc-tables payload, watch a production-renderer preview, and copy the four CMS field values.

**Architecture:** Pure logic in two ES modules (`model.js` state + grid ops, `serialize.js` import/export) tested from node; a DOM app (`builder.js`) renders an editable grid + side panel and a preview `iframe srcdoc` that embeds the pinned jsDelivr renderer exactly as production does. Logic uses `globalThis.cccTables` from the repo-local `../ccc-tables.js`.

**Tech Stack:** Vanilla ES modules, `node:test`, the ccc-tables UMD renderer, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-27-table-builder-design.md`

## Global Constraints

- No build step, no dependencies, no framework — plain HTML/CSS/ES modules only.
- No client data in the repo — fixtures are synthetic.
- Cell richness = renderer tokens only (`[check] [xmark] [dollar] [link:url|label] [tip:text|body] ^N`); no component insertion anywhere in the UI (D11).
- The preview iframe loads the **pinned jsDelivr** build; builder logic loads the **repo-local** `../ccc-tables.js`.
- Output = the v0.2 split-field model: Data / Caption / Footnotes / Config, four separate copy targets.
- Node tests: `node --test test/` from the repo root; renderer loaded via `createRequire` and assigned to `globalThis.cccTables` before importing modules.

---

### Task 1: model.js — state factory + import normalization

**Files:** Create `builder/model.js`, `test/builder-model.test.mjs`

**Interfaces (produces):**
- `blankState()` → `{caption:'', headerRows:[{cells:[{text:''},{text:''}]}], rows:[{cells:[{text:''},{text:''}]}], footnotes:[], config:{}}`
- `fromParsed(parsed)` → state (normalizes `columns` → single headerRow; carries inline `caption`/`footnotes`/`config`; strips column objects to `{text, colspan?, rowspan?}` cells; keeps `group`/`header` flags)
- `colCount(state)` → resolved grid width of the header (max col+span over the last header row via `cccTables.resolveGrid`)

- [ ] Tests: fromParsed of a TSV parse (columns→headerRows, groups kept); fromParsed of a v0.1 inline JSON blob (caption/footnotes/config carried; headerRows kept as-is); colCount over a colspan header.
- [ ] Run tests, verify fail. Implement. Verify pass. Commit `feat(builder): model state + import normalization`.

### Task 2: model.js — cell/row ops

**Interfaces (produces):** all mutate-and-return state:
- `setCell(state, section, r, c, text)` (`section` = `'header'|'body'`; c = cell index, not grid col)
- `addRow(state, at)` / `deleteRow(state, at)` / `moveRow(state, from, to)` (body; new row = colCount empty cells)
- `toggleGroup(state, r)` — normal→group keeps `cells[0]` only; group→normal pads with empty cells to colCount
- `addColAfter(state, k)` / `deleteCol(state, k)` — absolute grid column k, applied to headerRows + non-group rows: a cell **starting** at k+1/k gets inserted/removed; a cell **spanning across** grows/shrinks colspan; group rows untouched. Placement via `cccTables.resolveGrid`.

- [ ] Tests: toggleGroup both directions; addColAfter middle of a colspan grows the span, others gain a cell; deleteCol on a span-1 cell removes it, on a covering span decrements; delete last data col refuses (min 2 cols). Row ops.
- [ ] Fail → implement → pass → commit `feat(builder): grid row/column/cell operations`.

### Task 3: model.js — merge/unmerge + header promote/demote

**Interfaces (produces):**
- `gridRect(state, section, [r1,c1], [r2,c2])` → `{ok, reason?}` rectangle validation on grid coords (whole-cell coverage, no group rows inside, single section)
- `mergeCells(state, section, [r1,c1], [r2,c2])` — anchor = top-left cell; sets colspan/rowspan; removes covered cells (texts of removed non-empty cells are appended to the anchor with `\n`)
- `unmergeCell(state, section, r, cIdx)` — clears spans, re-inserts empty cells in this row and rowspan-covered following rows
- `promoteRowToHeader(state)` (first body row → last header row; group rows refuse) / `demoteHeaderRow(state)` (last header row → first body row; refuses when only one header row)

- [ ] Tests: 2×2 merge then unmerge restores a uniform grid (verify via resolveGrid widths); merge refuses ragged rectangles; promote/demote round-trip; demote refuses at 1 header row.
- [ ] Fail → implement → pass → commit `feat(builder): merges and multi-row headers`.

### Task 4: serialize.js — JSON/config/footnotes/caption export

**Files:** Create `builder/serialize.js`, `test/builder-serialize.test.mjs`

**Interfaces (produces):**
- `toJSONData(state)` → string: `{columns:[…]}` form when 1 header row with no spans, else `{headerRows:[…]}`; plus `rows`; cells emit `text` + `colspan`/`rowspan` (>1) + `header`/`group` (true) only; 2-space pretty
- `configJSON(state)` → string: non-defaults only (`stickyFirstCol/collapsibleGroups/mobileSwitcher` true, `tsvGroups` false, numeric `highlightCol`); `''` when empty
- `footnotesHTML(state)` → `'<ul><li>…</li></ul>'` with text HTML-escaped, `''` when no lines
- `captionText(state)` → trimmed string
- `validate(state)` → `{errors:[], warnings:[]}` — errors: emitted Data fails real `parseData`/`resolveGrid`; warnings: non-group row resolved width ≠ header colCount

- [ ] Tests: cell key minimality; columns-vs-headerRows switch; config non-defaults incl. `tsvGroups:false`; footnote escaping; width-mismatch warning; round-trip `parseData(toJSONData(s))` grid-equals the state.
- [ ] Fail → implement → pass → commit `feat(builder): JSON/config/footnotes serialization + validation`.

### Task 5: serialize.js — TSV export + representability + dataFieldValue

**Interfaces (produces):**
- `toTSV(state)` → string (header texts joined `\t`; group row = bare first-cell text; data rows joined `\t`)
- `dataFieldValue(state)` → `{format:'tsv'|'json', value, reason?}` — TSV iff `stateGrid(fromParsed(parseTSV(toTSV(state), state.config)))` deep-equals `stateGrid(state)` (projection: headerRows/rows/cells with text + flags), else JSON with human reason (merged cells / multi-row header / header flag on a body cell / a row would re-parse as a group row / tab or newline in a cell / trimming would change text)
- reasons are detected by explicit checks first; the round-trip compare is the final safety net (`reason:'not round-trip-safe'`)

- [ ] Tests: plain rate table → tsv; each reason case → json with that reason; the demo TSV round-trips verbatim-equivalent; leading empty header cell preserved.
- [ ] Fail → implement → pass → commit `feat(builder): TSV export + representability routing`.

### Task 6: LSC-shape fixtures + local real-payload sweep

**Files:** append to `test/builder-serialize.test.mjs`; scratch script (uncommitted) for the sweep.

- [ ] Synthetic fixtures mirroring real shapes: grouped 2-band × 4-tier rate table (medical shape, TSV route), colspan comparison w/ `header:true` body cells (coverage-ends shape, JSON route), 2-row spanned header (json-demo shape). Assert import→export→re-parse grid equality for each.
- [ ] Local sweep (NOT committed): for every `docs/build/tables/*.json` payload in the LSC repo, run Data through `fromParsed(parseData(…))` → `dataFieldValue` → re-parse → grid-compare. All 28+ must round-trip. Fix whatever it exposes.
- [ ] Commit `test(builder): real-shape fixtures`.

### Task 7: builder UI — page, grid editor, side panel, outputs

**Files:** Create `builder/index.html`, `builder/builder.css`, `builder/builder.js`

- [ ] `index.html`: header (title, version select, New, Load sample), paste `<details>` + textarea + Import button, grid host + row/col/merge toolbar + token toolbar (6 tokens w/ title-attr legends), side panel (caption input, footnotes textarea, config checkboxes + highlightCol select), 4 output blocks (status line, `<pre>` value, Copy button), preview section (width toggle + iframe). Loads `../ccc-tables.js` (classic) then `builder.js` (module).
- [ ] `builder.js`: single `state`; `render()` redraws grid (table of `contenteditable="plaintext-only"` cells; group rows full-width; selection via click/shift-click on grid coords), side panel, outputs (`dataFieldValue`/`captionText`/`footnotesHTML`/`configJSON` + validate status; copy disabled on errors), preview (Task 8). Cell edits commit on input (debounced); toolbar buttons call model ops on the current selection. Clipboard: `navigator.clipboard.writeText`; footnotes via `ClipboardItem` `text/html`+`text/plain` with writeText fallback. Autosave state JSON to `localStorage['ccc-builder-draft']` (try/catch), restore on load, New clears. Sample = the demo TSV + caption/footnotes/config.
- [ ] Manual smoke in browser (grid edit, ops, outputs update). Commit `feat(builder): builder page UI`.

### Task 8: preview iframe + version picker

**Files:** Modify `builder/builder.js`, `builder/index.html`

- [ ] `previewSrcdoc(outputs, version)`: demo stand-in styles + `[ccc-data]{display:none}` + cat-demo palette; pinned `https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@{v}/ccc-tables.css` + `.min.js`; carrier built from the EXACT output strings (Data blob script, caption div, footnotes div, config script — omitted when empty); `<div ccc-table="builder-preview">`. Escape `</script>` in blobs (`<\/script`).
- [ ] Version picker: `fetch('https://data.jsdelivr.com/v1/packages/gh/cohesivecc/ccc-tables')` → `versions[].version` newest-first; on failure, one option = local `cccTables.version`. Change → rebuild iframe. Debounced rebuild on every state change. Width toggle sets iframe width 100% / 375px.
- [ ] Browser-verify: table renders in preview, error box on bad config paste, version list populated. Commit `feat(builder): production-renderer preview + version picker`.

### Task 9: docs + final verification

- [ ] README: "Builder" section (URL, what it does, split-field mapping, Pages setup note). 
- [ ] Full browser pass: paste sample → edit → group → merge (Data flips to JSON w/ reason) → unmerge (back to TSV) → footnotes/caption/config → copy each field → mobile preview → reload restores draft → New clears.
- [ ] `node --test test/` green. Commit `docs: builder README section`.

## Self-review

Spec coverage: hosting (repo `builder/`, Pages note T9) · full-scope editing (T2/T3/T7) · vanilla no-build (T7) · version picker (T8) · preview==production via exact output strings (T8) · four split-field outputs + copy gating (T4/T5/T7) · TSV-when-safe routing (T5) · tokens-only toolbar (T7) · autosave (T7) · warnings panel (T4) · fixtures + local sweep (T6). No placeholders; interface names consistent (`dataFieldValue`, `toJSONData`, `configJSON`, `footnotesHTML`, `captionText`, `validate`, model op names as listed).
