import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.cccTables = require('../ccc-tables.js');
const ccc = globalThis.cccTables;

const { fromParsed } = await import('../builder/model.js');
const { rowWidthIssues } = await import('../builder/serialize.js');
const L = await import('../builder/logic.js');

const table = (tsv, extra = {}) => Object.assign(fromParsed(ccc.parseData(tsv)), extra);
const TSV = '\tA\tB\nGroup\nRow one\t$1^1\t[check]\nRow two\t$2\t$3';

test('supports: gates by release, local/unknown count as newest', () => {
  assert.equal(L.supports('0.5.0', 'align'), false);
  assert.equal(L.supports('0.6.0', 'align'), true);
  assert.equal(L.supports('0.6.2', 'maxHeight'), true);
  assert.equal(L.supports('0.6.1', 'maxHeight'), false);
  assert.equal(L.supports('local', 'maxHeight'), true);
  assert.equal(L.supports('0.2.0', 'not-a-feature'), true);
  assert.match(L.gateReason('0.5.0', 'align'), /0\.6\.0 or later — this site uses 0\.5\.0/);
});

test('featuresUsed / compatNotes: only features the table actually uses, only when missing', () => {
  const s = table(TSV);
  assert.deepEqual([...L.featuresUsed(s)], []);
  s.config = { align: [null, 'center'], colDividers: [2] };
  s.rows[1].cells[0].text = 'Row one [reg:(note)]';
  assert.deepEqual([...L.featuresUsed(s)].sort(), ['align', 'colDividers', 'softToken']);
  assert.equal(L.compatNotes(s, '0.6.2').length, 0);
  assert.equal(L.compatNotes(s, '0.5.0').length, 2);   // align + dividers; [reg:] is 0.5
  assert.equal(L.compatNotes(s, '0.4.1').length, 3);
  assert.match(L.compatNotes(s, '0.5.0')[0], /needs renderer 0\.6\.0, so 0\.5\.0 ignores it/);
});

test('featuresUsed: tokens in headings and merged cells under the switcher', () => {
  const s = table('\t[check] A\tB\nx\t1\t2');
  assert.ok(L.featuresUsed(s).has('headerTokens'));
  s.rows[0].cells = [{ text: 'x' }, { text: '1', colspan: 2 }];
  assert.ok(!L.featuresUsed(s).has('switcherSpans'));
  s.config.mobileSwitcher = true;
  assert.ok(L.featuresUsed(s).has('switcherSpans'));
});

test('publishValues never includes footnotes', () => {
  const s = table(TSV, { caption: 'Title', footnotes: ['^1 After deductible.'] });
  assert.deepEqual(Object.keys(L.publishValues(s)), ['data', 'title', 'config']);
  assert.equal(L.publishValues(s).title, 'Title');
});

test('publishPlan: new table pastes non-empty fields only', () => {
  const s = table(TSV, { caption: 'T' });
  const plan = L.publishPlan(s, null);
  assert.deepEqual(plan.map(p => p.status), ['new', 'new', 'empty']);
  assert.equal(L.toPasteCount(plan), 2);
});

test('publishPlan: changed / same / clear against the import baseline', () => {
  const s = table(TSV, { caption: 'T', config: { stickyFirstCol: true } });
  const base = L.publishValues(s);
  assert.equal(L.toPasteCount(L.publishPlan(s, base)), 0);
  s.config.highlightCol = 1;
  s.caption = '';
  const plan = L.publishPlan(s, base);
  assert.deepEqual(plan.map(p => p.status), ['same', 'clear', 'changed']);
  assert.equal(L.toPasteCount(plan), 2);
});

test('markersUsed / markersMissing', () => {
  const s = table('\tA\nx\t$1^1 and ^*\ny\t^2');
  assert.deepEqual(L.markersUsed(s), ['1', '*', '2']);
  assert.deepEqual(L.markersMissing(s), []);                 // no preview footnotes → no check
  s.footnotes = ['^1 One.', '* Star.', '12 Not two.'];
  assert.deepEqual(L.markersMissing(s), ['2']);
  s.footnotes.push('2. Two.');
  assert.deepEqual(L.markersMissing(s), []);
  s.footnotes = ['** Double star only.'];
  assert.deepEqual(L.markersMissing(s), ['1', '*', '2']);
});

test('colLetter / cellName', () => {
  assert.equal(L.colLetter(0), 'A');
  assert.equal(L.colLetter(25), 'Z');
  assert.equal(L.colLetter(26), 'AA');
  assert.equal(L.cellName('body', 2, 1, 1), 'B3');
  assert.equal(L.cellName('header', 0, 2, 1), 'heading C');
  assert.equal(L.cellName('header', 1, 2, 2), 'heading C (header row 2)');
});

test('rowWidthIssues: zero-based rows, rowspans carried', () => {
  const s = table('\tA\tB\nx\t1\t2\ny\t3');
  assert.deepEqual(rowWidthIssues(s), [{ row: 1, covered: 2, want: 3 }]);
  s.rows[0].cells[1].rowspan = 2;
  assert.deepEqual(rowWidthIssues(s), []);
});

test('firstColLabels: gated at 0.7.0, tracked as used, emitted only when off', () => {
  const s = table(TSV);
  assert.ok(!L.publishValues(s).config.includes('firstColLabels'));
  s.config.firstColLabels = false;
  assert.ok(L.featuresUsed(s).has('firstColLabels'));
  assert.equal(L.supports('0.6.2', 'firstColLabels'), false);
  assert.equal(L.supports('local', 'firstColLabels'), true);
  assert.match(L.publishValues(s).config, /"firstColLabels":false/);
  assert.equal(L.compatNotes(s, '0.6.2').length, 1);
  assert.match(L.compatNotes(s, '0.6.2')[0], /needs renderer 0\.7\.0/);
});
