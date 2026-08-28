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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@0.2.2/ccc-tables.css">
<script src="https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@0.2.2/ccc-tables.min.js"></script>
```

jsDelivr serves `.min.js`/`.min.css` automatically — no build step in this repo.

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
| `mobileSwitcher` | ≤767px: chip toolbar shows one value column at a time (auto-disabled when body cells span) |
| `highlightCol` | zero-based column index tinted with the category wash |
| `tsvGroups` | `false` disables TSV group-row detection |

### Cell tokens

Cells never accept HTML or components — richness ships only as tokens, rendered
identically everywhere:

| token | renders |
| --- | --- |
| `[check]` / `[xmark]` / `[dollar]` | icon glyphs |
| `^N` | superscript footnote reference |
| `[link:url|label]` | in-cell link (`https:`, `tel:`, `mailto:`, `/…`, `#…` only) |
| `[tip:text|body]` | tippy tooltip on `text` |

### Errors

Bad JSON, an empty Data field, or a missing blob render a visible error box in
the mount — authoring mistakes fail loudly, not blankly.

## API

The script exposes `window.cccTables` (and CommonJS exports for Node):
`version`, `init()`, `parseData(raw, opts)`, `parseTSV(text, opts)`,
`buildTable(data, mountEl)`, `resolveGrid(rows)`, `fmt(text)`, `overlay(data, extras)`.
The builder tool consumes these so its preview IS the production renderer.

## Builder (authoring tool)

`builder/` is a standalone static page for Marketer-seat contributors: paste a
range copied from Excel/Google Sheets (or an existing `Data` field), click-
configure it (group rows, cell merges, multi-row headers, highlight column,
token palette, caption/footnotes/options), and copy the four CMS field values —
**Data** (TSV when round-trip-safe, else JSON with a stated reason), **Caption**,
**Footnotes** (pastes as rich text), **Config**. The preview pane loads the
pinned jsDelivr build of this renderer (release-tag picker, mobile width
toggle), fed the exact strings the copy buttons emit — preview == production.
Drafts autosave to the browser's localStorage.

Hosted via GitHub Pages (Settings → Pages → Deploy from branch → `master`,
`/ (root)`): `https://cohesivecc.github.io/ccc-tables/builder/`. Cell richness
is tokens-only by design — the builder never inserts site components.

Caution shared with Tier-1 pastes: a spreadsheet cell containing a LINE BREAK is
quoted by Excel/Sheets on copy; the builder's import handles that quoting, but the
renderer's own `parseTSV` (a direct CMS `Data` paste) does not — multiline cells
must go through the builder (which emits JSON for them). Renderer quote-handling is
a v0.3 candidate.

Develop: serve the repo root over HTTP (ES modules don't load from `file://`),
e.g. `python3 -m http.server`, then open `/builder/`. Logic tests:
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
