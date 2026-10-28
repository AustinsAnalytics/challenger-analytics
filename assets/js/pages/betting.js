// Betting: the next day's Challenger singles slate with model prices, factor breakdowns and sportsbook odds.
import { h, clear, fmtInt, fmtPct, fmt1, fmt2, isNum, store, debounce, countryChip, ROUND_NAMES } from '../util.js';
import { D, lazy, surfaceColorVar, isAdv } from '../data.js';
import { card, barChart, scatter, lineChart } from '../charts.js';
import { dataTable } from '../table.js';
import { pageHead, tiles, segmented, playerLink, surfaceDot, keepTabVisible } from '../components.js';
import { parseHash, setQuery } from '../main.js';


const american = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
function fmtOdds(dec, mode) {
  if (!isNum(dec) || dec <= 1) return '–';
  if (mode === 'dec') return dec.toFixed(2);
  if (mode === 'pct') return (100 / dec).toFixed(1) + '%';
  const a = american(dec);
  return a > 0 ? '+' + a : '−' + Math.abs(a);
}
const evText = v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';

function timeLabel(iso, tz) {
  if (!iso) return { main: 'Time TBC', venue: '' };
  const d = new Date(iso);
  const main = d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  let venue = '';
  try { venue = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }); } catch { /* unknown zone */ }
  return { main, venue };
}
function status(m, now) {
  if (!m.start) return null;
  const t = Date.parse(m.start), mins = (t - now) / 6e4;
  if (m.delayed && mins > -120 && mins < 90) return { cls: 'soon', text: 'Court running late' };
  if (mins <= -240) return { cls: 'live', text: 'Probably finished' };
  if (mins <= 0) return { cls: 'live', text: 'Likely under way' };
  if (mins < 60) return { cls: 'soon', text: `Starts in ${Math.round(mins)} min` };
  if (mins < 24 * 60) return { cls: '', text: `In ${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m` };
  return { cls: '', text: `In ${Math.round(mins / 60)}h` };
}

/** Per-match derived numbers. p = our line (model blended with the market), pm = model only. */
function analyse(m, books) {
  const p = [m.our, 1 - m.our], pm = [m.p, 1 - m.p];
  const cons = m.market && isNum(m.market.consensus) ? [m.market.consensus, 1 - m.market.consensus] : null;
  const best = [null, null];
  for (const b of books) {
    const q = m.quotes[b.id];
    if (!q) continue;
    for (const i of [0, 1]) if (!best[i] || q[i] > best[i].dec) best[i] = { book: b, dec: q[i] };
  }
  const ev = best.map((b, i) => (b ? p[i] * b.dec - 1 : null));
  let side = null;
  for (const i of [0, 1]) if (isNum(ev[i]) && (side == null || ev[i] > ev[side])) side = i;
  const value = !!m.value && !m.lowData.some(Boolean);
  return { p, pm, cons, best, ev, side: m.value ? m.value.side : side, value, fav: m.our >= 0.5 ? 0 : 1, mfav: m.p >= 0.5 ? 0 : 1, nBooks: Object.keys(m.quotes).length };
}

// ---------- factor explanations ----------
function explain(f, m) {
  const r = m.raw || {}, [A, B] = m.players.map(x => short(x)), surf = (m.surface || 'this surface').toLowerCase();
  const two = (arr, fm = x => x) => arr ? `${fm(arr[0])} vs ${fm(arr[1])}` : '';
  switch (f) {
    case 'elo': return `Elo ${two(r.elo, fmtInt)}`;
    case 'selo': return `${m.surface || 'Surface'} Elo ${two(r.selo, fmtInt)}`;
    case 'spec': return `Small correction: surface Elo slightly over-rates players whose ${surf} rating runs well ahead of their overall rating (${two(r.nsurf)} ${surf} matches)`;
    case 'surfexp': return `${two(r.nsurf)} ${surf}-court matches this season`;
    case 'rank': return `ATP ranking ${two(r.rank, v => (v ? '#' + v : 'unranked'))}`;
    case 'markov': return `Service points won ${two(r.spw, fmtPct)} · return points won ${two(r.rpw, fmtPct)} → ${fmtPct(r.markov)} for ${A} in a point-by-point simulation`;
    case 'form': return `Last 8 matches vs Elo expectation: ${two(r.form, v => (v >= 0 ? '+' : '') + fmt1(v))} wins`;
    case 'fatigue': return `Time on court in the last 3 days: ${two(r.mins3, v => fmtInt(v) + ' min')}`;
    case 'load': return `Matches in the last 7 days: ${two(r.n7)}`;
    case 'rest': return `Days since last match: ${two(r.rest)}`;
    case 'h2h': return r.h2h ? `2026 meetings: ${A} ${r.h2h[0]}–${r.h2h[1]} ${B}` : '2026 meetings';
    case 'home': return r.home && r.home[0] ? `${A} is playing at home` : r.home && r.home[1] ? `${B} is playing at home` : 'Home country';
    case 'surface': return r.surfwl ? `Correction: surface Elo already counts ${surf} records (${r.surfwl[0].join('–')} vs ${r.surfwl[1].join('–')}); a record far better than a player's overall results tends to regress` : '';
    case 'youth': return 'Younger players tend to beat their ratings as they improve during the season';
    case 'qual': return `${m.players.filter(x => /^(Q|LL)$/.test(x.tag)).map(short).join(' & ') || 'Qualifier'} came through qualifying`;
    case 'wc': return `${m.players.filter(x => x.tag === 'WC').map(short).join(' & ') || 'Wildcard'} received a wildcard`;
    case 'exp': return `Rated matches behind each rating: ${two(r.n)}`;
    case 'trend': return 'Direction of the ATP ranking over the last 8 weeks';
    case 'gelo': return `Rating built from the share of games won, so dominant wins count more: ${two(r.gelo, fmtInt)}`;
    case 'inj': return r.inj && (r.inj[0] || r.inj[1]) ? `${r.inj[0] ? A : B} retired from a match in the last 30 days` : 'Retired from a recent match (possible injury)';
    case 'travel': return r.travel ? `Time zones crossed since a match in the last 10 days: ${two(r.travel)}` : 'Travel and jet lag';
    default: return '';
  }
}
const short = pl => { const p = pl.pid && D.players[pl.pid]; return p ? p.short : (pl.name || '').split(' ').slice(-1)[0]; };

function playerCell(pl) {
  const tag = pl.tag && !/^\d+$/.test(pl.tag) ? pl.tag : (pl.tag ? pl.tag : null);
  const name = pl.pid && D.players[pl.pid] ? playerLink(pl.pid, { tag }) : h('span', { class: 'plink' }, pl.cc ? countryChip(pl.cc) : null, h('b', {}, pl.name), tag ? h('span', { class: 'seed' }, `(${tag})`) : null);
  const recent = pl.pid ? (D.byPlayer[pl.pid] || []).slice().sort((x, y) => y.t - x.t).slice(0, 5).reverse() : [];
  return h('div', { class: 'bp-name' }, name,
    h('span', { class: 'muted bp-rank' }, pl.rank ? `#${pl.rank}` : 'NR'),
    recent.length ? h('span', { class: 'bp-form', title: 'Last 5 Challenger matches (oldest → newest)' }, recent.map(x => h('i', { class: x.w === pl.pid ? 'w' : 'l', title: `${x.date} ${x.e?.city || ''} ${x.rd}: ${x.w === pl.pid ? 'W' : 'L'} vs ${D.players[x.w === pl.pid ? x.l : x.w]?.name || ''}` }))) : null,
    pl.n < 5 ? h('span', { class: 'badge', title: `Only ${pl.n} Challenger matches in 2026: the model leans on the ATP ranking` }, 'LIMITED DATA') : null);
}

// ---------- page ----------
let FEAT_LABELS = {};
const featLabel = f => FEAT_LABELS[f] || f;
export async function render(root) {
  const q = parseHash().params;
  const st = {
    fmt: store.get('ca-odds-fmt', 'us'), city: q.event || 'all', sort: q.sort || 'time', show: q.show || 'all', text: '',
    open: new Set(q.match ? [q.match] : []), tab: ['slate', 'record', 'model'].includes(q.tab) ? q.tab : 'slate',
    day: q.day || 'all', focus: q.match || null,
  };
  root.appendChild(pageHead('Betting', 'Next-day Challenger slate',
    'Every scheduled singles match that has not started: our stats model, our line (the model combined with the betting market) and live prices from six sportsbooks and exchanges. Click a match for the full odds board and the factors behind the pick.'));
  const loading = h('div', { class: 'empty' }, 'Loading the slate…');
  root.appendChild(loading);
  let B;
  try { B = await lazy('data/betting.json'); } catch { clear(loading).append('The betting slate is not available yet.'); return; }
  loading.remove();
  const books = B.books || [];
  FEAT_LABELS = Object.fromEntries((B.model.features || []).map(x => [x.f, x.label]));
  const now = Date.now();
  const all = B.matches.map(m => ({ m, a: analyse(m, books) }));
  const gen = new Date(B.generated);

  root.appendChild(h('div', { class: 'notice bet-notice' },
    h('b', {}, 'For information and entertainment only. '),
    `Odds were captured ${gen.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} and move constantly; always confirm the price with the book. Model prices are estimates, not guarantees. 21+ only. Gambling problem? Call 1-800-GAMBLER.`,
    now - gen > 8 * 36e5 ? h('div', { class: 'stale-odds' }, `These prices are ${Math.round((now - gen) / 36e5)} hours old: lines have probably moved, and value spots may be gone. The slate refreshes every evening.`) : null));

  const GLOSSARY = [
    ['Model', 'The stats model alone: a calibrated win probability from 2026 Challenger results, ratings, serve/return numbers, form, fatigue and more. It sees only that data, not news the market may know (injuries, results outside the Challenger tour).'],
    ['Our line', `The model combined with the market consensus (about ${Math.round(B.model.blend.w * 100)}% model; less for players with little data). This is the probability used for every EV figure, shown as fair odds with no bookmaker margin.`],
    ['Market consensus', "Each source's prices with its margin removed (no-vig), then the median across sources: the market's own fair probability."],
    ['Best price', 'The highest odds offered on that player among the sources we read. The same bet can pay noticeably more at one source than another.'],
    ['EV (expected value)', 'Average profit per 1 unit staked if our line is right: our probability × decimal odds − 1. +5% means 5 cents per dollar on average, over many bets; any single bet still wins or loses.'],
    ['Value spot', `A bet where our line sees at least +${Math.round(B.model.blend.valueEv * 100)}% EV at the best price and rates the player ${Math.round(B.model.blend.valueGap * 100)}+ points higher than the market. Players with under 5 matches of data are never flagged.`],
    ['Margin', "The bookmaker's built-in edge: how far the two implied probabilities add up above 100%."],
    ['Closing line value (CLV)', 'How our published price compares with the last price before the match (Kalshi). Consistently beating the closing price is the best early sign of a real edge, long before profit is meaningful.'],
  ];
  root.appendChild(h('details', { class: 'card glossary mt' }, h('summary', {}, 'How to read this page'),
    h('dl', {}, GLOSSARY.map(([t, d]) => [h('dt', {}, t), h('dd', { class: 'muted' }, d)]))));

  const tabsEl = h('div', { class: 'tabs mt', role: 'tablist' });
  const slateHost = h('div'), recordHost = h('div', { hidden: true }), modelHost = h('div', { hidden: true });
  root.append(tabsEl, slateHost, recordHost, modelHost);
  const drawn = { record: false, model: false };
  const TABS = [['slate', 'Next-day slate'], ['record', 'Track record'], ['model', 'Model & changes']].filter(([k]) => k !== 'model' || isAdv());
  if (st.tab === 'model' && !isAdv()) st.tab = 'slate';
  function drawTabs() {
    clear(tabsEl);
    for (const [k, label] of TABS) tabsEl.appendChild(h('button', { type: 'button', role: 'tab', class: k === st.tab ? 'on' : '', 'aria-selected': k === st.tab ? 'true' : 'false',
      onclick: () => { st.tab = k; sync(); drawTabs(); showTab(); } }, label));
    keepTabVisible(tabsEl);
  }
  function showTab() {
    slateHost.hidden = st.tab !== 'slate'; recordHost.hidden = st.tab !== 'record'; modelHost.hidden = st.tab !== 'model';
    if (st.tab === 'record' && !drawn.record) { drawn.record = true; drawRecord(recordHost); }
    if (st.tab === 'model' && !drawn.model) { drawn.model = true; drawModel(); }
  }

  const withOdds = all.filter(x => x.a.nBooks);
  const values = all.filter(x => x.a.value);
  const rec = B.record || {}, rs = rec.scores || {}, rv = rec.value, ld = rec.lastDay;
  // (helpers declared further down are not usable yet here)
  const ldDay = ld ? new Date(ld.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const ldUnits = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + 'u';
  const lastDayTxt = ld && ld.n ? `Last match day (${ldDay}): model ${ld.model ? Math.round(ld.model.accuracy * ld.n) + '/' + ld.n : '–'} winners right${ld.value && ld.value.n ? `, value spots ${ld.value.wins}-${ld.value.n - ld.value.wins} (${ldUnits(ld.value.units)})` : ''}` : null;
  slateHost.appendChild(h('div', { class: 'mt' }, tiles([
    { label: 'Matches on the slate', value: fmtInt(all.length), delta: `${B.events.filter(e => all.some(x => x.m.eid === e.id)).length} tournaments` },
    { label: 'Priced by sportsbooks', value: fmtInt(withOdds.length), delta: `avg ${fmt1(withOdds.reduce((s, x) => s + x.a.nBooks, 0) / (withOdds.length || 1))} books per match` },
    { label: 'Value spots', value: fmtInt(values.length), delta: `our line ≥ +${Math.round(B.model.blend.valueEv * 100)}% EV at the best price and ${Math.round(B.model.blend.valueGap * 100)}+ pts above the market` },
    { label: 'Track record', value: rv ? `${rv.units >= 0 ? '+' : '−'}${Math.abs(rv.units).toFixed(1)}u` : (rs.our ? fmtPct(rs.our.accuracy) : '—'),
      delta: lastDayTxt || (rv ? `value spots: ${rv.wins}-${rv.n - rv.wins}, ROI ${evText(rv.roi)} · see Track record` : (rec.counts && rec.counts.settled ? `${rec.counts.settled} settled predictions` : `tracking since ${rec.since || 'today'}; results appear as matches finish`)) },
  ])));

  // best bets right now: open value spots, highest expected value first
  const bestBets = values.filter(x => !x.m.start || Date.parse(x.m.start) > now).sort((x, y) => y.m.value.ev - x.m.value.ev).slice(0, 6);
  if (bestBets.length) {
    slateHost.appendChild(h('div', { class: 'mt' }, card('Best bets right now', 'Value spots with the highest expected value at the best available price. Click one to open its full breakdown.',
      h('div', { class: 'best-bets' }, bestBets.map(({ m, a }) => {
        const i = m.value.side, pl = m.players[i], bk = books.find(b => b.id === m.value.book);
        const tl = timeLabel(m.start, m.tz);
        return h('button', { type: 'button', class: 'best-bet', onclick: () => focusMatch(m.id) },
          h('div', { class: 'bb-top muted' }, surfaceDot(m.surface), `${m.city} · ${tl.main}`),
          h('div', { class: 'bb-pick' }, h('b', {}, pl.name), h('span', { class: 'muted' }, ` vs ${m.players[1 - i].name}`)),
          h('div', { class: 'bb-line' }, h('span', { class: 'bb-price' }, fmtOdds(m.value.dec, st.fmt)), h('span', { class: 'muted' }, ` at ${bk ? bk.name : m.value.book}`),
            h('span', { class: 'bb-ev' }, evText(m.value.ev) + ' EV')),
          h('div', { class: 'muted bb-sub' }, `Our line ${fmtPct(a.p[i])} · market ${a.cons ? fmtPct(a.cons[i]) : '–'} · model ${fmtPct(a.pm[i])}`),
          (() => { const fs = m.factors.filter(f => (i === 0 ? f.pts : -f.pts) >= 0.5).slice(0, 2).map(f => featLabel(f.f));
            return fs.length ? h('div', { class: 'muted bb-sub' }, 'Main edge: ' + fs.join(', ')) : null; })());
      })))));
  }
  function focusMatch(id) {
    const x = all.find(r => r.m.id === id);
    const visible = x && (st.city === 'all' || x.m.eid === st.city) && (st.day === 'all' || dayKey(x.m) === st.day)
      && (st.show !== 'odds' || x.a.nBooks) && (st.show !== 'value' || x.a.value) && !st.text;
    if (!visible) {       // clear the filters that hide it, and show that in the controls
      st.city = 'all'; st.show = 'all'; st.day = 'all'; st.text = ''; search.value = '';
      const nc = makeCtrl(); ctrl.replaceWith(nc); ctrl = nc;
    }
    st.open.add(id); st.focus = id;
    setQuery({ match: id });
    draw();
    const el = document.getElementById('m-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // controls
  const dayKey = m => m.start ? new Date(m.start).toLocaleDateString('en-CA') : m.day;
  const days = [...new Set(all.map(x => dayKey(x.m)))].sort();
  const todayKey = new Date().toLocaleDateString('en-CA');
  const dayName = d => d === todayKey ? 'Today' : d === new Date(Date.now() + 864e5).toLocaleDateString('en-CA') ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const cities = [...new Map(all.map(x => [x.m.eid, x.m.city])).entries()];
  const search = h('input', { type: 'search', placeholder: 'Find a player…', style: { width: '180px' } });
  const makeCtrl = () => h('div', { class: 'row mt' },
    h('label', { class: 'fb-item' }, h('span', { class: 'muted bet-lab' }, 'Event'),
      segmented([['all', 'All'], ...cities.map(([id, c]) => [id, c])], st.city, v => { st.city = v; sync(); })),
    days.length > 1 ? h('label', { class: 'fb-item' }, h('span', { class: 'muted bet-lab' }, 'Day'),
      segmented([['all', 'All'], ...days.map(d => [d, dayName(d)])], st.day, v => { st.day = v; sync(); })) : null,
    h('span', { class: 'spacer' }),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted bet-lab' }, 'Show'),
      segmented([['all', 'All'], ['odds', 'With odds'], ['value', 'Value']], st.show, v => { st.show = v; sync(); })),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted bet-lab' }, 'Sort'),
      segmented([['time', 'By event'], ['clock', 'Start time'], ['edge', 'Best EV'], ['conf', 'Model confidence']], st.sort, v => { st.sort = v; sync(); })),
    h('label', { class: 'fb-item' }, h('span', { class: 'muted bet-lab' }, 'Odds'),
      segmented([['us', 'American'], ['dec', 'Decimal'], ['pct', 'Implied %']], st.fmt, v => { st.fmt = v; store.set('ca-odds-fmt', v); draw(); })),
    search);
  search.addEventListener('input', debounce(() => { st.text = search.value.trim().toLowerCase(); draw(); }, 120));
  let ctrl = makeCtrl();
  const list = h('div', { class: 'mt' });
  slateHost.append(ctrl, list);
  function sync() { setQuery({ tab: st.tab !== 'slate' ? st.tab : null, event: st.city !== 'all' ? st.city : null, show: st.show !== 'all' ? st.show : null, sort: st.sort !== 'time' ? st.sort : null, day: st.day !== 'all' ? st.day : null }); if (st.tab === 'slate') draw(); }

  function draw() {
    let rows = all.filter(x => (st.city === 'all' || x.m.eid === st.city)
      && (st.day === 'all' || dayKey(x.m) === st.day)
      && (st.show === 'all' || (st.show === 'odds' ? x.a.nBooks : x.a.value))
      && (!st.text || x.m.players.some(p => (p.name || '').toLowerCase().includes(st.text))));
    if (st.sort === 'edge') rows.sort((x, y) => (Math.max(...y.a.ev.filter(isNum), -9)) - (Math.max(...x.a.ev.filter(isNum), -9)));
    else if (st.sort === 'conf') rows.sort((x, y) => Math.abs(y.m.p - 0.5) - Math.abs(x.m.p - 0.5));
    else if (st.sort === 'clock') rows.sort((x, y) => (x.m.start || '9').localeCompare(y.m.start || '9'));
    clear(list);
    if (!rows.length) { list.appendChild(h('div', { class: 'card empty' }, 'No matches for this selection.')); return; }
    if (st.sort === 'time') {
      const byEv = new Map();
      for (const x of rows) { if (!byEv.has(x.m.eid)) byEv.set(x.m.eid, []); byEv.get(x.m.eid).push(x); }
      for (const [eid, xs] of byEv) {
        const ev = B.events.find(e => e.id === eid) || {};
        const m0 = xs[0].m;
        list.appendChild(h('div', { class: 'bet-ev' },
          h('div', { class: 'bet-ev-title' }, surfaceDot(m0.surface), h('a', { href: '#/tournament/' + eid, class: 'pl' }, m0.city), m0.cc ? countryChip(m0.cc) : null,
            h('span', { class: 'muted' }, ` ${m0.event || ''} · Challenger ${m0.cat || ''} · ${m0.surface || ''}${m0.io === 'I' ? ' (indoor)' : ''}`)),
          h('div', { class: 'muted bet-ev-sub' }, ev.oopDate ? `Order of play for ${new Date(ev.oopDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}${ev.released ? ' · released ' + ev.released + ' local' : ''}${ev.oopStale ? ' · last saved copy (the update could not refresh it)' : ''}` : 'Order of play not published yet: matches listed by the sportsbooks')));
        const grid = h('div', { class: 'bet-grid' });
        xs.forEach(x => grid.appendChild(matchCard(x)));
        list.appendChild(grid);
      }
    } else {
      const grid = h('div', { class: 'bet-grid' });
      rows.forEach(x => grid.appendChild(matchCard(x, true)));
      list.appendChild(grid);
    }
  }

  function matchCard({ m, a }, showEvent = false) {
    const tl = timeLabel(m.start, m.tz);
    const s = status(m, now);
    const el = h('div', { class: 'bet-card' + (a.value ? ' value' : '') + (s && s.cls === 'live' ? ' started' : '') + (st.focus === m.id ? ' focus' : ''), id: 'm-' + m.id });
    el.appendChild(h('div', { class: 'bet-top' },
      h('span', { class: 'bet-time' }, tl.main, tl.venue ? h('span', { class: 'muted' }, ` · ${tl.venue} local`) : null, m.start && !m.exact ? h('span', { class: 'muted', title: 'Estimated from the order of play (follows the previous match on court)' }, ' (est.)') : null),
      h('span', { class: 'muted' }, [showEvent ? m.city : null, ROUND_NAMES[m.round] || m.round || null, m.court ? `Court ${m.court}${m.order ? ' · match ' + m.order : ''}` : 'Not yet scheduled'].filter(Boolean).join(' · ')),
      h('span', { class: 'spacer' }),
      a.value ? h('span', { class: 'badge value-badge', title: `Our line sees ${evText(m.value.ev)} expected value on ${m.players[m.value.side].name} at ${books.find(b => b.id === m.value.book)?.name || m.value.book}` }, 'VALUE') : null,
      s ? h('span', { class: 'bet-status ' + s.cls }, s.text) : null));
    const head = h('div', { class: 'bp-head' }, h('span'), h('span', { title: 'Pure statistical model' }, 'Model'), h('span', { title: 'Our line: the model combined with the market consensus. Fair odds, no margin.' }, isAdv() ? 'Our line' : 'Our odds · chance'), h('span', {}, 'Best price'), h('span', { title: 'Expected value of a 1-unit bet at the best price, using our line' }, 'EV'));
    el.appendChild(head);
    m.players.forEach((pl, i) => {
      const pr = a.p[i], pmod = a.pm[i], best = a.best[i], ev = a.ev[i];
      el.appendChild(h('div', { class: 'bp-row' + (i === a.fav ? ' fav' : '') + (a.value && a.side === i ? ' pick' : '') },
        playerCell(pl),
        h('div', { class: 'bp-prob' }, h('b', {}, fmtPct(pmod)), h('span', { class: 'bp-bar' }, h('span', { style: { width: (pmod * 100).toFixed(1) + '%', background: i === 0 ? 'var(--series-1)' : 'var(--series-2)' } }))),
        h('div', { class: 'bp-fair' }, h('b', {}, fmtOdds(1 / pr, st.fmt)), st.fmt !== 'pct' ? h('span', { class: 'muted' }, ' ' + fmtPct(pr)) : null),
        h('div', { class: 'bp-best' }, best ? [h('b', {}, fmtOdds(best.dec, st.fmt)), h('span', { class: 'muted' }, ' ' + best.book.name)] : h('span', { class: 'muted' }, 'no odds')),
        h('div', { class: 'bp-ev ' + (isNum(ev) ? (ev > 0 ? 'pos' : 'neg') : '') }, isNum(ev) ? evText(ev) : '–')));
    });
    const top = m.factors.slice(0, 3).map(f => `${labelOf(f.f)} (${f.pts >= 0 ? short(m.players[0]) : short(m.players[1])})`);
    const h2h = m.raw && m.raw.h2h && (m.raw.h2h[0] + m.raw.h2h[1]) ? `2026 H2H ${short(m.players[0])} ${m.raw.h2h[0]}–${m.raw.h2h[1]}` : null;
    el.appendChild(h('div', { class: 'bet-foot' },
      h('span', { class: 'muted' }, a.cons ? `Market ${fmtPct(a.cons[0])} – ${fmtPct(a.cons[1])} (no-vig, ${a.nBooks} source${a.nBooks === 1 ? '' : 's'})` : 'No sportsbook prices yet'),
      h2h ? h('span', { class: 'muted' }, '· ' + h2h) : null,
      h('span', { class: 'muted bet-why' }, top.length ? 'Key factors: ' + top.join(' · ') : ''),
      h('button', { class: 'btn sm', type: 'button', 'aria-expanded': st.open.has(m.id) ? 'true' : 'false', onclick: ev => {
        const open = !st.open.has(m.id);
        open ? st.open.add(m.id) : st.open.delete(m.id);
        el.classList.toggle('open', open);
        ev.currentTarget.textContent = open ? 'Hide details' : 'Details';
        ev.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
        const d = el.querySelector('.bet-detail');
        if (d) d.remove(); else el.appendChild(detail(m, a));
      } }, st.open.has(m.id) ? 'Hide details' : 'Details')));
    if (st.open.has(m.id)) { el.classList.add('open'); el.appendChild(detail(m, a)); }
    return el;
  }
  const labelOf = f => ((B.model.features || []).find(x => x.f === f) || {}).label || f;

  function detail(m, a) {
    const box = h('div', { class: 'bet-detail' });
    const [A, Bn] = m.players.map(short);
    // odds board
    const rows = [];
    const wM = isNum(m.wEff) ? m.wEff : B.model.blend.w;
    rows.push(h('tr', { class: 'model-row' }, h('td', { title: `${Math.round(wM * 100)}% model + ${Math.round((1 - wM) * 100)}% market consensus` }, h('b', {}, 'Our line (fair odds)')), h('td', { class: 'r' }, h('b', {}, fmtOdds(1 / a.p[0], st.fmt))), h('td', { class: 'r' }, h('b', {}, fmtOdds(1 / a.p[1], st.fmt))),
      h('td', { class: 'r muted' }, '0.0%'), h('td', { class: 'r' }, fmtPct(a.p[0]))));
    rows.push(h('tr', { class: 'model-row' }, h('td', {}, 'Stats model only'), h('td', { class: 'r' }, fmtOdds(1 / a.pm[0], st.fmt)), h('td', { class: 'r' }, fmtOdds(1 / a.pm[1], st.fmt)),
      h('td', { class: 'r muted' }, '0.0%'), h('td', { class: 'r' }, fmtPct(a.pm[0]))));
    for (const b of books) {
      const qd = m.quotes[b.id];
      if (!qd) continue;
      const inv = 1 / qd[0] + 1 / qd[1];
      const cell = i => {
        const ev = a.p[i] * qd[i] - 1;
        const isBest = a.best[i] && a.best[i].book.id === b.id;
        return h('td', { class: 'r' + (isBest ? ' best' : '') }, fmtOdds(qd[i], st.fmt), h('span', { class: 'ev ' + (ev > 0 ? 'pos' : 'neg') }, evText(ev)));
      };
      rows.push(h('tr', {}, h('td', { title: b.note || '', class: 'src' }, b.name,
        b.kind === 'exchange' ? h('span', { class: 'muted src-note' }, `exchange${m.volume && m.volume[b.id] ? ` · $${fmtInt(m.volume[b.id])} traded` : ''}`) : null),
        cell(0), cell(1), h('td', { class: 'r muted' }, fmtPct(inv - 1)), h('td', { class: 'r' }, fmtPct((1 / qd[0]) / inv))));
    }
    if (a.cons) rows.push(h('tr', { class: 'cons-row' }, h('td', {}, 'Market consensus (no-vig median)'), h('td', { class: 'r' }, fmtOdds(1 / a.cons[0], st.fmt)), h('td', { class: 'r' }, fmtOdds(1 / a.cons[1], st.fmt)), h('td'), h('td', { class: 'r' }, fmtPct(a.cons[0]))));
    box.appendChild(h('div', { class: 'bet-detail-grid' },
      h('div', {}, h('div', { class: 'mgroup' }, 'Odds board'),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact odds-board' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', { class: 'r' }, A), h('th', { class: 'r' }, Bn), h('th', { class: 'r', title: 'Bookmaker margin (overround)' }, 'Margin'), h('th', { class: 'r', title: `No-vig probability for ${A}` }, `${A} %`))),
          h('tbody', {}, rows))),
        h('p', { class: 'muted bet-small' }, `Under each price: expected value of a bet at that price using our line. Best price per player in bold. Margin = the book's built-in edge. Our line for this match = ${Math.round(wM * 100)}% stats model + ${Math.round((1 - wM) * 100)}% market consensus.`),
        m.confNote ? h('p', { class: 'bet-small conf-note' }, m.confNote + '. The model leans on season data, so the market gets more say here.') : null,
        m.delayed ? h('p', { class: 'bet-small conf-note' }, 'The scheduled start has passed, but sportsbooks were still offering pre-match prices when this page was built: the court is probably running late.') : null),
      h('div', {}, h('div', { class: 'mgroup' }, `Why the stats model makes ${a.mfav === 0 ? A : Bn} ${fmtPct(a.pm[a.mfav])}`), factorBars(m))));
    box.appendChild(snapshot(m));
    const pa = m.players[0].pid, pb = m.players[1].pid;
    box.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn sm', type: 'button', onclick: ev => {
        const url = location.href.split('#')[0] + '#/betting?match=' + encodeURIComponent(m.id);
        const btn = ev.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { btn.textContent = 'Link copied'; }, () => { history.replaceState(null, '', '#/betting?match=' + encodeURIComponent(m.id)); btn.textContent = 'Link in address bar'; });
      } }, 'Copy link to this match'),
      pa && pb ? h('a', { class: 'btn sm', href: `#/compare?a=${pa}&b=${pb}&surf=${m.surface || 'Hard'}` }, 'Full head-to-head →') : null,
      h('a', { class: 'btn sm', href: '#/tournament/' + m.eid }, `${m.city} draw →`)));
    return box;
  }

  function factorBars(m) {
    const fs = m.factors.filter(f => Math.abs(f.pts) >= 0.3).slice(0, 9);
    const mx = Math.max(4, ...fs.map(f => Math.abs(f.pts)));
    const [A, Bn] = m.players.map(short);
    return h('div', { class: 'fbars' },
      h('div', { class: 'fbar-head muted' }, h('span', {}, `← favours ${Bn}`), h('span', {}, `favours ${A} →`)),
      fs.map(f => h('div', { class: 'fbar', title: explain(f.f, m) },
        h('div', { class: 'fbar-top' }, h('b', {}, labelOf(f.f)), h('span', { class: 'muted' }, `${Math.abs(f.pts).toFixed(1)} pts toward ${f.pts >= 0 ? A : Bn}`)),
        h('div', { class: 'fbar-track' }, h('span', { class: 'fbar-mid' }),
          h('span', { class: 'fbar-fill', style: { [f.pts >= 0 ? 'left' : 'right']: '50%', width: (50 * Math.abs(f.pts) / mx).toFixed(1) + '%', background: f.pts >= 0 ? 'var(--series-1)' : 'var(--series-2)' } })),
        h('div', { class: 'fbar-text muted' }, explain(f.f, m)))),
      h('p', { class: 'muted bet-small' }, 'Points = how much each factor moves the win probability, holding the others fixed.'));
  }

  function snapshot(m) {
    const r = m.raw || {}, [pa, pb] = m.players;
    const rec = pl => { const ms = pl.pid ? (D.byPlayer[pl.pid] || []) : []; const w = ms.filter(x => x.w === pl.pid).length; return ms.length ? `${w}-${ms.length - w}` : '–'; };
    const lines = [
      ['2026 Challenger record', rec(pa), rec(pb)],
      ['ATP ranking', pa.rank ? '#' + pa.rank : 'NR', pb.rank ? '#' + pb.rank : 'NR'],
      ['Elo / ' + (m.surface || 'surface') + ' Elo', r.elo ? `${fmtInt(r.elo[0])} / ${fmtInt(r.selo[0])}` : '–', r.elo ? `${fmtInt(r.elo[1])} / ${fmtInt(r.selo[1])}` : '–'],
      [(m.surface || 'Surface') + ' record', r.surfwl ? r.surfwl[0].join('-') : '–', r.surfwl ? r.surfwl[1].join('-') : '–'],
      ['Service points won*', r.spw ? fmtPct(r.spw[0]) : '–', r.spw ? fmtPct(r.spw[1]) : '–'],
      ['Return points won*', r.rpw ? fmtPct(r.rpw[0]) : '–', r.rpw ? fmtPct(r.rpw[1]) : '–'],
      ['Minutes played, last 3 days', r.mins3 ? fmtInt(r.mins3[0]) : '–', r.mins3 ? fmtInt(r.mins3[1]) : '–'],
      ['Days since last match', r.rest ? fmtInt(r.rest[0]) : '–', r.rest ? fmtInt(r.rest[1]) : '–'],
    ];
    return h('div', { class: 'mt', style: { maxWidth: '720px' } }, h('div', { class: 'mgroup' }, 'Stat snapshot'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact snap' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'r' }, short(pa)), h('th', { class: 'r' }, short(pb)))),
        h('tbody', {}, lines.map(([k, x, y]) => h('tr', {}, h('td', { class: 'muted' }, k), h('td', { class: 'r' }, x), h('td', { class: 'r' }, y)))))),
      h('p', { class: 'muted bet-small' }, '* Weighted toward recent matches and this surface, adjusted for small samples.'));
  }


  let TRK = null;
  const getTrack = async () => (TRK = TRK || await lazy('data/track.json'));
  const units = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + 'u';
  const ci = c => c ? `${evText(c[0])} to ${evText(c[1])}` : '–';
  const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const STRAT_COL = { value: 'var(--accent)', edge: 'var(--series-1)', modelFav: 'var(--series-3)', marketFav: 'var(--series-2)' };

  async function drawModel() {
    const V = B.model.validation, bl = B.model.blend;
    let TK = null;
    try { TK = await getTrack(); } catch { /* model tab still works without the record */ }
    modelHost.appendChild(h('h2', { class: 'mt2' }, 'How the model works'));
    modelHost.appendChild(h('p', { class: 'muted', style: { margin: '6px 0 14px', maxWidth: '900px' } },
      `The stats model is a logistic regression on ${B.model.features.length} factors, retrained every night on all ${fmtInt(B.model.trainedOn)} completed 2026 Challenger matches${B.model.trainedPast ? ` plus ${fmtInt(B.model.trainedPast)} from 2025 (which cut its error on the last 8 weeks)` : ''}, using only information available before each match. Today's version: "${B.model.championLabel}". Its accuracy below is from the last 8 weeks, where it was refitted week by week on earlier matches only, so every prediction was made on matches it had never seen (${fmtInt(V.test)} matches since ${V.testFrom}). Probabilities are calibrated so that "70%" means the favourite wins about 70% of the time. Betting markets also know things the model can't (injuries, results outside the Challenger tour), so our line combines the two: ${Math.round(bl.w * 100)}% model and ${Math.round((1 - bl.w) * 100)}% market consensus.`));
    modelHost.appendChild(tiles([
      { label: 'Correct winner, last 8 weeks', value: fmtPct(V.model.accuracy), delta: `Elo alone: ${fmtPct(V.eloOnly.accuracy)}` },
      { label: 'Log loss (lower is better)', value: V.model.logloss.toFixed(3), delta: `Elo alone: ${V.eloOnly.logloss.toFixed(3)} · coin flip: 0.693` },
      { label: 'Brier score', value: V.model.brier.toFixed(3), delta: `Elo alone: ${V.eloOnly.brier.toFixed(3)}` },
      { label: 'Odds sources today', value: `${Object.values(B.sources).filter(x => x.ok && x.n).length} of ${books.length}`, delta: Object.entries(B.sources).filter(([, x]) => !x.ok).map(([k]) => k + ' unavailable').join(', ') || 'all responded' },
    ]));
    // how it adapts
    modelHost.appendChild(h('h2', { class: 'mt2' }, 'How it improves itself'));
    modelHost.appendChild(h('div', { class: 'grid g3 mt' },
      h('div', { class: 'card adapt' }, h('h3', {}, '1 · Retrained nightly'), h('p', { class: 'muted' }, 'Every finished match is added to the training data the same night, so ratings, form, fatigue and surface records are always current.')),
      h('div', { class: 'card adapt' }, h('h3', {}, '2 · Best model chosen nightly'), h('p', { class: 'muted' }, 'Five variants are scored on the last 8 weeks of matches they never saw. The current model is replaced only when another is clearly better (by at least 0.0015 log loss), so it does not chase noise. Calibration is refitted at the same time.')),
      h('div', { class: 'card adapt' }, h('h3', {}, '3 · Model vs market weight learned from results'), h('p', { class: 'muted' }, `Our line's mix of model and market is refitted from every settled prediction, starting from 30% model and moving toward whatever has predicted best (the prior counts as ${150} matches, so early swings are damped). Currently ${Math.round(bl.w * 100)}% model${bl.n ? ` after ${bl.n} settled matches` : ''}. For a player with few matches on the surface or few 2026 matches, the model's share of that match is cut (to a quarter at the extreme), because its ratings are mostly guesswork there.`))));
    if (TK && TK.candidates) {
      const g0 = h('div', { class: 'grid g2 mt' });
      g0.appendChild(card('Tonight\'s model leaderboard', 'Each variant refitted week by week and scored on the last 8 weeks of matches it had not seen', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Variant'), h('th', { class: 'r' }, 'Log loss'), h('th', { class: 'r' }, 'Correct'), h('th', { class: 'r', title: 'Calibration multiplier on the log-odds' }, 'Calib.'), h('th', {}, ''))),
        h('tbody', {}, [...TK.candidates.map(c => h('tr', { class: c.champion ? 'tr-hl' : '' }, h('td', { style: { whiteSpace: 'normal' } }, c.label),
          h('td', { class: 'r num' }, c.logloss.toFixed(4)), h('td', { class: 'r num' }, fmtPct(c.accuracy)), h('td', { class: 'r num' }, c.temperature.toFixed(2)),
          h('td', {}, c.champion ? h('span', { class: 'badge value-badge' }, 'IN USE') : ''))),
          TK.eloOnly ? h('tr', {}, h('td', { class: 'muted' }, 'Elo rating alone (reference)'), h('td', { class: 'r num muted' }, TK.eloOnly.logloss.toFixed(4)), h('td', { class: 'r num muted' }, fmtPct(TK.eloOnly.accuracy)), h('td'), h('td')) : null])))));
      g0.appendChild(card('Changelog', 'Every automatic adjustment, with the reason', (TK.modelLog || []).length ? h('ul', { class: 'list-plain changelog' },
        TK.modelLog.slice(0, 25).map(e => h('li', {}, h('span', { class: 'cl-date' }, dayLabel(e.date)), h('span', { class: 'badge cl-' + e.kind }, e.kind.toUpperCase()), h('span', {}, e.text)))) : h('div', { class: 'empty' }, 'No changes yet.')));
      modelHost.appendChild(g0);
    }
    const g = h('div', { class: 'grid g2 mt' });
    const fw = B.model.features.map(f => ({ label: f.label, value: f.weight, color: f.weight >= 0 ? 'var(--series-1)' : 'var(--series-2)', note: `per 1 standard deviation of the factor (${f.std})` }));
    g.appendChild(card('Factor weights', 'Effect on the log-odds of a one-standard-deviation edge in each factor (player A minus player B). Blue = helps the player who has more of it.', el => barChart(el, { data: fw, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), labelWidth: 200, barH: 13, gap: 7 })));
    g.appendChild(card('Calibration, last 8 weeks', 'Predicted favourite win % vs how often favourites actually won', el => scatter(el, {
      points: (V.calibration || []).map(([pp, act, n]) => ({ x: pp, y: act, label: `Predicted ${fmtPct(pp)}`, extra: [{ value: fmtInt(n), label: 'matches' }], r: 5 })),
      xLabel: 'Predicted', yLabel: 'Actual', xFmt: fmtPct, yFmt: fmtPct, xDomain: [0.5, 1], yDomain: [0.4, 1], diag: true, height: 280,
    })));
    modelHost.appendChild(g);
    const g2 = h('div', { class: 'grid g2 mt' });
    const hist = TK && TK.weightsHistory ? Object.entries(TK.weightsHistory).sort((a, b) => a[0].localeCompare(b[0])) : [];
    if (hist.length >= 2) {
      const top = B.model.features.slice(0, 6).map(f => f.f);
      const cols = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];
      g2.appendChild(card('How the weights have moved', 'Daily weight of the six biggest factors since tracking started', el => lineChart(el, {
        series: top.map((f, k) => ({ name: (B.model.features.find(x => x.f === f) || {}).label || f, color: cols[k], values: hist.filter(([, v]) => v.w && isNum(v.w[f])).map(([d, v]) => ({ x: Date.parse(d), y: v.w[f] })) })),
        xType: 'time', yFmt: v => v.toFixed(2), height: 260, endLabels: false, markers: hist.length < 30,
      })));
    }
    if (TK && TK.blend && TK.blend.curve) {
      g2.appendChild(card('Choosing the model weight', `Log loss of our line on ${TK.blend.n} settled matches for every model weight (0% = market only). Best fit ${Math.round(TK.blend.wFit * 100)}%; used ${Math.round(TK.blend.w * 100)}% after damping.`, el => lineChart(el, {
        series: [{ name: 'Log loss', color: 'var(--series-1)', values: TK.blend.curve.map(([w, l]) => ({ x: w, y: l })) }], xType: 'num', xFmt: v => Math.round(v * 100) + '%', yFmt: v => v.toFixed(3), height: 240, markers: true, endLabels: false,
      })));
    }
    g2.appendChild(card('Odds sources', `Prices captured ${gen.toLocaleString()}. Exchange prices are the cost to buy a contract (Kalshi's fee included). Exchange prices with little money behind them are left out.`, h('ul', { class: 'list-plain' },
      books.map(b => { const x = B.sources[b.id] || {}; return h('li', {}, h('b', {}, b.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, b.note || (b.kind === 'exchange' ? 'Exchange' : 'Sportsbook')),
        h('span', { class: 'val ' + (x.ok ? '' : 'muted') }, x.ok ? `${x.n} Challenger matches` : 'unavailable today')); }),
      h('li', { class: 'muted', style: { fontSize: '12.5px' } }, `Next refresh planned around ${B.nextRun && B.nextRun.local ? B.nextRun.local + (B.nextRun.tz ? ' ' + B.nextRun.tz : '') : 'the evening'}${B.nextRun && B.nextRun.reason ? ' (' + B.nextRun.reason + ')' : ''}.`))));
    modelHost.appendChild(g2);
  }

  async function drawRecord(host) {
    const loadingEl = h('div', { class: 'empty' }, 'Loading the track record…');
    host.appendChild(loadingEl);
    let T;
    try { T = await getTrack(); } catch { clear(host).appendChild(h('div', { class: 'card empty' }, 'The track record is not available yet.')); return; }
    clear(host);
    const C = T.counts, S = T.scores, VS = T.strategies.value.summary;
    host.appendChild(h('p', { class: 'muted rec-intro' },
      `Live since ${T.since ? dayLabel(T.since) : 'today'}. Every slate is locked in before its matches start and scored once results are in: nothing is edited afterwards. Bets are 1 unit at the best price shown when the slate was published; retirements, defaults and walkovers are void (stake returned). Closing line value compares that price with the final pre-match price on the Kalshi exchange.`));
    if (!C.settled) {
      host.appendChild(h('div', { class: 'card mt' }, h('h3', {}, 'Nothing has settled yet'),
        h('p', { class: 'muted', style: { marginTop: '6px' } }, `${fmtInt(C.predictions)} predictions${C.pending ? ` (${C.pending} pending)` : ''} are locked in. Results are scored on the next nightly update after the matches finish. This page will then show profit over time for each strategy, whether higher-EV bets really win more, calibration, closing line value, and every bet.`)));
      pendingTable(host, T);
      return;
    }
    if (C.provisional) host.appendChild(h('p', { class: 'bet-small conf-note' },
      `${fmtInt(C.provisional)} result${C.provisional === 1 ? '' : 's'} (marked *) ${C.provisional === 1 ? 'is' : 'are'} provisional: taken from the settled Kalshi market because the official ATP result is not in yet. Kalshi pays a retirement to the player who advances, so those matches become void here once the ATP result confirms a retirement.`));
    host.appendChild(h('div', { class: 'mt' }, tiles([
      { label: 'Settled predictions', value: fmtInt(C.settled), delta: `${C.pending} pending · ${C.void} void${C.provisional ? ` · ${C.provisional} provisional` : ''}` },
      { label: 'Correct winner', value: S.our ? fmtPct(S.our.accuracy) : fmtPct(S.model.accuracy), delta: `our line · stats model ${fmtPct(S.model.accuracy)}${S.market ? ' · market ' + fmtPct(S.market.accuracy) : ''}` },
      { label: 'Log loss (lower is better)', value: S.our ? S.our.logloss.toFixed(3) : '–', delta: `our line · market ${S.market ? S.market.logloss.toFixed(3) : '–'} · model ${S.modelVsMarket ? S.modelVsMarket.logloss.toFixed(3) : '–'}` },
      { label: 'Value spots', value: VS ? units(VS.units) : '–', delta: VS ? `${VS.wins}-${VS.n - VS.wins} · ROI ${evText(VS.roi)} (90%: ${ci(VS.roiCI)})` : 'none settled yet' },
      { label: 'Beat the closing line', value: VS && VS.beatClose != null ? fmtPct(VS.beatClose) : '–', delta: VS && VS.clv != null ? `value spots · average CLV ${evText(VS.clv)} (${VS.clvN} bets)` : 'needs Kalshi closing prices' },
    ])));
    // profit over time
    const strat = Object.entries(T.strategies).filter(([, v]) => v.summary);
    const g1 = h('div', { class: 'grid g-21 mt' });
    g1.appendChild(card('Profit over time', 'Cumulative units, 1 unit per bet at the best published price', el => lineChart(el, {
      series: strat.map(([k, v]) => ({ name: v.label, color: STRAT_COL[k], values: T.days.map((d, i) => ({ x: Date.parse(d), y: T.cumulative[k][i] })) })),
      xType: 'time', yFmt: v => (v >= 0 ? '+' : '') + v.toFixed(0) + 'u', height: 300, refY: [{ y: 0, label: 'break-even' }], endLabels: false, markers: T.days.length < 25,
    }), { table: () => ({ cols: ['Day', ...strat.map(([, v]) => v.label)], rows: T.days.map((d, i) => [d, ...strat.map(([k]) => T.cumulative[k][i])]) }) }));
    g1.appendChild(card('Strategies', 'Same matches, different bets', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Strategy'), h('th', { class: 'r' }, 'Bets'), h('th', { class: 'r' }, 'Units'), h('th', { class: 'r' }, 'ROI'), h('th', { class: 'r' }, 'CLV'))),
      h('tbody', {}, strat.map(([k, v]) => h('tr', {}, h('td', { style: { whiteSpace: 'normal', minWidth: '130px' } }, h('span', { class: 'sdot', style: { background: STRAT_COL[k] } }), v.label),
        h('td', { class: 'r num' }, fmtInt(v.summary.n)), h('td', { class: 'r num ' + (v.summary.units >= 0 ? 'pos' : 'neg') }, units(v.summary.units)),
        h('td', { class: 'r num', title: '90% interval: ' + ci(v.summary.roiCI) }, evText(v.summary.roi)), h('td', { class: 'r num' }, v.summary.clv != null ? evText(v.summary.clv) : '–'))))))));
    host.appendChild(g1);
    // EV buckets
    host.appendChild(h('h2', { class: 'mt2' }, 'Do positive-EV bets actually do better?'));
    host.appendChild(h('p', { class: 'muted', style: { margin: '6px 0 12px', maxWidth: '900px' } },
      'Every settled match is placed in a bucket by the expected value of its best bet (using our line at the best published price). If our estimates are right, both profit and closing line value should rise from the top bucket to the bottom one. Closing line value settles within a few hundred bets; profit needs thousands, so read ROI with its interval.'));
    const B2 = T.evBuckets.filter(b => b.n);
    const g2 = h('div', { class: 'grid g2' });
    g2.appendChild(card('ROI by expected value', 'Actual return per unit staked', el => barChart(el, {
      data: B2.map(b => ({ label: `${b.label} (${b.n})`, value: b.roi, color: b.roi >= 0 ? 'var(--good)' : 'var(--series-2)', note: `${b.wins}-${b.n - b.wins}, ${units(b.units)}; expected ROI ${evText(b.expRoi)}; 90% interval ${ci(b.roiCI)}` })),
      fmt: evText, labelWidth: 160, barH: 16, gap: 10,
    })));
    g2.appendChild(card('Closing line value by expected value', 'How much the bet price beat (or missed) the final Kalshi price', el => barChart(el, {
      data: B2.filter(b => b.clv != null).map(b => ({ label: `${b.label} (${b.clvN})`, value: b.clv, color: b.clv >= 0 ? 'var(--good)' : 'var(--series-2)', note: `beat the close ${fmtPct(b.beatClose)} of the time` })),
      fmt: evText, labelWidth: 160, barH: 16, gap: 10,
    })));
    host.appendChild(g2);
    host.appendChild(h('div', { class: 'mt' }, card('Expected-value buckets in detail', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, ...['Expected value', 'Bets', 'Won', 'Expected wins', 'Avg price', 'Units', 'ROI', '90% interval', 'Expected ROI', 'CLV', 'Beat close'].map((t, k) => h('th', { class: k ? 'r' : '' }, t)))),
      h('tbody', {}, T.evBuckets.map(b => b.n ? h('tr', {}, h('td', {}, b.label), h('td', { class: 'r num' }, fmtInt(b.n)), h('td', { class: 'r num' }, `${b.wins} (${fmtPct(b.winPct)})`),
        h('td', { class: 'r num' }, fmt1(b.expWins)), h('td', { class: 'r num' }, fmtOdds(b.avgDec, st.fmt)), h('td', { class: 'r num ' + (b.units >= 0 ? 'pos' : 'neg') }, units(b.units)),
        h('td', { class: 'r num' }, evText(b.roi)), h('td', { class: 'r num muted' }, ci(b.roiCI)), h('td', { class: 'r num muted' }, evText(b.expRoi)),
        h('td', { class: 'r num' }, b.clv != null ? evText(b.clv) : '–'), h('td', { class: 'r num' }, b.beatClose != null ? fmtPct(b.beatClose) : '–'))
        : h('tr', {}, h('td', {}, b.label), h('td', { class: 'r muted', colspan: 10 }, 'no bets yet')))))))));
    // calibration + disagreements
    const g3 = h('div', { class: 'grid g2 mt' });
    const calSeries = [['our', 'Our line', 'var(--accent)'], ['model', 'Stats model', 'var(--series-1)'], ['market', 'Market', 'var(--series-2)']];
    g3.appendChild(card('Calibration of live predictions', 'Stated favourite win % vs actual, settled matches', el => scatter(el, {
      points: calSeries.flatMap(([k, lab, col]) => (T.calibration[k] || []).map(([pp, act, n]) => ({ x: pp, y: act, color: col, r: 5, label: `${lab}: predicted ${fmtPct(pp)}`, extra: [{ value: fmtInt(n), label: 'matches' }] }))),
      legend: calSeries.map(([, lab, col]) => ({ label: lab, color: col })), xLabel: 'Predicted', yLabel: 'Actual', xFmt: fmtPct, yFmt: fmtPct, xDomain: [0.5, 1], yDomain: [0.3, 1], diag: true, height: 300,
    })));
    const D2 = T.disagreements;
    g3.appendChild(card('When the model disagrees with the market', 'Matches where the stats model and the market differ by 5+ points', D2 ? h('div', {},
      h('dl', { class: 'kv' },
        h('dt', {}, 'Matches'), h('dd', {}, fmtInt(D2.n)),
        h('dt', {}, 'Model closer to the result'), h('dd', {}, `${fmtPct(D2.modelCloser / D2.n)} of the time`),
        h('dt', {}, "Model's side won"), h('dd', {}, `${D2.modelSideWon} of ${D2.n}`),
        h('dt', {}, 'Log loss: model / market'), h('dd', {}, `${D2.model.logloss.toFixed(3)} / ${D2.market.logloss.toFixed(3)}`)),
      h('div', { class: 'tbl-wrap mt' }, h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Model vs market'), h('th', { class: 'r' }, 'Matches'), h('th', { class: 'r' }, 'Model LL'), h('th', { class: 'r' }, 'Market LL'), h('th', { class: 'r' }, 'Backing our side'))),
        h('tbody', {}, T.edgeBuckets.filter(b => b.n).map(b => h('tr', {}, h('td', {}, b.label), h('td', { class: 'r num' }, fmtInt(b.n)),
          h('td', { class: 'r num' }, b.model ? b.model.logloss.toFixed(3) : '–'), h('td', { class: 'r num' }, b.market ? b.market.logloss.toFixed(3) : '–'),
          h('td', { class: 'r num' }, b.bets ? `${units(b.bets.units)} (${evText(b.bets.roi)})` : '–')))))),
      h('p', { class: 'muted bet-small' }, 'If the model is adding information, it should be closer to the result more than half the time when it disagrees, and the "Model ... above market" rows should make money.'))
      : h('div', { class: 'empty' }, 'No disagreements settled yet.')));
    host.appendChild(g3);
    // segments
    host.appendChild(h('div', { class: 'mt' }, card('Where the model is strong and weak', 'Log loss by segment (lower is better); value-spot results in each', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, ...['Group', 'Segment', 'Matches', 'Stats model', 'Our line', 'Market', 'Value spots'].map((t, k) => h('th', { class: k > 1 ? 'r' : '' }, t)))),
      h('tbody', {}, T.segments.map(x => h('tr', {}, h('td', { class: 'muted' }, x.group), h('td', {}, x.label), h('td', { class: 'r num' }, fmtInt(x.n)),
        h('td', { class: 'r num' }, x.model ? x.model.logloss.toFixed(3) : '–'), h('td', { class: 'r num' }, x.our ? x.our.logloss.toFixed(3) : '–'),
        h('td', { class: 'r num' }, x.market ? x.market.logloss.toFixed(3) : '–'),
        h('td', { class: 'r num' }, x.value ? `${x.value.wins}-${x.value.n - x.value.wins}, ${units(x.value.units)}` : '–')))))))));
    // daily log
    host.appendChild(h('div', { class: 'mt' }, card('Daily log', 'Settled matches by match day', h('div', {}, dataTable({
      rows: T.daily, sortKey: 'day', sortDir: -1, pageSize: 14, sticky: false, compact: true, csvName: 'daily-log.csv', cols: [
        { key: 'day', label: 'Day', render: r => dayLabel(r.day) },
        { key: 'n', label: 'Settled', align: 'r' },
        { key: 'acc', label: 'Model correct', align: 'r', get: r => r.model && r.model.accuracy, fmt: fmtPct },
        { key: 'ourll', label: 'Our line LL', align: 'r', get: r => r.our && r.our.logloss, fmt: v => isNum(v) ? v.toFixed(3) : '–' },
        { key: 'mkll', label: 'Market LL', align: 'r', get: r => r.market && r.market.logloss, fmt: v => isNum(v) ? v.toFixed(3) : '–' },
        { key: 'vb', label: 'Value spots', align: 'r', get: r => r.value.n, render: r => r.value.n ? `${r.value.wins}-${r.value.n - r.value.wins}` : '–' },
        { key: 'units', label: 'Units', align: 'r', get: r => r.value.units, render: r => r.value.n ? h('span', { class: r.value.units >= 0 ? 'pos' : 'neg' }, units(r.value.units)) : '–' },
      ],
    })))));
    // ledger
    host.appendChild(h('div', { class: 'mt' }, card('Every value spot', 'The full ledger of flagged bets, settled', h('div', {}, dataTable({
      rows: T.ledger, sortKey: 'day', sortDir: -1, pageSize: 25, compact: true, csvName: 'value-spots.csv', cols: [
        { key: 'day', label: 'Day', render: r => dayLabel(r.day), csv: r => r.day },
        { key: 'm', label: 'Match', get: r => r.players.join(' v '), render: r => r.match ? h('a', { href: '#/match/' + r.match }, r.players.join(' v ')) : r.players.join(' v ') },
        { key: 'pick', label: 'Pick', get: r => r.pick },
        { key: 'book', label: 'Book', get: r => (books.find(b => b.id === r.book) || {}).name || r.book },
        { key: 'dec', label: 'Price', align: 'r', fmt: v => fmtOdds(v, st.fmt), csv: r => r.dec },
        { key: 'p', label: 'Our %', align: 'r', fmt: fmtPct },
        { key: 'ev', label: 'EV', align: 'r', fmt: evText },
        { key: 'won', label: 'Result', get: r => r.won ? 1 : 0, render: r => [r.won ? h('span', { class: 'win-mark' }, 'Won') : h('span', { class: 'muted' }, 'Lost'), r.prov ? h('span', { class: 'muted', title: 'Provisional: from the settled Kalshi market. Confirmed (or made void after a retirement) when the official ATP result arrives.' }, '*') : null], csv: r => (r.won ? 'Won' : 'Lost') + (r.prov ? ' (provisional)' : '') },
        { key: 'pnl', label: 'P/L', align: 'r', render: r => h('span', { class: r.pnl >= 0 ? 'pos' : 'neg' }, units(r.pnl)), csv: r => r.pnl },
        { key: 'clv', label: 'CLV', align: 'r', fmt: v => isNum(v) ? evText(v) : '–' },
      ],
    })))));
    pendingTable(host, T);
    host.appendChild(h('p', { class: 'muted bet-small mt' },
      `How much data is enough? With a typical value-spot price around +110, results swing by about ±${Math.round(100 * 1.05 / Math.sqrt(Math.max(1, VS ? VS.n : 1)))}% ROI at the current sample (${VS ? VS.n : 0} bets). Telling a real 5% edge from luck takes roughly 1,700 bets; closing line value gives a reliable read much sooner.`));
  }

  function pendingTable(host, T) {
    if (!T.pendingValue || !T.pendingValue.length) return;
    host.appendChild(h('div', { class: 'mt' }, card('Open value spots', 'Locked in, waiting for results', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, ...['Day', 'Event', 'Match', 'Pick', 'Book', 'Price', 'EV'].map((t, k) => h('th', { class: k >= 5 ? 'r' : '' }, t)))),
      h('tbody', {}, T.pendingValue.map(x => h('tr', {}, h('td', {}, dayLabel(x.day)), h('td', {}, x.city || ''), h('td', {}, x.players.join(' v ')), h('td', {}, x.pick),
        h('td', {}, (books.find(b => b.id === x.book) || {}).name || x.book), h('td', { class: 'r num' }, fmtOdds(x.dec, st.fmt)), h('td', { class: 'r num' }, evText(x.ev))))))))));
  }

  draw();
  drawTabs();
  showTab();
  if (st.focus && st.tab === 'slate') requestAnimationFrame(() => { const el = document.getElementById('m-' + st.focus); if (el) el.scrollIntoView({ block: 'start' }); });
}
