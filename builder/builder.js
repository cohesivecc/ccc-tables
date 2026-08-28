/* ccc-tables builder — DOM app.
 *
 * Logic (parsing, grid resolution, state ops) rides the repo-local renderer
 * loaded as window.cccTables by index.html; the PREVIEW loads the pinned
 * jsDelivr build inside an iframe so preview == production for the version a
 * site actually pins.
 */

import * as M from './model.js';
import * as S from './serialize.js';

const ccc = window.cccTables;
const $ = sel => document.querySelector(sel);

const DRAFT_KEY = 'ccc-builder-draft';
const VERSION_KEY = 'ccc-builder-version';
const JSDELIVR_META = 'https://data.jsdelivr.com/v1/packages/gh/cohesivecc/ccc-tables';
const JSDELIVR_FILE = v => `https://cdn.jsdelivr.net/gh/cohesivecc/ccc-tables@${v}`;

const SAMPLE = {
  data: '\tHSA Core\tHSA Value\tPPO Plan\nIn-network\nDeductible\t$1,500\t$500\t$0\nCoinsurance\t20%\t10%\t5%\nPreventive care\t[check]\t[check]\t[check]\nOut-of-network\nDeductible\t$3,000^1\t$1,000^1\t[xmark]',
  caption: 'Compare the sample plans',
  footnotes: ['^1 After deductible.'],
  config: { stickyFirstCol: true, collapsibleGroups: true, mobileSwitcher: true },
};

let state = M.blankState();
let sel = null; // { section, anchor: [row, gridCol], focus: [row, gridCol] }

/* ---------- selection helpers ---------- */

function selRect() {
  if (!sel) return null;
  const [r1, c1] = sel.anchor, [r2, c2] = sel.focus;
  return {
    section: sel.section,
    r1: Math.min(r1, r2), r2: Math.max(r1, r2),
    c1: Math.min(c1, c2), c2: Math.max(c1, c2),
  };
}

function status(msg, cls) {
  const n = $('#grid-status');
  n.textContent = msg || '';
  n.className = 'status' + (cls ? ' is-' + cls : '');
}

/* ---------- grid rendering ---------- */

function renderGrid() {
  const host = $('#grid');
  const table = document.createElement('table');
  const cols = M.colCount(state);
  const rect = selRect();

  const paint = (rowsArr, section, parent) => {
    const placedRows = ccc.resolveGrid(rowsArr);
    rowsArr.forEach((row, r) => {
      const tr = document.createElement('tr');
      if (row.group) tr.className = 'is-group';
      row.cells.forEach((cell, i) => {
        const p = placedRows[r][i];
        const isHead = section === 'header' || row.group || cell.header || p.col === 0;
        const td = document.createElement(isHead ? 'th' : 'td');
        if (row.group && row.cells.length === 1) td.colSpan = cols;
        else {
          if (cell.colspan > 1) td.colSpan = cell.colspan;
          if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
        }
        td.dataset.section = section;
        td.dataset.row = r;
        td.dataset.cellidx = i;
        td.dataset.col = p.col;
        const span = row.group ? cols : (p ? p.span : 1);
        if (rect && rect.section === section &&
            r >= rect.r1 && r <= rect.r2 &&
            p.col <= rect.c2 && p.col + span - 1 >= rect.c1 && !row.group) {
          td.classList.add('is-sel');
        }
        if (!row.group && typeof state.config.highlightCol === 'number' &&
            p.col === state.config.highlightCol) td.classList.add('is-hl');
        const ed = document.createElement('div');
        ed.className = 'cell';
        ed.contentEditable = 'plaintext-only';
        ed.spellcheck = false;
        ed.textContent = cell.text || '';
        td.appendChild(ed);
        tr.appendChild(td);
      });
      parent.appendChild(tr);
    });
  };

  const thead = document.createElement('thead');
  paint(state.headerRows, 'header', thead);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  paint(state.rows, 'body', tbody);
  table.appendChild(tbody);

  host.innerHTML = '';
  host.appendChild(table);
}

/* ---------- outputs + preview ---------- */

let copyables = {};

function renderOutputs() {
  const v = S.validate(state);
  const data = S.dataFieldValue(state);
  const caption = S.captionText(state);
  const foot = S.footnotesHTML(state);
  const config = S.configJSON(state);
  // Footnotes: the HTML flavor pastes as formatted paragraphs; the PLAIN
  // flavor is the bare lines — so a plain-text paste into the Webflow
  // RichText field still becomes clean paragraphs, never literal tags.
  const footLines = (state.footnotes || []).map(l => l.trim()).filter(Boolean).join('\n');
  copyables = {
    'out-data': { value: data.value, ok: !v.errors.length },
    'out-caption': { value: caption, ok: true },
    'out-footnotes': { value: foot, plainAlt: footLines, ok: true, html: true },
    'out-config': { value: config, ok: true },
  };
  const set = (id, text, statusText, err) => {
    const box = $('#' + id);
    box.querySelector('.out_value').textContent = text;
    const st = box.querySelector('.out_status');
    st.textContent = statusText || '';
    st.classList.toggle('is-err', !!err);
    box.querySelector('.copy').disabled = !text || !!err;
  };
  set('out-data', data.value,
    v.errors.length ? v.errors[0]
      : data.format === 'tsv' ? 'TSV' : 'JSON — ' + data.reason,
    v.errors.length > 0);
  set('out-caption', caption);
  set('out-footnotes', foot, foot ? 'pastes as rich text' : '');
  set('out-config', config);
  const warn = $('#warnings');
  warn.textContent = v.warnings.join(' · ');
  warn.className = 'status' + (v.warnings.length ? ' is-warn' : '');
  schedulePreview();
}

/* Preview: the production embedding, verbatim, in an iframe. */

function previewSrcdoc(version) {
  const data = S.dataFieldValue(state);
  let blob = data.value;
  if (/<\/script/i.test(blob)) {
    blob = S.toJSONData(state).replace(/<\//g, '<\\/'); // JSON-safe escape
  }
  const caption = S.captionText(state);
  const foot = S.footnotesHTML(state);
  const config = S.configJSON(state);
  const base = version === 'local' ? '..' : JSDELIVR_FILE(version);
  const js = version === 'local' ? `${base}/ccc-tables.js` : `${base}/ccc-tables.min.js`;
  const escAttr = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Stand-ins for the CCC starter's table_* class family (host-site dependency) */
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 1.2rem; color: #15181d; background: #fff; }
  .table_component { border-collapse: collapse; width: 100%; font-size: .9rem; }
  .table_header, .table_cell { border: 1px solid #d8dde2; padding: .55em .8em; text-align: left; vertical-align: top; }
  .table_header { font-weight: 600; }
  [ccc-data] { display: none; }
  .cat-demo { --ccc-cat-700: #26375c; --ccc-cat-500: #3b5b92; --ccc-cat-100: #eaeef6; }
  @media (max-width: 767px) { .table_component .table_row { display: grid; } }
</style>
<link rel="stylesheet" href="${base}/ccc-tables.css">
</head><body class="cat-demo">
<div ccc-data="tables">
<script type="application/json" data-ccc-table="builder-preview">${blob}</scr${'ipt'}>
${caption ? `<div data-ccc-table-caption="builder-preview">${escAttr(caption)}</div>` : ''}
${foot ? `<div data-ccc-table-footnotes="builder-preview">${foot}</div>` : ''}
${config ? `<script type="application/json" data-ccc-table-config="builder-preview">${config}</scr${'ipt'}>` : ''}
</div>
<div ccc-table="builder-preview"></div>
<script src="${js}"></scr${'ipt'}>
</body></html>`;
}

/* True when the selected preview renderer predates a feature the current
   table depends on (group rows keeping extra cells → renderer ≥ 0.3). */
function previewNote(version) {
  const needs03 = state.rows.some(r => r.group && r.cells.length > 1);
  if (!needs03 || version === 'local') return '';
  const [maj, min] = version.split('.').map(Number);
  if (maj > 0 || min >= 3) return '';
  return 'This table uses group rows that keep extra cells — renderer ≥ 0.3 required. ' +
    'The selected ' + version + ' preview shows only the group label (and so will a site ' +
    'pinned to it). Pick “local checkout” to preview the 0.3 behavior.';
}

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const version = $('#version').value || 'local';
    $('#preview').srcdoc = previewSrcdoc(version);
    $('#preview-note').textContent = previewNote(version);
  }, 300);
}

/* ---------- persistence ---------- */

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      $('#autosave').hidden = false;
    } catch (e) { /* storage unavailable — fine */ }
  }, 500);
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft.headerRows || !draft.rows) return false;
    state = draft;
    return true;
  } catch (e) { return false; }
}

/* ---------- undo/redo history ---------- */

const undoStack = [], redoStack = [];
let historySnapshot = null;
const serState = () => JSON.stringify(state);

/* Call AFTER a mutation settles: pushes the pre-mutation snapshot. Typing
   bursts commit once per debounce window, so undo steps stay coarse. */
function commitHistory() {
  const now = serState();
  if (historySnapshot !== null && now !== historySnapshot) {
    undoStack.push(historySnapshot);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  historySnapshot = now;
}

/* ---------- refresh orchestration ---------- */

function refresh({ grid = true } = {}) {
  if (grid) renderGrid();
  syncPanel();
  renderOutputs();
  scheduleSave();
  commitHistory();
}

function syncPanel() {
  $('#caption').value = state.caption || '';
  $('#footnotes').value = (state.footnotes || []).join('\n');
  ['stickyFirstCol', 'collapsibleGroups', 'mobileSwitcher'].forEach(k => {
    $('#cfg-' + k).checked = state.config[k] === true;
  });
  // The renderer disables the plan switcher on tables with merged body cells —
  // gray the checkbox out and say why, instead of letting it silently no-op.
  const inert = S.switcherInert(state);
  const cb = $('#cfg-mobileSwitcher');
  cb.disabled = inert;
  $('#switcher-note').hidden = !inert;
  $('#cfg-mobileSwitcher-label').title = inert
    ? 'The renderer turns the mobile plan switcher off when body rows contain merged cells — it can\u2019t show or hide part of a span. Unmerge the cells to enable it.'
    : '';
}

/* ---------- import ---------- */

function importData(text) {
  const st = $('#import-status');
  try {
    const sniff = String(text || '').trim();
    if (!sniff) throw new Error('empty data');
    // JSON blobs go through the real parser; pasted ranges go through the
    // Excel-clipboard parser (quoted multiline cells arrive as ONE cell).
    const parsed = sniff.charAt(0) === '{'
      ? ccc.parseData(sniff)
      : S.gridToParsed(S.parseExcelClipboard(text));
    state = M.fromParsed(parsed);
    sel = null;
    st.textContent = 'Imported.';
    st.className = 'status';
    $('#paste-details').open = false;
    refresh();
  } catch (e) {
    st.textContent = 'Could not read that: ' + e.message;
    st.className = 'status is-err';
  }
}

/* ---------- grid events ---------- */

function cellAt(target) {
  const td = target.closest('td, th');
  if (!td || td.dataset.section == null) return null;
  return {
    section: td.dataset.section,
    r: +td.dataset.row,
    cellIdx: +td.dataset.cellidx,
    col: +td.dataset.col,
    td,
  };
}

/* Repaint selection classes in place — never rebuild the grid DOM on a plain
   click, or the browser loses the caret/focus the user just placed. */
function updateSelClasses() {
  const rect = selRect();
  document.querySelectorAll('#grid td, #grid th').forEach(td => {
    const r = +td.dataset.row, col = +td.dataset.col;
    const section = td.dataset.section;
    const span = td.colSpan || 1;
    const isGroup = section === 'body' && state.rows[r] && state.rows[r].group;
    const on = rect && rect.section === section && !isGroup &&
      r >= rect.r1 && r <= rect.r2 && col <= rect.c2 && col + span - 1 >= rect.c1;
    td.classList.toggle('is-sel', !!on);
  });
}

$('#grid').addEventListener('pointerdown', e => {
  const c = cellAt(e.target);
  if (!c) return;
  const isBodyGroup = c.section === 'body' && state.rows[c.r].group;
  const pos = [c.r, c.col];
  if (e.shiftKey && sel && sel.section === c.section && !isBodyGroup) {
    sel.focus = pos;
    e.preventDefault(); // keep the anchor cell's focus
  } else {
    sel = { section: c.section, anchor: pos, focus: pos };
  }
  updateSelClasses();
  status('');
});

$('#grid').addEventListener('input', e => {
  const c = cellAt(e.target);
  if (!c) return;
  M.setCell(state, c.section, c.r, c.cellIdx, e.target.textContent);
  clearTimeout($('#grid')._t);
  $('#grid')._t = setTimeout(() => { renderOutputs(); scheduleSave(); commitHistory(); }, 250);
});

/* ---------- toolbar actions ---------- */

const ACTIONS = {
  'add-row': () => {
    const r = sel && sel.section === 'body' ? selRect().r2 + 1 : state.rows.length;
    M.addRow(state, r);
  },
  'del-row': () => {
    if (!sel || sel.section !== 'body') return status('Select a row first.', 'warn');
    if (state.rows.length <= 1) return status('The table needs at least one row.', 'warn');
    M.deleteRow(state, selRect().r1);
    sel = null;
  },
  'row-up': () => {
    if (!sel || sel.section !== 'body') return status('Select a row first.', 'warn');
    const r = selRect().r1;
    if (r === 0) return;
    M.moveRow(state, r, r - 1);
    sel.anchor[0] = sel.focus[0] = r - 1;
  },
  'row-down': () => {
    if (!sel || sel.section !== 'body') return status('Select a row first.', 'warn');
    const r = selRect().r1;
    if (r >= state.rows.length - 1) return;
    M.moveRow(state, r, r + 1);
    sel.anchor[0] = sel.focus[0] = r + 1;
  },
  'group': () => {
    if (!sel || sel.section !== 'body') return status('Select a row first.', 'warn');
    M.toggleGroup(state, selRect().r1);
  },
  'add-col': () => {
    const k = sel ? selRect().c2 : M.colCount(state) - 1;
    M.addColAfter(state, k);
  },
  'add-col-left': () => {
    const k = sel ? selRect().c1 : 0;
    M.addColAfter(state, k - 1);
  },
  'col-left': () => {
    if (!sel) return status('Select a column first.', 'warn');
    const k = selRect().c1;
    if (!M.moveCol(state, k, -1)) {
      return status('Cannot move: at the edge, or a merged cell crosses that boundary.', 'warn');
    }
    sel.anchor[1] = sel.focus[1] = k - 1;
  },
  'col-right': () => {
    if (!sel) return status('Select a column first.', 'warn');
    const k = selRect().c1;
    if (!M.moveCol(state, k, 1)) {
      return status('Cannot move: at the edge, or a merged cell crosses that boundary.', 'warn');
    }
    sel.anchor[1] = sel.focus[1] = k + 1;
  },
  'undo': () => {
    if (!undoStack.length) return status('Nothing to undo.', 'warn');
    redoStack.push(serState());
    state = JSON.parse(undoStack.pop());
    historySnapshot = serState();
    sel = null;
  },
  'redo': () => {
    if (!redoStack.length) return status('Nothing to redo.', 'warn');
    undoStack.push(serState());
    state = JSON.parse(redoStack.pop());
    historySnapshot = serState();
    sel = null;
  },
  'del-col': () => {
    if (!sel) return status('Select a column first.', 'warn');
    if (M.colCount(state) <= 2) return status('The table needs at least two columns.', 'warn');
    M.deleteCol(state, selRect().c1);
    sel = null;
  },
  'highlight': () => {
    if (!sel) return status('Select a column first.', 'warn');
    const k = selRect().c1;
    state.config.highlightCol = state.config.highlightCol === k ? undefined : k;
    if (state.config.highlightCol === undefined) delete state.config.highlightCol;
  },
  'merge': () => {
    if (!sel) return status('Click one corner, shift-click the other, then Merge.', 'warn');
    const r = selRect();
    if (r.r1 === r.r2 && r.c1 === r.c2) return status('Select more than one cell to merge.', 'warn');
    const v = M.gridRect(state, r.section, [r.r1, r.c1], [r.r2, r.c2]);
    if (!v.ok) return status('Cannot merge: ' + v.reason + '.', 'err');
    M.mergeCells(state, r.section, [r.r1, r.c1], [r.r2, r.c2]);
    sel.focus = sel.anchor;
  },
  'unmerge': () => {
    if (!sel) return status('Select a merged cell first.', 'warn');
    const r = selRect();
    const rowsArr = r.section === 'header' ? state.headerRows : state.rows;
    const placed = ccc.resolveGrid(rowsArr)[r.r1] || [];
    const hit = placed.find(p => p.col <= r.c1 && p.col + p.span - 1 >= r.c1);
    const idx = hit ? rowsArr[r.r1].cells.indexOf(hit.cell) : -1;
    if (idx < 0 || !M.unmergeCell(state, r.section, r.r1, idx)) {
      return status('That cell is not merged.', 'warn');
    }
  },
  'promote': () => {
    if (!M.promoteRowToHeader(state)) return status('The first body row cannot be a group row.', 'warn');
    sel = null;
  },
  'demote': () => {
    if (!M.demoteHeaderRow(state)) return status('The header needs at least one row.', 'warn');
    sel = null;
  },
};

$('#grid-toolbar').addEventListener('click', e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (!act) return;
  status('');
  ACTIONS[act]();
  refresh();
});

document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  e.preventDefault();
  status('');
  ACTIONS[(k === 'y' || e.shiftKey) ? 'redo' : 'undo']();
  refresh();
});

/* Token palette: insert at the caret of the focused cell; a text SELECTION
   becomes the link label / tip term instead of being overwritten. */
document.querySelector('.toolbar-tokens').addEventListener('pointerdown', e => {
  const token = e.target.dataset && e.target.dataset.token;
  if (!token) return;
  e.preventDefault(); // keep the cell focused
  const active = document.activeElement;
  if (!active || !active.classList.contains('cell')) {
    return status('Click into a cell first, then insert a token.', 'warn');
  }
  let insert = token;
  const s = getSelection();
  if (s && !s.isCollapsed && active.contains(s.anchorNode)) {
    const text = s.toString();
    if (token.startsWith('[link:')) insert = '[link:https://example.com|' + text + ']';
    else if (token.startsWith('[tip:')) insert = '[tip:' + text + '|explanation]';
  }
  document.execCommand('insertText', false, insert);
});

/* ---------- side panel events ---------- */

let panelTimer;
function panelTouched() {
  renderOutputs();
  scheduleSave();
  clearTimeout(panelTimer);
  panelTimer = setTimeout(commitHistory, 400);
}
$('#caption').addEventListener('input', e => { state.caption = e.target.value; panelTouched(); });
$('#footnotes').addEventListener('input', e => {
  state.footnotes = e.target.value.split('\n');
  panelTouched();
});
['stickyFirstCol', 'collapsibleGroups', 'mobileSwitcher'].forEach(k => {
  $('#cfg-' + k).addEventListener('change', e => {
    if (e.target.checked) state.config[k] = true; else delete state.config[k];
    renderOutputs(); scheduleSave(); commitHistory();
  });
});

/* ---------- copy buttons ---------- */

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* fall through */ }
  ta.remove();
  return ok;
}

document.querySelectorAll('.out .copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const box = btn.closest('.out');
    const { value, html, plainAlt } = copyables[box.id] || {};
    if (!value) return;
    const plain = plainAlt || value;
    let ok = false;
    try {
      if (html && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([value], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      ok = true;
    } catch (e) {
      ok = legacyCopy(plain);
    }
    if (ok) {
      btn.textContent = 'Copied ✓';
    } else {
      // last resort: select the value so ⌘C works
      const range = document.createRange();
      range.selectNodeContents(box.querySelector('.out_value'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
      btn.textContent = 'Press ⌘C';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

/* ---------- header bar ---------- */

$('#new-table').addEventListener('click', () => {
  state = M.blankState();
  sel = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  $('#paste-details').open = true;
  $('#paste-box').value = '';
  $('#import-status').textContent = '';
  refresh();
});

$('#load-sample').addEventListener('click', () => {
  state = M.fromParsed(ccc.parseData(SAMPLE.data));
  state.caption = SAMPLE.caption;
  state.footnotes = [...SAMPLE.footnotes];
  state.config = { ...SAMPLE.config };
  sel = null;
  $('#paste-details').open = false;
  refresh();
});

$('#import').addEventListener('click', () => importData($('#paste-box').value));

$('#w-desktop').addEventListener('click', () => {
  $('#preview').classList.remove('is-mobile');
  $('#w-desktop').classList.add('is-active');
  $('#w-mobile').classList.remove('is-active');
});
$('#w-mobile').addEventListener('click', () => {
  $('#preview').classList.add('is-mobile');
  $('#w-mobile').classList.add('is-active');
  $('#w-desktop').classList.remove('is-active');
});

/* Version picker: release tags from jsDelivr, newest first; the local
   checkout is always available (and the fallback when the API is off). */
async function loadVersions() {
  const select = $('#version');
  const local = document.createElement('option');
  local.value = 'local';
  local.textContent = `local checkout (${ccc.version})`;
  try {
    const res = await fetch(JSDELIVR_META);
    const meta = await res.json();
    const versions = (meta.versions || []).map(v => v.version);
    if (!versions.length) throw new Error('no tags');
    versions.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v + (i === 0 ? ' (latest)' : '');
      select.appendChild(o);
    });
    select.appendChild(local);
    select.value = versions[0];
  } catch (e) {
    select.appendChild(local);
    select.value = 'local';
  }
  try {
    const remembered = localStorage.getItem(VERSION_KEY);
    if (remembered && [...select.options].some(o => o.value === remembered)) {
      select.value = remembered;
    }
  } catch (e) { /* storage unavailable */ }
  select.addEventListener('change', () => {
    try { localStorage.setItem(VERSION_KEY, select.value); } catch (e) { /* ignore */ }
    schedulePreview();
  });
  schedulePreview();
}

/* ---------- boot ---------- */

if (restoreDraft()) $('#paste-details').open = false;
refresh();
loadVersions();
