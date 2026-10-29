// Tournament detail: bracket, conditions, performers.
import { h, clear, fmtInt, fmtPct, fmtDate, fmtMin, isNum, ratio, countryName, ROUND_ORDER, ROUND_NAMES } from '../util.js';
import { D, tourAgg, METRICS, playerAgg, runElo, eloProb, SEASON, lazy, seasonHref } from '../data.js';
import { card, compareRow } from '../charts.js';
import { playerLink, surfaceDot, matchCols, tiles, segmented } from '../components.js';
import { dataTable } from '../table.js';
import { eventConditions } from './tournaments.js';
import { setQuery } from '../main.js';

const roundPhrase = rd => /^Q\d*$/.test(rd || '') ? 'qualifying' : rd === 'F' ? 'the final' : rd === 'SF' ? 'the semifinals' : rd === 'QF' ? 'the quarterfinals' : `the ${(ROUND_NAMES[rd] || rd).toLowerCase()}`;

/** Plain sentences: who won and from where, how likely it looked before the draw, and how the top seed did. */
function eventSummary(e, main) {
  if (!main.length) return null;
  const nm = pid => D.players[pid]?.short || pid;
  const tag = {};
  for (const m of main) { tag[m.w] = tag[m.w] || m.wTag || ''; tag[m.l] = tag[m.l] || m.lTag || ''; }
  const seedOf = pid => { const x = /^(\d+)/.exec(tag[pid] || ''); return x ? +x[1] : null; };
  const entry = pid => { const sd = seedOf(pid), t = tag[pid] || ''; return sd ? `the No. ${sd} seed` : /\bQ\b|^Q/.test(t) ? 'a qualifier' : /WC/.test(t) ? 'a wildcard' : /LL/.test(t) ? 'a lucky loser' : 'an unseeded player'; };
  const out = [];
  const fin = main.find(m => m.rd === 'F');
  const tree = drawTree(main);
  const pre = tree ? titleOdds(tree, 'pre').title : null;
  if (e.champ) {
    out.push(fin && !fin.flag ? `${nm(e.champ)} won the title as ${entry(e.champ)}, beating ${nm(fin.l)} ${fin.score} in the final.`
      : `${nm(e.champ)} won the title as ${entry(e.champ)}${e.runner ? ` (${nm(e.runner)} ${e.finalWO ? 'gave a walkover in' : 'lost'} the final)` : ''}.`);
    if (pre && pre.has(e.champ)) {
      const fav = [...pre.entries()].sort((a, b) => b[1] - a[1])[0];
      const pc = pre.get(e.champ);
      out.push(fav[0] === e.champ ? `${nm(e.champ)} was also the favourite before the draw (${fmtPct(pc)} by Elo).`
        : `Before the draw Elo gave ${nm(e.champ)} a ${pc >= 0.01 ? fmtPct(pc) : 'under 1%'} chance; the favourite was ${nm(fav[0])} (${fmtPct(fav[1])}).`);
    }
  } else if (e.status === 'live' && tree) {
    const now = [...titleOdds(tree, 'now').title.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
    if (now.length) out.push(`${now.length} player${now.length > 1 ? 's' : ''} still in the title race. Favourite: ${nm(now[0][0])} (${fmtPct(now[0][1])} to win it)${now[1] ? `, then ${nm(now[1][0])} (${fmtPct(now[1][1])})` : ''}.`);
  }
  const top = Object.keys(tag).find(pid => seedOf(pid) === 1);
  if (top && top !== e.champ) {
    const lost = main.find(m => m.l === top);
    if (lost) out.push(`Top seed ${nm(top)} lost in ${roundPhrase(lost.rd)} to ${nm(lost.w)}${lost.flag === 'RET' ? ' (retired)' : ''}.`);
  }
  return out.length ? out.join(' ') : null;
}

/** Links to this event's other editions, plus the defending champion's result this year. */
function editions(host, S, e) {
  const initial = n => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };
  const nm = pid => D.players[pid]?.short || (S.names[pid] ? initial(S.names[pid][0]) : pid);
  const others = Object.keys(S.events).map(Number).filter(y => y !== SEASON && S.events[y][e.id]).sort((a, b) => b - a);
  if (!others.length) return;
  const items = others.map(y => {
    const [c, r] = S.events[y][e.id];
    return h('a', { class: 'ss-item', href: seasonHref(y, '#/tournament/' + e.id), title: `Open the ${y} edition` },
      h('b', {}, String(y)), c ? h('span', {}, `${nm(c)} d. ${r ? nm(r) : '–'}`) : h('span', { class: 'muted' }, 'no champion yet'), h('span', { class: 'muted' }, '→'));
  });
  let dc = null;
  const prev = S.events[SEASON - 1] && S.events[SEASON - 1][e.id];
  if (prev && prev[0]) {
    const c = prev[0];
    const mine = e.matches.filter(m => m.w === c || m.l === c);
    const lost = mine.find(m => m.l === c);
    const txt = e.champ === c ? 'won the title again' : lost ? `lost in ${roundPhrase(lost.rd)} to ${nm(lost.w)}`
      : mine.length ? `is still in the draw (${mine.length} win${mine.length > 1 ? 's' : ''})`
      : e.status === 'live' && new Set(e.matches.filter(m => !m.q).map(m => m.rd)).size < 2 ? 'has not played yet' : 'did not play';
    dc = h('div', { class: 'ed-dc' }, 'Defending champion ', D.players[c] ? playerLink(c, { short: true }) : h('b', {}, nm(c)), ` ${txt}.`);
  }
  host.appendChild(h('div', { class: 'season-strip mt' }, h('span', { class: 'ss-label' }, 'Other editions'), items));
  if (dc) host.appendChild(dc);
}

export function render(root, { id, params = {} }) {
  const e = D.events[id];
  if (!e) { root.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Tournament not found'))); return; }
  root.dataset.title = e.city;
  const ms = e.matches.slice();
  root.appendChild(h('div', { class: 'phero' },
    h('div', { class: 'avatar', style: { background: 'var(--accent-wash)', color: 'var(--accent-ink)', fontSize: '15px' } }, e.cat || 'CH'),
    h('div', {},
      h('div', { class: 'eyebrow' }, `Challenger ${e.cat || ''} · ${e.dates || fmtDate(e.start, true)}`),
      h('h1', {}, e.name),
      h('div', { class: 'facts' },
        h('span', {}, h('b', {}, e.loc || e.city)),
        h('span', {}, surfaceDot(e.surface), h('b', {}, e.surface), e.io === 'I' ? ' (indoor)' : ' (outdoor)'),
        e.draw ? h('span', {}, 'Draw ', h('b', {}, e.draw)) : null,
        e.prize ? h('span', {}, 'Prize money ', h('b', {}, e.prize)) : null,
        e.cv ? h('span', { class: 'badge he' }, 'HAWK-EYE TRACKED') : null)),
    h('div', { class: 'kpis' },
      e.champ ? h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Champion'), h('div', { class: 'v', style: { fontSize: '17px' } }, playerLink(e.champ))) : h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Status'), h('div', { class: 'v', style: { fontSize: '17px' } }, e.status === 'live' ? 'In progress' : e.status === 'upcoming' ? 'Upcoming' : 'No final played')),
      e.runner ? h('div', { class: 'kpi' }, h('div', { class: 'k' }, e.finalWO ? 'Runner-up (walkover)' : 'Runner-up'), h('div', { class: 'v', style: { fontSize: '17px' } }, playerLink(e.runner))) : null)));

  const sumTxt = eventSummary(e, ms.filter(m => !m.q));
  if (sumTxt) root.appendChild(h('p', { class: 'p-summary' }, sumTxt));
  // the same event in other seasons (ATP keeps the id), and how last year's champion did here
  const edHost = h('div');
  root.appendChild(edHost);
  lazy('data/seasons.json').then(S => editions(edHost, S, e)).catch(() => {});

  const K = D.K;
  const main = ms.filter(m => !m.q), qual = ms.filter(m => m.q);
  const timed = ms.filter(m => isNum(m.mins) && !m.flag);
  const seeded = ms => new Set(ms.flatMap(m => [[m.w, m.wTag], [m.l, m.lTag]]).filter(([, t]) => /^\d+/.test(t || '')).map(([p]) => p));
  const seedsQF = seeded(main.filter(m => ['QF', 'SF', 'F'].includes(m.rd)));
  const nSeeds = seeded(main).size;
  const longest = timed.length ? timed.reduce((a, m) => (m.mins > a.mins ? m : a)) : null;
  root.appendChild(h('div', { class: 'mt' }, tiles([
    { label: 'Matches', value: fmtInt(ms.length), delta: `${main.length} main draw · ${qual.length} qualifying` },
    { label: 'Longest match', value: longest ? fmtMin(longest.mins) : '–', delta: longest ? `${D.players[longest.w]?.short} d. ${D.players[longest.l]?.short} · ${longest.rd}` : '' },
    { label: 'Aces', value: fmtInt(ms.reduce((s, m) => s + (m.ws ? (m.ws[K.ace] || 0) + (m.ls[K.ace] || 0) : 0), 0)) },
    { label: 'Tiebreak sets', value: fmtInt(ms.reduce((s, m) => s + m.sets.filter(([a, b]) => Math.max(a, b) === 7 && Math.min(a, b) === 6).length, 0)) },
    { label: 'Seeds reaching QF', value: nSeeds ? fmtInt(seedsQF.size) : '–', delta: nSeeds ? `of ${nSeeds} seeds` : 'seedings not published' },
  ])));

  // draws (main / qualifying)
  let drawSel = 'main';
  const bc = card('Draw', 'Click a match for the match centre', null, {
    actions: qual.length ? segmented([['main', 'Main draw'], ['qual', 'Qualifying']], drawSel, v => { drawSel = v; drawBracket(); }) : null,
  });
  root.appendChild(h('div', { class: 'mt' }, bc));
  const drawBracket = () => {
    const bb = clear(bc.querySelector('.card-body'));
    const set = drawSel === 'main' ? main : qual;
    const rounds = [...new Set(set.map(m => m.rd))].sort((a, b) => (ROUND_ORDER[a] || 0) - (ROUND_ORDER[b] || 0));
    if (!rounds.length) { bb.appendChild(h('div', { class: 'empty' }, drawSel === 'main' ? 'No main-draw matches recorded yet.' : 'No qualifying matches recorded.')); return; }
    const byRound = Object.fromEntries(rounds.map(r => [r, set.filter(m => m.rd === r)]));
    const order = {};
    const last = rounds[rounds.length - 1];
    order[last] = byRound[last].slice().sort((a, b) => a.mid.localeCompare(b.mid));
    for (let i = rounds.length - 2; i >= 0; i--) {
      const r = rounds[i], next = order[rounds[i + 1]];
      const pool = byRound[r].slice();
      const out = [];
      for (const nm of next) for (const pid of [nm.w, nm.l]) {
        const k = pool.findIndex(m => m.w === pid);
        if (k >= 0) out.push(pool.splice(k, 1)[0]);
      }
      out.push(...pool.sort((a, b) => a.mid.localeCompare(b.mid)));
      order[r] = out;
    }
    const br = h('div', { class: 'bracket' });
    for (const r of rounds) {
      br.appendChild(h('div', { class: 'br-col' }, h('div', { class: 'br-title' }, ROUND_NAMES[r] || r), h('div', { class: 'br-inner' }, order[r].map(m => bracketMatch(m)))));
    }
    if (drawSel === 'main' && e.champ) {
      br.appendChild(h('div', { class: 'br-col', style: { minWidth: '160px' } }, h('div', { class: 'br-title' }, 'Champion'),
        h('div', { class: 'br-inner' }, h('div', { class: 'br-m br-champ' }, h('span', { class: 'badge title' }, 'CHAMPION'), playerLink(e.champ, { short: true })))));
    } else if (drawSel === 'qual') {
      const quals = order[last].map(m => m.w);
      br.appendChild(h('div', { class: 'br-col', style: { minWidth: '170px' } }, h('div', { class: 'br-title' }, 'Qualified'),
        h('div', { class: 'br-inner' }, quals.map(pid => h('div', { class: 'br-m br-champ' }, playerLink(pid, { short: true }))))));
    }
    bb.appendChild(br);
  };
  drawBracket();
  titleOddsCard(root, e, main);
  whatIfCard(root, e, main, params);

  // conditions vs tour (same surface) + performers
  const c = eventConditions(e, ms);
  const surfMs = D.matches.filter(m => m.surface === e.surface);
  const cs = eventConditions(null, surfMs);
  const g = h('div', { class: 'grid g-12 mt' });
  g.appendChild(card('Conditions', `Compared with all ${SEASON} ${e.surface.toLowerCase()}-court Challenger matches`, h('div', {},
    h('div', { class: 'cmp-head' }, h('b', {}, 'This event'), h('span', {}), h('b', { class: 'b' }, e.surface + ' average')),
    compareRow('Ace %', c.ace, cs.ace, fmtPct, { better: 0 }),
    compareRow('1st serve points won', c.first, cs.first, fmtPct, { better: 0 }),
    compareRow('Service games held', c.hold, cs.hold, fmtPct, { better: 0 }),
    compareRow('Average match (min)', c.len, cs.len, fmtInt, { better: 0 }),
    compareRow('Three-set matches', c.three, cs.three, fmtPct, { better: 0 }),
    compareRow('Elo upsets', c.upset, cs.upset, fmtPct, { better: 0 }))));
  const players = [...new Set(ms.flatMap(m => [m.w, m.l]))];
  const aggs = players.map(pid => playerAgg(pid, ms.filter(m => m.w === pid || m.l === pid), null));
  const top = (key, min = 2) => aggs.filter(a => a.m >= min).map(a => ({ a, v: METRICS[key].val(a) })).filter(x => isNum(x.v)).sort((x, y) => METRICS[key].dir * (y.v - x.v)).slice(0, 5);
  const perf = h('div', { class: 'grid g2' });
  for (const [key, title] of [['spw', 'Best on serve'], ['rpw', 'Best on return'], ['acesPerM', 'Aces per match'], ['dr', 'Dominance ratio']]) {
    const rows = top(key);
    perf.appendChild(card(title, `${METRICS[key].label} · 2+ matches here`, h('ul', { class: 'list-plain' },
      rows.length ? rows.map((x, i) => h('li', {}, h('span', { class: 'rank-n' }, i + 1), playerLink(x.a.pid, { short: true }), h('span', { class: 'val' }, METRICS[key].fmt(x.v))))
        : h('li', { class: 'muted' }, 'Not enough matches yet'))));
  }
  g.appendChild(perf);
  root.appendChild(g);
  root.appendChild(h('div', { class: 'mt' }, card('All matches', null, h('div', {}, dataTable({
    rows: ms, sortKey: 'rd', sortDir: -1, pageSize: 60, cols: matchCols().map(cl => cl.key === 'rd' ? { ...cl, get: m => ROUND_ORDER[m.rd] || 0 } : cl).filter(cl => cl.key !== 'event'),
    onRowClick: m => { location.hash = '#/match/' + m.id; },
  })))));
}

function bracketMatch(m) {
  const el = h('div', { class: 'br-m', onclick: () => { location.hash = '#/match/' + m.id; } },
    h('div', { class: 'br-p w' }, h('span', {}, D.players[m.w]?.short || m.w, m.wTag ? h('span', { class: 'seed' }, `(${m.wTag})`) : null), h('span', { class: 'sc' }, m.sets.map(s => s[0]).join(' '))),
    h('div', { class: 'br-p' }, h('span', {}, D.players[m.l]?.short || m.l, m.lTag ? h('span', { class: 'seed' }, `(${m.lTag})`) : null), h('span', { class: 'sc' }, m.sets.map(s => s[1]).join(' ') + (m.flag ? ' ' + m.flag : ''))));
  return el;
}

// ---------- title odds from the draw ----------
// ATP numbers a main draw like a heap: the final is MS001, the semifinals MS002-003, and match k is fed by matches
// 2k and 2k+1, so the whole draw (including rounds not yet played) follows from the first-round match numbers.
export function drawTree(main) {
  const byK = new Map();
  for (const m of main) { const k = parseInt(String(m.mid).replace(/\D/g, ''), 10); if (k > 0) byK.set(k, m); }
  if (!byK.size) return null;
  const maxK = Math.max(...byK.keys());
  let L = 1;
  while (L * 2 <= maxK) L *= 2;                       // first-round matches are L .. 2L-1
  if (L < 8) return null;
  for (let k = L; k < 2 * L; k++) if (!byK.has(k)) return null;   // first round incomplete (or byes): no odds
  return { byK, L };
}

/** Each player's chance of winning the event. mode 'pre': from ratings before the main draw, ignoring results;
 *  mode 'now': results so far are fixed and the remaining matches use current ratings. */
export function titleOdds(tree, mode) {
  const E = runElo(null);
  const rating = new Map();
  for (let k = tree.L; k < 2 * tree.L; k++) {
    const m = tree.byK.get(k), pre = E.pre.get(m.id);
    for (const [pid, side] of [[m.w, 0], [m.l, 1]]) {
      if (mode === 'pre') rating.set(pid, pre ? pre[side] : 1500);
      else { const t = E.tl.get(pid); rating.set(pid, t && t.length ? t[t.length - 1][1] : (pre ? pre[side] : 1500)); }
    }
  }
  const dist = new Map();
  const solve = k => {
    if (dist.has(k)) return dist.get(k);
    const m = tree.byK.get(k);
    let out;
    if (mode === 'now' && m) out = new Map([[m.w, 1]]);
    else if (k >= tree.L) { const p = eloProb(rating.get(m.w), rating.get(m.l)); out = new Map([[m.w, p], [m.l, 1 - p]]); }
    else {
      const A = solve(2 * k), B = solve(2 * k + 1);
      out = new Map();
      for (const [X, Y] of [[A, B], [B, A]]) for (const [i, pi] of X) {
        let s = 0;
        for (const [j, pj] of Y) s += pj * eloProb(rating.get(i), rating.get(j));
        out.set(i, pi * s);
      }
    }
    dist.set(k, out);
    return out;
  };
  return { title: solve(1), rating };
}

// ---------- what if? pick the winners ----------
/**
 * Who plays and who wins each draw slot, given the user's picks (slot k -> pid). A real result stands while the same
 * two players meet there; a pick only counts once both players in that slot are known.
 */
function resolveDraw(tree, picks) {
  const win = new Map(), parts = new Map();
  for (let k = 2 * tree.L - 1; k >= 1; k--) {
    const m = tree.byK.get(k);
    const pp = k >= tree.L ? [m.w, m.l] : [win.get(2 * k) || null, win.get(2 * k + 1) || null];
    parts.set(k, pp);
    const known = pp[0] && pp[1], pick = picks.get(k);
    if (known && pick && pp.includes(pick)) win.set(k, pick);
    else if (known && m && pp.includes(m.w) && pp.includes(m.l)) win.set(k, m.w);
    else win.set(k, null);
  }
  return { win, parts };
}
/** Title chances when every decided slot is fixed and the rest is played out with current Elo. */
function scenarioOdds(tree, win, rating) {
  const dist = new Map();
  const solve = k => {
    if (dist.has(k)) return dist.get(k);
    let out;
    if (win.get(k)) out = new Map([[win.get(k), 1]]);
    else {
      const A = solve(2 * k), B = solve(2 * k + 1);
      out = new Map();
      for (const [X, Y] of [[A, B], [B, A]]) for (const [i, pi] of X) {
        let sum = 0;
        for (const [j, pj] of Y) sum += pj * eloProb(rating.get(i), rating.get(j));
        out.set(i, (out.get(i) || 0) + pi * sum);
      }
    }
    dist.set(k, out);
    return out;
  };
  return solve(1);
}
function whatIfCard(root, e, main, params) {
  const tree = drawTree(main);
  if (!tree) return;
  const now = titleOdds(tree, 'now');
  const actual = now.title;
  const picks = new Map();
  for (const tok of String(params.wi || '').split(',')) {
    const [k, pid] = tok.split('-');
    if (+k >= 1 && +k < 2 * tree.L && D.players[pid]) picks.set(+k, pid);
  }
  const roundName = n => ({ 1: 'Final', 2: 'Semifinals', 4: 'Quarterfinals', 8: 'Round of 16', 16: 'Round of 32', 32: 'Round of 64' }[n] || `Round of ${n * 2}`);
  const body = h('div');
  const done = !!e.champ;
  root.appendChild(h('div', { class: 'mt' }, card('What if? Pick the winners', done
    ? 'Change any result and the rest of the draw replays with Elo: who would have won the title instead?'
    : 'Pick winners for matches still to be played (or change ones already played) and watch every title chance update', body)));
  const draw = () => {
    const { win, parts } = resolveDraw(tree, picks);
    for (const [k, pid] of [...picks]) if (win.get(k) !== pid) picks.delete(k);      // picks orphaned by an earlier change
    setQuery({ wi: [...picks].map(([k, pid]) => `${k}-${pid}`).join(',') || null });
    const odds = scenarioOdds(tree, win, now.rating);
    const cols = [];
    for (let n = tree.L; n >= 1; n /= 2) {
      const slots = [];
      for (let k = n; k < 2 * n; k++) slots.push(k);
      cols.push(h('div', { class: 'wi-col' }, h('div', { class: 'wi-title' }, roundName(n)), h('div', { class: 'wi-inner' }, slots.map(k => {
        const m = tree.byK.get(k), pp = parts.get(k), w = win.get(k), changed = picks.has(k) && !(m && m.w === picks.get(k) && pp.includes(m.l));
        return h('div', { class: 'wi-m' + (changed ? ' changed' : '') }, pp.map(pid => {
          if (!pid) return h('div', { class: 'wi-p tbd' }, 'TBD');
          const real = m && m.w === pid && pp.includes(m.l);
          return h('button', { type: 'button', class: 'wi-p' + (w === pid ? ' w' : '') + (w && w !== pid ? ' l' : ''), title: real ? 'Won this match in reality' : 'Pick as the winner',
            onclick: () => { if (picks.get(k) === pid) picks.delete(k); else picks.set(k, pid); draw(); } },
            h('span', { class: 'ellipsis' }, D.players[pid]?.short || pid), real && !picks.has(k) ? h('span', { class: 'wi-real' }, '\u2713') : null);
        }));
      }))));
    }
    const champ = win.get(1);
    cols.push(h('div', { class: 'wi-col wi-champ' }, h('div', { class: 'wi-title' }, 'Champion'), h('div', { class: 'wi-inner' },
      h('div', { class: 'wi-m' }, champ ? h('div', { class: 'wi-p w' }, h('span', { class: 'badge title' }, 'TITLE'), ' ', D.players[champ]?.short) : h('div', { class: 'wi-p tbd' }, 'Undecided')))));
    const rows = [...odds.entries()].filter(([, p]) => p > 0.0005).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const diff = picks.size > 0;
    clear(body).append(
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('span', { class: 'muted', style: { fontSize: '12.5px' } }, diff ? `${picks.size} change${picks.size > 1 ? 's' : ''} from ${done ? 'what happened' : 'the real draw'}. Your scenario is saved in the page address, so you can share it.` : 'Click a player to send them through. Ticks mark real results.'),
        h('span', { class: 'spacer' }),
        diff ? h('button', { class: 'btn-ghost sm', type: 'button', onclick: () => { picks.clear(); draw(); } }, 'Reset to reality') : null),
      h('div', { class: 'wi-bracket' }, cols),
      h('div', { class: 'tbl-wrap mt' }, h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'r' }, done ? 'Real result' : 'Real chance now'), h('th', { class: 'r' }, 'Your scenario'), h('th', { class: 'r' }, 'Change'))),
        h('tbody', {}, rows.map(([pid, p]) => {
          const a = actual.get(pid) || 0, d = p - a;
          return h('tr', {}, h('td', {}, playerLink(pid, { short: true })), h('td', { class: 'r num' }, done ? (a === 1 ? 'Champion' : '\u2013') : fmtPct(a)),
            h('td', { class: 'r num' }, h('b', {}, fmtPct(p))), h('td', { class: 'r num ' + (d > 0.0005 ? 'pos' : d < -0.0005 ? 'neg' : 'muted') }, Math.abs(d) < 0.0005 ? '\u2013' : (d > 0 ? '+' : '\u2212') + fmtPct(Math.abs(d))));
        })))));
  };
  draw();
}

function titleOddsCard(root, e, main) {
  const tree = drawTree(main);
  if (!tree) return;
  const pre = titleOdds(tree, 'pre');
  const live = e.status === 'live' && !e.champ;
  const now = live ? titleOdds(tree, 'now') : null;
  const order = ['R64', 'R48', 'R32', 'R16', 'QF', 'SF', 'F'];
  const reached = new Map();
  for (const m of main) for (const pid of [m.w, m.l]) {
    const cur = reached.get(pid);
    if (!cur || order.indexOf(m.rd) > order.indexOf(cur.rd)) reached.set(pid, { rd: m.rd, won: m.w === pid });
  }
  const tagOf = new Map();
  for (const m of main) { if (m.wTag) tagOf.set(m.w, m.wTag); if (m.lTag) tagOf.set(m.l, m.lTag); }
  const rows = [...pre.title.entries()].map(([pid, p]) => ({ pid, p, now: now ? (now.title.get(pid) || 0) : null, elo: pre.rating.get(pid), r: reached.get(pid) }))
    .sort((a, b) => b.p - a.p);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const result = r => {
    if (!r.r) return '–';
    if (e.champ === r.pid) return 'Champion';
    if (live && r.r.won && (now.title.get(r.pid) || 0) > 0) return 'Still in';
    return 'Lost ' + ({ F: 'final', SF: 'SF', QF: 'QF' }[r.r.rd] || r.r.rd);
  };
  const champ = e.champ ? rows.find(r => r.pid === e.champ) : null;
  const upsets = main.filter(m => isNum(m.pWin) && !m.flag).sort((a, b) => a.pWin - b.pWin).slice(0, 3);
  const fav = rows[0];
  const intro = h('div', { class: 'odds-intro' },
    champ ? h('p', {}, h('b', {}, D.players[champ.pid]?.name),
      champ.rank === 1 ? ` won the title as the pre-draw favourite, with a ${fmtPct(champ.p)} chance before the first round.`
        : ` won the title after starting the main draw with a ${fmtPct(champ.p)} chance (favourite number ${champ.rank} of ${rows.length}). The pre-draw favourite was ${D.players[fav.pid]?.name} (${fmtPct(fav.p)}), who ${result(fav).replace('Lost ', 'lost in the ')}.`) :
      live ? h('p', {}, `Live odds: results so far are fixed, the rest of the draw is played out with current Elo ratings. ${D.players[[...now.title.entries()].sort((a, b) => b[1] - a[1])[0][0]]?.name} is now the favourite.`) : null,
    upsets.length ? h('p', { class: 'muted' }, 'Biggest upsets: ', upsets.map((m, i) => [i ? '; ' : '', h('a', { href: '#/match/' + m.id }, `${D.players[m.w]?.short} d. ${D.players[m.l]?.short}`), ` (${fmtPct(m.pWin)} chance, ${m.rd})`])) : null);
  const show = live ? rows.filter((r, i) => r.now > 0.0005 || i < 8).sort((a, b) => b.now - a.now || b.p - a.p)
    : rows.filter((r, i) => i < 12 || r.pid === e.champ);
  const tbl = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
    h('thead', {}, h('tr', {}, h('th', { class: 'r' }, '#'), h('th', {}, 'Player'), h('th', { class: 'r' }, 'Elo before'), h('th', { class: 'r' }, 'Title chance before the draw'), live ? h('th', { class: 'r' }, 'Title chance now') : null, h('th', {}, live ? 'Status' : 'Result'))),
    h('tbody', {}, show.map(r => h('tr', { class: r.pid === e.champ ? 'tr-hl' : '' },
      h('td', { class: 'r num muted' }, r.rank),
      h('td', {}, playerLink(r.pid, { short: true }), tagOf.get(r.pid) ? h('span', { class: 'seed' }, ` (${tagOf.get(r.pid)})`) : null),
      h('td', { class: 'r num' }, isNum(r.elo) ? fmtInt(r.elo) : '–'),
      h('td', { class: 'r num' }, h('span', { class: 'odds-bar' }, h('span', { style: { width: Math.min(100, r.p / rows[0].p * 100).toFixed(1) + '%' } })), r.p < 0.001 ? '<0.1%' : fmtPct(r.p)),
      live ? h('td', { class: 'r num' }, r.now > 0 ? fmtPct(r.now) : '–') : null,
      h('td', { class: result(r) === 'Champion' ? 'pos' : 'muted' }, result(r)))))));
  root.appendChild(h('div', { class: 'mt' }, card(live ? 'Title odds' : 'Title odds before the main draw', 'From Elo ratings and the draw: every possible path through the bracket, weighted by each match-up\'s Elo win chance', h('div', {}, intro, tbl))));
}
