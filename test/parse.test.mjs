import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ccc = require('../ccc-tables.js');

test('version is exported', () => {
  assert.match(ccc.version, /^\d+\.\d+\.\d+$/);
});

// ---------- parseData sniff ----------

test('parseData: JSON when first char is {', () => {
  const d = ccc.parseData('  {"columns":[{"text":"A"}],"rows":[]} ');
  assert.equal(d.columns[0].text, 'A');
});

test('parseData: TSV otherwise', () => {
  const d = ccc.parseData('Plan\tOption 1\tOption 2\nDeductible\t$500\t$1,000');
  assert.equal(d.columns.length, 3);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].cells[1].text, '$500');
});

test('parseData: empty input throws', () => {
  assert.throws(() => ccc.parseData('   '), /empty data/);
});

test('parseData: bad JSON throws', () => {
  assert.throws(() => ccc.parseData('{"columns":'));
});

// ---------- TSV parsing ----------

test('parseTSV: CRLF and blank lines handled', () => {
  const d = ccc.parseTSV('H1\tH2\r\n\r\nval1\tval2\r\n');
  assert.equal(d.columns.length, 2);
  assert.equal(d.rows.length, 1);
  assert.deepEqual(d.rows[0].cells.map(c => c.text), ['val1', 'val2']);
});

test('parseTSV: cells are trimmed', () => {
  const d = ccc.parseTSV('H1\tH2\n a \t b ');
  assert.deepEqual(d.rows[0].cells.map(c => c.text), ['a', 'b']);
});

test('parseTSV: filled-first-empty-rest row becomes a group row', () => {
  const d = ccc.parseTSV('Plan\tA\tB\nIn-network\t\t\nDeductible\t$1\t$2');
  assert.equal(d.rows[0].group, true);
  assert.equal(d.rows[0].cells.length, 1);
  assert.equal(d.rows[0].cells[0].text, 'In-network');
  assert.ok(!d.rows[1].group);
});

test('parseTSV: group detection off via tsvGroups:false', () => {
  const d = ccc.parseTSV('Plan\tA\tB\nIn-network\t\t', { tsvGroups: false });
  assert.ok(!d.rows[0].group);
  assert.equal(d.rows[0].cells.length, 3);
});

test('parseTSV: rows in a single-column table are never group rows', () => {
  const d = ccc.parseTSV('Only\nvalue');
  assert.ok(!d.rows[0].group);
});

test('parseTSV: bare label line (no trailing tabs) is a group row in a multi-column table', () => {
  const d = ccc.parseTSV('Plan\tA\tB\nIn-network\nDeductible\t$1\t$2');
  assert.equal(d.rows[0].group, true);
  assert.ok(!d.rows[1].group);
});

test('parseData: TSV leading tab preserved (empty first header cell)', () => {
  const d = ccc.parseData('\tPlan A\tPlan B\nDeductible\t$1\t$2');
  assert.equal(d.columns.length, 3);
  assert.equal(d.columns[0].text, '');
  assert.equal(d.columns[1].text, 'Plan A');
});

test('parseTSV: underfilled rows keep their cells (grid resolver pads)', () => {
  const d = ccc.parseTSV('A\tB\tC\nrow\tx');
  assert.equal(d.rows[0].cells.length, 2);
});

// ---------- fmt tokens ----------

test('fmt: escapes HTML including quotes', () => {
  assert.equal(ccc.fmt('<b> & "q"'), '&lt;b> &amp; &quot;q&quot;');
});

test('fmt: newline to <br>', () => {
  assert.equal(ccc.fmt('a\nb'), 'a<br>b');
});

test('fmt: icon tokens', () => {
  assert.equal(ccc.fmt('[check]'), '<span class="ccc-ico is-check" aria-hidden="true"></span>');
  assert.match(ccc.fmt('[xmark]'), /is-xmark/);
  assert.match(ccc.fmt('[dollar]'), /is-dollar/);
});

test('fmt: superscript footnote refs', () => {
  assert.equal(ccc.fmt('Deductible^1'), 'Deductible<sup>1</sup>');
});

test('fmt: [link:url|label] renders a safe anchor', () => {
  assert.equal(
    ccc.fmt('[link:https://example.com/x|Plan details]'),
    '<a class="ccc-table_link" href="https://example.com/x">Plan details</a>'
  );
});

test('fmt: [link:] allows tel:, mailto:, /, #', () => {
  assert.match(ccc.fmt('[link:tel:+18005551234|Call]'), /href="tel:\+18005551234"/);
  assert.match(ccc.fmt('[link:mailto:hr@example.com|Email]'), /href="mailto:/);
  assert.match(ccc.fmt('[link:/benefits|Guide]'), /href="\/benefits"/);
  assert.match(ccc.fmt('[link:#footnotes|Notes]'), /href="#footnotes"/);
});

test('fmt: [link:] rejects unsafe schemes, keeps the label as text', () => {
  const out = ccc.fmt('[link:javascript:alert(1)|click]');
  assert.equal(out.includes('<a'), false);
  assert.equal(out, 'click');
});

test('fmt: [link:] url cannot break out of the href attribute', () => {
  const out = ccc.fmt('[link:https://x.co/"onmouseover="x|l]');
  assert.equal(out.includes('"onmouseover'), false); // quote was escaped before token expansion
});

test('fmt: [tip:text|body] renders a tippy carrier', () => {
  assert.equal(
    ccc.fmt('[tip:HSA|Health Savings Account]'),
    '<span class="ccc-table_tip" data-tippy-content="Health Savings Account" tabindex="0">HSA</span>'
  );
});

test('fmt: tokens compose in one cell', () => {
  const out = ccc.fmt('[check] Covered^2 [link:/plans|see plans]');
  assert.match(out, /is-check/);
  assert.match(out, /<sup>2<\/sup>/);
  assert.match(out, /href="\/plans"/);
});

// ---------- resolveGrid ----------

test('resolveGrid: colspan advances the column cursor', () => {
  const placed = ccc.resolveGrid([{ cells: [{ text: 'a', colspan: 2 }, { text: 'b' }] }]);
  assert.equal(placed[0][0].col, 0);
  assert.equal(placed[0][1].col, 2);
});

test('resolveGrid: rowspan carries into following rows', () => {
  const placed = ccc.resolveGrid([
    { cells: [{ text: 'a', rowspan: 2 }, { text: 'b' }] },
    { cells: [{ text: 'c' }] },
  ]);
  assert.equal(placed[1][0].col, 1); // col 0 occupied by the rowspan
});

// ---------- overlay ----------

test('overlay: split fields win over inline JSON fields', () => {
  const data = { caption: 'inline', footnotes: ['x'], config: { highlightCol: 1 } };
  const out = ccc.overlay(data, {
    caption: 'from CMS field',
    footnotesHTML: '<p>rich</p>',
    config: { mobileSwitcher: true },
  });
  assert.equal(out.caption, 'from CMS field');
  assert.equal(out.footnotesHTML, '<p>rich</p>');
  assert.deepEqual(out.config, { mobileSwitcher: true });
});

test('overlay: absent extras leave the blob untouched', () => {
  const data = { caption: 'inline', config: { highlightCol: 1 } };
  const out = ccc.overlay(data, {});
  assert.equal(out.caption, 'inline');
  assert.deepEqual(out.config, { highlightCol: 1 });
});
