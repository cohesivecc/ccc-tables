/* builder — step-based authoring page (Start → Edit → Publish).
 *
 * Data logic lives in ./model.js + ./serialize.js; pure UI-support logic
 * (feature gating, the publish plan) in ./logic.js. This file is DOM only. The two previews load the
 * site's pinned renderer from jsDelivr in iframes (desktop at the live article
 * width, 824px, and phone at 375px) fed the exact strings Publish emits.
 */

import * as M from './model.js';
import * as S from './serialize.js';
import * as L from './logic.js';

const ccc = window.cccTables;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const DRAFT_KEY = 'ccc-builder-next-draft';
const VERSION_KEY = 'ccc-builder-version';
const JSDELIVR_META = 'https://data.jsdelivr.com/v1/packages/gh/cohesivecc/ccc-tables';
const JSDELIVR_FILE = v => `https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@${v}`;
const DESK_W = 824, PHONE_W = 375, FRAME_GAP = 24;

const SAMPLE = {
  data: '\tHSA Core\tHSA Value\tPPO Plan\nIn-network\nDeductible\t$1,500\t$500\t$0\nCoinsurance\t20%\t10%\t5%\nPreventive care\t[check]\t[check]\t[check]\nOut-of-network\nDeductible\t$3,000^1\t$1,000^1\t[xmark]',
  title: 'Compare the sample plans',
  footnotes: '^1 After deductible.',
  config: '{"stickyFirstCol":true,"collapsibleGroups":true,"mobileSwitcher":true}',
};

/* ---------------- state ---------------- */

let state = M.blankState();
let baseline = null;          // L.publishValues() at import; null = a new table
let configProvided = true;    // false = imported without the item's Config
let legacyFootnotes = false;  // imported Data carried footnotes inline (pre-split JSON)
let sel = null;               // {type:'col',col} | {type:'row',section,row} | {type:'cells',section,anchor:[r,c],focus:[r,c]}
let step = 'start';
let typeTimer, setTimer;   // debounced typing commits (grid cells / settings fields)

const version = () => $('#version').value || 'local';

/* ---------------- history ---------------- */

const undoStack = [], redoStack = [];
let snap = JSON.stringify(state);
function commit() {
  const now = JSON.stringify(state);
  if (now === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  snap = now;
}
/* commit any debounced typing so it becomes its own undo step */
function flushTyping() { clearTimeout(typeTimer); clearTimeout(setTimer); commit(); }
function resetHistory() { undoStack.length = redoStack.length = 0; snap = JSON.stringify(state); }
function undo() {
  flushTyping();
  if (!undoStack.length) return status('Nothing to undo.');
  redoStack.push(snap); snap = undoStack.pop(); state = JSON.parse(snap); sel = null; renderAll();
}
function redo() {
  flushTyping();
  if (!redoStack.length) return status('Nothing to redo.');
  undoStack.push(snap); snap = redoStack.pop(); state = JSON.parse(snap); sel = null; renderAll();
}

/* ---------------- persistence ---------------- */

let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ state, baseline, configProvided, legacyFootnotes, savedAt: Date.now() }));
      if ($('#saved').textContent !== 'Draft saved') $('#saved').textContent = 'Draft saved'; // announce once, not per keystroke
    } catch (e) {
      $('#saved').textContent = 'Draft not saved (browser storage is off)';
    }
  }, 400);
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !d.state || !d.state.headerRows || !d.state.rows) return false;
    state = d.state; baseline = d.baseline || null;
    configProvided = d.configProvided !== false; legacyFootnotes = !!d.legacyFootnotes;
    return true;
  } catch (e) { return false; }
}

/* ---------------- steps ---------------- */

function showStep(id, { focusTab = false } = {}) {
  step = id;
  $$('[role="tab"]').forEach(t => {
    const on = t.id === 'tab-' + id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
    if (on && focusTab) t.focus();
  });
  if (id === 'start') renderStart();
  if (id === 'edit') { renderAll(); layoutFrames(); }
  if (id === 'publish') renderPublish();
  window.scrollTo(0, 0);
}
$$('[role="tab"]').forEach(t => t.addEventListener('click', () => showStep(t.id.slice(4))));
$('.steps').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const ids = ['start', 'edit', 'publish'];
  const i = ids.indexOf(step);
  showStep(ids[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3], { focusTab: true });
});

/* ---------------- start ---------------- */

function tableName() {
  if (state.caption.trim()) return '“' + state.caption.trim() + '”';
  const heads = state.headerRows[state.headerRows.length - 1].cells.map(c => c.text).filter(Boolean);
  return heads.length ? 'the table with ' + heads.slice(0, 3).join(', ') : 'a blank table';
}
function isBlank() {
  return [...state.headerRows, ...state.rows].every(r => r.cells.every(c => !c.text)) && !state.caption;
}
function renderStart() {
  const cur = $('#start-current');
  cur.hidden = isBlank();
  cur.textContent = `You’re editing ${tableName()}. Starting another table replaces it.`;
}
function setErr(fieldId, errId, msg) {
  $('#' + errId).textContent = msg || '';
  if (fieldId) $('#' + fieldId).setAttribute('aria-invalid', msg ? 'true' : 'false');
}
/* A pre-split ("one-chunk") JSON Data blob keeps caption/footnotes/config inside
   Data, so the item's separate Table Title / Config fields don't hold them yet. */
function legacyKeys(data) {
  const t = String(data || '').trim();
  if (t.charAt(0) !== '{') return [];
  try { const j = JSON.parse(t); return ['caption', 'footnotes', 'config'].filter(k => j[k] != null && j[k] !== ''); } catch (e) { return []; }
}
function inlineFootnotes(data) {
  const t = String(data || '').trim();
  if (t.charAt(0) !== '{') return false;
  try { const j = JSON.parse(t); return Array.isArray(j.footnotes) && j.footnotes.some(f => String(f).trim()); } catch (e) { return false; }
}
function beginTable(got, { fromCms, cmsBoxes }) {
  state = got.state;
  baseline = fromCms ? L.publishValues(state) : null;
  const legacy = fromCms && cmsBoxes ? legacyKeys(cmsBoxes.data) : [];
  if (legacy.length) {
    // Compare against what the item's fields really hold: the old Data text
    // (always differs from the split Data) and whatever the other boxes had.
    baseline.data = '\u0000legacy';
    if (legacy.includes('caption')) baseline.title = '';   // the item's own Table Title field is still empty
    if (!cmsBoxes.config.trim()) baseline.config = '';
  }
  configProvided = fromCms ? got.configProvided : true;
  sel = null;
  resetHistory();
  showStep('edit');
  if (fromCms && !configProvided) {
    status('Imported without Config. If this item has a Config field, go back to Start and include it — otherwise changing an option would replace the item’s current options.', 'warn');
  } else if (legacy.length) {
    status('This table uses the old single-field format (its title, footnotes or options sit inside Data). Publish converts it into separate Data, Table title and Config fields.', 'warn');
  } else status(fromCms ? 'Imported. Publish will list only the fields you change.' : 'Table ready. Click any cell to edit it.');
}

$('#start-new').addEventListener('submit', e => {
  e.preventDefault();
  const data = $('#new-range').value;
  setErr('new-range', 'new-err', '');
  if (!data.trim()) { setErr('new-range', 'new-err', 'Paste a range from your spreadsheet first.'); $('#new-range').focus(); return; }
  try {
    const got = S.stateFromCms({ data });
    got.state.config = { stickyFirstCol: true, collapsibleGroups: true, ...got.state.config };
    legacyFootnotes = inlineFootnotes(data);
    beginTable(got, { fromCms: false });
  } catch (err) { setErr('new-range', 'new-err', 'Couldn’t read that: ' + err.message + '.'); $('#new-range').focus(); }
});
$('#start-blank').addEventListener('click', () => {
  legacyFootnotes = false;
  const blank = M.blankState();
  blank.config = { stickyFirstCol: true, collapsibleGroups: true };
  beginTable({ state: blank, configProvided: true }, { fromCms: false });
});
$('#start-cms').addEventListener('submit', e => {
  e.preventDefault();
  setErr('in-data', 'data-err', ''); setErr('in-config', 'config-err', '');
  const data = $('#in-data').value;
  try {
    const boxes = { data, config: $('#in-config').value };
    const got = S.stateFromCms({ data, config: boxes.config });
    legacyFootnotes = inlineFootnotes(data);
    beginTable(got, { fromCms: true, cmsBoxes: boxes });
  } catch (err) {
    const msg = err.message.charAt(0).toUpperCase() + err.message.slice(1) + '.';
    if (/Config box/.test(err.message)) { setErr('in-config', 'config-err', msg); $('#in-config').focus(); }
    else { setErr('in-data', 'data-err', msg); $('#in-data').focus(); }
  }
});
$('#load-sample').addEventListener('click', () => {
  const got = S.stateFromCms({ data: SAMPLE.data, caption: SAMPLE.title, footnotes: SAMPLE.footnotes, config: SAMPLE.config });
  legacyFootnotes = false;
  beginTable(got, { fromCms: false });
});

/* ---------------- grid ---------------- */

const display = t => (t ? ccc.fmt(t).replace(/ tabindex="0"/g, '') : '');

function lastHeadCellAt(k) {
  const placed = ccc.resolveGrid(state.headerRows);
  const row = placed[placed.length - 1] || [];
  const p = row.find(x => x.col <= k && k < x.col + x.span);
  return p ? p.cell : null;
}
function colName(k) {
  const c = lastHeadCellAt(k);
  return (c && c.text) || (k === 0 ? 'Row labels' : 'Untitled column');
}

function renderGrid() {
  const n = M.colCount(state);
  const v = version();
  const cfg = state.config || {};
  const alignOK = L.supports(v, 'align'), divOK = L.supports(v, 'colDividers');
  const labelsOn = !(cfg.firstColLabels === false && L.supports(v, 'firstColLabels'));
  const issues = new Map(S.rowWidthIssues(state).map(i => [i.row, i]));
  const H = state.headerRows.length;
  const table = $('#grid');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.className = 'handles';
  hr.appendChild(document.createElement('td'));
  for (let k = 0; k < n; k++) {
    const th = document.createElement('th');
    th.innerHTML = `<button type="button" class="handle" data-col="${k}" aria-pressed="false" aria-label="Select column ${L.colLetter(k)}: ${esc(colName(k))}">${L.colLetter(k)}</button>`;
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const paint = (rowsArr, section, parent) => {
    const placed = ccc.resolveGrid(rowsArr);
    rowsArr.forEach((row, r) => {
      const tr = document.createElement('tr');
      const g = document.createElement('th');
      g.className = 'gutter';
      const issue = section === 'body' && issues.get(r);
      const lbl = section === 'header' ? 'H' + (r + 1) : String(r + 1);
      const aria = section === 'header' ? `Select header row ${r + 1}` : `Select row ${r + 1}`;
      g.innerHTML = `<button type="button" class="handle${issue ? ' is-warn' : ''}" data-section="${section}" data-row="${r}" aria-pressed="false"
        aria-label="${aria}${issue ? ` (covers ${issue.covered} of ${issue.want} columns)` : ''}"
        ${issue ? `title="This row covers ${issue.covered} of ${issue.want} columns"` : ''}>${lbl}${issue ? ' ⚠' : ''}</button>`;
      tr.appendChild(g);
      row.cells.forEach((cell, i) => {
        const p = placed[r][i];
        const band = section === 'body' && !!row.group;
        const fullBand = band && row.cells.length === 1;
        const head = section === 'header';
        const label = !head && !band && (cell.header || (labelsOn && p.col === 0));
        const td = document.createElement(head || band || label ? 'th' : 'td');
        const span = fullBand ? n : p.span;
        if (fullBand) td.colSpan = n;
        else {
          if (cell.colspan > 1) td.colSpan = cell.colspan;
          if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
        }
        Object.assign(td.dataset, { section, row: r, idx: i, col: p.col, span });
        if (band) td.dataset.band = '1';
        if (head) td.classList.add('is-head');
        if (band) td.classList.add('is-band');
        if (label) td.classList.add('is-label');
        if (!head && !band && typeof cfg.highlightCol === 'number' && p.col <= cfg.highlightCol && cfg.highlightCol < p.col + span) td.classList.add('is-hl');
        if (divOK && !band && Array.isArray(cfg.colDividers) && cfg.colDividers.includes(p.col) && p.col > 0) td.classList.add('is-divide');
        const a = alignOK && !band && Array.isArray(cfg.align) ? ccc.alignValue(cfg.align[p.col]) : null;
        if (a) td.style.textAlign = a;
        const ed = document.createElement('div');
        ed.className = 'cell';
        ed.contentEditable = 'plaintext-only';
        ed.spellcheck = false;
        ed.setAttribute('role', 'textbox');
        ed.setAttribute('aria-label', band ? `Tinted group band, row ${r + 1}` : L.cellName(section, r, p.col, H));
        ed.innerHTML = display(cell.text);
        td.appendChild(ed);
        tr.appendChild(td);
      });
      parent.appendChild(tr);
    });
  };
  paint(state.headerRows, 'header', thead);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  paint(state.rows, 'body', tbody);
  table.appendChild(tbody);
  paintSel();
}

const rowsOf = section => (section === 'header' ? state.headerRows : state.rows);
function cellInfo(td) {
  const d = td.dataset;
  return { section: d.section, row: +d.row, idx: +d.idx, col: +d.col, span: +d.span, rowspan: td.rowSpan || 1, band: d.band === '1', td };
}
function rawOf(info) { return rowsOf(info.section)[info.row].cells[info.idx].text || ''; }

function selRect() {
  if (!sel || sel.type !== 'cells') return null;
  const [r1, c1] = sel.anchor, [r2, c2] = sel.focus;
  return { section: sel.section, r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
}

function paintSel() {
  const rect = selRect();
  $$('#grid [data-section][data-idx]').forEach(td => {
    const c = cellInfo(td);
    let on = false;
    if (sel && sel.type === 'col') on = !c.band && c.col <= sel.col && sel.col < c.col + c.span;
    else if (sel && sel.type === 'row') on = c.section === sel.section && c.row === sel.row;
    else if (rect) {
      on = c.section === rect.section && !c.band &&
        c.row <= rect.r2 && c.row + c.rowspan - 1 >= rect.r1 && c.col <= rect.c2 && c.col + c.span - 1 >= rect.c1;
    }
    td.classList.toggle('is-sel', on);
  });
  $$('#grid .handle').forEach(h => {
    const on = sel && ((sel.type === 'col' && h.dataset.col != null && +h.dataset.col === sel.col) ||
      (sel.type === 'row' && h.dataset.row != null && h.dataset.section === sel.section && +h.dataset.row === sel.row));
    h.setAttribute('aria-pressed', String(!!on));
  });
  $('#ctx').innerHTML = ctxText();
}
function ctxText() {
  if (!sel) return 'Select a cell, row or column — or change the table settings on the right.';
  if (sel.type === 'col') return `Column <strong>${L.colLetter(sel.col)}</strong> selected`;
  if (sel.type === 'row') return sel.section === 'header' ? `Header row <strong>${sel.row + 1}</strong> selected` : `Row <strong>${sel.row + 1}</strong> selected`;
  const r = selRect();
  if (r.r1 === r.r2 && r.c1 === r.c2) return `Cell <strong>${L.cellName(r.section, r.r1, r.c1, state.headerRows.length)}</strong>`;
  return `<strong>${L.cellName(r.section, r.r1, r.c1, 1)} – ${L.cellName(r.section, r.r2, r.c2, 1)}</strong> selected`;
}

/* find the rendered cell covering grid position (section, r, col) */
function tdAt(section, r, col) {
  return $$(`#grid [data-section="${section}"][data-idx]`).find(td => {
    const c = cellInfo(td);
    return c.row <= r && r < c.row + c.rowspan && c.col <= col && col < c.col + c.span;
  });
}

const grid = $('#grid');
let caret = null; // {ed, start, end} — last caret inside a cell, for the Insert menu

grid.addEventListener('click', e => {
  const h = e.target.closest('.handle');
  if (!h) return;
  sel = h.dataset.col != null ? { type: 'col', col: +h.dataset.col } : { type: 'row', section: h.dataset.section, row: +h.dataset.row };
  paintSel(); renderInspector(); status('');
});

/* shift-click extends a cell range without moving focus off the anchor */
grid.addEventListener('pointerdown', e => {
  const td = e.target.closest('[data-idx]');
  if (!td || !e.shiftKey || !sel || sel.type !== 'cells') return;
  const c = cellInfo(td);
  if (c.section !== sel.section || c.band) return;
  e.preventDefault();
  sel.focus = [c.row, c.col];
  paintSel(); renderInspector();
});

/* focus IS selection: keyboard users get the same inspector as pointer users */
grid.addEventListener('focusin', e => {
  const ed = e.target.closest('.cell');
  if (!ed) return;
  const c = cellInfo(ed.parentElement);
  ed.textContent = rawOf(c);                   // show the raw token text while editing
  placeCaret(ed, ed.textContent.length);
  caret = { ed, start: ed.textContent.length, end: ed.textContent.length };
  sel = c.band ? { type: 'row', section: 'body', row: c.row } : { type: 'cells', section: c.section, anchor: [c.row, c.col], focus: [c.row, c.col] };
  paintSel(); renderInspector();
});
grid.addEventListener('focusout', e => {
  const ed = e.target.closest('.cell');
  if (!ed || !ed.isConnected) return;
  ed.innerHTML = display(rawOf(cellInfo(ed.parentElement)));
});

function placeCaret(ed, start, end = start) {
  const node = ed.firstChild;
  const r = document.createRange();
  if (node && node.nodeType === 3) { r.setStart(node, Math.min(start, node.length)); r.setEnd(node, Math.min(end, node.length)); }
  else { r.selectNodeContents(ed); r.collapse(false); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function caretOffsets(ed) {
  const s = getSelection();
  if (!s.rangeCount || !ed.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0);
  const pre = document.createRange(); pre.selectNodeContents(ed);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: start + r.toString().length };
}
document.addEventListener('selectionchange', () => {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains('cell')) {
    const o = caretOffsets(a);
    if (o) caret = { ed: a, ...o };
  }
});

grid.addEventListener('input', e => {
  const ed = e.target.closest('.cell');
  if (!ed) return;
  const c = cellInfo(ed.parentElement);
  M.setCell(state, c.section, c.row, c.idx, ed.textContent.replace(/\n$/, ''));
  const o = caretOffsets(ed);
  if (o) caret = { ed, ...o };
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => { commit(); previewSoon(); updateBadge(); saveSoon(); }, 250);
});

/* arrows / Enter move like a spreadsheet; Shift+arrow at a text edge extends the range */
grid.addEventListener('keydown', e => {
  const ed = e.target.closest('.cell');
  if (!ed) return;
  const c = cellInfo(ed.parentElement);
  const text = ed.textContent;
  const o = caretOffsets(ed) || { start: 0, end: 0 };
  const collapsed = o.start === o.end;
  let d = null;
  if (e.key === 'Escape') { ed.blur(); return; }
  if (e.key === 'Enter' && !e.shiftKey) d = [1, 0];
  else if (e.key === 'ArrowUp' && !text.includes('\n')) d = [-1, 0];
  else if (e.key === 'ArrowDown' && !text.includes('\n')) d = [1, 0];
  else if (e.key === 'ArrowLeft' && collapsed && o.start === 0) d = [0, -1];
  else if (e.key === 'ArrowRight' && collapsed && o.end === text.length) d = [0, 1];
  if (!d) return;
  e.preventDefault();
  if (e.key === 'Enter') commit();
  if (e.shiftKey && e.key.startsWith('Arrow') && sel && sel.type === 'cells' && !c.band) {
    const [fr, fc] = sel.focus;
    const rows = rowsOf(sel.section).length, n = M.colCount(state);
    sel.focus = [Math.max(0, Math.min(rows - 1, fr + d[0])), Math.max(0, Math.min(n - 1, fc + d[1]))];
    paintSel(); renderInspector();
    return;
  }
  moveFrom(c, d);
});
function moveFrom(c, [dr, dc]) {
  let section = c.section, r = c.row, col = c.col;
  if (dr > 0) r = c.row + c.rowspan; else if (dr < 0) r = c.row - 1;
  if (dc > 0) col = c.col + c.span; else if (dc < 0) col = c.col - 1;
  const n = M.colCount(state);
  if (col < 0 || col >= n) return;
  if (section === 'header' && r >= state.headerRows.length) { section = 'body'; r = 0; }
  if (section === 'body' && r < 0) { section = 'header'; r = state.headerRows.length - 1; }
  if (r < 0 || r >= rowsOf(section).length) return;
  const row = rowsOf(section)[r];
  const target = section === 'body' && row.group ? tdAt(section, r, 0) || tdAt(section, r, col) : tdAt(section, r, col);
  if (target) target.querySelector('.cell').focus();
}

/* paste a spreadsheet range into the grid, starting at the focused cell */
grid.addEventListener('paste', e => {
  const ed = e.target.closest('.cell');
  if (!ed) return;
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (!/[\t\n]/.test(text.replace(/\n+$/, ''))) return; // one value: normal paste
  const values = S.parseExcelClipboard(text);
  if (values.length < 1 || (values.length === 1 && values[0].length < 2)) return;
  e.preventDefault();
  pasteRange(cellInfo(ed.parentElement), values);
});
function pasteRange(start, values) {
  const n = M.colCount(state);
  let placedCount = 0, skipped = 0, added = 0;
  let r = start.row;
  values.forEach(line => {
    const rowsArr = rowsOf(start.section);
    if (r >= rowsArr.length) {
      if (start.section !== 'body') { skipped += line.length; return; }
      M.addRow(state, rowsArr.length); added++;
    }
    const row = rowsArr[r];
    const placed = ccc.resolveGrid(rowsArr)[r];
    line.forEach((val, dc) => {
      const col = start.col + dc;
      const p = col < n && placed.find(x => x.col === col);
      if (!p || (row.group && col > 0)) { skipped++; return; }
      p.cell.text = val; placedCount++;
    });
    r++;
  });
  commit(); renderAll();
  const t = tdAt(start.section, start.row, start.col);
  if (t) t.querySelector('.cell').focus();
  status(`Pasted ${placedCount} value${placedCount === 1 ? '' : 's'}${added ? `, adding ${added} row${added === 1 ? '' : 's'}` : ''}.` +
    (skipped ? ` ${skipped} didn’t fit — add columns, or unmerge cells, first.` : ''), skipped ? 'warn' : '');
}

/* ---------------- insert menu (tokens) ---------------- */

const TOKENS = [
  { t: '[check]', label: '✓ Check', desc: 'covered / yes' },
  { t: '[xmark]', label: '✕ X mark', desc: 'not covered / no' },
  { t: '[dollar]', label: '$ Dollar icon', desc: '' },
  { t: '^1', label: 'Footnote marker', desc: '^1 … or ^* ^† ^‡' },
  { wrap: 'link', label: 'Link', desc: 'wraps selected text' },
  { wrap: 'tip', label: 'Tooltip', desc: 'wraps selected text' },
  { wrap: 'reg', label: 'Regular weight', desc: 'soften part of a label' },
  { t: '[nbsp]', label: 'Keep words together', desc: 'put between two words' },
];
$('#insert-items').innerHTML = TOKENS.map((x, i) =>
  `<button type="button" class="btn btn-ghost btn-sm" data-tok="${i}"><span>${x.label}</span><span class="desc">${x.desc}</span></button>`).join('');
function toggleMenu(open) {
  const m = $('#insert-menu');
  m.hidden = open === undefined ? !m.hidden : !open;
  $('#insert-btn').setAttribute('aria-expanded', String(!m.hidden));
  if (!m.hidden) m.querySelector('button').focus();
}
$('#insert-btn').addEventListener('click', () => toggleMenu());
$('#insert-menu').addEventListener('keydown', e => {
  const items = $$('#insert-items button');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { toggleMenu(false); $('#insert-btn').focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});
document.addEventListener('pointerdown', e => {
  if (!$('#insert-menu').hidden && !e.target.closest('.menu')) toggleMenu(false);
});
$('#insert-items').addEventListener('click', e => {
  const b = e.target.closest('[data-tok]');
  if (!b) return;
  toggleMenu(false);
  if (!caret || !caret.ed.isConnected) { status('Click into a cell first, then choose what to insert.', 'warn'); return; }
  const { ed, start, end } = caret;
  const tok = TOKENS[+b.dataset.tok];
  ed.focus();                                  // focusin swaps to raw text
  placeCaret(ed, start, end);
  const picked = ed.textContent.slice(start, end);
  const insert = tok.t || ({
    link: `[link:https://example.com|${picked || 'label'}]`,
    tip: `[tip:${picked || 'term'}|explanation]`,
    reg: `[reg:${picked || 'text'}]`,
  })[tok.wrap];
  document.execCommand('insertText', false, insert);
});

/* ---------------- inspector ---------------- */

/* Point at the collapse option when a band is created while it's off. */
function flashCollapse() {
  const lab = $('#collapse-label');
  $('#tbl').open = true;
  lab.scrollIntoView({ block: 'nearest' });
  lab.classList.add('is-flash');
  clearTimeout(flashCollapse._t);
  flashCollapse._t = setTimeout(() => lab.classList.remove('is-flash'), 2400);
}

let statusCls = '';
function status(msg, cls = '') {
  const n = $('#insp-status');
  n.textContent = msg || '';
  statusCls = cls;
  n.className = 'insp_status' + (cls ? ' is-' + cls : '');
}

function seg(name, options, current, disabled) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(name)}">` + options.map(([v, l], i) =>
    `<input type="radio" name="${name}" id="${name}-${i}" value="${v}" ${current === v ? 'checked' : ''} ${disabled ? 'disabled' : ''}><label for="${name}-${i}">${l}</label>`).join('') + '</div>';
}
const gate = key => (L.supports(version(), key) ? '' : `<span class="gate">${esc(L.gateReason(version(), key))}</span>`);

function renderInspector() {
  const box = $('#insp-ctx');
  const cfg = state.config || {};
  const n = M.colCount(state);
  $('#tbl').open = !sel || $('#tbl').open;
  if (!sel) { box.innerHTML = ''; return; }

  if (sel.type === 'col') {
    const k = sel.col;
    const al = Array.isArray(cfg.align) ? (ccc.alignValue(cfg.align[k]) || '') : '';
    const alignOK = L.supports(version(), 'align'), divOK = L.supports(version(), 'colDividers');
    box.innerHTML = `
      <div class="insp_title"><span class="section-label">Column ${L.colLetter(k)}</span><strong>${esc(colName(k))}</strong></div>
      <div class="insp_row"><span class="lbl">Alignment</span>
        ${seg('align', [['', 'Default'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']], al, !alignOK)}
        ${gate('align')}</div>
      <div>
        <label class="check"><input type="checkbox" id="i-hl" ${cfg.highlightCol === k ? 'checked' : ''}><span>Highlight this column<span class="hint">tints it — e.g. a recommended plan</span></span></label>
        <label class="check"><input type="checkbox" id="i-div" ${Array.isArray(cfg.colDividers) && cfg.colDividers.includes(k) ? 'checked' : ''} ${k === 0 || !divOK ? 'disabled' : ''}><span>Divider before this column<span class="hint">${k === 0 ? 'not available on the first column' : 'a vertical rule that separates two groups of plans'}</span></span></label>
        ${k > 0 ? gate('colDividers') : ''}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" data-do="col-left" ${k === 0 ? 'disabled' : ''}>← Move left</button>
        <button type="button" class="btn btn-sm" data-do="col-right" ${k === n - 1 ? 'disabled' : ''}>Move right →</button>
        <button type="button" class="btn btn-sm" data-do="col-ins-left">Insert left</button>
        <button type="button" class="btn btn-sm" data-do="col-ins-right">Insert right</button>
        <button type="button" class="btn btn-sm btn-danger" data-do="col-del" ${n <= 2 ? 'disabled' : ''}>Delete column</button>
      </div>`;
    return;
  }

  if (sel.type === 'row' && sel.section === 'header') {
    const r = sel.row, H = state.headerRows.length;
    box.innerHTML = `
      <div class="insp_title"><span class="section-label">Header row ${r + 1} of ${H}</span><strong>Column headings</strong></div>
      ${H > 1 && r === H - 1 ? '<div class="btn-row"><button type="button" class="btn btn-sm" data-do="demote">Move back into the body</button></div>' : ''}
      <p class="small muted">${H > 1 ? 'Merge heading cells across columns to group them (shift-click a range, then Merge).' : 'For a two-row header, select body row 1 and choose “Make this a header row”.'}</p>`;
    return;
  }

  if (sel.type === 'row') {
    const r = sel.row, row = state.rows[r];
    const issue = S.rowWidthIssues(state).find(i => i.row === r);
    box.innerHTML = `
      <div class="insp_title"><span class="section-label">Row ${r + 1}</span><strong>${esc((row.cells[0] || {}).text || 'Untitled row')}</strong></div>
      ${issue ? `<p class="note">This row covers ${issue.covered} of ${issue.want} columns. Add cells or merge so it fills the table.</p>` : ''}
      <div class="insp_row"><span class="lbl">Row type</span>
        ${seg('rowkind', [['normal', 'Values'], ['group', 'Tinted Group Band']], row.group ? 'group' : 'normal')}
        <span class="small muted">A tinted group band applies a tint and groups rows underneath.</span></div>
      ${r === 0 && !row.group ? '<div class="btn-row"><button type="button" class="btn btn-sm" data-do="promote">Make this a header row</button></div>' : ''}
      <div class="btn-row">
        <button type="button" class="btn btn-sm" data-do="row-up" ${r === 0 ? 'disabled' : ''}>↑ Move up</button>
        <button type="button" class="btn btn-sm" data-do="row-down" ${r === state.rows.length - 1 ? 'disabled' : ''}>↓ Move down</button>
        <button type="button" class="btn btn-sm" data-do="row-ins-above">Insert above</button>
        <button type="button" class="btn btn-sm" data-do="row-ins-below">Insert below</button>
        <button type="button" class="btn btn-sm btn-danger" data-do="row-del" ${state.rows.length <= 1 ? 'disabled' : ''}>Delete row</button>
      </div>`;
    return;
  }

  // cells
  const rect = selRect();
  const rowsArr = rowsOf(rect.section);
  const placed = ccc.resolveGrid(rowsArr);
  const hits = [];
  rowsArr.forEach((row, r) => placed[r].forEach(p => {
    const rs = p.cell.rowspan || 1;
    if (r <= rect.r2 && r + rs - 1 >= rect.r1 && p.col <= rect.c2 && p.col + p.span - 1 >= rect.c1) hits.push({ ...p, row: r, group: !!row.group });
  }));
  const body = rect.section === 'body';
  const plainFirst = cfg.firstColLabels === false;
  const labelable = hits.filter(h => body && !h.group && (h.col > 0 || plainFirst));
  const allLabels = labelable.length > 0 && labelable.every(h => h.cell.header);
  const labelBox = labelable.length ? `<label class="check"><input type="checkbox" id="i-label" ${allLabels ? 'checked' : ''}><span>Treat as ${hits.length > 1 ? 'labels' : 'a label'}<span class="hint">bold, and always shown on phones — e.g. “Employee only”</span></span></label>` : '';

  if (hits.length <= 1) {
    const h = hits[0];
    const spanning = h && ((h.cell.colspan || 1) > 1 || (h.cell.rowspan || 1) > 1);
    box.innerHTML = `
      <div class="insp_title"><span class="section-label">${body ? 'Cell' : 'Column heading'} ${esc(L.cellName(rect.section, rect.r1, rect.c1, state.headerRows.length).replace(/^heading /, ''))}</span>
        <strong>${h && h.cell.text ? esc(h.cell.text) : '<span class="muted">Empty</span>'}</strong></div>
      ${body && h && h.col === 0 && !plainFirst ? '<p class="small muted">First-column cells are row labels. “First column holds row labels” in Table settings turns that off for the whole table.</p>' : labelBox}
      ${spanning ? '<div class="btn-row"><button type="button" class="btn btn-sm" data-do="unmerge">Unmerge</button></div>' : ''}
      <p class="small muted">Use <strong>Insert ▾</strong> for icons, links, tooltips and footnote markers. Shift-click another cell to select a range you can merge.</p>`;
    return;
  }
  const v = M.gridRect(state, rect.section, [rect.r1, rect.c1], [rect.r2, rect.c2]);
  box.innerHTML = `
    <div class="insp_title"><span class="section-label">${hits.length} cells selected</span>
      <strong>${esc(L.cellName(rect.section, rect.r1, rect.c1, 1))} – ${esc(L.cellName(rect.section, rect.r2, rect.c2, 1))}</strong></div>
    <div class="insp_row">
      <div class="btn-row"><button type="button" class="btn btn-sm btn-primary" data-do="merge" ${v.ok ? '' : 'disabled'}>Merge cells</button></div>
      ${v.ok ? '<span class="small muted">Their text is kept, one line each, in the merged cell.</span>' : `<span class="note">Can’t merge: this range ${esc(v.reason)}.</span>`}
    </div>
    ${labelBox}`;
}

/* run an edit, re-render, and keep keyboard focus on the same control */
function act(fn) {
  const a = document.activeElement;
  const key = a && (a.id ? '#' + a.id : a.dataset && a.dataset.do ? `[data-do="${a.dataset.do}"]` :
    a.name ? `input[name="${a.name}"][value="${a.value}"]` : null);
  flushTyping();
  const keepStatus = fn() === 'keep-status';
  commit(); renderAll(!keepStatus);
  const back = key && document.querySelector('.insp ' + key);
  if (back && !back.disabled) back.focus();
  else if (sel && sel.type === 'col') { const h = $(`#grid .handle[data-col="${sel.col}"]`); h && h.focus(); }
  else if (sel && sel.type === 'row') { const h = $(`#grid .handle[data-section="${sel.section}"][data-row="${sel.row}"]`); h && h.focus(); }
  else if (sel && sel.type === 'cells') { const t = tdAt(sel.section, sel.anchor[0], sel.anchor[1]); t && t.querySelector('.cell').focus(); }
}

$('#insp-ctx').addEventListener('change', e => {
  const t = e.target, cfg = state.config;
  act(() => {
    if (t.name === 'align') {
      const a = Array.isArray(cfg.align) ? cfg.align.slice() : [];
      a[sel.col] = t.value || null;
      if (a.some(Boolean)) cfg.align = a; else delete cfg.align;
    } else if (t.id === 'i-hl') {
      if (t.checked) cfg.highlightCol = sel.col; else delete cfg.highlightCol;
    } else if (t.id === 'i-div') {
      const s = new Set(Array.isArray(cfg.colDividers) ? cfg.colDividers : []);
      if (t.checked) s.add(sel.col); else s.delete(sel.col);
      if (s.size) cfg.colDividers = [...s].sort((x, y) => x - y); else delete cfg.colDividers;
    } else if (t.name === 'rowkind') {
      M.toggleGroup(state, sel.row);
    } else if (t.id === 'i-label') {
      const r = selRect();
      M.toggleHeaderCells(state, { ...r, c1: state.config.firstColLabels === false ? r.c1 : Math.max(1, r.c1) });
    }
  });
  if (t.name === 'rowkind' && t.value === 'group' && !state.config.collapsibleGroups) flashCollapse();
});

$('#insp-ctx').addEventListener('click', e => {
  const b = e.target.closest('[data-do]');
  if (!b) return;
  act(() => {
    const k = sel && sel.col, r = sel && sel.row;
    switch (b.dataset.do) {
      case 'col-left':
      case 'col-right': {
        const dir = b.dataset.do === 'col-left' ? -1 : 1;
        if (!M.moveCol(state, k, dir)) { status('Can’t move: a merged cell crosses that edge. Unmerge it first.', 'warn'); return 'keep-status'; }
        shiftColConfigSwap(k, k + dir);
        sel.col = k + dir; break;
      }
      case 'col-ins-left': M.addColAfter(state, k - 1); shiftColConfigInsert(k); sel.col = k; break;
      case 'col-ins-right': M.addColAfter(state, k); shiftColConfigInsert(k + 1); sel.col = k + 1; break;
      case 'col-del': M.deleteCol(state, k); shiftColConfigDelete(k); sel = null; break;
      case 'row-up': M.moveRow(state, r, r - 1); sel.row = r - 1; break;
      case 'row-down': M.moveRow(state, r, r + 1); sel.row = r + 1; break;
      case 'row-ins-above': M.addRow(state, r); sel.row = r + 1; break;
      case 'row-ins-below': M.addRow(state, r + 1); break;
      case 'row-del': M.deleteRow(state, r); sel = null; break;
      case 'promote':
        if (!M.promoteRowToHeader(state)) { status('A group band can’t become a header row.', 'warn'); return 'keep-status'; }
        sel = { type: 'row', section: 'header', row: state.headerRows.length - 1 }; break;
      case 'demote': M.demoteHeaderRow(state); sel = { type: 'row', section: 'body', row: 0 }; break;
      case 'merge': {
        const x = selRect();
        M.mergeCells(state, x.section, [x.r1, x.c1], [x.r2, x.c2]);
        sel.anchor = [x.r1, x.c1]; sel.focus = [x.r1, x.c1]; break;
      }
      case 'unmerge': {
        const x = selRect();
        const rowsArr = rowsOf(x.section);
        const hit = ccc.resolveGrid(rowsArr)[x.r1].find(p => p.col <= x.c1 && x.c1 < p.col + p.span);
        if (hit) M.unmergeCell(state, x.section, x.r1, rowsArr[x.r1].cells.indexOf(hit.cell));
        break;
      }
    }
    return undefined;
  });
});

/* Config keys indexed by grid column follow structural column edits. */
function shiftColConfigInsert(at) {
  const c = state.config;
  if (typeof c.highlightCol === 'number' && c.highlightCol >= at) c.highlightCol++;
  if (Array.isArray(c.align) && c.align.length > at) c.align.splice(at, 0, null);
  if (Array.isArray(c.colDividers)) c.colDividers = c.colDividers.map(d => (d >= at ? d + 1 : d));
}
function shiftColConfigDelete(k) {
  const c = state.config;
  if (c.highlightCol === k) delete c.highlightCol; else if (c.highlightCol > k) c.highlightCol--;
  if (Array.isArray(c.align)) { c.align.splice(k, 1); if (!c.align.some(Boolean)) delete c.align; }
  if (Array.isArray(c.colDividers)) {
    c.colDividers = c.colDividers.filter(d => d !== k).map(d => (d > k ? d - 1 : d)).filter(d => d > 0);
    if (!c.colDividers.length) delete c.colDividers;
  }
}
function shiftColConfigSwap(a, b) {
  const c = state.config;
  if (c.highlightCol === a) c.highlightCol = b; else if (c.highlightCol === b) c.highlightCol = a;
  if (Array.isArray(c.align)) {
    const al = c.align; while (al.length <= Math.max(a, b)) al.push(null);
    [al[a], al[b]] = [al[b], al[a]];
  }
}

/* ---------------- table settings ---------------- */

const CAP_OPTS = [['', 'Up to half the table (default)'], ['40', 'Up to 40%'], ['60', 'Up to 60%'], ['none', 'No limit']];
const HEIGHT_OPTS = [['', 'Full height (default)'], ['60', 'Scroll after 60% of the screen'], ['true', 'Scroll after 70% of the screen']];
function fillSelect(sel_, opts, value) {
  const v = value == null ? '' : String(value);
  const list = opts.some(([x]) => x === v) ? opts : [...opts, [v, `Custom: ${v}`]];
  sel_.innerHTML = list.map(([x, l]) => `<option value="${esc(x)}">${esc(l)}</option>`).join('');
  sel_.value = v;
}
function syncSettings() {
  const c = state.config || {};
  const v = version();
  if (document.activeElement !== $('#t-title')) $('#t-title').value = state.caption || '';
  if (document.activeElement !== $('#t-foot')) $('#t-foot').value = (state.footnotes || []).join('\n');
  $('#t-sticky').checked = c.stickyFirstCol === true;
  $('#t-collapse').checked = c.collapsibleGroups === true;
  $('#t-switch').checked = c.mobileSwitcher === true;
  $('#t-tsvgroups').checked = c.tsvGroups !== false;
  $('#t-firstlabels').checked = c.firstColLabels !== false;
  const capV = c.firstColMax === 50 || c.firstColMax === '50' || c.firstColMax === '50%' ? '' : c.firstColMax;
  fillSelect($('#t-cap'), CAP_OPTS, capV);
  fillSelect($('#t-height'), HEIGHT_OPTS, c.maxHeight === false ? '' : c.maxHeight);
  [['t-cap', 'cap-gate', 'firstColMax'], ['t-height', 'height-gate', 'maxHeight'],
   ['t-firstlabels', 'firstlabels-gate', 'firstColLabels']].forEach(([id, g, key]) => {
    const ok = L.supports(v, key);
    $('#' + id).disabled = !ok;
    $('#' + g).hidden = ok;
    $('#' + g).textContent = ok ? '' : L.gateReason(v, key);
  });
  const spans = c.mobileSwitcher && !L.supports(v, 'switcherSpans') && S.switcherInert(state);
  $('#switch-gate').hidden = !spans;
  $('#switch-gate').textContent = spans ? `This table has merged cells, and renderer ${v} turns the phone switcher off for those. ${L.gateReason(v, 'switcherSpans')}` : '';
  const missing = L.markersMissing(state);
  $('#foot-note').textContent = missing.length
    ? `Cells use ${missing.map(m => '^' + m).join(', ')} but no footnote above starts with ${missing.length > 1 ? 'those markers' : 'that marker'}.` : '';
}
$('#tbl').addEventListener('input', e => {
  const t = e.target, c = state.config;
  if (t.id === 't-title') state.caption = t.value;
  else if (t.id === 't-foot') state.footnotes = t.value.split('\n');
  else if (t.id === 't-sticky') { if (t.checked) c.stickyFirstCol = true; else delete c.stickyFirstCol; }
  else if (t.id === 't-collapse') { if (t.checked) c.collapsibleGroups = true; else delete c.collapsibleGroups; }
  else if (t.id === 't-switch') { if (t.checked) c.mobileSwitcher = true; else delete c.mobileSwitcher; }
  else if (t.id === 't-tsvgroups') { if (t.checked) delete c.tsvGroups; else c.tsvGroups = false; }
  else if (t.id === 't-firstlabels') { if (t.checked) delete c.firstColLabels; else c.firstColLabels = false; }
  else if (t.id === 't-cap') { if (t.value === '') delete c.firstColMax; else c.firstColMax = t.value === 'none' ? 'none' : (isNaN(+t.value) ? t.value : +t.value); }
  else if (t.id === 't-height') { if (t.value === '') delete c.maxHeight; else c.maxHeight = t.value === 'true' ? true : (isNaN(+t.value) ? t.value : +t.value); }
  else return;
  const typing = t.id === 't-title' || t.id === 't-foot';
  clearTimeout(setTimer);
  setTimer = setTimeout(commit, typing ? 400 : 0);
  if (!typing) renderGrid();
  syncSettings(); previewSoon(); updateBadge(); saveSoon();
  if (sel && !typing) renderInspector();
});

/* ---------------- previews ---------------- */

function srcdoc(v) {
  const data = S.dataFieldValue(state);
  let blob = data.value;
  if (/<\/script/i.test(blob)) blob = S.toJSONData(state).replace(/<\//g, '<\\/');
  const title = S.captionText(state);
  const foot = S.footnotesHTML(state);
  const config = S.configJSON(state);
  const local = v === 'local';
  const base = local ? '..' : JSDELIVR_FILE(v);
  const js = local ? `${base}/ccc-tables.js` : `${base}/ccc-tables.min.js`;
  const escT = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* stand-ins for the CCC starter's table_* family (host-site dependency) */
  html, body { margin: 0; background: #fff; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #15181d; padding: 0 0 2px; }
  .table_component { border-collapse: collapse; width: 100%; font-size: .9rem; }
  .table_header, .table_cell { border: 1px solid #d8dde2; padding: .55em .8em; text-align: left; vertical-align: top; }
  .table_header { font-weight: 600; }
  [ccc-data] { display: none; }
  body { --ccc-cat-700: #26375c; --ccc-cat-500: #3b5b92; --ccc-cat-100: #eaeef6; }
  @media (max-width: 767px) { .table_component .table_row { display: grid; } }
</style>
<link rel="stylesheet" href="${base}/ccc-tables.css">
</head><body>
<div ccc-data="tables">
<script type="application/json" data-ccc-table="builder">${blob}</scr${'ipt'}>
${title ? `<div data-ccc-table-caption="builder">${escT(title)}</div>` : ''}
${foot ? `<div data-ccc-table-footnotes="builder">${foot}</div>` : ''}
${config ? `<script type="application/json" data-ccc-table-config="builder">${config}</scr${'ipt'}>` : ''}
</div>
<div ccc-table="builder"></div>
<script src="${js}"></scr${'ipt'}>
</body></html>`;
}

let pvTimer;
function previewSoon() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(renderPreviews, 250);
}
function renderPreviews() {
  const v = version();
  const doc = srcdoc(v);
  $('#f-desk').srcdoc = doc;
  $('#f-phone').srcdoc = doc;
  $('#pv-sub').textContent = v === 'local' ? '— your local checkout of the renderer' : `— exactly as it publishes with renderer ${v}`;
  const notes = L.compatNotes(state, v);
  $('#compat').innerHTML = notes.map(t => `<li>${esc(t)}</li>`).join('');
}

const frameH = { desk: 200, phone: 200 };
function watchFrame(id, key) {
  const f = $('#' + id);
  f.addEventListener('load', () => {
    const d = f.contentDocument;
    if (!d) return;
    const measure = () => {
      const h = Math.max(d.documentElement.scrollHeight, 60);
      if (h !== frameH[key]) { frameH[key] = h; layoutFrames(); }
    };
    measure();
    try { new ResizeObserver(measure).observe(d.body); } catch (e) { /* older browsers: one measure */ }
  });
}
watchFrame('f-desk', 'desk');
watchFrame('f-phone', 'phone');

function layoutFrames() {
  const box = $('#frames');
  if (!box.offsetParent) return;                       // Edit step hidden
  const W = box.clientWidth - 32;                        // padding
  const stacked = W < 700;
  box.classList.toggle('is-stacked', stacked);
  const sd = stacked ? Math.min(1, W / DESK_W) : Math.min(1, (W - FRAME_GAP) / (DESK_W + PHONE_W));
  const sp = stacked ? Math.min(1, W / PHONE_W) : sd;
  [['desk', DESK_W, sd], ['phone', PHONE_W, sp]].forEach(([k, w, s]) => {
    const f = $('#f-' + k), b = $('#' + k + '-box');
    f.style.width = w + 'px';
    f.style.height = frameH[k] + 'px';
    f.style.transform = s < 1 ? `scale(${s})` : '';
    b.style.width = Math.round(w * s) + 'px';
    b.style.height = Math.round(frameH[k] * s) + 'px';
    $('#' + k + '-scale').textContent = s < 1 ? `(shown at ${Math.round(s * 100)}%)` : '';
  });
}
addEventListener('resize', layoutFrames);

/* ---------------- publish ---------------- */

function updateBadge() {
  const n = L.toPasteCount(L.publishPlan(state, baseline));
  const b = $('#pub-count');
  b.hidden = !n;
  b.textContent = String(n);
  b.setAttribute('aria-label', `${n} field${n === 1 ? '' : 's'} to paste`);
}

const BADGE = {
  new: ['badge-changed', 'Paste'],
  changed: ['badge-changed', 'Changed — paste'],
  clear: ['badge-changed', 'Clear this field'],
  same: ['badge-same', 'No change'],
  empty: ['badge-same', 'Leave empty'],
};

function renderPublish() {
  const v = S.validate(state);
  const plan = L.publishPlan(state, baseline);
  const n = L.toPasteCount(plan);
  const data = S.dataFieldValue(state);
  $('#pub-title').textContent = !baseline
    ? 'Paste these into a new item in the Tables collection'
    : n ? `Paste ${n} field${n === 1 ? '' : 's'} into the CMS item` : 'Nothing to paste — this matches the item you imported';
  $('#pub-sub').textContent = !baseline
    ? 'Create the item in Webflow, then paste each field below into its matching field. Footnotes are written in the CMS Footnotes field.'
    : 'Only the highlighted fields changed. Leave the others as they are.';
  $('#mark-pasted').hidden = n === 0;
  $('#pub-errors').innerHTML = v.errors.map(e => `<p class="pub_note is-err" role="alert">${esc(e)}. Fix this before copying Data.</p>`).join('');

  $('#pub-list').innerHTML = plan.map(p => {
    const todo = p.status === 'new' || p.status === 'changed' || p.status === 'clear';
    const [cls, text] = BADGE[p.status];
    const blocked = p.key === 'data' && v.errors.length;
    let detail = `Goes in ${p.where}.`;
    if (p.key === 'data' && p.value) detail += data.format === 'tsv' ? ' Saved as plain text (TSV).' : ` Saved as JSON: ${data.reason}.`;
    if (p.status === 'clear') detail = `Empty ${p.where} in the CMS.`;
    const warn = p.key === 'config' && p.status === 'changed' && baseline && !configProvided
      ? '<p class="pubfield_warn">This item’s Config wasn’t imported, so pasting this replaces all of its current options (sticky column, switcher, dividers…) instead of adding to them. If the item has a Config, re-import with it first.</p>' : '';
    return `<article class="pubfield ${todo ? 'is-todo' : 'is-quiet'}">
      <div class="pubfield_head">
        <div class="grow"><strong>${esc(p.label)}</strong><span class="small muted">${esc(detail)}</span></div>
        <span class="badge ${cls}">${text}</span>
        ${p.value ? `<button type="button" class="btn btn-sm ${todo ? 'btn-primary' : ''}" data-copy="${p.key}" ${blocked ? 'disabled' : ''}>Copy ${esc(p.label)}</button>` : ''}
      </div>
      ${warn}
      ${p.value ? `<details ${todo ? 'open' : ''}><summary>Value</summary><pre>${esc(p.value)}</pre></details>` : ''}
    </article>`;
  }).join('');

  const notes = [];
  if (legacyFootnotes && (state.footnotes || []).some(f => f.trim())) {
    notes.push(`<div class="pub_note is-warn"><strong>This table’s footnotes were stored inside Data.</strong>
      <span>The new Data won’t carry them. Paste them into the item’s Footnotes field so they keep showing.</span>
      <div><button type="button" class="btn btn-sm" data-copy="footnotes">Copy footnotes</button></div></div>`);
  } else {
    const used = L.markersUsed(state);
    if (used.length) notes.push(`<div class="pub_note"><span>Cells use footnote markers ${used.map(m => '<code>^' + esc(m) + '</code>').join(', ')}. Footnotes live in the item’s Footnotes field — check they still match.</span></div>`);
  }
  const issues = S.rowWidthIssues(state);
  if (issues.length) {
    notes.push(`<div class="pub_note is-warn"><strong>Some rows don’t fill the table</strong><ul>${issues.map(i =>
      `<li><button type="button" class="linkish" data-goto-row="${i.row}">Row ${i.row + 1}</button> covers ${i.covered} of ${i.want} columns</li>`).join('')}</ul></div>`);
  }
  const compat = L.compatNotes(state, version());
  if (compat.length) notes.push(`<div class="pub_note is-warn"><strong>Renderer ${esc(version())} won’t show everything</strong><ul>${compat.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`);
  $('#pub-notes').innerHTML = notes.join('');
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* fall through */ }
  ta.remove();
  return ok;
}
$('#p-publish').addEventListener('click', async e => {
  const go = e.target.closest('[data-goto-row]');
  if (go) { sel = { type: 'row', section: 'body', row: +go.dataset.gotoRow }; showStep('edit'); const h = $(`#grid .handle[data-section="body"][data-row="${sel.row}"]`); h && h.focus(); return; }
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const key = b.dataset.copy;
  let plain, html = null;
  if (key === 'footnotes') {
    html = S.footnotesHTML(state);
    plain = (state.footnotes || []).map(l => l.trim()).filter(Boolean).join('\n');
  } else plain = L.publishValues(state)[key];
  let ok = false;
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(plain);
    ok = true;
  } catch (err) { ok = legacyCopy(plain); }
  const label = b.textContent;
  b.textContent = ok ? 'Copied ✓' : 'Couldn’t copy — select the value and press ⌘C';
  $('#saved').textContent = ok ? 'Copied to the clipboard' : '';
  setTimeout(() => { b.textContent = label; }, 1600);
});
$('#mark-pasted').addEventListener('click', () => {
  baseline = L.publishValues(state);
  configProvided = true;
  legacyFootnotes = false;
  saveSoon(); updateBadge(); renderPublish();
  $('#pub-title').focus?.();
});

/* ---------------- version picker ---------------- */

async function loadVersions() {
  const select = $('#version');
  const local = new Option(`local checkout (${ccc.version})`, 'local');
  try {
    const res = await fetch(JSDELIVR_META);
    const meta = await res.json();
    const versions = (meta.versions || []).map(x => x.version);
    if (!versions.length) throw new Error('no tags');
    versions.forEach((x, i) => select.appendChild(new Option(x + (i === 0 ? ' (latest)' : ''), x)));
    select.appendChild(local);
    select.value = versions[0];
  } catch (e) {
    select.appendChild(local);
    select.value = 'local';
  }
  try {
    const remembered = localStorage.getItem(VERSION_KEY);
    if (remembered && [...select.options].some(o => o.value === remembered)) select.value = remembered;
  } catch (e) { /* storage off */ }
  select.addEventListener('change', () => {
    try { localStorage.setItem(VERSION_KEY, select.value); } catch (e) { /* ignore */ }
    if (step === 'edit') renderAll(false);
    if (step === 'publish') renderPublish();
  });
  if (step === 'edit') renderAll(false);
}

/* ---------------- orchestration ---------------- */

function renderAll(clearStatus = true) {
  if (clearStatus) status('');
  renderGrid(); renderInspector(); syncSettings(); previewSoon(); updateBadge(); saveSoon();
}

$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  e.preventDefault();
  if (k === 'y' || e.shiftKey) redo(); else undo();
});

/* ---------------- boot ---------------- */

if (loadDraft()) { resetHistory(); showStep('edit'); }
else showStep('start');
loadVersions();
