import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.cccTables = require('../ccc-tables.js');
const ccc = globalThis.cccTables;

const model = await import('../builder/model.js');
const { blankState, fromParsed, colCount } = model;

// ---------- Task 1: state factory + import normalization ----------

test('blankState: 2×2 empty grid, empty extras', () => {
  const s = blankState();
  assert.equal(s.headerRows.length, 1);
  assert.equal(s.headerRows[0].cells.length, 2);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].cells.length, 2);
  assert.equal(s.caption, '');
  assert.deepEqual(s.footnotes, []);
  assert.deepEqual(s.config, {});
});

test('fromParsed: TSV parse normalizes columns to a single header row, keeps groups', () => {
  const parsed = ccc.parseTSV('\tHSA Core\tHSA Value\nIn-network\nDeductible\t$1,500\t$500');
  const s = fromParsed(parsed);
  assert.equal(s.headerRows.length, 1);
  assert.deepEqual(s.headerRows[0].cells.map(c => c.text), ['', 'HSA Core', 'HSA Value']);
  assert.equal(s.rows[0].group, true);
  assert.deepEqual(s.rows[0].cells, [{ text: 'In-network' }]);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['Deductible', '$1,500', '$500']);
});

test('fromParsed: v0.1 inline JSON carries caption/footnotes/config and headerRows', () => {
  const parsed = ccc.parseData(JSON.stringify({
    caption: 'Inline cap',
    headerRows: [
      { cells: [{ text: '', rowspan: 2 }, { text: 'Tier 1', colspan: 2 }, { text: 'Tier 2' }] },
      { cells: [{ text: 'You' }, { text: 'Family' }, { text: 'All' }] },
    ],
    rows: [{ cells: [{ text: 'Premium' }, { text: '$40' }, { text: '$120' }, { text: '$200' }] }],
    footnotes: ['^1 note'],
    config: { highlightCol: 1 },
  }));
  const s = fromParsed(parsed);
  assert.equal(s.caption, 'Inline cap');
  assert.deepEqual(s.footnotes, ['^1 note']);
  assert.deepEqual(s.config, { highlightCol: 1 });
  assert.equal(s.headerRows.length, 2);
  assert.equal(s.headerRows[0].cells[1].colspan, 2);
  assert.equal(s.headerRows[0].cells[0].rowspan, 2);
});

test('fromParsed: strips span=1 and falsy header flags to minimal cells', () => {
  const s = fromParsed({
    columns: [{ text: 'A', colspan: 1 }, { text: 'B' }],
    rows: [{ cells: [{ text: 'x', header: false, rowspan: 1 }, { text: 'y', header: true }] }],
  });
  assert.deepEqual(s.headerRows[0].cells, [{ text: 'A' }, { text: 'B' }]);
  assert.deepEqual(s.rows[0].cells, [{ text: 'x' }, { text: 'y', header: true }]);
});

test('colCount: resolved width of a spanned multi-row header', () => {
  const s = fromParsed({
    headerRows: [
      { cells: [{ text: '', rowspan: 2 }, { text: 'T1', colspan: 2 }, { text: 'T2' }] },
      { cells: [{ text: 'You' }, { text: 'Family' }, { text: 'All' }] },
    ],
    rows: [],
  });
  assert.equal(colCount(s), 4);
});

// ---------- Task 2: cell/row/column ops ----------

const { setCell, addRow, deleteRow, moveRow, toggleGroup, addColAfter, deleteCol } = model;

function rate3() {
  // 3 grid cols: label + 2 plans, one group row, two data rows
  return fromParsed(ccc.parseTSV('\tA\tB\nIn-network\nDeductible\t$1\t$2\nCoinsurance\t20%\t10%'));
}

test('setCell: writes text in header and body sections', () => {
  const s = rate3();
  setCell(s, 'header', 0, 1, 'Plan A');
  setCell(s, 'body', 1, 2, '$9');
  assert.equal(s.headerRows[0].cells[1].text, 'Plan A');
  assert.equal(s.rows[1].cells[2].text, '$9');
});

test('addRow/deleteRow/moveRow', () => {
  const s = rate3();
  addRow(s, 1);
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['', '', '']);
  moveRow(s, 1, 3);
  assert.equal(s.rows[3].cells[0].text, '');
  deleteRow(s, 3);
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[0].group, true);
});

test('toggleGroup: normal→group PRESERVES cells (trailing empties trimmed); group→normal pads', () => {
  const s = rate3();
  toggleGroup(s, 1); // ['Deductible','$1','$2'] — data kept
  assert.equal(s.rows[1].group, true);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['Deductible', '$1', '$2']);
  toggleGroup(s, 1); // back to a normal row, nothing lost
  assert.ok(!s.rows[1].group);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['Deductible', '$1', '$2']);
  toggleGroup(s, 0); // imported label-only group → ungroup pads
  assert.ok(!s.rows[0].group);
  assert.deepEqual(s.rows[0].cells.map(c => c.text), ['In-network', '', '']);
  s.rows[2].cells[1].text = ''; s.rows[2].cells[2].text = '';
  toggleGroup(s, 2); // all-empty tail is trimmed → label-only group
  assert.deepEqual(s.rows[2].cells, [{ text: 'Coinsurance' }]);
});

test('addColAfter: inserts a cell in plain rows, grows a spanning cell, skips group rows', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [
      { group: true, cells: [{ text: 'G' }] },
      { cells: [{ text: 'wide', colspan: 2 }, { text: 'b' }] },
      { cells: [{ text: 'x' }, { text: 'y' }, { text: 'z' }] },
    ],
  });
  addColAfter(s, 0); // boundary 0|1 sits inside the colspan-2 cell
  assert.deepEqual(s.headerRows[0].cells.map(c => c.text), ['', '', 'A', 'B']);
  assert.equal(s.rows[1].cells[0].colspan, 3); // span grew across the insertion
  assert.equal(s.rows[1].cells.length, 2);
  assert.deepEqual(s.rows[2].cells.map(c => c.text), ['x', '', 'y', 'z']);
  assert.deepEqual(s.rows[0].cells, [{ text: 'G' }]); // group untouched
  assert.equal(colCount(s), 4);
});

test('deleteCol: removes span-1 cells, shrinks covering spans, refuses below 2 columns', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [
      { cells: [{ text: 'wide', colspan: 2 }, { text: 'b' }] },
      { cells: [{ text: 'x' }, { text: 'y' }, { text: 'z' }] },
    ],
  });
  deleteCol(s, 1);
  assert.deepEqual(s.headerRows[0].cells.map(c => c.text), ['', 'B']);
  assert.equal(s.rows[0].cells.length, 2);
  assert.ok(!s.rows[0].cells[0].colspan); // 2 → 1 → key dropped
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['x', 'z']);
  deleteCol(s, 1);
  assert.equal(colCount(s), 2); // refused — still 2 columns
});

// ---------- Task 3: merge/unmerge + header promote/demote ----------

const { gridRect, mergeCells, unmergeCell, promoteRowToHeader, demoteHeaderRow } = model;

function plain33() {
  return fromParsed({
    columns: [{ text: 'H0' }, { text: 'H1' }, { text: 'H2' }],
    rows: [
      { cells: [{ text: 'a0' }, { text: 'a1' }, { text: 'a2' }] },
      { cells: [{ text: 'b0' }, { text: 'b1' }, { text: 'b2' }] },
      { cells: [{ text: 'c0' }, { text: 'c1' }, { text: 'c2' }] },
    ],
  });
}

test('mergeCells: 2×2 merge sets spans on the anchor, removes covered cells, keeps text', () => {
  const s = plain33();
  assert.equal(mergeCells(s, 'body', [0, 1], [1, 2]), true);
  assert.equal(s.rows[0].cells.length, 2);
  assert.deepEqual(s.rows[0].cells[1], { text: 'a1\na2\nb1\nb2', colspan: 2, rowspan: 2 });
  assert.equal(s.rows[1].cells.length, 1); // only b0 left
  // grid still resolves cleanly: full rows are 3 wide, the covered row's
  // lone cell sits at col 0 with cols 1–2 carried by the rowspan
  const placed = ccc.resolveGrid(s.rows);
  const width = row => row.reduce((m, p) => Math.max(m, p.col + p.span), 0);
  assert.equal(width(placed[0]), 3);
  assert.equal(width(placed[2]), 3);
  assert.equal(placed[1].length, 1);
  assert.equal(placed[1][0].col, 0);
});

test('unmergeCell: restores a uniform grid of empty cells', () => {
  const s = plain33();
  mergeCells(s, 'body', [0, 1], [1, 2]);
  unmergeCell(s, 'body', 0, 1);
  assert.equal(s.rows[0].cells.length, 3);
  assert.equal(s.rows[1].cells.length, 3);
  assert.ok(!s.rows[0].cells[1].colspan && !s.rows[0].cells[1].rowspan);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['b0', '', '']);
});

test('gridRect: refuses a rectangle that cuts a spanning cell', () => {
  const s = plain33();
  mergeCells(s, 'body', [0, 1], [0, 2]); // a1 now colspan 2
  const v = gridRect(s, 'body', [0, 0], [0, 1]); // would cut the span
  assert.equal(v.ok, false);
  assert.equal(mergeCells(s, 'body', [0, 0], [0, 1]), false);
});

test('gridRect: refuses rectangles containing a group row', () => {
  const s = rate3();
  assert.equal(gridRect(s, 'body', [0, 0], [1, 1]).ok, false);
});

test('promote/demote header rows round-trip; demote refuses at one header row', () => {
  const s = plain33();
  assert.equal(demoteHeaderRow(s), false);
  assert.equal(promoteRowToHeader(s), true);
  assert.equal(s.headerRows.length, 2);
  assert.equal(s.headerRows[1].cells[0].text, 'a0');
  assert.equal(s.rows.length, 2);
  assert.equal(demoteHeaderRow(s), true);
  assert.equal(s.headerRows.length, 1);
  assert.equal(s.rows[0].cells[0].text, 'a0');
  assert.equal(s.rows.length, 3);
});

test('promoteRowToHeader refuses a group row', () => {
  const s = rate3();
  assert.equal(promoteRowToHeader(s), false);
});

// ---------- moveCol + insert-before-first ----------

const { moveCol } = model;

test('addColAfter(-1): inserts a new first column', () => {
  const s = plain33();
  addColAfter(s, -1);
  assert.deepEqual(s.headerRows[0].cells.map(c => c.text), ['', 'H0', 'H1', 'H2']);
  assert.deepEqual(s.rows[0].cells.map(c => c.text), ['', 'a0', 'a1', 'a2']);
  assert.equal(colCount(s), 4);
});

test('moveCol: swaps adjacent columns in header and body, skips group rows', () => {
  const s = rate3();
  assert.equal(moveCol(s, 1, 1), true); // A ↔ B
  assert.deepEqual(s.headerRows[0].cells.map(c => c.text), ['', 'B', 'A']);
  assert.deepEqual(s.rows[1].cells.map(c => c.text), ['Deductible', '$2', '$1']);
  assert.deepEqual(s.rows[0].cells, [{ text: 'In-network' }]); // group untouched
  assert.equal(moveCol(s, 2, 1), false); // off the edge
});

test('moveCol: refuses when a span crosses the boundary', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'wide', colspan: 2 }, { text: 'b' }] }],
  });
  assert.equal(moveCol(s, 0, 1), false);
  assert.equal(moveCol(s, 1, 1), false); // 'wide' covers col 1; boundary 1|2 touches it
});
