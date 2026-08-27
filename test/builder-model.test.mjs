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
