import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.cccTables = require('../ccc-tables.js');
const ccc = globalThis.cccTables;

const { fromParsed } = await import('../builder/model.js');
const ser = await import('../builder/serialize.js');
const { toJSONData, configJSON, footnotesHTML, captionText, validate } = ser;

// ---------- Task 4: JSON / config / footnotes / caption ----------

test('toJSONData: columns form for a single spanless header row, minimal cell keys', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }],
    rows: [
      { group: true, cells: [{ text: 'G' }] },
      { cells: [{ text: 'x', colspan: 1, header: false }, { text: 'y', header: true }] },
    ],
  });
  const d = JSON.parse(toJSONData(s));
  assert.deepEqual(d, {
    columns: [{ text: '' }, { text: 'A' }],
    rows: [
      { group: true, cells: [{ text: 'G' }] },
      { cells: [{ text: 'x' }, { text: 'y', header: true }] },
    ],
  });
  assert.ok(!('caption' in d) && !('config' in d) && !('footnotes' in d)); // split-field model
});

test('toJSONData: headerRows form when the header has spans or multiple rows', () => {
  const s = fromParsed({
    headerRows: [
      { cells: [{ text: '', rowspan: 2 }, { text: 'T1', colspan: 2 }] },
      { cells: [{ text: 'You' }, { text: 'Family' }] },
    ],
    rows: [{ cells: [{ text: 'P' }, { text: '$1' }, { text: '$2' }] }],
  });
  const d = JSON.parse(toJSONData(s));
  assert.ok(!d.columns);
  assert.equal(d.headerRows.length, 2);
  assert.equal(d.headerRows[0].cells[1].colspan, 2);
});

test('configJSON: non-defaults only; empty config → empty string', () => {
  const s = fromParsed({ columns: [{ text: 'A' }, { text: 'B' }], rows: [] });
  assert.equal(configJSON(s), '');
  s.config = { stickyFirstCol: true, collapsibleGroups: false, mobileSwitcher: true, tsvGroups: true, highlightCol: 2 };
  assert.deepEqual(JSON.parse(configJSON(s)), { stickyFirstCol: true, mobileSwitcher: true, highlightCol: 2 });
  s.config = { tsvGroups: false };
  assert.deepEqual(JSON.parse(configJSON(s)), { tsvGroups: false });
});

test('footnotesHTML: escaped <ul>, empty when no lines', () => {
  const s = fromParsed({ columns: [{ text: 'A' }, { text: 'B' }], rows: [] });
  assert.equal(footnotesHTML(s), '');
  s.footnotes = ['* Rates are biweekly.', 'Tobacco & <spouse> rule'];
  assert.equal(
    footnotesHTML(s),
    '<ul><li>* Rates are biweekly.</li><li>Tobacco &amp; &lt;spouse&gt; rule</li></ul>'
  );
});

test('captionText trims', () => {
  const s = fromParsed({ columns: [{ text: 'A' }, { text: 'B' }], rows: [] });
  s.caption = '  2027 Medical Premiums ';
  assert.equal(captionText(s), '2027 Medical Premiums');
});

test('validate: clean state has no errors; short row warns; emitted Data must re-parse', () => {
  const s = fromParsed(ccc.parseTSV('\tA\tB\nDeductible\t$1\t$2'));
  const clean = validate(s);
  assert.deepEqual(clean.errors, []);
  assert.deepEqual(clean.warnings, []);
  s.rows.push({ cells: [{ text: 'short' }, { text: 'x' }] }); // 2 of 3 cols
  const v = validate(s);
  assert.equal(v.errors.length, 0);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /row 2/i);
});

test('validate: round-trip — parseData(toJSONData) grid-equals the state', () => {
  const s = fromParsed({
    headerRows: [{ cells: [{ text: '' }, { text: 'A', colspan: 2 }] }],
    rows: [{ cells: [{ text: 'x' }, { text: 'y' }, { text: 'z' }] }],
  });
  const re = fromParsed(ccc.parseData(toJSONData(s)));
  assert.deepEqual(re.headerRows, s.headerRows);
  assert.deepEqual(re.rows, s.rows);
});

// ---------- Task 5: TSV export + representability + dataFieldValue ----------

const { toTSV, dataFieldValue } = ser;

test('toTSV + round-trip: a plain grouped rate table routes to TSV', () => {
  const src = '\tHSA Core\tHSA Value\nIn-network\nDeductible\t$1,500\t$500\nCoinsurance\t20%\t10%';
  const s = fromParsed(ccc.parseTSV(src));
  const out = dataFieldValue(s);
  assert.equal(out.format, 'tsv');
  const re = fromParsed(ccc.parseData(out.value, s.config));
  assert.deepEqual(re.headerRows, s.headerRows);
  assert.deepEqual(re.rows, s.rows);
  assert.match(out.value, /^\tHSA Core\tHSA Value\n/); // leading empty header cell kept
  assert.match(out.value, /\nIn-network\n/);           // group row = bare label line
});

test('dataFieldValue: merged cells route to JSON with a reason', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'wide', colspan: 2 }, { text: 'b' }] }],
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /merged/i);
  assert.ok(JSON.parse(out.value).rows);
});

test('dataFieldValue: multi-row header routes to JSON with a reason', () => {
  const s = fromParsed({
    headerRows: [{ cells: [{ text: 'A' }, { text: 'B' }] }, { cells: [{ text: 'C' }, { text: 'D' }] }],
    rows: [{ cells: [{ text: '1' }, { text: '2' }] }],
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /multi-row header/i);
});

test('dataFieldValue: header flag on a body cell routes to JSON', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }],
    rows: [{ cells: [{ text: 'x' }, { text: 'y', header: true }] }],
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /header/i);
});

test('dataFieldValue: a row that would re-parse as a group row routes to JSON', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'filled' }, { text: '' }, { text: '' }] }], // NOT a group row
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /group/i);
});

test('dataFieldValue: group misdetection is fine when tsvGroups is off', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'filled' }, { text: '' }, { text: '' }] }],
  });
  s.config = { tsvGroups: false };
  assert.equal(dataFieldValue(s).format, 'tsv');
});

test('dataFieldValue: tab or newline in a cell routes to JSON', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }],
    rows: [{ cells: [{ text: 'two\nlines' }, { text: 'y' }] }],
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /line break|tab/i);
});

test('dataFieldValue: text the TSV parser would trim routes to JSON', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }],
    rows: [{ cells: [{ text: ' padded ' }, { text: 'y' }] }],
  });
  assert.equal(dataFieldValue(s).format, 'json');
});
