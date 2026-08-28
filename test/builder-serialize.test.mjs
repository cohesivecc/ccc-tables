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

test('footnotesHTML: escaped <p> lines, empty when no lines', () => {
  const s = fromParsed({ columns: [{ text: 'A' }, { text: 'B' }], rows: [] });
  assert.equal(footnotesHTML(s), '');
  s.footnotes = ['* Rates are biweekly.', 'Tobacco & <spouse> rule'];
  assert.equal(
    footnotesHTML(s),
    '<p>* Rates are biweekly.</p><p>Tobacco &amp; &lt;spouse&gt; rule</p>'
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

// ---------- Task 6: real-shape fixtures (synthetic values only) ----------

function roundTrip(s) {
  const out = dataFieldValue(s);
  const re = fromParsed(ccc.parseData(out.value, s.config));
  assert.deepEqual(re.headerRows, s.headerRows);
  assert.deepEqual(re.rows, s.rows);
  return out;
}

test('fixture: grouped 2-band × 4-tier rate table (medical shape) → TSV', () => {
  const s = fromParsed(ccc.parseData(JSON.stringify({
    columns: [{ text: 'Coverage Level' }, { text: 'Plan One' }, { text: 'Plan Two' }, { text: 'Plan Three' }],
    rows: [
      { group: true, cells: [{ text: 'Employees Who Earn Less Than $100,000' }] },
      { cells: [{ text: 'Employee Only' }, { text: '$10.00' }, { text: '$20.00' }, { text: '$30.00' }] },
      { cells: [{ text: 'Family' }, { text: '$40.00' }, { text: '$50.00' }, { text: '$60.00' }] },
      { group: true, cells: [{ text: 'Employees Who Earn More Than $100,000' }] },
      { cells: [{ text: 'Employee Only' }, { text: '$11.00' }, { text: '$21.00' }, { text: '$31.00' }] },
      { cells: [{ text: 'Family' }, { text: '$41.00' }, { text: '$51.00' }, { text: '$61.00' }] },
    ],
  })));
  s.config = { stickyFirstCol: true, collapsibleGroups: true, mobileSwitcher: true };
  assert.equal(roundTrip(s).format, 'tsv');
});

test('fixture: colspan comparison with header:true body cells (coverage-ends shape) → JSON', () => {
  const s = fromParsed(ccc.parseData(JSON.stringify({
    columns: [{ text: 'Benefit' }, { text: 'Leaving' }, { text: 'Retiring' }, { text: 'Status Change' }],
    rows: [
      { cells: [{ text: 'All medical plans', header: true }, { text: 'Coverage ends', colspan: 2 }, { text: '[check]' }] },
      { cells: [{ text: 'Dental', header: true }, { text: '[xmark]' }, { text: '[check]' }, { text: '[check]' }] },
    ],
  })));
  const out = roundTrip(s);
  assert.equal(out.format, 'json');
});

test('fixture: 2-row spanned header (demo shape) → JSON, multi-row header reason', () => {
  const s = fromParsed(ccc.parseData(JSON.stringify({
    headerRows: [
      { cells: [{ text: '', rowspan: 2 }, { text: 'Tier 1', colspan: 2 }, { text: 'Tier 2' }] },
      { cells: [{ text: 'You' }, { text: 'Family' }, { text: 'All' }] },
    ],
    rows: [{ cells: [{ text: 'Premium' }, { text: '$40' }, { text: '$120' }, { text: '$200' }] }],
  })));
  const out = roundTrip(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /multi-row header/);
});

// ---------- Excel-clipboard import (quoted multiline fields) ----------

const { parseExcelClipboard, gridToParsed } = ser;

test('parseExcelClipboard: plain TSV matches parseTSV cell-for-cell', () => {
  const src = '\tA\tB\nIn-network\nDeductible\t $1,500 \t$500';
  const grid = parseExcelClipboard(src);
  const viaRenderer = ccc.parseTSV(src);
  assert.deepEqual(grid[0], viaRenderer.columns.map(c => c.text));
  assert.deepEqual(grid[2], ['Deductible', '$1,500', '$500']); // trimmed like parseTSV
});

test('parseExcelClipboard: a quoted field keeps its embedded newline as ONE cell', () => {
  const src = 'Label\tValue\n"Out-of-Pocket Maximum (OOP)***\n(Medical & Rx combined)"\t$6,500';
  const grid = parseExcelClipboard(src);
  assert.equal(grid.length, 2);
  assert.equal(grid[1][0], 'Out-of-Pocket Maximum (OOP)***\n(Medical & Rx combined)');
  assert.equal(grid[1][1], '$6,500');
});

test('parseExcelClipboard: "" escapes a literal quote; quotes mid-field stay literal', () => {
  const grid = parseExcelClipboard('A\tB\n"say ""hi"""\t5"6');
  assert.equal(grid[1][0], 'say "hi"');
  assert.equal(grid[1][1], '5"6');
});

test('parseExcelClipboard: all-empty rows and trailing empty columns are dropped', () => {
  const grid = parseExcelClipboard('A\tB\t\nx\ty\t\n\t\t\nz\tw\t');
  assert.deepEqual(grid, [['A', 'B'], ['x', 'y'], ['z', 'w']]);
});

test('gridToParsed: group heuristic matches parseTSV', () => {
  const src = 'Plan\tA\tB\nIn-network\t\t\nDeductible\t$1\t$2';
  const ours = gridToParsed(parseExcelClipboard(src));
  const theirs = ccc.parseTSV(src);
  assert.deepEqual(ours, theirs);
});

test('excel paste with merged cells + multiline labels imports whole and routes to JSON', () => {
  // Synthetic mirror of the Easify Edge comparison paste (quotes, merge remnants)
  const src = '\t\tPlan X\t\t\t\n\t\tTier 1\tTier 2\tTier 3\tOut-of-Network\n' +
    'Annual Deductible\t\t$0 \t\t\t\n' +
    '"Out-of-Pocket Maximum***\n(Medical & Rx combined)"\t Employee Only\t$6,500 \t\t\tN/A\n' +
    '\tEmployee + Dependent(s)\t$13,000 \t\t\t';
  const s = fromParsed(gridToParsed(parseExcelClipboard(src)));
  assert.equal(s.rows.length, 4); // no shattered fragment rows
  assert.equal(s.rows[2].cells[0].text, 'Out-of-Pocket Maximum***\n(Medical & Rx combined)');
  assert.ok(!s.rows.some(r => r.group)); // no false group rows
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /line break/i);
  const re = fromParsed(ccc.parseData(out.value, s.config));
  assert.deepEqual(re.rows, s.rows);
});

// ---------- footnotes as <p> lines + group rows with extra cells ----------

test('footnotesHTML: <p> per line, no bullet list', () => {
  const s = fromParsed({ columns: [{ text: 'A' }, { text: 'B' }], rows: [] });
  s.footnotes = ['* Biweekly.', '† ER surcharge & <caveat>'];
  assert.equal(footnotesHTML(s), '<p>* Biweekly.</p><p>† ER surcharge &amp; &lt;caveat&gt;</p>');
});

test('dataFieldValue: a group row keeping extra cells routes to JSON with a renderer note', () => {
  const s = fromParsed({
    columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [
      { group: true, cells: [{ text: 'Prescription Drugs' }, { text: 'Retail' }, { text: 'Mail' }] },
      { cells: [{ text: 'Generic' }, { text: '20%' }, { text: '20%' }] },
    ],
  });
  const out = dataFieldValue(s);
  assert.equal(out.format, 'json');
  assert.match(out.reason, /group row/i);
  const re = fromParsed(ccc.parseData(out.value, s.config));
  assert.deepEqual(re.rows, s.rows); // extras survive the round-trip
});

// ---------- switcherInert: mirrors the renderer's mobile-switcher guard ----------

const { switcherInert } = ser;

test('switcherInert: true when body rows (or multi-cell group rows) carry spans', () => {
  const plain = fromParsed({ columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'x' }, { text: '1' }, { text: '2' }] }] });
  assert.equal(switcherInert(plain), false);
  const spanned = fromParsed({ columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ cells: [{ text: 'x' }, { text: 'wide', colspan: 2 }] }] });
  assert.equal(switcherInert(spanned), true);
  const labelGroup = fromParsed({ columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [
      { group: true, cells: [{ text: 'Band' }] },
      { cells: [{ text: 'x' }, { text: '1' }, { text: '2' }] },
    ] });
  assert.equal(switcherInert(labelGroup), false); // label-only group rows don't block
  const cellGroup = fromParsed({ columns: [{ text: '' }, { text: 'A' }, { text: 'B' }],
    rows: [{ group: true, cells: [{ text: 'Rx' }, { text: 'Retail', colspan: 2 }] }] });
  assert.equal(switcherInert(cellGroup), true);
});
