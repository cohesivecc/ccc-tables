/* builder/model.js — the builder's canonical table state + grid operations.
 *
 * Pure logic, node-testable. Grid placement (colspan/rowspan resolution) comes
 * from the renderer itself via globalThis.cccTables (the repo-local
 * ../ccc-tables.js in the browser; assigned by the test harness in node) so
 * builder math can never drift from renderer math.
 *
 * State shape (the renderer's JSON model, normalized):
 *   {
 *     caption: '',
 *     headerRows: [{ cells: [{ text, colspan?, rowspan? }] }],   // ≥ 1 row
 *     rows: [{ group?: true, cells: [{ text, colspan?, rowspan?, header? }] }],
 *     footnotes: [''],                                            // one per line
 *     config: {}
 *   }
 */

function ccc() { return globalThis.cccTables; }

/* Minimal cell: only text plus meaningful span/header keys. */
function cleanCell(c) {
  if (c == null) return { text: '' };
  if (typeof c !== 'object') return { text: String(c) };
  const out = { text: c.text != null ? String(c.text) : '' };
  if (c.colspan > 1) out.colspan = c.colspan;
  if (c.rowspan > 1) out.rowspan = c.rowspan;
  if (c.header) out.header = true;
  return out;
}

export function blankState() {
  return {
    caption: '',
    headerRows: [{ cells: [{ text: '' }, { text: '' }] }],
    rows: [{ cells: [{ text: '' }, { text: '' }] }],
    footnotes: [],
    config: {},
  };
}

/* Normalize a cccTables.parseData() result (TSV or JSON, v0.1 or v0.2 shaped)
   into builder state. */
export function fromParsed(parsed) {
  const s = blankState();
  s.headerRows = parsed.headerRows
    ? parsed.headerRows.map(r => ({ cells: (r.cells || []).map(cleanCell) }))
    : [{ cells: (parsed.columns || []).map(cleanCell) }];
  if (!s.headerRows.length) s.headerRows = [{ cells: [{ text: '' }] }];
  s.rows = (parsed.rows || []).map(r => {
    const row = { cells: (r.cells || []).map(cleanCell) };
    if (r.group) row.group = true;
    return row;
  });
  if (parsed.caption) s.caption = String(parsed.caption);
  if (Array.isArray(parsed.footnotes)) s.footnotes = parsed.footnotes.map(String);
  if (parsed.config && typeof parsed.config === 'object') s.config = { ...parsed.config };
  return s;
}

/* Resolved grid width of the header (same math as the renderer's buildTable). */
export function colCount(state) {
  const placed = ccc().resolveGrid(state.headerRows);
  const last = placed[placed.length - 1] || [];
  return last.reduce((m, p) => Math.max(m, p.col + p.span), 0);
}
