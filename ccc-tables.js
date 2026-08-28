/*!
 * ccc-tables v0.3.0 — CMS-data-driven table renderer (Cohesive CCC starter)
 * https://github.com/cohesivecc/ccc-tables
 *
 * Renders semantic table markup from data blobs in the DOM:
 *   <script type="application/json" data-ccc-table="slug">…JSON or TSV…</script>
 *   <div ccc-table="slug"></div>   ← mount point
 *
 * Split-field overlay (all optional, override the inline JSON when present):
 *   [data-ccc-table-caption="slug"]                       plain-text caption
 *   [data-ccc-table-footnotes="slug"]                     rich-text footnotes (HTML kept)
 *   <script type="application/json"
 *           data-ccc-table-config="slug">…JSON…</script>  config
 *
 * Data field accepts JSON ({…}) or TSV (an Excel/Sheets copy IS TSV — paste as-is).
 * Cell tokens: [check] [xmark] [dollar] ^N [link:url|label] [tip:text|body]
 */
(function () {
  'use strict';

  var VERSION = '0.3.0';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Resolve colspan/rowspan into absolute grid columns (each cell gets data-col). */
  function resolveGrid(rows) {
    var carry = [];
    return rows.map(function (row) {
      var placed = [], col = 0;
      (row.cells || []).forEach(function (c) {
        while (carry[col] > 0) col++;
        placed.push({ cell: c, col: col, span: c.colspan || 1 });
        var rs = c.rowspan || 1;
        for (var i = 0; i < (c.colspan || 1); i++) { if (rs > 1) carry[col + i] = rs; }
        col += c.colspan || 1;
      });
      for (var k = 0; k < carry.length; k++) if (carry[k] > 0) carry[k]--;
      return placed;
    });
  }

  var SAFE_HREF = /^(https?:|tel:|mailto:|\/|#)/i;

  /* Escape, then expand the closed token vocabulary (D11) into markup. */
  function fmt(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>')
      .replace(/\[(check|xmark|dollar)\]/g, '<span class="ccc-ico is-$1" aria-hidden="true"></span>')
      .replace(/\[link:([^\]|]+)\|([^\]]+)\]/g, function (m, url, label) {
        url = url.trim();
        if (!SAFE_HREF.test(url)) return label;
        return '<a class="ccc-table_link" href="' + url + '">' + label + '</a>';
      })
      .replace(/\[tip:([^\]|]+)\|([^\]]+)\]/g,
        '<span class="ccc-table_tip" data-tippy-content="$2" tabindex="0">$1</span>')
      .replace(/\^(\d+)/g, '<sup>$1</sup>');
  }

  /* TSV → {columns, rows}. First line = header row. A row whose first cell is
     filled while every other cell is empty becomes a group row (disable with
     config.tsvGroups === false). */
  function parseTSV(text, opts) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n')
      .filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) throw new Error('empty data');
    var grid = lines.map(function (l) {
      return l.split('\t').map(function (c) { return c.trim(); });
    });
    var groups = !(opts && opts.tsvGroups === false);
    var columns = grid[0].map(function (t) { return { text: t }; });
    var colCount = columns.length;
    var rows = grid.slice(1).map(function (cells) {
      var isGroup = groups && colCount > 1 && cells[0] !== '' &&
        cells.slice(1).every(function (c) { return c === ''; });
      var row = { cells: (isGroup ? [cells[0]] : cells).map(function (t) { return { text: t }; }) };
      if (isGroup) row.group = true;
      return row;
    });
    return { columns: columns, rows: rows };
  }

  /* Data field sniff: '{' → JSON, anything else → TSV. Only the sniff is
     trimmed — TSV keeps its leading tabs (an empty first header cell). */
  function parseData(raw, opts) {
    var t = String(raw == null ? '' : raw);
    var sniff = t.trim();
    if (!sniff) throw new Error('empty data');
    if (sniff.charAt(0) === '{') return JSON.parse(sniff);
    return parseTSV(t, opts);
  }

  function buildTable(data, mount) {
    var cfg = data.config || {};
    var outer = el('div', 'table_outer ccc-table');
    var toolbar = el('div', 'ccc-table_toolbar');
    var wrapper = el('div', 'table_wrapper ccc-table_scroll');
    var table = el('table', 'table_component is-layout-auto');
    if (cfg.stickyFirstCol) outer.setAttribute('ccc-sticky-first', '');
    if (data.caption) table.appendChild(el('caption', 'ccc-table_caption', data.caption));
    var headRows = data.headerRows || (data.columns ? [{ cells: data.columns.map(function (c) { var t = (c && typeof c === 'object') ? (c.text || '') : c; return { text: t, header: true, colspan: c && c.colspan }; }) }] : []);
    var thead = el('thead', 'table_head');
    resolveGrid(headRows).forEach(function (placed) {
      var tr = el('tr', 'table_row');
      placed.forEach(function (p) {
        var th = el('th', 'table_header', p.cell.text);
        th.setAttribute('scope', 'col');
        if (p.cell.colspan) th.colSpan = p.cell.colspan;
        if (p.cell.rowspan) th.rowSpan = p.cell.rowspan;
        th.setAttribute('data-col', p.col);
        if (p.col === 0) th.classList.add('is-row-header');
        tr.appendChild(th);
      });
      thead.appendChild(tr);
    });
    table.appendChild(thead);
    var tbody = el('tbody', 'table_body');
    var groupIdx = 0;
    resolveGrid(data.rows || []).forEach(function (placed, i) {
      var row = (data.rows || [])[i];
      var tr = el('tr', 'table_row');
      if (row.group) {
        tr.classList.add('is-legend-row', 'ccc-table_group-row');
        /* v0.3: a group row may keep cells beyond its label — they render as
           header cells with their spans (e.g. "Rx | Retail | Mail"). A
           label-only group row keeps the classic full-width band. */
        var multi = (row.cells || []).length > 1;
        if (cfg.collapsibleGroups) {
          groupIdx++;
          tr.setAttribute('data-group', groupIdx);
        }
        placed.forEach(function (p, idx) {
          if (idx > 0 && !multi) return;
          var td = el('th', idx === 0 ? 'table_header is-row-header' : 'table_header', '');
          td.setAttribute('scope', 'colgroup');
          if (multi) {
            if (p.cell.colspan) td.colSpan = p.cell.colspan;
            if (p.cell.rowspan) td.rowSpan = p.cell.rowspan;
            td.setAttribute('data-col', p.col);
          } else {
            td.colSpan = 99;
          }
          if (idx === 0 && cfg.collapsibleGroups) {
            var btn = el('button', 'ccc-table_group-toggle');
            btn.type = 'button';
            btn.setAttribute('aria-expanded', 'true');
            var lbl = el('span');
            lbl.innerHTML = fmt((p.cell || {}).text || '');
            btn.appendChild(lbl);
            btn.appendChild(el('span', 'ccc-table_group-chevron', '▾'));
            td.appendChild(btn);
            btn.addEventListener('click', (function (g) {
              return function (e) {
                var open = e.currentTarget.getAttribute('aria-expanded') === 'true';
                e.currentTarget.setAttribute('aria-expanded', String(!open));
                tbody.querySelectorAll('[data-in-group="' + g + '"]').forEach(function (r) { r.style.display = open ? 'none' : ''; });
              };
            })(groupIdx));
          } else {
            td.innerHTML = fmt((p.cell || {}).text || '');
          }
          tr.appendChild(td);
        });
      } else {
        placed.forEach(function (p) {
          var isHead = p.cell.header || p.col === 0;
          var cell = el(isHead ? 'th' : 'td', isHead ? 'table_header is-row-header' : 'table_cell', '');
          if (isHead) cell.setAttribute('scope', 'row');
          cell.innerHTML = fmt(p.cell.text);
          if (p.cell.colspan) cell.colSpan = p.cell.colspan;
          if (p.cell.rowspan) cell.rowSpan = p.cell.rowspan;
          cell.setAttribute('data-col', p.col);
          if (cfg.highlightCol != null && p.col === cfg.highlightCol) cell.classList.add('ccc-table_highlight');
          tr.appendChild(cell);
        });
        if (groupIdx && cfg.collapsibleGroups) tr.setAttribute('data-in-group', groupIdx);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var hasBodySpans = (data.rows || []).some(function (r) {
      if (r.group && (r.cells || []).length < 2) return false;
      return (r.cells || []).some(function (c) { return (c.colspan || 1) > 1 || (c.rowspan || 1) > 1; });
    });
    var lastHead = resolveGrid(headRows)[headRows.length - 1] || [];
    var colCount = lastHead.reduce(function (m, p) { return Math.max(m, p.col + p.span); }, 0);
    if (cfg.mobileSwitcher && !hasBodySpans && colCount > 2) {
      var setCol = function (col) {
        table.querySelectorAll('th[data-col], td[data-col]').forEach(function (c) {
          var cc = c.getAttribute('data-col');
          if (cc === '0') return;
          if (cc === String(col)) c.removeAttribute('data-ccc-colhide');
          else c.setAttribute('data-ccc-colhide', '');
        });
        outer.setAttribute('ccc-show-col', col);
      };
      var chips = el('div', 'ccc-table_chips');
      lastHead.forEach(function (p) {
        if (p.col === 0) return;
        var chip = el('button', 'ccc-table_chip', p.cell.text);
        chip.type = 'button';
        chip.setAttribute('data-col', p.col);
        chip.addEventListener('click', function () {
          chips.querySelectorAll('.ccc-table_chip').forEach(function (c) { c.classList.remove('is-active'); });
          chip.classList.add('is-active');
          setCol(p.col);
        });
        chips.appendChild(chip);
      });
      toolbar.appendChild(chips);
      var first = chips.querySelector('.ccc-table_chip');
      if (first) { first.classList.add('is-active'); setCol(first.getAttribute('data-col')); }
      outer.setAttribute('ccc-mobile-switcher', '');
    }
    wrapper.appendChild(table);
    if (toolbar.childNodes.length) outer.appendChild(toolbar);
    outer.appendChild(wrapper);
    if (data.footnotesHTML) {
      var fnr = el('div', 'ccc-table_footnotes');
      fnr.innerHTML = data.footnotesHTML;
      outer.appendChild(fnr);
    } else if (data.footnotes && data.footnotes.length) {
      var fn = el('div', 'ccc-table_footnotes');
      data.footnotes.forEach(function (f) { var p = el('p'); p.innerHTML = fmt(f); fn.appendChild(p); });
      outer.appendChild(fn);
    }
    mount.innerHTML = '';
    mount.appendChild(outer);
  }

  /* Merge the split-field carriers over the parsed Data blob (split fields win). */
  function overlay(data, extras) {
    if (extras.caption != null && extras.caption !== '') data.caption = extras.caption;
    if (extras.footnotesHTML) data.footnotesHTML = extras.footnotesHTML;
    if (extras.config) data.config = extras.config;
    return data;
  }

  function collect(root) {
    var blobs = {};
    root.querySelectorAll('script[type="application/json"][data-ccc-table]').forEach(function (s) {
      var k = s.getAttribute('data-ccc-table');
      blobs[k] = (blobs[k] || '') + s.textContent;
    });
    return blobs;
  }

  function extrasFor(root, slug) {
    var out = {};
    var cap = root.querySelector('[data-ccc-table-caption="' + slug + '"]');
    if (cap) out.caption = cap.textContent.trim();
    var fns = root.querySelector('[data-ccc-table-footnotes="' + slug + '"]');
    if (fns && fns.innerHTML.trim()) out.footnotesHTML = fns.innerHTML;
    var cfg = root.querySelector('script[type="application/json"][data-ccc-table-config="' + slug + '"]');
    var cfgText = cfg ? cfg.textContent.trim() : '';
    if (cfgText) {
      try { out.config = JSON.parse(cfgText); }
      catch (e) { out.configError = 'bad config JSON — ' + e.message; }
    }
    return out;
  }

  function fail(mount, slug, msg) {
    mount.innerHTML = '<div class="ccc-table_error">ccc-tables: ' +
      String(msg).replace(/</g, '&lt;') + ' (“' + slug + '”)</div>';
  }

  function init() {
    var blobs = collect(document);
    document.querySelectorAll('[ccc-table]').forEach(function (mount) {
      var slug = mount.getAttribute('ccc-table');
      var raw = blobs[slug];
      if (!raw) { fail(mount, slug, 'no data found'); return; }
      var extras = extrasFor(document, slug);
      if (extras.configError) { fail(mount, slug, extras.configError); return; }
      try {
        var data = overlay(parseData(raw, extras.config), extras);
        buildTable(data, mount);
      } catch (e) {
        fail(mount, slug, 'could not parse — ' + e.message);
      }
      /* Late tippy hookup for [tip:] tokens rendered after the site's tippy init. */
      if (window.tippy) {
        var fresh = [].filter.call(mount.querySelectorAll('[data-tippy-content]'),
          function (n) { return !n._tippy; });
        if (fresh.length) window.tippy(fresh, { theme: 'ccc' });
      }
    });
  }

  var api = {
    version: VERSION,
    init: init,
    parseData: parseData,
    parseTSV: parseTSV,
    resolveGrid: resolveGrid,
    fmt: fmt,
    buildTable: buildTable,
    overlay: overlay
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                       /* Node (tests, builder tooling) */
  }
  if (typeof window !== 'undefined') {
    window.cccTables = api;                     /* browser (builder preview reuse) */
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
