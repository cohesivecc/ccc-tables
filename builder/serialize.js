/* builder/serialize.js — builder state → the four CMS field values
 * (Data / Caption / Footnotes / Config, the v0.2 split-field model), plus
 * validation and the TSV-vs-JSON routing for the Data field.
 *
 * Pure logic, node-testable. Uses globalThis.cccTables (see model.js).
 */

import { colCount } from './model.js';

function ccc() { return globalThis.cccTables; }

/* Minimal cell for output: text + only meaningful keys. */
function outCell(c) {
  const out = { text: c.text || '' };
  if (c.colspan > 1) out.colspan = c.colspan;
  if (c.rowspan > 1) out.rowspan = c.rowspan;
  if (c.header) out.header = true;
  return out;
}

function outRows(rows) {
  return rows.map(r => {
    const row = {};
    if (r.group) row.group = true;
    row.cells = r.cells.map(outCell);
    return row;
  });
}

/* Data field, JSON form: columns when the header is one spanless row, else
   headerRows. Never carries caption/footnotes/config (split-field model). */
export function toJSONData(state) {
  const h = state.headerRows;
  const singlePlain = h.length === 1 &&
    h[0].cells.every(c => !(c.colspan > 1) && !(c.rowspan > 1));
  const data = singlePlain
    ? { columns: h[0].cells.map(c => ({ text: c.text || '' })) }
    : { headerRows: h.map(r => ({ cells: r.cells.map(outCell) })) };
  data.rows = outRows(state.rows);
  return JSON.stringify(data, null, 2);
}

/* Config field: non-defaults only (renderer defaults: the three booleans off,
   tsvGroups on). Empty result = nothing to paste. */
export function configJSON(state) {
  const c = state.config || {};
  const out = {};
  ['stickyFirstCol', 'collapsibleGroups', 'mobileSwitcher'].forEach(k => {
    if (c[k] === true) out[k] = true;
  });
  if (c.tsvGroups === false) out.tsvGroups = false;
  if (typeof c.highlightCol === 'number') out.highlightCol = c.highlightCol;
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Footnotes field: the LSC-canon <ul> shape for the CMS RichText field. */
export function footnotesHTML(state) {
  const lines = (state.footnotes || []).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return '<ul>' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>';
}

export function captionText(state) {
  return (state.caption || '').trim();
}

/* Errors: the emitted Data string must survive the real parser.
   Warnings: non-group rows whose resolved width ≠ the header width
   (the row-span validation practice used on the LSC payloads). */
export function validate(state) {
  const errors = [], warnings = [];
  let parsed;
  try {
    parsed = ccc().parseData(toJSONData(state), state.config);
    ccc().resolveGrid(parsed.headerRows || []);
    ccc().resolveGrid(parsed.rows || []);
  } catch (e) {
    errors.push('Data does not re-parse: ' + e.message);
    return { errors, warnings };
  }
  const want = colCount(state);
  const placed = ccc().resolveGrid(state.rows);
  const carry = []; // grid cols covered in following rows by rowspans
  state.rows.forEach((row, i) => {
    let covered = carry[i] ? carry[i].size : 0;
    placed[i].forEach(p => {
      covered += p.span;
      const rs = p.cell.rowspan || 1;
      for (let rr = i + 1; rr < i + rs; rr++) {
        carry[rr] = carry[rr] || new Set();
        for (let cc = p.col; cc < p.col + p.span; cc++) carry[rr].add(cc);
      }
    });
    if (!row.group && covered !== want) {
      warnings.push('Row ' + (i + 1) + ' covers ' + covered + ' of ' + want + ' columns');
    }
  });
  return { errors, warnings };
}
