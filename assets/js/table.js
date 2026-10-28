// Sortable, paginated data table.
import { h, clear, isNum, csvDownload } from './util.js';
import { isAdv } from './data.js';

/**
 * cols: [{key, label, title, get(row) -> sortable value, render(row) -> Node|string, fmt(v), align:'r'|'l'|'c',
 *         width, sortDir: -1|1 (default direction on first click), cls, csv(row), csvOnly (export only)}]
 * opts: {rows, sortKey, sortDir, pageSize, onRowClick, rowClass, empty, csvName, rank:true, sticky}
 */
/** A column's explanation, when its title says more than its label. */
const bare = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const tipOf = c => (c.title && bare(c.title) !== bare(c.label) ? c.title : null);

export function dataTable(opts) {
  const st = { key: opts.sortKey, dir: opts.sortDir ?? -1, page: 0, size: opts.pageSize || 50 };
  const root = h('div', { class: 'dt' });
  const bar = h('div', { class: 'dt-bar' });
  const wrap = h('div', { class: 'tbl-wrap' + (opts.sticky === false ? '' : ' sticky') });
  const pager = h('div', { class: 'dt-pager' });
  root.append(bar, wrap, pager);
  const allCols = opts.cols.filter(c => !c.adv || isAdv());      // {adv: true} columns only in advanced mode
  const cols = allCols.filter(c => !c.csvOnly);
  let rows = opts.rows;

  function sortRows() {
    const c = allCols.find(x => x.key === st.key);
    if (!c) return rows;
    const get = c.get || (r => r[c.key]);
    const arr = rows.map((r, i) => [get(r), i, r]);
    arr.sort((a, b) => {
      const va = a[0], vb = b[0];
      const na = va == null || (typeof va === 'number' && !isFinite(va)), nb = vb == null || (typeof vb === 'number' && !isFinite(vb));
      if (na && nb) return a[1] - b[1];
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return st.dir * String(va).localeCompare(String(vb)) || a[1] - b[1];
      return st.dir * (va - vb) || a[1] - b[1];
    });
    return arr.map(x => x[2]);
  }

  function render() {
    const sorted = sortRows();
    const pages = Math.max(1, Math.ceil(sorted.length / st.size));
    st.page = Math.min(st.page, pages - 1);
    const slice = sorted.slice(st.page * st.size, (st.page + 1) * st.size);
    const thead = h('thead', {}, h('tr', {},
      opts.rank ? h('th', { class: 'r rank-col' }, '#') : null,
      cols.map(c => {
        const active = st.key === c.key;
        const th = h('th', { class: (c.align === 'r' ? 'r ' : c.align === 'c' ? 'c ' : '') + (c.get !== false ? 'sortable ' : '') + (active ? 'active' : ''), title: c.title || '', style: c.width ? { width: c.width } : null, scope: 'col', 'aria-sort': active ? (st.dir > 0 ? 'ascending' : 'descending') : null },
          tipOf(c) ? h('span', { class: 'th-tip' }, c.label) : c.label, active ? h('span', { class: 'sort-ind' }, st.dir > 0 ? '▲' : '▼') : null);
        if (c.get !== false) th.addEventListener('click', () => {
          if (st.key === c.key) st.dir = -st.dir; else { st.key = c.key; st.dir = c.sortDir ?? -1; }
          st.page = 0; render();
        });
        return th;
      })));
    const tbody = h('tbody', {});
    if (!slice.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length + (opts.rank ? 1 : 0), class: 'empty' }, opts.empty || 'No rows match the current filters.')));
    slice.forEach((r, i) => {
      const tr = h('tr', { class: (opts.onRowClick ? 'clickable ' : '') + (opts.rowClass ? opts.rowClass(r) || '' : '') },
        opts.rank ? h('td', { class: 'r rank-col muted' }, st.page * st.size + i + 1) : null,
        cols.map(c => {
          let v;
          if (c.render) v = c.render(r);
          else {
            const raw = c.get ? c.get(r) : r[c.key];
            v = c.fmt ? c.fmt(raw, r) : (raw == null ? '–' : raw);
          }
          return h('td', { class: (c.align === 'r' ? 'r num ' : c.align === 'c' ? 'c ' : '') + (c.cls || '') }, v);
        }));
      if (opts.onRowClick) tr.addEventListener('click', ev => { if (ev.target.closest('a,button')) return; opts.onRowClick(r, ev); });
      tbody.appendChild(tr);
    });
    clear(wrap).appendChild(h('table', { class: 'tbl' + (opts.compact ? ' compact' : '') }, thead, tbody));
    clear(pager);
    if (pages > 1) {
      pager.append(
        h('button', { class: 'btn-ghost sm', disabled: st.page === 0, onclick: () => { st.page--; render(); } }, '‹ Prev'),
        h('span', { class: 'muted' }, `Page ${st.page + 1} of ${pages} · ${sorted.length.toLocaleString()} rows`),
        h('button', { class: 'btn-ghost sm', disabled: st.page >= pages - 1, onclick: () => { st.page++; render(); } }, 'Next ›'));
    } else if (sorted.length) pager.append(h('span', { class: 'muted' }, `${sorted.length.toLocaleString()} row${sorted.length === 1 ? '' : 's'}`));
  }
  clear(bar);
  // plain-language column guide (from each column's title), so the meaning is one tap away on phones too
  const tips = cols.filter(tipOf);
  if (tips.length >= 2 && opts.guide !== false) {
    const panel = h('dl', { class: 'col-guide', hidden: true }, tips.map(c => [h('dt', {}, c.label), h('dd', {}, tipOf(c))]));
    const btn = h('button', { class: 'btn-ghost sm', type: 'button', 'aria-expanded': 'false', onclick: () => {
      panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); btn.textContent = panel.hidden ? 'What the columns mean' : 'Hide column guide';
    } }, 'What the columns mean');
    bar.appendChild(btn);
    root.insertBefore(panel, wrap);
  }
  if (opts.csvName) {
    bar.appendChild(h('button', { class: 'btn-ghost sm', type: 'button', onclick: () => {
      const sorted = sortRows();
      const head = allCols.filter(c => c.csv !== false).map(c => c.label);
      const body = sorted.map(r => allCols.filter(c => c.csv !== false).map(c => {
        if (typeof c.csv === 'function') return c.csv(r);
        const raw = c.get ? c.get(r) : r[c.key];
        return isNum(raw) ? +raw.toFixed(4) : raw;
      }));
      csvDownload(opts.csvName, [head, ...body]);
    } }, 'Export CSV'));
  }
  render();
  root.update = newRows => { rows = newRows; st.page = 0; render(); };
  return root;
}
