// Stat leaderboards.
import { h, clear, isNum, store } from '../util.js';
import { D, aggregateFiltered, eloNow, METRICS, METRIC_GROUPS, mval, tourAgg, filtered } from '../data.js';
import { card, barChart } from '../charts.js';
import { pageHead, playerLink, minMatchesControl, segmented, selectEl, filterSummary } from '../components.js';
import { parseHash, setQuery } from '../main.js';

export function render(root) {
  const q = parseHash().params;
  const st = { group: q.group || 'Serve', minM: +(q.min || store.get('ca-lead-min', 10)), metric: q.metric || 'hold', order: q.order || 'best' };
  root.appendChild(pageHead('Leaderboards', 'Stat leaders', `Top performers in every category — ${filterSummary()}. Players need the minimum number of matches (and enough sample for each stat) to qualify.`));
  const agg = aggregateFiltered();
  const tour = tourAgg(filtered());
  const focus = h('div');
  const grid = h('div', { class: 'grid g3 mt' });
  const metricOpts = Object.values(METRICS).filter(m => m.key !== 'elo').map(m => [m.key, `${m.group} · ${m.label}`]);
  root.append(
    h('div', { class: 'row' },
      minMatchesControl(st.minM, v => { st.minM = v; store.set('ca-lead-min', v); sync(); }, [3, 5, 8, 10, 15, 20, 30]),
      h('span', { class: 'spacer' }),
      segmented(METRIC_GROUPS.map(g => [g, g]), st.group, v => { st.group = v; sync(); })),
    h('div', { class: 'mt' }, focus), grid);
  function sync() { setQuery({ group: st.group, min: st.minM, metric: st.metric, order: st.order !== 'best' ? st.order : null }); draw(); }
  function ranked(key) {
    const m = METRICS[key];
    const out = [];
    for (const a of agg.values()) {
      if (a.m < st.minM) continue;
      if (m.n && m.n(a) < st.minM * 0.5) continue;
      const v = key === 'elo' ? eloNow(a.pid) : mval(key, a);
      if (isNum(v)) out.push({ a, v });
    }
    const dir = m.dir === 0 ? 1 : m.dir;
    return out.sort((x, y) => dir * (y.v - x.v));
  }
  function draw() {
    clear(focus);
    const m = METRICS[st.metric] || METRICS.hold;
    let list = ranked(m.key);
    if (st.order === 'worst') list = list.slice().reverse();
    const top = list.slice(0, 25);
    focus.appendChild(card(m.label, `${list.length} qualified players${m.noAvg ? '' : ' · tour average ' + m.fmt(mval(m.key, tour))}${m.desc ? ' · ' + m.desc : ''}`, el => barChart(el, {
      data: top.map(x => ({ label: D.players[x.a.pid]?.name || x.a.pid, value: x.v, note: `${x.a.w}-${x.a.l} in ${x.a.m} matches`, onClick: () => { location.hash = '#/player/' + x.a.pid; } })),
      fmt: m.fmt, barH: 14, gap: 7, ref: m.noAvg ? undefined : mval(m.key, tour), labelWidth: 190,
    }), {
      actions: h('div', { class: 'row', style: { gap: '6px' } },
        selectEl(metricOpts, m.key, v => { st.metric = v; sync(); }, { 'aria-label': 'Metric' }),
        segmented([['best', 'Top'], ['worst', 'Bottom']], st.order, v => { st.order = v; sync(); })),
      table: () => ({ cols: ['#', 'Player', m.short, 'Matches'], rows: list.map((x, i) => [i + 1, D.players[x.a.pid]?.name, m.fmt(x.v), x.a.m]) }),
    }));
    clear(grid);
    const keys = Object.values(METRICS).filter(x => x.group === st.group && x.key !== 'elo');
    for (const mm of keys) {
      const r = ranked(mm.key).slice(0, 10);
      grid.appendChild(card(mm.label, mm.noAvg ? (mm.desc || null) : `Tour avg ${mm.fmt(mval(mm.key, tour))}`, h('ul', { class: 'list-plain' },
        r.length ? r.map((x, i) => h('li', {}, h('span', { class: 'rank-n' }, i + 1), playerLink(x.a.pid, { short: true }), h('span', { class: 'val' }, mm.fmt(x.v))))
          : h('li', { class: 'muted' }, 'Not enough data under these filters')),
      { actions: h('button', { class: 'btn-ghost sm', type: 'button', onclick: () => { st.metric = mm.key; sync(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Chart') }));
    }
  }
  draw();
}
