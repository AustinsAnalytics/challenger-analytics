// Head-to-head comparison & match prediction.
import { h, clear, fmtInt, fmtPct, fmt1, fmtDate, isNum, ratio, SURFACES } from '../util.js';
import { D, F, passes, playerAgg, eloNow, runElo, METRICS, mval, tourAgg, filtered, eloProb, pMatchBo3, matchupServe, pGame, aggregateFiltered, activeSince, lazy, SEASON, seasonHref, isAdv } from '../data.js';
import { matchupPredict } from '../matchup.js';
import { STYLE, stylePool, likeness } from '../style.js';
import { card, compareRow, lineChart } from '../charts.js';
import { pairInputs } from '../predict.js';
import { pageHead, playerPicker, playerLink, matchCols, segmented, percentile, metricDistributions } from '../components.js';
import { dataTable } from '../table.js';
import { parseHash, setQuery } from '../main.js';

const CA = 'var(--series-1)', CB = 'var(--series-2)';
const american = d => (d >= 2 ? '+' + Math.round((d - 1) * 100) : '−' + Math.round(100 / (d - 1)));

export function render(root) {
  const q = parseHash().params;
  // sensible defaults: top two by Elo
  const agg = aggregateFiltered();
  const since = activeSince();
  const top = [...agg.values()].filter(a => a.m >= 10 && a.last && a.last.t >= since).map(a => [a.pid, eloNow(a.pid)]).filter(x => isNum(x[1])).sort((x, y) => y[1] - x[1]);
  const st = { a: (q.a || (top[0] && top[0][0]) || '').toUpperCase(), b: (q.b || (top[1] && top[1][0]) || '').toUpperCase(), surf: q.surf || (F.surface !== 'all' ? F.surface : 'Hard') };
  root.appendChild(pageHead('Head-to-head', 'Compare two players', 'Side-by-side profiles, their meetings, common opponents, and a model-based prediction for a best-of-three match.'));
  const pickA = playerPicker(st.a, id => { st.a = id; sync(); }, { placeholder: 'Player A…' });
  const pickB = playerPicker(st.b, id => { st.b = id; sync(); }, { placeholder: 'Player B…' });
  const body = h('div', { class: 'mt' });
  root.append(h('div', { class: 'grid g2' },
    h('div', {}, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'sdot', style: { background: CA } }), h('b', {}, 'Player A')), pickA),
    h('div', {}, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'sdot', style: { background: CB } }), h('b', {}, 'Player B')), pickB)), body);
  function sync() { setQuery({ a: st.a, b: st.b, surf: st.surf }); draw(); }
  // the betting model's per-player inputs and today's slate (both optional: the simple model below is the fallback)
  let MU = null, SLATE = null;
  Promise.all([lazy('data/matchup.json').catch(() => null), lazy('data/betting.json').catch(() => null)]).then(([mu, sl]) => {
    MU = mu; SLATE = sl;
    if (root.isConnected && (MU || SLATE)) draw();
  });
  function draw() {
    clear(body);
    if (!D.players[st.a] || !D.players[st.b] || st.a === st.b) { body.appendChild(h('div', { class: 'empty' }, 'Pick two different players.')); return; }
    const A = D.players[st.a], B = D.players[st.b];
    const msA = (D.byPlayer[st.a] || []).filter(m => passes(m)), msB = (D.byPlayer[st.b] || []).filter(m => passes(m));
    const meetings = (D.byPlayer[st.a] || []).filter(m => m.w === st.b || m.l === st.b).sort((x, y) => y.t - x.t);
    const winsA = meetings.filter(m => m.w === st.a).length;

    // prediction (shared with the match simulator: assets/js/predict.js)
    const { aA, aB, sA, sB, tourSpw, spwA, rpwA, spwB, rpwB, pa, pb, pMarkov, eA, eB, seA, seB, pElo, pBlend } = pairInputs(st.a, st.b, st.surf, msA, msB);

    const h2hNoRet = [meetings.filter(m => !m.flag && m.w === st.a).length, meetings.filter(m => !m.flag && m.w === st.b).length];
    const MP = MU ? matchupPredict(MU, st.a, st.b, st.surf, h2hNoRet) : null;
    const g = h('div', { class: 'grid g3' });
    const setsWon = pidX => meetings.reduce((x, mm) => x + mm.sets.filter(sv => (mm.w === pidX ? sv[0] > sv[1] : sv[1] > sv[0])).length, 0);
    const last = meetings[0];
    // playing styles: how alike, and the biggest contrast
    const SP = stylePool();
    const aggAll = aggregateFiltered();
    const styA = aggAll.get(st.a), styB = aggAll.get(st.b);
    let styleEl = null;
    if (styA && styB && styA.m >= 8 && styB.m >= 8 && SP.pool.length >= 30) {
      const za = SP.z(styA), zb = SP.z(styB);
      const i = za.map((v, k) => [Math.abs(v - zb[k]), k]).sort((x, y) => y[0] - x[0])[0][1];
      const M = METRICS[STYLE[i][0]];
      styleEl = h('div', { class: 'h2h-style' }, h('div', {}, h('b', {}, `${fmtInt(100 * likeness(za, zb))}% alike`), h('span', { class: 'muted' }, ' in serve, return and pressure numbers')),
        h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } }, `Biggest contrast: ${M.label.toLowerCase()}, ${A.short} ${M.fmt(M.val(styA))} vs ${B.short} ${M.fmt(M.val(styB))}.`));
    }
    const earlierHost = h('div');
    g.appendChild(card('Head-to-head', `${meetings.length} Challenger meeting${meetings.length === 1 ? '' : 's'} in ${SEASON}`, h('div', {},
      h('div', { style: { textAlign: 'center', padding: '8px 0' } },
        h('div', { class: 'hero-num' }, `${winsA}–${meetings.length - winsA}`),
        h('div', { class: 'muted', style: { marginTop: '6px' } }, !meetings.length ? 'No meetings yet'
          : winsA === meetings.length - winsA ? 'Level' : `${winsA > meetings.length - winsA ? A.short : B.short} leads`)),
      meetings.length ? h('dl', { class: 'kv' },
        h('dt', {}, 'Sets'), h('dd', {}, `${setsWon(st.a)}–${setsWon(st.b)}`),
        h('dt', {}, 'Last meeting'), h('dd', {}, h('a', { href: '#/match/' + last.id }, `${D.players[last.w]?.short} won ${last.sets.map(x => `${x[0]}-${x[1]}`).join(' ')}`), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${last.e?.city || ''} ${last.rd} · ${fmtDate(last.date)}`))) : null,
      styleEl, earlierHost)));
    lazy('data/h2h_history.json').then(H => earlierMeetings(earlierHost, H, st.a, st.b, winsA, meetings.length - winsA)).catch(() => {});
    const surfSeg = segmented(SURFACES.filter(s => D.matches.some(m => m.surface === s)).map(s => [s, s]), st.surf, v => { st.surf = v; sync(); });
    const predCard = MP ? card('Match prediction', `Best of 3 on ${st.surf.toLowerCase()} · the Betting tab's model (${MU.names.length} factors, calibrated) at a neutral venue with equal rest`, h('div', {},
      h('div', { class: 'mp-split' },
        h('div', {}, h('div', { class: 'mp-pct', style: { color: CA } }, fmtPct(MP.p)), h('div', { class: 'muted' }, `${A.short} · fair ${american(1 / MP.p)}`)),
        h('div', { class: 'r' }, h('div', { class: 'mp-pct', style: { color: CB } }, fmtPct(1 - MP.p)), h('div', { class: 'muted' }, `${B.short} · fair ${american(1 / (1 - MP.p))}`))),
      h('div', { class: 'mp-bar' }, h('span', { style: { width: (MP.p * 100).toFixed(1) + '%', background: CA } }), h('span', { style: { width: ((1 - MP.p) * 100).toFixed(1) + '%', background: CB } })),
      h('div', { class: 'mgroup', style: { marginTop: '12px' } }, 'What drives it'),
      h('div', { class: 'fbars' }, MP.factors.slice(0, isAdv() ? 5 : 3).map(f => h('div', { class: 'fbar' },
        h('div', { class: 'fbar-top' }, h('b', {}, f.label), h('span', { class: 'muted' }, `${Math.abs(f.pts).toFixed(1)} pts toward ${f.pts >= 0 ? A.short : B.short}`)),
        h('div', { class: 'fbar-track' }, h('span', { class: 'fbar-mid' }),
          h('span', { class: 'fbar-fill', style: { [f.pts >= 0 ? 'left' : 'right']: '50%', width: (50 * Math.min(1, Math.abs(f.pts) / Math.max(4, Math.abs(MP.factors[0].pts)))).toFixed(1) + '%', background: f.pts >= 0 ? CA : CB } }))))),
      h('div', { class: 'cmp-head', style: { marginTop: '10px' } }, h('b', {}, A.short), h('span', {}), h('b', { class: 'b' }, B.short)),
      isAdv() ? compareRow('Serve/return simulation', MP.raw.pm, 1 - MP.raw.pm, fmtPct, { better: 1 }) : null,
      compareRow('Expected serve points won', MP.raw.qa, MP.raw.qb, fmtPct, { better: 1 }),
      compareRow('Expected hold %', pGame(MP.raw.qa), pGame(MP.raw.qb), fmtPct, { better: 1 }),
      upcoming(),
      h('p', { class: 'muted bet-small' }, `Ratings and form as of ${fmtDate(MU.generated)}; ignores the filters above. Points = how much each factor moves the win probability, holding the others fixed.`)), { actions: surfSeg })
    : card('Match prediction', `Best of 3 on ${st.surf.toLowerCase()} · blends surface-weighted Elo (60%) with a point-level Markov model (40%)`, h('div', {},
      h('div', { class: 'cmp-head' }, h('b', {}, A.short), h('span', {}), h('b', { class: 'b' }, B.short)),
      compareRow('Win probability', pBlend, 1 - pBlend, fmtPct, { better: 1 }),
      isAdv() ? compareRow('Elo model', pElo, isNum(pElo) ? 1 - pElo : null, fmtPct, { better: 1 }) : null,
      isAdv() ? compareRow('Serve/return Markov model', pMarkov, 1 - pMarkov, fmtPct, { better: 1 }) : null,
      compareRow('Expected serve points won', pa, pb, fmtPct, { better: 1 }),
      compareRow('Expected hold %', pGame(pa), pGame(pb), fmtPct, { better: 1 }), upcoming()), { actions: surfSeg });
    g.appendChild(predCard);
    function upcoming() {
      const m = SLATE && (SLATE.matches || []).find(x => { const ids = x.players.map(p => p.pid); return ids.includes(st.a) && ids.includes(st.b); });
      if (!m) return null;
      const when = m.start ? new Date(m.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'time TBC';
      const pA = m.players[0].pid === st.a ? m.our : 1 - m.our;
      return h('a', { class: 'mp-next', href: '#/betting?match=' + encodeURIComponent(m.id) },
        h('b', {}, 'They play next: '), `${m.city}${m.surface ? ' (' + m.surface.toLowerCase() + ')' : ''}, ${when}. Our line ${A.short} ${fmtPct(pA)} with rest, travel and the market included · odds →`);
    }
    g.appendChild(card('At a glance', null, h('div', {},
      h('div', { class: 'cmp-head' }, h('b', {}, A.short), h('span', {}), h('b', { class: 'b' }, B.short)),
      compareRow('Elo', eA, eB, fmtInt, { raw: [fmtInt(eA), fmtInt(eB)] }),
      compareRow('ATP ranking', A.rk ? -A.rk : null, B.rk ? -B.rk : null, v => '', { raw: [A.rk ? '#' + A.rk : 'NR', B.rk ? '#' + B.rk : 'NR'] }),
      compareRow('Record', aA.w / aA.m, aB.w / aB.m, fmtPct, { raw: [`${aA.w}-${aA.l}`, `${aB.w}-${aB.l}`] }),
      compareRow('Titles', aA.titles, aB.titles, fmtInt),
      compareRow('Age', A.dob ? -Date.parse(A.dob) : null, B.dob ? -Date.parse(B.dob) : null, () => '', { better: 0, raw: [A.dob ? String(Math.floor((Date.now() - Date.parse(A.dob)) / 3.156e10)) : '–', B.dob ? String(Math.floor((Date.now() - Date.parse(B.dob)) / 3.156e10)) : '–'] }))));
    body.appendChild(g);

    // Elo trajectories
    const tA = runElo(null).tl.get(st.a) || [], tB = runElo(null).tl.get(st.b) || [];
    body.appendChild(h('div', { class: 'mt' }, card('Elo through the season', null, el => lineChart(el, {
      series: [{ name: A.short, color: CA, values: tA.map(([t, r]) => ({ x: t, y: r })) }, { name: B.short, color: CB, values: tB.map(([t, r]) => ({ x: t, y: r })) }],
      xType: 'time', yFmt: fmtInt, height: 260, endLabels: true,
    }))));

    // stats comparison
    const groups = [['Serve', ['acePct', 'dfPct', 'firstIn', 'firstWon', 'secondWon', 'spw', 'hold']], ['Return', ['r1', 'r2', 'rpw', 'brk', 'bpConv']], ['Pressure & style', ['bpSaved', 'tbPct', 'decPct', 'bigServe', 'winnersPerM', 'uePerM', 'wUe']]];
    const g2 = h('div', { class: 'grid g3 mt' });
    for (const [title, keys] of groups) {
      g2.appendChild(card(title, 'Under the current filters', h('div', {},
        h('div', { class: 'cmp-head' }, h('b', {}, A.short), h('span', {}), h('b', { class: 'b' }, B.short)),
        keys.map(k => compareRow(METRICS[k].label, mval(k, aA), mval(k, aB), METRICS[k].fmt, { better: METRICS[k].dir })))));
    }
    body.appendChild(g2);

    // common opponents
    const oppA = new Map(), oppB = new Map();
    for (const m of msA) { const o = m.w === st.a ? m.l : m.w; const r = oppA.get(o) || [0, 0]; r[m.w === st.a ? 0 : 1]++; oppA.set(o, r); }
    for (const m of msB) { const o = m.w === st.b ? m.l : m.w; const r = oppB.get(o) || [0, 0]; r[m.w === st.b ? 0 : 1]++; oppB.set(o, r); }
    const common = [...oppA.keys()].filter(o => oppB.has(o) && o !== st.a && o !== st.b).map(o => ({ o, a: oppA.get(o), b: oppB.get(o) }));
    const g3 = h('div', { class: 'grid g2 mt' });
    g3.appendChild(card('Meetings', null, meetings.length ? h('div', {}, dataTable({ rows: meetings, sortKey: 'date', pageSize: 10, sticky: false, compact: true, cols: matchCols(st.a), onRowClick: m => { location.hash = '#/match/' + m.id; } })) : h('div', { class: 'empty' }, `They have not met on the Challenger Tour in ${SEASON}.`)));
    g3.appendChild(card('Common opponents', `${common.length} shared opponents`, common.length ? h('div', {}, dataTable({
      rows: common, sortKey: 'n', pageSize: 12, sticky: false, compact: true, cols: [
        { key: 'o', label: 'Opponent', get: r => D.players[r.o]?.name, render: r => playerLink(r.o, { short: true }), sortDir: 1 },
        { key: 'n', label: 'Matches', align: 'r', get: r => r.a[0] + r.a[1] + r.b[0] + r.b[1] },
        { key: 'ra', label: A.short, align: 'r', get: r => r.a[0] - r.a[1], render: r => `${r.a[0]}-${r.a[1]}` },
        { key: 'rb', label: B.short, align: 'r', get: r => r.b[0] - r.b[1], render: r => `${r.b[0]}-${r.b[1]}` },
      ],
    })) : h('div', { class: 'empty' }, 'No common opponents under these filters.')));
    body.appendChild(g3);
  }
  draw();
}

/** Meetings in earlier seasons (data/h2h_history.json), with the all-time Challenger head-to-head. */
function earlierMeetings(host, H, a, b, winsA, winsB) {
  const C = Object.fromEntries(H.cols.map((c, i) => [c, i]));
  const rows = H.rows.filter(r => r[C.season] < SEASON && ((r[C.w] === a && r[C.l] === b) || (r[C.w] === b && r[C.l] === a)))
    .sort((x, y) => (y[C.date] || '').localeCompare(x[C.date] || ''));
  if (!rows.length) return;
  const ea = rows.filter(r => r[C.w] === a).length, eb = rows.length - ea;
  const nm = pid => D.players[pid]?.short || pid;
  host.appendChild(h('div', { class: 'h2h-earlier' },
    h('div', { class: 'mgroup' }, `Earlier seasons: ${nm(a)} ${ea}–${eb} ${nm(b)} · all-time ${winsA + ea}–${winsB + eb}`),
    h('ul', { class: 'list-plain' }, rows.slice(0, 6).map(r => h('li', {},
      h('a', { href: seasonHref(r[C.season], '#/match/' + r[C.id]) }, `${nm(r[C.w])} won ${r[C.score]}`),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, ` ${r[C.season]} · ${r[C.city] || ''} ${r[C.rd]}`))))));
}
