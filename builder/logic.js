/* builder/logic.js — pure logic for the step-based builder.
 *
 * Node-testable. Builds on ./model.js + ./serialize.js (the data logic)
 * and globalThis.cccTables. Owns three things the old builder scattered across
 * tooltips and inline notes:
 *   1. FEATURES — the one table of which renderer release introduced what.
 *   2. The Publish plan — which CMS fields to paste, clear, or leave alone.
 *      Footnotes are PREVIEW-ONLY here: authored in the CMS Rich Text field,
 *      never emitted (the old round trip dropped their inline formatting).
 *   3. Footnote-marker cross-checks for the preview-only footnotes.
 */

import { colCount } from './model.js';
import { dataFieldValue, captionText, configJSON } from './serialize.js';

/* ---------- 1. renderer feature table ---------- */

export const FEATURES = [
  { key: 'groupCells', since: '0.3.0', label: 'group bands that keep extra cells' },
  { key: 'switcherSpans', since: '0.4.0', label: 'the phone plan switcher on tables with merged cells' },
  { key: 'firstColMax', since: '0.5.0', label: 'the first-column width cap' },
  { key: 'softToken', since: '0.5.0', label: 'the regular-weight token and symbol footnote markers (^*, ^†)' },
  { key: 'align', since: '0.6.0', label: 'column alignment' },
  { key: 'colDividers', since: '0.6.0', label: 'column dividers' },
  { key: 'nbsp', since: '0.6.0', label: 'the keep-together token' },
  { key: 'headerTokens', since: '0.6.1', label: 'tokens in column headings' },
  { key: 'maxHeight', since: '0.6.2', label: 'the scroll-height setting' },
  { key: 'firstColLabels', since: '0.7.0', label: 'a first column without row labels' },
];

function vnum(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? (+m[1]) * 1e6 + (+m[2]) * 1e3 + (+m[3]) : Infinity; // unknown/local = newest
}

export function feature(key) {
  return FEATURES.find(f => f.key === key);
}

/* Does renderer `version` ('0.5.0', 'local', …) support feature `key`? */
export function supports(version, key) {
  const f = feature(key);
  return !f || vnum(version) >= vnum(f.since);
}

/* One sentence for a disabled control. */
export function gateReason(version, key) {
  const f = feature(key);
  return f ? `Needs renderer ${f.since} or later — this site uses ${version}.` : '';
}

const allCells = s => [...s.headerRows, ...s.rows].flatMap(r => r.cells);

/* Which features the current table USES — drives the preview's compatibility notes. */
export function featuresUsed(state) {
  const used = new Set();
  const c = state.config || {};
  const bodyText = state.rows.flatMap(r => r.cells).map(x => x.text || '').join('\n');
  const headText = state.headerRows.flatMap(r => r.cells).map(x => x.text || '').join('\n');
  const text = bodyText + '\n' + headText;
  if (state.rows.some(r => r.group && r.cells.length > 1)) used.add('groupCells');
  if (c.mobileSwitcher && state.rows.some(r => r.cells.some(x => x.colspan > 1 || x.rowspan > 1))) used.add('switcherSpans');
  if (c.firstColMax != null && c.firstColMax !== '') used.add('firstColMax');
  if (/\[reg:|\^[*†‡§]/.test(text)) used.add('softToken');
  if (Array.isArray(c.align) && c.align.some(Boolean)) used.add('align');
  if (Array.isArray(c.colDividers) && c.colDividers.length) used.add('colDividers');
  if (/\[nbsp\]/.test(text)) used.add('nbsp');
  if (/\[(check|xmark|dollar|nbsp)\]|\[(link|tip|reg):|\^(\d+|[*†‡§]+)/.test(headText)) used.add('headerTokens');
  if (c.maxHeight != null && c.maxHeight !== false && c.maxHeight !== '') used.add('maxHeight');
  if (c.firstColLabels === false) used.add('firstColLabels');
  return used;
}

/* Plain-language notes for features the table uses that `version` lacks. */
export function compatNotes(state, version) {
  return [...featuresUsed(state)]
    .filter(k => !supports(version, k))
    .map(k => `${cap(feature(k).label)}: needs renderer ${feature(k).since}, so ${version} ignores it.`);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- 2. publish plan ---------- */

export const PUBLISH_FIELDS = [
  { key: 'data', label: 'Data', where: 'the item’s Data field' },
  { key: 'title', label: 'Table title', where: 'the item’s Table Title field' },
  { key: 'config', label: 'Config', where: 'the item’s Config field' },
];

/* The CMS field values the builder emits. Footnotes deliberately absent. */
export function publishValues(state) {
  return {
    data: dataFieldValue(state).value,
    title: captionText(state),
    config: configJSON(state),
  };
}

/* baseline = publishValues() at import time (null for a new table).
   Returns rows in PUBLISH_FIELDS order:
     status 'new'     new table, non-empty value → paste
            'changed' differs from the import → paste
            'clear'   was filled at import, now empty → empty the CMS field
            'same'    unchanged → leave alone
            'empty'   new table, nothing to paste */
export function publishPlan(state, baseline) {
  const now = publishValues(state);
  return PUBLISH_FIELDS.map(f => {
    const value = now[f.key];
    let status;
    if (!baseline) status = value ? 'new' : 'empty';
    else if (baseline[f.key] === value) status = 'same';
    else status = value ? 'changed' : 'clear';
    return { ...f, value, status };
  });
}

export function toPasteCount(plan) {
  return plan.filter(p => p.status === 'new' || p.status === 'changed' || p.status === 'clear').length;
}

/* ---------- 3. footnote markers ---------- */

/* Markers used in cells: ['1', '*', '†', …] in first-seen order. */
export function markersUsed(state) {
  const seen = [];
  allCells(state).forEach(c => {
    String(c.text || '').replace(/\^(\d+|[*†‡§]+)/g, (m, k) => { if (!seen.includes(k)) seen.push(k); return m; });
  });
  return seen;
}

/* Markers with no preview footnote line starting with them ("^1 …", "1 …",
   "1. …", "* …"). Only meaningful when footnotes were pasted for the preview. */
export function markersMissing(state) {
  const lines = (state.footnotes || []).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const starts = (line, k) => {
    const t = line.replace(/^\^/, '');
    if (!t.startsWith(k)) return false;
    const next = t.charAt(k.length);
    return /\d/.test(k) ? !/\d/.test(next) : !/[*†‡§]/.test(next);
  };
  return markersUsed(state).filter(k => !lines.some(l => starts(l, k)));
}

/* ---------- small helpers the UI shares ---------- */

export const colLetter = k => (k < 26 ? '' : colLetter(Math.floor(k / 26) - 1)) + String.fromCharCode(65 + (k % 26));

/* Human name for a grid position: "B3", or "heading B" in the header. */
export function cellName(section, r, col, headerRowCount) {
  if (section === 'header') return headerRowCount > 1 ? `heading ${colLetter(col)} (header row ${r + 1})` : `heading ${colLetter(col)}`;
  return `${colLetter(col)}${r + 1}`;
}

export { colCount };
