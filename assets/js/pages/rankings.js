// Power rankings (Elo) for players with multiple Challenger matches.
import { h, clear, fmtInt, fmtPct, fmt2, fmtDate, isNum, countryName, store, ageOn } from '../util.js';
import { D, F, aggregateFiltered, eloNow, runElo, METRICS, ACTIVE_WEEKS, periodEnd, activeSince, SEASON, seedLabel, isAdv, eloAsAtp } from '../data.js';
import { card, scatter, sparkline, formStrip } from '../charts.js';
import { pageHead, playerLink, selectEl, minMatchesControl, filterSummary, segmented } from '../components.js';
import { dataTable } from '../table.js';
import { parseHash, setQuery } from '../main.js';

export function render(root) {
  const q = parseHash().params;
  const st = {
    minM: +(q.min || store.get('ca-rank-min', 5)), country: q.country || 'all', hand: q.hand || 'all', age: q.age || 'all', search: '',
    active: (q.active || store.get('ca-rank-active', 'active')) === 'active',
  };
  const surf = F.surface !== 'all' ? F.surface : null;
  const carried = Object.values(D.players).some(p => p.s0 != null);
  root.appendChild(pageHead('Power rankings', surf ? `${surf}-court Elo rankings` : 'Challenger Elo rankings',
    h('span', {}, `Who is playing best right now. Elo is a rating that rises with every win and falls with every loss, by more when the opponent is strong: about 1,500 is qualifier level, 1,750 a typical main-draw player and 1,900+ top-100 form. `,
      h('span', { class: 'muted' }, `Built from every ${SEASON} Challenger singles match, starting from each player's ATP ranking on ${seedLabel()}${carried ? ` and final ${SEASON - 1} Elo` : ''}. ${surf ? 'Surface Elo uses only ' + surf.toLowerCase() + '-court matches. ' : ''}"Active" = played in the last ${ACTIVE_WEEKS} weeks. Showing: ${filterSummary()}. `),
      h('a', { href: '#/about' }, 'How it works'))));

  const agg = aggregateFiltered();
  const E = runElo(surf);
  const refT = periodEnd();
  const endT = F.period === 'all' ? Infinity : refT;
  const prevT = refT - 28 * 864e5;
  const activeT = activeSince();
  const eloAtT = (pid, t) => { const tl = E.tl.get(pid); if (!tl) return null; let v = null; for (const [x, r] of tl) { if (x <= t) v = r; else break; } return v; };

  const base = [...agg.values()].map(a => {
    const p = D.players[a.pid] || {};
    const tl = (E.tl.get(a.pid) || []).filter(x => x[0] <= endT);
    return {
      a, pid: a.pid, p, name: p.name || a.pid, c: p.c, elo: eloNow(a.pid, surf), prev: eloAtT(a.pid, prevT),
      peak: tl.length ? Math.max(...tl.map(x => x[1])) : null, spark: tl.slice(-25).map(x => x[1]),
      age: p.dob ? ageOn(p.dob) : null, atp: p.rk || null,
      winPct: a.w / a.m, hold: METRICS.hold.val(a), brk: METRICS.brk.val(a), dr: METRICS.dr.val(a), spw: METRICS.spw.val(a), rpw: METRICS.rpw.val(a),
      form: a.form.slice(-10), lastT: a.last ? a.last.t : 0, lastDate: a.last ? a.last.date : null,
    };
  }).filter(r => isNum(r.elo));

  const countries = [...new Set(base.map(r => r.c).filter(Boolean))].sort((x, y) => countryName(x).localeCompare(countryName(y)));
  const controls = h('div', { class: 'row', style: { marginBottom: '14px' } });
  const tableHost = h('div');
  const chartHost = h('div');
  const search = h('input', { type: 'search', placeholder: 'Find player…', style: { width: '180px' } });
  controls.append(
    segmented([['active', 'Active players'], ['all', 'All players']], st.active ? 'active' : 'all', v => { st.active = v === 'active'; store.set('ca-rank-active', v); sync(); }),
    minMatchesControl(st.minM, v => { st.minM = v; store.set('ca-rank-min', v); sync(); }),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Country'),
      selectEl([['all', 'All countries'], ...countries.map(c => [c, countryName(c)])], st.country, v => { st.country = v; sync(); })),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Plays'),
      segmented([['all', 'All'], ['R', 'Right'], ['L', 'Left']], st.hand, v => { st.hand = v; sync(); })),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Age'),
      selectEl([['all', 'All ages'], ['u21', '20 & under'], ['u23', '22 & under'], ['2427', '23 – 27'], ['28', '28 & over']], st.age, v => { st.age = v; sync(); })),
    h('span', { class: 'spacer' }), search);
  search.addEventListener('input', () => { st.search = search.value.trim().toLowerCase(); draw(); });
  root.append(controls, chartHost, tableHost);

  function rows() {
    const qualified = base.filter(r => r.a.m >= st.minM && (!st.active || r.lastT >= activeT));
    // overall rank among qualified players (before sub-filters), so a country view still shows the true rank
    const ranked = qualified.slice().sort((x, y) => y.elo - x.elo);
    const prevRanked = qualified.filter(r => isNum(r.prev)).sort((x, y) => y.prev - x.prev);
    const prevRank = new Map(prevRanked.map((r, i) => [r.pid, i + 1]));
    ranked.forEach((r, i) => { r.rank = i + 1; r.move = prevRank.has(r.pid) ? prevRank.get(r.pid) - r.rank : null; });
    return ranked.filter(r => (st.country === 'all' || r.c === st.country)
      && (st.hand === 'all' || r.p.h === st.hand)
      && (st.age === 'all' || (isNum(r.age) && (st.age === 'u21' ? r.age < 21 : st.age === 'u23' ? r.age < 23 : st.age === '2427' ? r.age >= 23 && r.age < 28 : r.age >= 28))));
  }
  function sync() { setQuery({ active: st.active ? null : 'all', min: st.minM, country: st.country !== 'all' ? st.country : null, hand: st.hand !== 'all' ? st.hand : null, age: st.age !== 'all' ? st.age : null }); draw(); }

  function draw() {
    const rs = rows();
    const shown = st.search ? rs.filter(r => r.name.toLowerCase().includes(st.search)) : rs;
    clear(chartHost);
    const pts = rs.filter(r => r.atp).slice(0, 400).map(r => ({
      x: Math.log10(r.atp), y: r.elo, label: r.name, id: r.pid, color: 'var(--series-1)',
      sub: `ATP #${r.atp} · Elo rank ${r.rank} · ${r.a.w}-${r.a.l}`,
    }));
    // "Under-ranked" = furthest above the Elo-vs-log(ATP rank) trend line (least-squares fit over the plotted players)
    const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / (n || 1), my = pts.reduce((a, p) => a + p.y, 0) / (n || 1);
    const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / (pts.reduce((a, p) => a + (p.x - mx) ** 2, 0) || 1);
    const top5 = new Set(rs.slice(0, 5).map(r => r.pid));
    const under = pts.filter(p => !top5.has(p.id)).map(p => ({ id: p.id, res: p.y - (my + slope * (p.x - mx)) })).sort((x, y) => y.res - x.res).slice(0, 4);
    const labelIds = new Set([...top5, ...under.map(x => x.id)]);
    for (const p of pts) if (labelIds.has(p.id)) { p.color = 'var(--series-2)'; p.hl = true; }
    const g = h('div', { class: 'grid g-21' });
    g.appendChild(card('Elo vs official ATP ranking', 'Each dot is a qualified player. Orange = top 5 by Elo and the four players furthest above the trend (Elo much higher than their ATP ranking suggests).', el => scatter(el, {
      points: pts, xLabel: 'ATP ranking (log scale, current week)', yLabel: surf ? surf + ' Elo' : 'Elo', height: 320,
      xFmt: v => '#' + fmtInt(Math.pow(10, v)), yFmt: fmtInt, xDomain: [0, Math.log10(Math.max(2000, ...rs.map(r => r.atp || 1)))],
      labelIds, onClick: p => { location.hash = '#/player/' + p.id; },
      legend: [{ label: 'Qualified player', color: 'var(--series-1)' }, { label: 'Top 5 by Elo / most under-ranked', color: 'var(--series-2)' }],
    }), { table: () => ({ cols: ['Player', 'ATP rank', 'Elo', 'Elo rank'], rows: rs.filter(r => r.atp).slice(0, 300).map(r => [r.name, r.atp, Math.round(r.elo), r.rank]) }) }));
    const movers = rs.filter(r => isNum(r.prev)).map(r => ({ r, d: r.elo - r.prev })).sort((x, y) => y.d - x.d);
    g.appendChild(card('Biggest movers', 'Elo points gained or lost over the last 4 weeks of the period', h('div', {},
      h('ul', { class: 'list-plain' }, movers.slice(0, 6).map(({ r, d }) => h('li', {}, playerLink(r.pid, { short: true }), h('span', { class: 'muted' }, '#' + r.rank), h('span', { class: 'val', style: { color: 'var(--good-ink)' } }, '▲ ' + fmtInt(d))))),
      h('ul', { class: 'list-plain', style: { marginTop: '6px' } }, movers.slice(-4).reverse().filter(x => x.d < 0).map(({ r, d }) => h('li', {}, playerLink(r.pid, { short: true }), h('span', { class: 'muted' }, '#' + r.rank), h('span', { class: 'val muted' }, '▼ ' + fmtInt(-d))))))));
    chartHost.appendChild(g);

    clear(tableHost);
    tableHost.appendChild(h('div', { class: 'mt' }, card(`${fmtInt(rs.length)} ranked players`, `Minimum ${st.minM} matches in view. Click a player for the full profile.`, dataTable({
      rows: shown, sortKey: 'elo', sortDir: -1, pageSize: 100, csvName: 'challenger-rankings.csv',
      onRowClick: r => { location.hash = '#/player/' + r.pid; },
      cols: [
        { key: 'rank', label: '#', align: 'r', sortDir: 1, fmt: fmtInt },
        { key: 'move', label: '4w', title: 'Places gained or lost in these rankings over the last 4 weeks', align: 'r', render: r => !isNum(r.move) || r.move === 0 ? h('span', { class: 'muted' }, '–') : h('span', { style: { color: r.move > 0 ? 'var(--good-ink)' : 'var(--muted)' } }, (r.move > 0 ? '▲' : '▼') + Math.abs(r.move)), csv: r => r.move },
        { key: 'name', label: 'Player', sortDir: 1, render: r => playerLink(r.pid), csv: r => r.name },
        { key: 'c', label: 'Nat', csvOnly: true },
        { key: 'age', label: 'Age', align: 'r', sortDir: 1, fmt: v => isNum(v) ? Math.floor(v) : '–' },
        { key: 'atp', label: 'ATP', title: 'Current official ATP singles ranking', align: 'r', sortDir: 1, fmt: v => v ? '#' + v : 'NR' },
        { key: 'elo', label: surf ? surf + ' Elo' : 'Elo', title: 'Rating from Challenger results: beating strong players raises it more. About 1,500 = qualifier level, 1,750 = typical main-draw player, 1,900+ = top-100 form', align: 'r', fmt: v => fmtInt(v) },
        ...(isAdv() || surf ? [] : [{ key: 'like', label: 'Plays like', title: 'The ATP ranking that players with this Elo usually hold: a quick way to read the rating', align: 'r', get: r => eloAsAtp(r.elo), fmt: v => (v ? `ATP #${v}` : '–'), sortDir: 1 }]),
        { key: 'spark', label: 'Trend', title: 'Elo over the last 25 matches', get: false, render: r => sparkline(r.spark), csv: false },
        { key: 'peak', adv: true, label: 'Peak', title: 'Highest Elo this season', align: 'r', fmt: fmtInt },
        { key: 'wl', label: 'W-L', align: 'r', get: r => r.a.w - r.a.l, render: r => `${r.a.w}-${r.a.l}`, csv: r => `${r.a.w}-${r.a.l}` },
        { key: 'winPct', label: 'Win %', align: 'r', fmt: fmtPct },
        { key: 'titles', label: 'Titles', align: 'r', get: r => r.a.titles, fmt: v => v || '–' },
        { key: 'hold', adv: true, label: 'Hold %', title: 'Share of service games won', align: 'r', fmt: fmtPct },
        { key: 'brk', adv: true, label: 'Break %', title: "Share of return games won (breaking the opponent's serve)", align: 'r', fmt: fmtPct },
        { key: 'dr', adv: true, label: 'DR', title: 'Dominance ratio: ' + METRICS.dr.desc, align: 'r', fmt: fmt2 },
        { key: 'lastT', label: 'Last match', align: 'r', render: r => r.lastDate ? fmtDate(r.lastDate) : '–', csv: r => r.lastDate },
        { key: 'form', label: 'Last 10', title: 'Results of the last 10 matches, oldest first (W = win, L = loss)', get: false, csv: false, render: r => formStrip(r.form.map(m => ({ won: m.w === r.pid, title: `${m.date} ${m.e?.city} ${m.rd} vs ${D.players[m.w === r.pid ? m.l : m.w]?.name || ''}` }))) },
      ],
    }))));
  }
  draw();
}
