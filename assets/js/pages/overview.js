// Season dashboard.
import { h, fmtInt, fmtPct, fmt1, fmtCompact, fmtMin, fmtDate, isNum, ratio, SURFACES, ROUND_ORDER, countryChip } from '../util.js';
import { D, F, filtered, filteredEvents, aggregateFiltered, eloNow, tourAgg, METRICS, surfaceColorVar, activeSince, ACTIVE_WEEKS, lazy, SEASON, PAST } from '../data.js';
import { card, columnChart, barChart, sparkline } from '../charts.js';
import { pageHead, tiles, playerLink, eventLink, surfaceDot, filterSummary, matchHref } from '../components.js';
import { updatedLabel } from '../main.js';
import { dataTable } from '../table.js';
import { drawTree, titleOdds } from './tournament.js';

export function render(root) {
  const ms = filtered();
  const evs = filteredEvents();
  const agg = aggregateFiltered();
  const K = D.K;
  const tour = tourAgg(ms);
  const withStats = ms.filter(m => m.ws);
  const sum = (arr, f) => arr.reduce((a, m) => a + (f(m) || 0), 0);
  const aces = sum(withStats, m => (m.ws[K.ace] || 0) + (m.ls[K.ace] || 0));
  const points = sum(withStats, m => m.ws[K.tp] || 0);
  const lens = ms.filter(m => isNum(m.mins) && !m.flag && m.mins > 20);
  const threeSets = ms.filter(m => !m.flag && m.sets.length === 3).length;
  const decided = ms.filter(m => !m.flag && m.sets.length >= 2).length;
  const tbSets = sum(ms, m => m.sets.filter(([a, b, tb]) => tb != null || (Math.max(a, b) === 7 && Math.min(a, b) === 6)).length);
  const setsN = sum(ms, m => m.sets.length);
  const elo = ms.filter(m => m.pWin != null);
  const upsets = elo.filter(m => m.pWin < 0.5).length;
  const players = new Set(ms.flatMap(m => [m.w, m.l]));
  const finals = evs.filter(e => e.champ);

  const timedAvg = ratio(sum(lens, m => m.mins), lens.length);
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'eyebrow' }, `ATP Challenger Tour · ${SEASON} season${PAST ? ' · complete' : ''}`),
    h('h1', {}, `Every Challenger match of ${SEASON}, `, h('em', {}, 'decoded'), '.'),
    h('p', {}, `Elo power rankings, serve and return profiles, point-by-point momentum and Hawk-Eye ball tracking — ${filterSummary().toLowerCase()}.`),
    h('div', { class: 'hero-stats' },
      heroStat(fmtInt(ms.length), 'singles matches'),
      heroStat(fmtInt(evs.length), 'tournaments'),
      heroStat(fmtInt(players.size), 'players'),
      heroStat(fmtCompact(points), 'points played'),
      heroStat(fmtCompact(aces), 'aces')),
    h('div', { class: 'hero-meta' },
      PAST ? h('span', { class: 'chip' }, `Final standings · ${D.eventList.length} events`) : h('span', { class: 'chip' }, h('span', { class: 'live-dot' }), 'Updated ' + updatedLabel()),
      h('span', { class: 'chip' }, `${fmtInt(ms.filter(m => m.hasCV).length)} Hawk-Eye tracked matches`),
      h('a', { class: 'chip', href: '#/rankings' }, 'Power rankings →')));
  root.appendChild(hero);
  // where to start
  const liveN = evs.filter(e => e.status === 'live').length;
  const quick = [
    ['Find a player', `Profiles for all ${fmtInt(players.size)} players: form, ratings, strengths`, null, () => document.querySelector('#search input')?.focus()],
    [PAST ? 'Tournaments' : 'This week', PAST ? `All ${evs.length} events, champions and draws` : `${liveN} tournament${liveN === 1 ? '' : 's'} in progress, title chances live`, '#/tournaments'],
    ['Play', 'Guess today\u2019s mystery player, or simulate any match point by point', '#/play'],
    PAST ? ['Insights', 'Upsets, comebacks, ages, nations and what predicts wins', '#/insights'] : ['Next matches', "Tomorrow's matches with our odds and the sportsbooks'", '#/betting'],
  ];
  root.appendChild(h('nav', { class: 'quick', 'aria-label': 'Start here' }, quick.map(([t, d, href, fn]) => {
    const el = h(href ? 'a' : 'button', { class: 'quick-item', ...(href ? { href } : { type: 'button' }) }, h('b', {}, t), h('span', {}, d), h('i', { 'aria-hidden': 'true' }, '→'));
    if (fn) el.addEventListener('click', fn);
    return el;
  })));
  root.appendChild(tiles([
    { label: 'Completed events', value: fmtInt(finals.length), delta: `${evs.filter(e => e.status === 'live').length} in progress · ${evs.filter(e => e.status === 'nofinal').length} ended without a final` },
    { label: 'Qualifying matches', value: fmtInt(ms.filter(m => m.q).length), delta: fmtPct(ratio(ms.filter(m => m.q).length, ms.length)) + ' of all matches' },
    { label: 'Average match', value: fmtMin(timedAvg), delta: `${fmtPct(ratio(threeSets, decided))} go to a 3rd set` },
    { label: 'Tiebreak sets', value: fmtPct(ratio(tbSets, setsN)), delta: `${fmtInt(tbSets)} of ${fmtInt(setsN)} sets` },
    { label: 'Elo upsets', value: fmtPct(ratio(upsets, elo.length)), delta: 'underdog won the match' },
    { label: 'Service holds', value: fmtPct(METRICS.hold.val(tour)), delta: 'all players combined' },
  ]));

  // Latest results feed + events in progress
  const latestDay = ms.reduce((a, m) => (m.date && m.date > a ? m.date : a), '');
  const latest = ms.filter(m => m.date === latestDay).sort((a, b) => (ROUND_ORDER[b.rd] || 0) - (ROUND_ORDER[a.rd] || 0)).slice(0, 12);
  const live = evs.filter(e => e.status === 'live');
  if (latest.length) {
    const feedCard = card(`${PAST ? 'Last day of the season' : 'Latest results'} · ${fmtDate(latestDay, true)}`, live.length ? h('span', {}, 'In progress: ', live.map((e, i) => [i ? ', ' : '', eventLink(e)])) : 'Most recent day of play in view', h('div', { class: 'feed' }, latest.map(feedItem)),
      { actions: h('a', { class: 'btn sm', href: '#/matches' }, 'All matches') });
    root.appendChild(h('div', { class: 'mt' }, feedCard));
  }

  // Title races (live odds from the draw) and this week's great escapes (win probability)
  const raceHost = h('div', { class: 'grid g2 mt' });
  root.appendChild(raceHost);
  const races = live.map(e => {
    const tree = drawTree((e.matches || []).filter(m => !m.q));
    if (!tree) return null;
    const t = [...titleOdds(tree, 'now').title.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
    return t.length ? { e, t } : null;
  }).filter(Boolean);
  if (races.length) {
    raceHost.appendChild(card('Title races this week', 'Live title chances: results so far are fixed, the rest of each draw is played out with Elo', h('div', { class: 'races' },
      races.map(({ e, t }) => h('a', { class: 'race', href: '#/tournament/' + e.id, 'data-eid': e.id },
        h('div', { class: 'race-ev' }, surfaceDot(e.surface), h('b', {}, e.city), h('span', { class: 'muted' }, ` · ${t.length} left`)),
        t.slice(0, 3).map(([pid, p]) => h('div', { class: 'race-row' }, h('span', { class: 'ellipsis' }, D.players[pid]?.short || pid),
          h('span', { class: 'race-bar' }, h('span', { style: { width: (p * 100).toFixed(1) + '%' } })), h('span', { class: 'num' }, fmtPct(p)))))))));
  }
  // last year's champion under each title race
  if (races.length) lazy('data/seasons.json').then(S => {
    const prev = S.events[SEASON - 1] || {};
    for (const el of raceHost.querySelectorAll('.race[data-eid]')) {
      const c = (prev[el.dataset.eid] || [])[0];
      if (!c) continue;
      const nm = D.players[c]?.short || (S.names[c] || [c])[0];
      const alive = (D.events[el.dataset.eid]?.matches || []).some(m => m.l === c) ? 'out' : (D.events[el.dataset.eid]?.matches || []).some(m => m.w === c) ? 'still in' : 'absent';
      el.appendChild(h('div', { class: 'race-dc muted' }, `${SEASON - 1} champ ${nm} · ${alive}`));
    }
  }).catch(() => {});
  lazy('data/drama.json').then(dr => {
    const since = latestDay ? new Date(Date.parse(latestDay) - 7 * 864e5).toISOString().slice(0, 10) : '';
    const recent = ms.filter(m => m.date >= since && dr.byMatch[m.id] && dr.byMatch[m.id][0] < 0.2).sort((a, b) => dr.byMatch[a.id][0] - dr.byMatch[b.id][0]).slice(0, 5);
    if (!recent.length) return;
    raceHost.appendChild(card(PAST ? 'Great escapes in the final week' : 'Great escapes this week', 'Lowest chance the winner had during the match, from the win-probability line', h('ul', { class: 'list-plain' },
      recent.map(m => { const [lo, mps] = dr.byMatch[m.id]; return h('li', {}, h('a', { href: '#/match/' + m.id + '?tab=flow' }, `${D.players[m.w]?.short} d. ${D.players[m.l]?.short}`),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, ` ${m.e?.city || ''} ${m.rd}${mps ? ` · saved ${mps} MP${mps > 1 ? 's' : ''}` : ''}`), h('span', { class: 'val' }, lo >= 0.01 ? fmtPct(lo) : '<1%')); })),
      { actions: h('a', { class: 'btn sm', href: '#/insights' }, 'All escapes') }));
  }).catch(() => {});

  // Betting teaser: value spots first, then the most confident prices
  const betHost = h('div', { class: 'mt' });
  root.appendChild(betHost);
  lazy('data/betting.json').then(B => {
    if (!B || !B.matches || !B.matches.length) return;
    const now = Date.now();
    const up = B.matches.filter(m => !m.start || Date.parse(m.start) > now);
    if (!up.length) return;
    const pick = up.slice().sort((a, b) => (!!b.value - !!a.value) || ((b.value?.ev || 0) - (a.value?.ev || 0)) || Math.abs(b.our - 0.5) - Math.abs(a.our - 0.5)).slice(0, 6);
    const am = d => { const a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); return a > 0 ? '+' + a : '−' + Math.abs(a); };
    betHost.appendChild(card('Next-day betting slate', `${up.length} upcoming matches priced by our model and ${B.books.length} sportsbooks/exchanges`, h('div', { class: 'feed' }, pick.map(m => {
      const fav = m.our >= 0.5 ? 0 : 1, pl = m.players[fav], ourP = fav === 0 ? m.our : 1 - m.our;
      const best = m.market && m.market.best[fav];
      const t = m.start ? new Date(m.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'time TBC';
      return h('a', { class: 'feed-item', href: '#/betting' + (m.eid ? '?event=' + m.eid : '') },
        h('div', { class: 'feed-top' }, h('span', {}, surfaceDot(m.surface), `${m.city} · ${t}`), m.value ? h('span', { class: 'badge value-badge' }, 'VALUE') : h('span', {}, '')),
        h('div', { class: 'feed-p w' }, h('span', { class: 'plink' }, pl.cc ? countryChip(pl.cc) : null, pl.name), h('span', { class: 'sc' }, fmtPct(ourP))),
        h('div', { class: 'feed-p' }, h('span', { class: 'plink' }, 'vs ', m.players[1 - fav].name), h('span', { class: 'sc muted' }, best ? `best ${am(best.dec)}` : 'no odds')));
    })), { actions: h('a', { class: 'btn sm', href: '#/betting' }, 'Open the slate') }));
  }).catch(() => {});

  // Weekly volume by surface
  const weeks = new Map();
  for (const m of ms) {
    if (!m.t) continue;
    const d = new Date(m.t); const day = (d.getUTCDay() + 6) % 7;
    const wk = m.t - day * 864e5;
    const w = weeks.get(wk) || { parts: {}, n: 0 };
    w.parts[m.surface] = (w.parts[m.surface] || 0) + 1; w.n++;
    weeks.set(wk, w);
  }
  const surfaces = SURFACES.filter(s => ms.some(m => m.surface === s));
  const weekData = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([t, w]) => ({ label: fmtDate(new Date(t).toISOString().slice(0, 10)), tipTitle: 'Week of ' + fmtDate(new Date(t).toISOString().slice(0, 10)), parts: w.parts }));
  const g1 = h('div', { class: 'grid g-21 mt' });
  g1.appendChild(card('Matches per week', 'Singles matches played each week, by surface', el => columnChart(el, {
    data: weekData, stacked: surfaces.map(s => ({ key: s, label: s, color: surfaceColorVar(s) })), fmt: fmtInt, height: 240, rotate: weekData.length > 20,
  }), { table: () => ({ cols: ['Week', ...surfaces, 'Total'], rows: weekData.map(w => [w.label, ...surfaces.map(s => w.parts[s] || 0), surfaces.reduce((a, s) => a + (w.parts[s] || 0), 0)]) }) }));

  // Surface fingerprints
  const surfRows = surfaces.map(s => {
    const sm = ms.filter(m => m.surface === s);
    const t = tourAgg(sm);
    const l = sm.filter(m => isNum(m.mins) && !m.flag && m.mins > 20);
    return { s, n: sm.length, ace: METRICS.acePct.val(t), hold: METRICS.hold.val(t), first: METRICS.firstWon.val(t), len: ratio(sum(l, m => m.mins), l.length), tb: ratio(sum(sm, m => m.sets.filter(([a, b]) => Math.max(a, b) === 7 && Math.min(a, b) === 6).length), sum(sm, m => m.sets.length)) };
  });
  const FP = [['Matches', r => fmtInt(r.n)], ['Ace %', r => fmtPct(r.ace)], ['1st serve pts won', r => fmtPct(r.first)], ['Service holds', r => fmtPct(r.hold)],
    ['Tiebreak sets', r => fmtPct(r.tb)], ['Avg match', r => fmtMin(r.len)]];
  g1.appendChild(card('Surface fingerprints', 'How each surface plays (all players combined)', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact fp' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), surfRows.map(r => h('th', { class: 'r' }, surfaceDot(r.s), r.s)))),
    h('tbody', {}, FP.map(([label, f]) => h('tr', {}, h('td', { class: 'muted' }, label), surfRows.map(r => h('td', { class: 'r num' }, f(r))))))))));
  root.appendChild(g1);

  // Leaders
  const qual = [...agg.values()].filter(a => a.m >= 8);
  const since = activeSince();
  const topElo = [...agg.values()].filter(a => a.m >= 5 && a.last && a.last.t >= since).map(a => ({ a, elo: eloNow(a.pid) })).filter(x => isNum(x.elo)).sort((x, y) => y.elo - x.elo).slice(0, 10);
  const g2 = h('div', { class: 'grid g3 mt' });
  g2.appendChild(card('Power ranking · top 10', `${F.surface !== 'all' ? F.surface + ' Elo' : 'Elo rating'} · active players (match in the last ${ACTIVE_WEEKS} weeks), 5+ matches`, h('ul', { class: 'list-plain' },
    topElo.map((x, i) => h('li', {}, h('span', { class: 'rank-n' }, i + 1), playerLink(x.a.pid),
      h('span', { class: 'val' }, fmtInt(x.elo)))),
    h('li', {}, h('a', { href: '#/rankings' }, 'Full rankings →')))));
  const mostTitles = [...agg.values()].filter(a => a.titles > 0).sort((a, b) => b.titles - a.titles || b.w - a.w).slice(0, 10);
  g2.appendChild(card('Most titles', 'Challenger singles titles in view', el => barChart(el, {
    data: mostTitles.map(a => ({ label: D.players[a.pid]?.short || a.pid, value: a.titles, onClick: () => { location.hash = '#/player/' + a.pid; }, note: `${a.w}-${a.l} record, ${a.finals} finals` })), fmt: fmtInt, barH: 16, gap: 8,
  }), { table: () => ({ cols: ['Player', 'Titles', 'Finals', 'W-L'], rows: mostTitles.map(a => [D.players[a.pid]?.name, a.titles, a.finals, `${a.w}-${a.l}`]) }) }));
  const mostWins = [...agg.values()].sort((a, b) => b.w - a.w || a.l - b.l).slice(0, 10);
  g2.appendChild(card('Most match wins', 'Includes qualifying', el => barChart(el, {
    data: mostWins.map(a => ({ label: D.players[a.pid]?.short || a.pid, value: a.w, onClick: () => { location.hash = '#/player/' + a.pid; }, note: `${a.w}-${a.l} (${fmtPct(a.w / a.m)})` })), fmt: fmtInt, barH: 16, gap: 8,
  }), { table: () => ({ cols: ['Player', 'Wins', 'Losses'], rows: mostWins.map(a => [D.players[a.pid]?.name, a.w, a.l]) }) }));
  root.appendChild(g2);

  // Stat leaders strip
  const leaderKeys = [['hold', 'Best hold %'], ['brk', 'Best break %'], ['acePct', 'Highest ace %'], ['dr', 'Best dominance ratio'], ['bpSaved', 'Best BP saved %'], ['tbPct', 'Best tiebreak %']];
  const g3 = h('div', { class: 'grid g3 mt' });
  for (const [k, title] of leaderKeys) {
    const m = METRICS[k];
    // enough sample for the stat itself too (e.g. 8+ tiebreaks, 32+ break points faced)
    const rows = qual.map(a => ({ a, v: m.val(a) })).filter(x => isNum(x.v) && (!m.n || m.n(x.a) >= 8)).sort((x, y) => m.dir * (y.v - x.v)).slice(0, 5);
    g3.appendChild(card(title, `Players with 8+ matches · tour avg ${m.fmt(m.val(tour))}`, h('ul', { class: 'list-plain' },
      rows.map((x, i) => h('li', {}, h('span', { class: 'rank-n' }, i + 1), playerLink(x.a.pid), h('span', { class: 'val' }, m.fmt(x.v)))))));
  }
  root.appendChild(g3);

  // Recent champions + highlights
  const g4 = h('div', { class: 'grid g2 mt' });
  const recent = finals.slice().sort((a, b) => (b.end || '').localeCompare(a.end || '')).slice(0, 12);
  g4.appendChild(card('Latest champions', 'Most recent finals in view', h('div', {}, dataTable({
    rows: recent.map(e => ({ e, f: ms.find(m => m.eid === e.id && m.rd === 'F') })), sortKey: 'date', pageSize: 12, sticky: false, compact: true, cols: [
      { key: 'date', label: 'Week', get: r => r.e.end, render: r => fmtDate(r.e.start), sortDir: -1 },
      { key: 'ev', label: 'Event', get: r => r.e.city, render: r => h('span', { style: { whiteSpace: 'normal' } }, surfaceDot(r.e.surface), eventLink(r.e), h('span', { class: 'muted' }, ' ' + (r.e.cat || ''))), sortDir: 1 },
      { key: 'ch', label: 'Champion', get: r => D.players[r.e.champ]?.name, render: r => playerLink(r.e.champ, { short: true }), sortDir: 1 },
      { key: 'sc', label: 'Final', get: false, render: r => r.f ? h('a', { href: matchHref(r.f), style: { whiteSpace: 'nowrap' } }, r.f.score) : (r.e.finalWO ? 'Walkover' : '–') },
    ], onRowClick: r => { location.hash = '#/tournament/' + r.e.id; },
  }))));

  const hl = h('div', { class: 'stack' });
  const bigUpsets = elo.filter(m => !m.flag).sort((a, b) => a.pWin - b.pWin).slice(0, 5);
  hl.appendChild(card('Biggest upsets', 'Lowest pre-match Elo win probability for the winner', h('ul', { class: 'list-plain' },
    bigUpsets.map(m => h('li', {}, playerLink(m.w, { short: true }), h('span', { class: 'muted' }, 'd.'), playerLink(m.l, { short: true, cc: false }),
      h('a', { href: matchHref(m), class: 'muted', style: { fontSize: '12px' } }, `${m.e?.city} ${m.rd}`), h('span', { class: 'val' }, fmtPct(m.pWin)))))));
  const longest = lens.slice().sort((a, b) => b.mins - a.mins).slice(0, 5);
  hl.appendChild(card('Longest matches', null, h('ul', { class: 'list-plain' },
    longest.map(m => h('li', {}, playerLink(m.w, { short: true }), h('span', { class: 'muted' }, 'd.'), playerLink(m.l, { short: true, cc: false }),
      h('a', { href: matchHref(m), class: 'muted', style: { fontSize: '12px' } }, m.score), h('span', { class: 'val' }, fmtMin(m.mins)))))));
  const aceRows = [];
  for (const m of withStats) { aceRows.push([m, m.w, m.ws[K.ace]]); aceRows.push([m, m.l, m.ls[K.ace]]); }
  const topAces = aceRows.filter(r => isNum(r[2])).sort((a, b) => b[2] - a[2]).slice(0, 5);
  hl.appendChild(card('Most aces in a match', null, h('ul', { class: 'list-plain' },
    topAces.map(([m, pid, v]) => h('li', {}, playerLink(pid, { short: true }), h('a', { href: matchHref(m), class: 'muted', style: { fontSize: '12px' } }, `${m.e?.city} ${m.rd} · ${m.score}`), h('span', { class: 'val' }, v))))));
  g4.appendChild(hl);
  root.appendChild(g4);
}

function heroStat(v, k) { return h('div', { class: 'hero-stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k)); }
function feedItem(m) {
  const side = (pid, tag, games, won) => h('div', { class: 'feed-p' + (won ? ' w' : '') },
    h('span', { class: 'plink' }, countryChip(D.players[pid]?.c), D.players[pid]?.short || pid, tag ? h('span', { class: 'seed' }, `(${tag})`) : null),
    h('span', { class: 'sc' }, games));
  return h('a', { class: 'feed-item', href: matchHref(m) },
    h('div', { class: 'feed-top' }, h('span', {}, surfaceDot(m.surface), `${m.e?.city || ''} · ${m.rd}`), m.flag ? h('span', { class: 'badge ret' }, m.flag) : (m.hasCV ? h('span', { class: 'badge he' }, 'HAWK-EYE') : h('span', {}, ''))),
    side(m.w, m.wTag, m.sets.map(x => x[0]).join(' '), true),
    side(m.l, m.lTag, m.sets.map(x => x[1]).join(' '), false));
}
