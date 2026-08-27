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

/* Grid occupancy for one section: occ[r][gridCol] = the owning cell record
   ({ originRow, cell, col, span }), rowspans expanded downward. Derived from
   the renderer's own resolveGrid so placement semantics can't drift. */
function occupancy(rowsArr) {
  const placedRows = ccc().resolveGrid(rowsArr);
  const occ = placedRows.map(() => []);
  placedRows.forEach((placed, r) => {
    placed.forEach(p => {
      const rs = p.cell.rowspan || 1;
      for (let rr = r; rr < Math.min(r + rs, occ.length); rr++) {
        for (let cc = p.col; cc < p.col + p.span; cc++) {
          occ[rr][cc] = { originRow: r, cell: p.cell, col: p.col, span: p.span };
        }
      }
    });
  });
  return { occ, placedRows };
}

export function setCell(state, section, r, c, text) {
  const row = section === 'header' ? state.headerRows[r] : state.rows[r];
  if (row && row.cells[c]) row.cells[c].text = text;
  return state;
}

export function addRow(state, at) {
  const cells = [];
  for (let i = 0; i < colCount(state); i++) cells.push({ text: '' });
  state.rows.splice(at, 0, { cells });
  return state;
}

export function deleteRow(state, at) {
  state.rows.splice(at, 1);
  return state;
}

export function moveRow(state, from, to) {
  const [row] = state.rows.splice(from, 1);
  state.rows.splice(to, 0, row);
  return state;
}

export function toggleGroup(state, r) {
  const row = state.rows[r];
  if (!row) return state;
  if (row.group) {
    delete row.group;
    const cells = [{ text: (row.cells[0] || {}).text || '' }];
    while (cells.length < colCount(state)) cells.push({ text: '' });
    row.cells = cells;
  } else {
    row.group = true;
    row.cells = [{ text: (row.cells[0] || {}).text || '' }];
  }
  return state;
}

/* Insert a new grid column after absolute column k, in one section. A cell
   spanning the k|k+1 boundary stretches (once, at its origin row); every
   other row gains an empty cell at the boundary. Group rows are untouched. */
function insertColInSection(rowsArr, k, isBody) {
  const { occ, placedRows } = occupancy(rowsArr);
  rowsArr.forEach((row, r) => {
    if (isBody && row.group) return;
    const left = occ[r][k], right = occ[r][k + 1];
    if (left && right && left.cell === right.cell) {
      if (left.originRow === r) left.cell.colspan = (left.cell.colspan || 1) + 1;
      return;
    }
    let idx = placedRows[r].findIndex(p => p.col > k);
    if (idx === -1) idx = row.cells.length;
    row.cells.splice(idx, 0, { text: '' });
  });
}

export function addColAfter(state, k) {
  insertColInSection(state.headerRows, k, false);
  insertColInSection(state.rows, k, true);
  return state;
}

/* Delete absolute grid column k in one section: a span-1 cell at k is
   removed, a covering span shrinks (once, at its origin row). */
function deleteColInSection(rowsArr, k, isBody) {
  const { occ } = occupancy(rowsArr);
  rowsArr.forEach((row, r) => {
    if (isBody && row.group) return;
    const owner = occ[r][k];
    if (!owner || owner.originRow !== r) return;
    if (owner.span > 1) {
      owner.cell.colspan = owner.span - 1;
      if (owner.cell.colspan <= 1) delete owner.cell.colspan;
    } else {
      row.cells.splice(row.cells.indexOf(owner.cell), 1);
    }
  });
}

export function deleteCol(state, k) {
  if (colCount(state) <= 2) return state;
  deleteColInSection(state.headerRows, k, false);
  deleteColInSection(state.rows, k, true);
  return state;
}
