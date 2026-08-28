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
    // pad to the grid width by RESOLVED width — a group row that kept
    // spanning cells already covers more columns than it has cells
    const width = () =>
      ccc().resolveGrid([row])[0].reduce((m, p) => Math.max(m, p.col + p.span), 0);
    while (width() < colCount(state)) row.cells.push({ text: '' });
  } else {
    row.group = true;
    // Keep the row's data — renderer ≥ 0.3 renders a group row's extra cells;
    // older renderers show just the label. Only a trailing run of empty
    // span-1 cells is trimmed so a plain label row stays label-only.
    let n = row.cells.length;
    while (n > 1) {
      const c = row.cells[n - 1];
      if (c.text || c.colspan > 1 || c.rowspan > 1) break;
      n--;
    }
    row.cells.length = n;
  }
  return state;
}

/* Swap grid column k with its neighbor (dir = ±1). Refuses when a spanning
   cell touches either column — split merges first. Group rows keep their own
   layout and are skipped. */
export function moveCol(state, k, dir) {
  const to = k + dir;
  const n = colCount(state);
  if (k < 0 || to < 0 || k >= n || to >= n) return false;
  const lo = Math.min(k, to);
  const sections = [
    { rowsArr: state.headerRows, isBody: false },
    { rowsArr: state.rows, isBody: true },
  ];
  for (const { rowsArr, isBody } of sections) {
    const { occ } = occupancy(rowsArr);
    for (let r = 0; r < rowsArr.length; r++) {
      if (isBody && rowsArr[r].group) continue;
      for (const cc of [lo, lo + 1]) {
        const o = occ[r][cc];
        if (o && (o.span > 1 || (o.cell.rowspan || 1) > 1)) return false;
      }
    }
  }
  for (const { rowsArr, isBody } of sections) {
    const { placedRows } = occupancy(rowsArr);
    rowsArr.forEach((row, r) => {
      if (isBody && row.group) return;
      const a = placedRows[r].find(p => p.col === lo);
      const b = placedRows[r].find(p => p.col === lo + 1);
      if (a && b) {
        const ia = row.cells.indexOf(a.cell), ib = row.cells.indexOf(b.cell);
        row.cells[ia] = b.cell;
        row.cells[ib] = a.cell;
      } else if (a && !b) {
        // underfilled row: the moving cell shifts right past an implicit empty
        row.cells.splice(row.cells.indexOf(a.cell), 0, { text: '' });
      }
    });
  }
  return true;
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

/* Validate a merge rectangle in grid coordinates [r,c]..[r,c]: every cell it
   touches must lie entirely inside it, no group rows, no empty grid slots. */
export function gridRect(state, section, a, b) {
  const rowsArr = section === 'header' ? state.headerRows : state.rows;
  const r1 = Math.min(a[0], b[0]), r2 = Math.max(a[0], b[0]);
  const c1 = Math.min(a[1], b[1]), c2 = Math.max(a[1], b[1]);
  if (r2 >= rowsArr.length) return { ok: false, reason: 'out of range' };
  for (let r = r1; r <= r2; r++) {
    if (section === 'body' && rowsArr[r].group) return { ok: false, reason: 'contains a group row' };
  }
  const { occ } = occupancy(rowsArr);
  const owners = new Map(); // cell → its occupancy record
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const o = occ[r][c];
      if (!o) return { ok: false, reason: 'covers an empty grid slot' };
      owners.set(o.cell, o);
    }
  }
  for (const o of owners.values()) {
    const rs = o.cell.rowspan || 1;
    if (o.col < c1 || o.col + o.span - 1 > c2 || o.originRow < r1 || o.originRow + rs - 1 > r2) {
      return { ok: false, reason: 'cuts across a spanning cell' };
    }
  }
  return { ok: true, owners, r1, r2, c1, c2 };
}

/* Merge the rectangle into its top-left cell; covered non-empty texts are
   kept, newline-joined, on the anchor. Returns false when the rect is invalid. */
export function mergeCells(state, section, a, b) {
  const v = gridRect(state, section, a, b);
  if (!v.ok) return false;
  const rowsArr = section === 'header' ? state.headerRows : state.rows;
  const { occ } = occupancy(rowsArr);
  const anchor = occ[v.r1][v.c1].cell;
  const recs = [...v.owners.values()].sort((x, y) => x.originRow - y.originRow || x.col - y.col);
  const texts = [];
  recs.forEach(o => {
    if (o.cell.text) texts.push(o.cell.text);
    if (o.cell !== anchor) {
      const row = rowsArr[o.originRow];
      row.cells.splice(row.cells.indexOf(o.cell), 1);
    }
  });
  anchor.text = texts.join('\n');
  if (v.c2 - v.c1 > 0) anchor.colspan = v.c2 - v.c1 + 1; else delete anchor.colspan;
  if (v.r2 - v.r1 > 0) anchor.rowspan = v.r2 - v.r1 + 1; else delete anchor.rowspan;
  return true;
}

/* Split a spanning cell back into span-1 cells (the freed slots come back empty). */
export function unmergeCell(state, section, r, cIdx) {
  const rowsArr = section === 'header' ? state.headerRows : state.rows;
  const row = rowsArr[r];
  const cell = row && row.cells[cIdx];
  if (!cell) return false;
  const cs = cell.colspan || 1, rs = cell.rowspan || 1;
  if (cs === 1 && rs === 1) return false;
  const { placedRows } = occupancy(rowsArr);
  const rec = placedRows[r].find(p => p.cell === cell);
  delete cell.colspan;
  delete cell.rowspan;
  for (let i = 1; i < cs; i++) row.cells.splice(cIdx + i, 0, { text: '' });
  for (let rr = r + 1; rr < Math.min(r + rs, rowsArr.length); rr++) {
    const target = rowsArr[rr];
    if (target.group) continue;
    let idx = placedRows[rr].findIndex(p => p.col > rec.col);
    if (idx === -1) idx = target.cells.length;
    target.cells.splice(idx, 0, ...Array.from({ length: cs }, () => ({ text: '' })));
  }
  return true;
}

/* Multi-row headers: move the first body row up / the last header row down. */
export function promoteRowToHeader(state) {
  const row = state.rows[0];
  if (!row || row.group) return false;
  state.rows.shift();
  state.headerRows.push({
    cells: row.cells.map(c => { const o = { ...c }; delete o.header; return o; }),
  });
  return true;
}

export function demoteHeaderRow(state) {
  if (state.headerRows.length <= 1) return false;
  const row = state.headerRows.pop();
  state.rows.unshift({ cells: row.cells });
  return true;
}
