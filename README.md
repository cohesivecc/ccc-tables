# ccc-tables

CMS-data-driven table renderer for Cohesive benefits sites built on the CCC
Webflow starter. Table data lives in a Webflow CMS `Tables` collection, gets
emitted into the page as hidden data blobs, and this runtime renders it as
semantic, design-system-classed table markup — sticky headers, collapsible row
groups, footnotes, a mobile plan switcher, and a closed cell-token vocabulary.

Replaces per-table Designer components and `/tables/` iframe pages for data
tables (readers *comparing values across columns*). Record-style lists (readers
*scanning rows*, e.g. a contacts page) stay native Collection Lists — see the
two-species rule below.

## Install (Webflow)

Load the script and stylesheet once per page (site-wide custom code or an
embed), pinned to a release tag:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@0.7.0/ccc-tables.css">
<script src="https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@0.7.0/ccc-tables.min.js"></script>
```

jsDelivr serves `.min.js`/`.min.css` automatically — no build step in this repo.
Release notes: [CHANGELOG.md](CHANGELOG.md).

**Height (v0.6.2+):** tables render at their natural height — the wrapper
scrolls horizontally for wide tables only. The pre-0.6.2 internal 70vh scroll
is opt-in per table via `maxHeight` in Config. A site-head override
`.ccc-table_scroll{max-height:none;overflow-y:visible}` (the old workaround) is
redundant from 0.6.2 and can be deleted.

## Styling: what the stylesheet owns vs the Designer

`ccc-tables.css` splits into two kinds of rules (see its header comment):

- **Mechanics** (sticky positioning, column hiding, the mobile-switcher media
  block, category-colored header/legend treatments) keep normal specificity.
  Their colors are themable via custom properties, never by re-declaring rules:
  `--ccc-cat-700/500/100` (category bridge), `--ccc-cat-on-dark`,
  `--ccc-table-bg`, `--ccc-ok`, `--ccc-danger` — set them as Webflow Variables
  or on any ancestor. The two `!important`s are load-bearing and stay.
- **Skin** on renderer-minted classes (`.ccc-table_caption`, `_chip`,
  `_footnotes`, `_link`, `_tip`, `.ccc-ico` colors, `_error`) is wrapped in
  `:where(...)` — zero specificity, so ANY Designer-authored rule on the same
  class wins regardless of stylesheet order. To restyle visually in Webflow:
  put dummy elements carrying these classes on a `/system` swatch page, style
  them in the Designer panel, done — no `!important`, no head-code overrides.

Requirements on the host site:

- The CCC starter's `table_*` class family (`table_component`, `table_header`,
  `table_cell`, `table_row`, `table_outer`, `table_wrapper`) — the renderer
  emits those classes and only ships its own `ccc-table_*` layer.
- Category theming (optional): any ancestor that sets the `--ccc-cat-100/500/700`
  custom properties themes the table. Without them a neutral fallback palette
  applies.
- `[tip:]` tokens (optional): tippy.js with the site's `ccc` theme. The renderer
  initializes its own tips late if the site's tippy pass already ran.

## Usage

**1. Emit the data** — a hidden element carries the CMS `Data` field:

```html
<script type="application/json" data-ccc-table="compare-plans">{{Data field}}</script>
```

Hide data carriers with CSS (`[ccc-data] { display: none }` on a wrapper), never
with the Webflow visibility toggle (it strips elements from published HTML).
Multiple blobs with the same slug concatenate (Webflow embed size limits).

**2. Mount it** where the table should appear (works inside rich text via an
HTML embed):

```html
<div ccc-table="compare-plans"></div>
```

### Data formats

The `Data` field accepts either format — sniffed by the first character:

**TSV** (an Excel/Google Sheets clipboard copy IS TSV — paste the range as-is).
First line is the header row. A row with only its first cell filled becomes a
group row (disable with `"tsvGroups": false` in Config):

```
	BCBSTX HSA	BCBSTX PPO
In-network
Deductible	$1,500	$500
Coinsurance	20%	10%
```

**JSON** (full model — spans, explicit groups, multi-row headers):

```json
{
  "caption": "Compare the Medical Plans",
  "columns": [{ "text": "" }, { "text": "HSA" }, { "text": "PPO" }],
  "rows": [
    { "group": true, "cells": [{ "text": "In-network" }] },
    { "cells": [{ "text": "Deductible" }, { "text": "$1,500" }, { "text": "$500" }] },
    { "cells": [{ "text": "Spans too", "colspan": 2 }, { "text": "x" }] }
  ],
  "footnotes": ["^1 After deductible."],
  "config": { "stickyFirstCol": true, "collapsibleGroups": true, "mobileSwitcher": true, "highlightCol": 1 }
}
```

`headerRows` (array of row objects) replaces `columns` for multi-row headers
with spans.

A group row may carry cells beyond its label (**v0.3+**) — they render as
header cells with their spans, so a collapsible band can head sub-columns:

```json
{ "group": true, "cells": [{ "text": "Prescription Drugs" },
  { "text": "Retail", "colspan": 2 }, { "text": "Mail", "colspan": 2 }] }
```

Renderers before 0.3 show only the label.

**Mobile plan switcher on merged tables (v0.4+):** `mobileSwitcher` is span-aware —
a merged cell stays visible whenever the selected column falls inside its span, so
spanned comparison tables keep the switcher (renderers before 0.4 turn it off when
body rows contain merges). Cells flagged `"header": true` (and the first column)
always show — flag sub-label cells like "Employee Only" so they survive the
single-column view. Blank header cells produce no switcher chip. Caveat: a
`rowspan` value renders once, on its origin row — covered rows show no value for
that column.

### Split-field overlay

Caption, footnotes, and config can live in their own CMS fields instead of the
JSON blob (the v0.2 authoring model — `Data` stays exactly the Excel-shaped
part). Emit them as tagged siblings; when present they override the blob:

```html
<div data-ccc-table-caption="compare-plans">{{Caption field}}</div>
<script type="application/json" data-ccc-table-config="compare-plans">{{Config field}}</script>
```

**Footnotes (rich text) cannot bind inside an embed** — Webflow's embed field
picker doesn't offer Rich Text fields. Bind them with a Rich Text *element*
instead: in the same Collection Item, add a Rich Text element bound to the
Footnotes field, and give it a custom attribute named `data-ccc-table-footnotes`
whose *value* is field-bound to the Slug (a Designer-only capability). The
renderer accepts the attribute on any element and keeps the rich HTML verbatim.

### Config

| key | effect |
| --- | --- |
| `stickyFirstCol` | first column sticks while scrolling horizontally |
| `collapsibleGroups` | group rows become expand/collapse toggles |
| `mobileSwitcher` | screens ≤767px: chip toolbar shows one value column at a time (span-aware since v0.4). Screen-only since v0.6.2 — print always gets the full table |
| `highlightCol` | zero-based grid column tinted with the category wash (a merged cell tints whenever the column falls inside its span) |
| `tsvGroups` | `false` disables TSV group-row detection |
| `firstColMax` | first-column width cap, percent of the table (default `50`; a no-op unless the column would exceed it). Accepts `50` / `"50%"`, an explicit length (`"30ch"`), or `"none"` to disable |
| `align` | per-column text alignment, indexed by grid column: `["left","center", …]` — `null`/omitted keeps the site default (first column left, others centered). Only `left`/`center`/`right`; ignored per-cell in the stacked mobile switcher. A centred/right first column also moves its capped `firstColMax` box (v0.6.2+; before that, centring col 0 needed `"firstColMax": false`) |
| `colDividers` | grid columns that get a vertical rule on their **left** edge — e.g. `[4]` to divide two plan groups. Reskin via `--ccc-divide-color` |
| `firstColLabels` | **v0.7+**: `false` renders the first column as plain cells instead of bold row-label headers (for grids with no row headings). Per-cell `"header": true` still works |
| `maxHeight` | **v0.6.2+**, opt-in internal vertical scroll (the default is natural height): `true` (= 70vh, the pre-0.6.2 cap), a bare number (`60` = 60vh), or a length (`"40rem"`). Lets a sticky header stay in view while a very long table scrolls. Screen only — print is never clipped |

### Cell tokens

Cells never accept HTML or components — richness ships only as tokens, rendered
identically everywhere:

| token | renders |
| --- | --- |
| `[check]` / `[xmark]` / `[dollar]` | icon glyphs |
| `^N` | superscript footnote reference — digits (`^1`) or the marker glyphs `*` `**` `***` `†` `‡` `§` (`^*`, `^†`) |
| `[reg:text]` | regular-weight span — de-emphasize part of a bold first-column label (e.g. `Deductible [reg:(does not apply to Type A)]`); upright by default, add `font-style: italic` to `.ccc-table_soft` in Designer for italic |
| `[nbsp]` | non-breaking space — keeps two short words on one line (e.g. `No[nbsp]Orthodontics`). The `&nbsp;` entity is escaped to literal text, so use this token instead |
| `[link:url|label]` | in-cell link (`https:`, `tel:`, `mailto:`, `/…`, `#…` only) |
| `[tip:text|body]` | tippy tooltip on `text` |

### Errors

Bad JSON, an empty Data field, or a missing blob render a visible error box in
the mount — authoring mistakes fail loudly, not blankly.

## API

The script exposes `window.cccTables` (and CommonJS exports for Node):
`version`, `init()`, `parseData(raw, opts)`, `parseTSV(text, opts)`,
`buildTable(data, mountEl)`, `resolveGrid(rows)`, `firstColMaxCss(value)`,
`maxHeightCss(value)`,
`alignValue(value)`, `fmt(text)`, `overlay(data, extras)`.
The builder tool consumes these so its preview IS the production renderer.

## Builder (authoring tool)

`builder/` is a standalone static page for Marketer-seat contributors, in
three steps — **Start → Edit → Publish**:

- **Start.** Paste a range copied from Excel/Google Sheets (first row = the
  column headings; a row with only its first cell filled = a tinted group
  band), or edit a table that's already in the CMS by pasting its **Data**
  and **Config** fields. Table title and Footnotes stay in the CMS. Legacy
  one-chunk JSON blobs import; Publish converts them to the split-field model.
- **Edit.** A spreadsheet-style grid (arrow keys/Enter move, shift-click
  selects a range, pasting a range fills cells), an inspector for whatever is
  selected — column (alignment, highlight, divider, move/insert/delete), row
  (values vs tinted group band, header rows), cell (merge/unmerge, treat as a
  label) — table settings with plain-language hints, and an Insert menu for
  the cell tokens. New tables default `stickyFirstCol` + `collapsibleGroups`
  on. **Previews** sit under the grid: desktop at 824px (the CCC article
  column) and phone at 375px side by side, rendered by the pinned jsDelivr
  build (release-tag picker). Controls a pinned renderer doesn't support are
  disabled with the release that adds them.
- **Publish.** Lists only the fields to act on — Data (TSV when
  round-trip-safe, else JSON with a stated reason), Table title, Config —
  each marked Changed / No change / Clear against the builder's own
  serialization of the import, so format-only differences with the CMS text
  never show as changes. Footnotes are preview-only: author them in the CMS
  Rich Text field (cell markers `^1`, `^*` are cross-checked, and footnotes
  trapped inside a legacy Data blob get a copy-out rescue).

Drafts autosave to the browser's localStorage. Hosted via GitHub Pages
(Settings → Pages → Deploy from branch → `master`, `/ (root)`):
`https://cohesivecc.github.io/ccc-tables/builder/`. Cell richness is
tokens-only by design — the builder never inserts site components.

Caution shared with Tier-1 pastes: a spreadsheet cell containing a LINE BREAK
is quoted by Excel/Sheets on copy; the builder's import handles that quoting,
but the renderer's own `parseTSV` (a direct CMS `Data` paste) does not —
multiline cells must go through the builder (which emits JSON for them).
Renderer-side quote handling remains a candidate.

Develop: serve the repo root over HTTP (ES modules don't load from `file://`),
`python3 scripts/serve.py` (a no-store static server — plain `http.server` lets the browser cache modules stale), then open `/builder/`. Logic tests:
`node --test test/builder-*.test.mjs`.

## The two-species rule

Route by one question: **do readers compare values across columns, or scan rows
as records?** Compare → ccc-tables. Records (contacts: carrier / phone / app
links) → native CMS Collection List + row component. Exotic one-off layouts
keep the bespoke-component escape hatch.

## Develop

```
node --test test/*.test.mjs
```

No dependencies, no build. Release = tag (`git tag vX.Y.Z && git push --tags`);
jsDelivr picks tags up automatically (purge cache at
`https://purge.jsdelivr.net/gh/cohesivecc/ccc-tables@<tag>/…` if needed).
