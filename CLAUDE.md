# ccc-tables — CMS-data table renderer (Cohesive)

Versioned runtime that renders benefits data tables from CMS-emitted blobs on
CCC-starter Webflow sites. Served via jsDelivr (`gh/cohesivecc/ccc-tables@<tag>`),
so **this repo is PUBLIC** — no client data, client names, or real benefits
figures anywhere in it (tests use synthetic fixtures only).

## Orientation

- Knowledge home: this project's design record lives in the **CCC Template Work
  area wiki** (sibling `CCC Template Work/wiki/` in the cohesive workspace) —
  eguide-pattern §10/§11/§11b + decisions D10 (species rule), D11 (closed token
  vocabulary), D12 (CMS-data strategy). Read those before changing scope.
- Consumers: the CCC starter template (`/guide-detail-v2` prototype page) and
  every client fork of it. Pin by tag; never break published data blobs.
- The planned Tier-2 **builder page** (home: `utilities/`) reuses this exact
  build via `window.cccTables` so preview == production. Keep the API surface
  (`parseData/parseTSV/buildTable/fmt/resolveGrid/overlay`) stable.

## Rules

- No dependencies, no build step. One readable JS file + one CSS file at root;
  jsDelivr auto-minifies (`ccc-tables.min.js`).
- Cell richness = closed token vocabulary only (D11). New edge case → new token
  in a new tagged release, never arbitrary HTML/components.
- Backward compatibility: full-JSON `Data` blobs must keep working alongside
  TSV and the split-field overlay.
- Tests: `node --test test/parse.test.mjs` (pure-logic coverage; DOM behavior is
  verified on the template's staging site).
- Release: bump `VERSION` in ccc-tables.js + the header comments + README pin,
  tag `vX.Y.Z`, push tags.
