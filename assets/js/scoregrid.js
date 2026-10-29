// Serve points won at every game score (server's view), as a grid: rows = server's points, columns = receiver's.
// Data: data/serve_states.json from pipeline/drama.py ({states: [...], players: {pid | '_tour': [[played, won], ...]}}).
import { h, fmtPct, fmtInt, isNum } from './util.js';
import { showTip, hideTip } from './charts.js';

const ROWS = ['0', '15', '30', '40', 'AD'], COLS = ['0', '15', '30', '40', 'AD'];
const cellKey = (r, c) => {
  if (r === '40' && c === '40') return '40-40';
  if (r === 'AD' && c === '40') return 'AD-40';
  if (r === '40' && c === 'AD') return '40-AD';
  if (r === 'AD' || c === 'AD') return null;
  return `${r}-${c}`;
};

/**
 * cells: [[played, won], ...] in `states` order; ref: same shape (what to compare with).
 * refLabel: e.g. 'his average' or 'tour'; relative: compare each cell with the player's overall rate instead of ref cells.
 */
export function scoreGrid({ states, cells, ref, relative = false, refLabel = 'tour', minN = 25 }) {
  const ix = Object.fromEntries(states.map((k, i) => [k, i]));
  const tot = cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  const base = tot[0] ? tot[1] / tot[0] : null;
  const rate = (arr, k) => { const c = arr[ix[k]]; return c && c[0] ? c[1] / c[0] : null; };
  const table = h('table', { class: 'sgrid' },
    h('thead', {}, h('tr', {}, h('th', { class: 'corner' }, h('span', {}, 'Receiver →'), h('span', {}, 'Server ↓')), COLS.map(c => h('th', {}, c)))),
    h('tbody', {}, ROWS.map(r => h('tr', {}, h('th', {}, r), COLS.map(c => {
      const k = cellKey(r, c);
      if (!k || ix[k] == null) return h('td', { class: 'empty' });
      const [n, w] = cells[ix[k]] || [0, 0];
      const v = n ? w / n : null;
      const cmp = relative ? base : rate(ref, k);
      const d = isNum(v) && isNum(cmp) ? v - cmp : null;
      const small = n < minN;
      const shade = isNum(d) && !small ? Math.max(-1, Math.min(1, d / 0.08)) : 0;
      const td = h('td', { class: small ? 'small' : '', style: { background: shade >= 0 ? `color-mix(in srgb, var(--good) ${Math.round(shade * 45)}%, transparent)` : `color-mix(in srgb, var(--series-2) ${Math.round(-shade * 45)}%, transparent)` } },
        h('b', {}, isNum(v) ? fmtPct(v).replace(/\.\d%$/, '%') : '–'),
        h('span', {}, isNum(d) && !small ? `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}` : small ? `n=${n}` : ''));
      td.addEventListener('pointermove', ev => showTip(ev, `${k === '40-40' ? 'Deuce' : k} (server first)`, [
        { value: isNum(v) ? fmtPct(v) : '–', label: 'serve points won' }, { value: fmtInt(n), label: 'points' },
        { value: isNum(cmp) ? fmtPct(cmp) : '–', label: relative ? refLabel : `${refLabel} at this score` }]));
      td.addEventListener('pointerleave', hideTip);
      return td;
    })))));
  return h('div', { class: 'sgrid-wrap' }, table);
}
