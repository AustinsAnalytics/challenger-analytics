// Tournament calendar & conditions.
import { h, clear, fmtInt, fmtPct, fmtDate, isNum, ratio, countryName, debounce } from '../util.js';
import { D, filtered, filteredEvents, tourAgg, METRICS, surfaceColorVar, SEASON, lazy, isAdv } from '../data.js';
import { card, scatter } from '../charts.js';
import { pageHead, playerLink, surfaceDot, filterSummary } from '../components.js';
import { dataTable } from '../table.js';
import { drawTree, titleOdds } from './tournament.js';

export function eventConditions(e, ms) {
  const t = tourAgg(ms);
  const timed = ms.filter(m => isNum(m.mins) && !m.flag && m.mins > 20);
  return {
    ace: METRICS.acePct.val(t), hold: METRICS.hold.val(t), spw: METRICS.spw.val(t), first: METRICS.firstWon.val(t),
    len: ratio(timed.reduce((a, m) => a + m.mins, 0), timed.length),
    three: ratio(ms.filter(m => m.sets.length === 3).length, ms.length),
    upset: ratio(ms.filter(m => m.pWin != null && m.pWin < 0.5).length, ms.filter(m => m.pWin != null).length),
  };
}

export function render(root) {
  const prevChamp = {};
  root.appendChild(pageHead('Tournaments', `${SEASON} Challenger calendar`, isAdv()
    ? `${filterSummary()}. The pace index compares each event's service points won with the season average (100 = average; higher = conditions favour servers).`
    : `${filterSummary()}. Every event with its champion and runner-up; open one for the draw, title chances and match stats.`));
  const ms = filtered();
  const evs = filteredEvents();
  const tourSpw = METRICS.spw.val(tourAgg(D.matches));
  const byEv = new Map();
  for (const m of ms) { if (!byEv.has(m.eid)) byEv.set(m.eid, []); byEv.get(m.eid).push(m); }
  const rows = evs.map(e => {
    const em = byEv.get(e.id) || [];
    const c = eventConditions(e, em);
    return { e, n: em.length, ...c, pace: isNum(c.spw) ? 100 * c.spw / tourSpw : null, champ: e.champ, runner: e.runner, ...champOdds(e) };
  });
  const surfaces = ['Hard', 'Clay', 'Grass'];
  const pts = rows.filter(r => r.n >= 15 && isNum(r.ace) && isNum(r.hold)).map(r => ({
    x: r.ace, y: r.hold, label: `${r.e.city} (${r.e.surface})`, id: r.e.id, color: surface3(r.e.surface), sub: `${r.e.name} · ${fmtDate(r.e.start)} · pace ${fmtInt(r.pace)}`,
  }));
  const extremes = new Set([...pts].sort((a, b) => b.y - a.y).slice(0, 3).map(p => p.id).concat([...pts].sort((a, b) => a.y - b.y).slice(0, 3).map(p => p.id)));
  const topCard = h('div', { class: 'grid ' + (isAdv() ? 'g-21' : 'g2') });
  root.appendChild(topCard);
  if (!isAdv()) {       // simple mode: who won most instead of the conditions chart
    const tally = new Map();
    for (const r of rows) if (r.champ) tally.set(r.champ, (tally.get(r.champ) || 0) + 1);
    const most = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
    topCard.appendChild(card('Most titles', `Champions across the ${rows.filter(r => r.champ).length} completed events in view`,
      most.length ? h('ul', { class: 'list-plain' }, most.map(([pid, n]) => h('li', {}, playerLink(pid, { short: true }), h('span', { class: 'val' }, `${n} title${n > 1 ? 's' : ''}`)))) : h('div', { class: 'empty' }, 'No titles in view.')));
  } else topCard.appendChild(card('Court conditions by tournament', 'Ace rate vs hold rate for every event with 15+ matches in view. Fast, serve-friendly events sit top-right.', el => scatter(el, {
    points: pts, xLabel: 'Ace % (per service point)', yLabel: 'Service games held %', xFmt: fmtPct, yFmt: fmtPct, height: 360,
    legend: surfaces.map(s => ({ label: s === 'Grass' ? 'Grass / other' : s, color: surface3(s) })), labelIds: extremes,
    onClick: p => { location.hash = '#/tournament/' + p.id; },
  }), { table: () => ({ cols: ['Event', 'Surface', 'Ace %', 'Hold %'], rows: pts.map(p => [p.label, '', fmtPct(p.x), fmtPct(p.y)]) }) }));
  const shots = rows.filter(r => isNum(r.champP)).sort((a, b) => a.champP - b.champP);
  const shotItems = shots.slice(0, 9).map(r => h('li', {}, playerLink(r.champ, { short: true }),
    h('span', { class: 'muted', style: { fontSize: '12px' } }, ` ${r.e.city} · no. ${r.champRank} of ${r.champOf}`), h('span', { class: 'val' }, oddsPct(r.champP))));
  shotItems.push(h('li', { class: 'muted', style: { fontSize: '12px' } }, `Pre-draw favourites won ${fmtInt(shots.filter(r => r.champRank === 1).length)} of ${fmtInt(shots.length)} titles.`));
  topCard.appendChild(card('Longest-shot champions', 'Title chance before the main draw, from Elo and the draw. Elo can underrate players returning from injury.',
    shots.length ? h('ul', { class: 'list-plain' }, shotItems) : h('div', { class: 'empty' }, 'No completed draws in view.')));

  const search = h('input', { type: 'search', placeholder: 'Filter by city, name, country…', style: { width: '260px' } });
  const host = h('div');
  root.append(h('div', { class: 'row mt' }, h('h2', {}, `${evs.length} tournaments`), h('span', { class: 'spacer' }), search), h('div', { class: 'mt' }, host));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q ? rows.filter(r => `${r.e.name} ${r.e.city} ${r.e.loc} ${countryName(r.e.cc)}`.toLowerCase().includes(q)) : rows;
    clear(host).appendChild(dataTable({
      rows: shown, sortKey: 'start', sortDir: -1, pageSize: 60, csvName: 'challenger-tournaments.csv',
      onRowClick: r => { location.hash = '#/tournament/' + r.e.id; },
      cols: [
        { key: 'start', label: 'Week', get: r => r.e.start, render: r => fmtDate(r.e.start) },
        { key: 'name', label: 'Tournament', get: r => r.e.city, render: r => h('span', {}, h('a', { class: 'pl', href: '#/tournament/' + r.e.id }, r.e.city), h('div', { class: 'muted ellipsis', title: r.e.name, style: { fontSize: '11.5px', maxWidth: '240px' } }, r.e.name)), csv: r => `${r.e.city} — ${r.e.name}`, sortDir: 1 },
        { key: 'cc', label: 'Country', get: r => countryName(r.e.cc), sortDir: 1 },
        { key: 'cat', label: 'Cat.', align: 'r', get: r => r.e.cat },
        { key: 'surface', label: 'Surface', get: r => r.e.surface, render: r => h('span', {}, surfaceDot(r.e.surface), r.e.surface, r.e.io === 'I' ? h('span', { class: 'muted' }, ' · indoor') : null), sortDir: 1 },
        { key: 'champ', label: 'Champion', get: r => D.players[r.champ]?.name, render: r => r.champ ? h('span', {}, playerLink(r.champ, { short: true }), prevChamp[r.e.id] === r.champ ? h('span', { class: 'badge', title: `Also won this event in ${SEASON - 1}` }, 'REPEAT') : null) : (r.e.status === 'live' ? h('span', { class: 'badge live' }, 'IN PROGRESS') : h('span', { class: 'muted' }, r.e.status === 'upcoming' ? 'Upcoming' : 'No final played')), sortDir: 1 },
        { key: 'champP', adv: true, label: 'Champ\'s odds', title: 'The champion\'s chance of winning the title before the main draw (Elo and the draw)', align: 'r', fmt: v => (isNum(v) ? oddsPct(v) : '–') },
        { key: 'runner', label: 'Runner-up', get: r => D.players[r.runner]?.name, render: r => r.runner ? playerLink(r.runner, { short: true }) : '–', sortDir: 1 },
        { key: 'n', label: 'Matches', align: 'r' },
        { key: 'ace', adv: true, label: 'Ace %', align: 'r', fmt: fmtPct },
        { key: 'hold', adv: true, label: 'Hold %', align: 'r', fmt: fmtPct },
        { key: 'pace', adv: true, label: 'Pace', title: 'Service points won relative to the season average (100 = average)', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
        { key: 'len', adv: true, label: 'Avg min', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
        { key: 'cv', label: '', get: r => r.e.cv ? 1 : 0, render: r => r.e.cv ? h('span', { class: 'badge he' }, 'HAWK-EYE') : '' },
      ],
    }));
  };
  search.addEventListener('input', debounce(draw, 120));
  draw();
  // champions who also won the same event last season (data/seasons.json)
  lazy('data/seasons.json').then(S => {
    const prev = S.events[SEASON - 1] || {};
    for (const [eid, v] of Object.entries(prev)) if (v[0]) prevChamp[eid] = v[0];
    if (Object.keys(prevChamp).length) draw();
  }).catch(() => {});
}
export function surface3(s) { return s === 'Hard' ? 'var(--series-1)' : s === 'Clay' ? 'var(--series-2)' : 'var(--series-3)'; }

// the champion's title chance before the main draw (Elo + draw), and where that ranked in the field
const champCache = new Map();
function champOdds(e) {
  if (!e.champ) return {};
  if (champCache.has(e.id)) return champCache.get(e.id);
  let out = {};
  const tree = drawTree((e.matches || []).filter(m => !m.q));
  if (tree) {
    const t = titleOdds(tree, 'pre').title;
    const sorted = [...t.entries()].sort((a, b) => b[1] - a[1]);
    const i = sorted.findIndex(([pid]) => pid === e.champ);
    if (i >= 0) out = { champP: sorted[i][1], champRank: i + 1, champOf: sorted.length };
  }
  champCache.set(e.id, out);
  return out;
}

export const oddsPct = v => (v < 0.001 ? '<0.1%' : fmtPct(v));
