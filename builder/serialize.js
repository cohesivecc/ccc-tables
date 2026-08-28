/* builder/serialize.js — builder state → the four CMS field values
 * (Data / Caption / Footnotes / Config, the v0.2 split-field model), plus
 * validation and the TSV-vs-JSON routing for the Data field.
 *
 * Pure logic, node-testable. Uses globalThis.cccTables (see model.js).
 */

import { colCount, fromParsed } from './model.js';

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

/* Data field, TSV form: header texts, then rows; a group row is its bare
   label line (exactly what parseTSV re-detects). */
export function toTSV(state) {
  const lines = [state.headerRows[0].cells.map(c => c.text || '').join('\t')];
  state.rows.forEach(r => {
    if (r.group) lines.push((r.cells[0] || {}).text || '');
    else lines.push(r.cells.map(c => c.text || '').join('\t'));
  });
  return lines.join('\n');
}

/* Route the Data field: TSV when the state survives a full round-trip through
   the REAL parseTSV, else JSON with a human reason. Explicit checks give the
   friendly reasons; the round-trip compare is the final safety net. */
export function dataFieldValue(state) {
  const json = reason => ({ format: 'json', value: toJSONData(state), reason });
  if (state.headerRows.length > 1) return json('multi-row header');
  const spans = c => c.colspan > 1 || c.rowspan > 1;
  if (state.headerRows[0].cells.some(spans) ||
      state.rows.some(r => r.cells.some(spans))) return json('merged cells');
  if (state.rows.some(r => !r.group && r.cells.some(c => c.header))) {
    return json('a header flag on a body cell');
  }
  const cells = [...state.headerRows[0].cells, ...state.rows.flatMap(r => r.cells)];
  if (cells.some(c => /[\t\n\r]/.test(c.text || ''))) {
    return json('a cell contains a tab or line break');
  }
  if (cells.some(c => (c.text || '') !== (c.text || '').trim())) {
    return json('a cell has spaces the TSV parser would trim');
  }
  if (!(state.config && state.config.tsvGroups === false)) {
    const misdetected = state.rows.some(r => !r.group &&
      (r.cells[0] || {}).text &&
      r.cells.slice(1).every(c => !c.text));
    if (misdetected) return json('a row would re-parse as a group row');
  }
  const tsv = toTSV(state);
  try {
    const re = fromParsed(ccc().parseData(tsv, state.config));
    const grid = s => JSON.stringify({ h: s.headerRows, r: s.rows });
    if (grid(re) === grid(state)) return { format: 'tsv', value: tsv };
  } catch (e) { /* fall through to JSON */ }
  return json('not round-trip-safe as TSV');
}

/* Excel/Sheets CLIPBOARD parser for the builder's import path. Unlike the
 * renderer's parseTSV (which the CMS Data field uses and which has no quote
 * handling), a spreadsheet clipboard wraps any cell containing a newline,
 * tab, or quote in double quotes ("" escapes a literal quote). Without this,
 * a multiline cell shatters into extra rows and the fragments get mistaken
 * for group rows. Returns a grid of trimmed strings; all-empty rows and
 * trailing all-empty columns are dropped.
 */
export function parseExcelClipboard(text) {
  const t = String(text).replace(/\r\n?/g, '\n');
  const rows = [[]];
  let field = '', quoted = false, fieldStart = true;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (fieldStart && ch === '"') { quoted = true; fieldStart = false; continue; }
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    fieldStart = false;
    if (ch === '\t') { rows[rows.length - 1].push(field); field = ''; fieldStart = true; }
    else if (ch === '\n') { rows[rows.length - 1].push(field); field = ''; fieldStart = true; rows.push([]); }
    else field += ch;
  }
  rows[rows.length - 1].push(field);
  let grid = rows.map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
  let width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  while (width > 0 && grid.every(r => (r[width - 1] || '') === '')) {
    grid.forEach(r => { if (r.length >= width) r.length = width - 1; });
    width--;
  }
  return grid;
}

/* Grid of strings → the renderer's {columns, rows} shape, with the SAME
   group-row heuristic as parseTSV (first line header; a body row with only
   its first cell filled becomes a group row). */
export function gridToParsed(grid) {
  if (!grid.length) throw new Error('empty data');
  const columns = grid[0].map(t => ({ text: t }));
  const colCount = columns.length;
  const rows = grid.slice(1).map(cells => {
    const isGroup = colCount > 1 && cells[0] !== '' &&
      cells.slice(1).every(c => c === '');
    const row = { cells: (isGroup ? [cells[0]] : cells).map(t => ({ text: t })) };
    if (isGroup) row.group = true;
    return row;
  });
  return { columns, rows };
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
