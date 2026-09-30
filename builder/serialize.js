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
  // firstColMax default is 50 (cap on) — implicit; emit only "none" (off) or a
  // custom percent. Mirrors firstColMaxCss's default so preview == published.
  if (c.firstColMax != null && c.firstColMax !== '' &&
      !(c.firstColMax === 50 || c.firstColMax === '50' || c.firstColMax === '50%')) {
    out.firstColMax = c.firstColMax;
  }
  // maxHeight (renderer ≥ 0.6.2) has no builder control — carry an imported
  // value through so a round trip doesn't silently drop it. Off = implicit.
  if (ccc().maxHeightCss(c.maxHeight)) out.maxHeight = c.maxHeight;
  // Per-column alignment: normalize via the renderer's own alignValue (no
  // drift), drop trailing unset slots, emit only if something is set.
  if (Array.isArray(c.align)) {
    const a = c.align.map(v => ccc().alignValue(v));
    while (a.length && !a[a.length - 1]) a.pop();
    if (a.some(Boolean)) out.align = a.map(v => v || null);
  }
  // Column dividers: unique, sorted grid-column indices.
  if (Array.isArray(c.colDividers) && c.colDividers.length) {
    out.colDividers = [...new Set(c.colDividers.map(Number))].sort((x, y) => x - y);
  }
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Footnotes field: one <p> per line — the same shape the renderer gives
   inline-array footnotes. No bullet list: real tables mix symbol markers
   (*, **, †) with plain notes, and the CMS paste kept the <ul> tags as
   unstyled noise anyway. */
export function footnotesHTML(state) {
  const lines = (state.footnotes || []).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return lines.map(l => '<p>' + esc(l) + '</p>').join('');
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
  if (state.rows.some(r => r.group && r.cells.length > 1)) {
    return json('a group row keeps extra cells (renderer ≥ 0.3 renders them)');
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

/* The four CMS field values exactly as the copy boxes emit them. The import
   baseline and every later render go through this one function, so "changed"
   compares builder output to builder output — never to the raw CMS text, whose
   formatting (TSV vs JSON, key order, false-valued defaults) can legitimately
   differ from what the builder would write for the same table. */
export function fieldValues(state) {
  return {
    data: dataFieldValue(state).value,
    caption: captionText(state),
    footnotes: footnotesHTML(state),
    config: configJSON(state),
  };
}

/* CMS Footnotes field → builder lines. Accepts the RichText HTML (<p>, <br>,
   inline tags) or the plain text a copy out of the Webflow editor yields (one
   paragraph per line, sometimes blank-line separated). */
export function footnotesFromCms(text) {
  let t = String(text || '');
  if (/<\s*(p|br|div|li|em|strong|span)\b/i.test(t)) {
    t = t.replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return t.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
}

/* CMS Config field → object, or null when the box is empty. Throws a message
   meant for an editor, not a developer. */
export function configFromCms(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let obj;
  try { obj = JSON.parse(t); } catch (e) {
    throw new Error('the Config box isn’t valid JSON — copy the whole Config field, including the { } braces');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('the Config box should hold one { … } object');
  }
  return obj;
}

/* A friendlier message when a pasted Data blob won't parse. The common
   mistake: pasting the Config field onto the end of the Data field. */
export function dataErrorHint(text, err) {
  const t = String(text || '').trim();
  if (t.charAt(0) === '{' && /\}\s*\{/.test(t)) {
    return 'that looks like two JSON objects — paste the Config field into the Config box below, not after the Data';
  }
  return err && err.message ? err.message : String(err);
}

/* Import: the four CMS fields → builder state. Data is required; the other
   three are optional and, when filled, win over anything a legacy one-chunk
   JSON Data blob carried. configProvided records whether the table's CMS
   Config actually came in — without it, a Config-changing click would emit a
   Config that REPLACES the table's live options instead of editing them. */
export function stateFromCms({ data, caption, footnotes, config } = {}) {
  const sniff = String(data || '').trim();
  if (!sniff) throw new Error('paste the table’s Data field first');
  const cfg = configFromCms(config);
  let parsed;
  try {
    // JSON blobs go through the real parser; pasted ranges go through the
    // Excel-clipboard parser (quoted multiline cells arrive as ONE cell) —
    // except when the imported Config turns TSV group detection off, which
    // only the renderer's own parseTSV honours (CMS TSV never has quoting).
    parsed = sniff.charAt(0) === '{'
      ? ccc().parseData(sniff)
      : cfg && cfg.tsvGroups === false
        ? ccc().parseData(String(data), cfg)
        : gridToParsed(parseExcelClipboard(String(data)));
  } catch (e) {
    throw new Error(dataErrorHint(sniff, e));
  }
  const legacyConfig = !!(parsed.config && typeof parsed.config === 'object');
  const state = fromParsed(parsed);
  if (String(caption || '').trim()) state.caption = String(caption).trim();
  if (String(footnotes || '').trim()) state.footnotes = footnotesFromCms(footnotes);
  if (cfg) state.config = { ...cfg };
  return { state, configProvided: !!cfg || legacyConfig };
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

/* Mirrors the renderer's mobile-switcher guard: the switcher is inert when
   body rows (or group rows keeping extra cells) contain merged cells — it
   can't show/hide part of a span. */
export function switcherInert(state) {
  return state.rows.some(r => {
    if (r.group && r.cells.length < 2) return false;
    return r.cells.some(c => c.colspan > 1 || c.rowspan > 1);
  });
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
