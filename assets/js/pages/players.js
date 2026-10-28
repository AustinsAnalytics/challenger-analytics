// Player directory + full stats explorer.
import { h, clear, fmtInt, fmtPct, isNum, countryName, store, ageOn } from '../util.js';
import { D, aggregateFiltered, eloNow, METRICS, mval, isAdv } from '../data.js';
import { pageHead, playerLink, selectEl, minMatchesControl, segmented, filterSummary } from '../components.js';
import { dataTable } from '../table.js';
import { parseHash, setQuery } from '../main.js';

// simple: the stats shown in simple mode (with full labels); adv: the view itself is advanced-only
const VIEWS = {
  overview: { label: 'Overview', simple: ['elo', 'winPct', 'titles', 'vsTop100'], keys: ['elo', 'winPct', 'titles', 'setsPct', 'gamesPct', 'tpw', 'dr', 'overExp', 'vsTop100'] },
  serve: { label: 'Serve', simple: ['acePct', 'firstIn', 'hold', 'acesPerM'], keys: ['acePct', 'dfPct', 'firstIn', 'firstWon', 'secondWon', 'spw', 'hold', 'bpFacedPerSg', 'serveRating', 'firstPt', 'loveHold'] },
  return: { label: 'Return', simple: ['rpw', 'brk', 'bpConv'], keys: ['rpw', 'r1', 'r2', 'brk', 'bpOppPerRg', 'oppAce', 'returnRating'] },
  pressure: { label: 'Pressure', simple: ['bpSaved', 'bpConv', 'tbPct', 'decPct', 'comeback'], keys: ['bpSaved', 'bpConv', 'tbPct', 'decPct', 'bigServe', 'bigReturn', 'clutch', 'comeback', 'closeOut', 'pressureRating'] },
  endings: { label: 'Point endings', adv: true, keys: ['winnersPerM', 'uePerM', 'wUe', 'winnerPct', 'uePct', 'feInduced', 'aggression', 'fhWue', 'bhWue', 'fhShare'] },
  rally: { label: 'Rally & speed (Hawk-Eye)', adv: true, keys: ['rally4', 'rally8', 'rally9', 'avgRally', 'netPct', 'netFreq', 'v1', 'v2', 'vmax'] },
};

export function render(root) {
  const q = parseHash().params;
  const st = { view: q.view || 'overview', minM: +(q.min || store.get('ca-players-min', 3)), country: q.country || 'all', search: q.q || '' };
  root.appendChild(pageHead('Players', 'Player explorer',
    `Every player with a Challenger singles match in view (${filterSummary()}). Switch stat groups, sort any column, export to CSV, or open a profile.`));
  const agg = aggregateFiltered();
  const all = [...agg.values()].map(a => {
    const p = D.players[a.pid] || {};
    return { a, pid: a.pid, p, name: p.name || a.pid, c: p.c, age: p.dob ? ageOn(p.dob) : null, atp: p.rk || null };
  });
  const countries = [...new Set(all.map(r => r.c).filter(Boolean))].sort((x, y) => countryName(x).localeCompare(countryName(y)));
  const search = h('input', { type: 'search', placeholder: 'Search by name…', value: st.search, style: { width: '200px' } });
  const host = h('div', { class: 'mt' });
  if (VIEWS[st.view]?.adv && !isAdv()) st.view = 'overview';
  const viewSeg = segmented(Object.entries(VIEWS).filter(([, v]) => !v.adv || isAdv()).map(([k, v]) => [k, v.label]), st.view, v => { st.view = v; sync(); });
  root.append(h('div', { class: 'row' }, viewSeg),
    h('div', { class: 'row mt' },
      minMatchesControl(st.minM, v => { st.minM = v; store.set('ca-players-min', v); sync(); }, [1, 2, 3, 5, 10, 15, 20, 30]),
      h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Country'),
        selectEl([['all', 'All countries'], ...countries.map(c => [c, countryName(c)])], st.country, v => { st.country = v; sync(); })),
      h('span', { class: 'spacer' }), search),
    host);
  search.addEventListener('input', () => { st.search = search.value.trim(); draw(); });
  function sync() { setQuery({ view: st.view, min: st.minM, country: st.country !== 'all' ? st.country : null }); draw(); }
  function draw() {
    const v0 = VIEWS[st.view] || VIEWS.overview;
    const view = isAdv() ? v0 : { ...v0, keys: v0.simple };
    const s = st.search.toLowerCase();
    const rows = all.filter(r => r.a.m >= st.minM && (st.country === 'all' || r.c === st.country) && (!s || r.name.toLowerCase().includes(s)));
    for (const r of rows) for (const k of view.keys) r[k] = k === 'elo' ? eloNow(r.pid) : mval(k, r.a);
    const sortKey = view.keys[0];
    clear(host).appendChild(dataTable({
      rows, sortKey, sortDir: METRICS[sortKey].dir < 0 ? 1 : -1, pageSize: 50, rank: true, csvName: `challenger-players-${st.view}.csv`,
      onRowClick: r => { location.hash = '#/player/' + r.pid; },
      cols: [
        { key: 'name', label: 'Player', sortDir: 1, render: r => playerLink(r.pid), csv: r => r.name },
        { key: 'c', label: 'Nat', csvOnly: true },
        { key: 'age', label: 'Age', align: 'r', sortDir: 1, fmt: v => isNum(v) ? Math.floor(v) : '–' },
        { key: 'atp', label: 'ATP', align: 'r', sortDir: 1, fmt: v => v ? '#' + v : 'NR' },
        { key: 'm', label: isAdv() ? 'M' : 'Matches', title: 'Matches', align: 'r', get: r => r.a.m, fmt: fmtInt },
        { key: 'wl', label: 'W-L', align: 'r', get: r => r.a.w, render: r => `${r.a.w}-${r.a.l}`, csv: r => `${r.a.w}-${r.a.l}` },
        ...view.keys.map(k => ({ key: k, label: isAdv() ? METRICS[k].short : METRICS[k].label.replace(/ %$/, ' %'), title: METRICS[k].label + (METRICS[k].desc ? ' — ' + METRICS[k].desc : ''), align: 'r', sortDir: METRICS[k].dir < 0 ? 1 : -1, fmt: v => isNum(v) ? METRICS[k].fmt(v) : '–' })),
      ],
    }));
  }
  draw();
}
