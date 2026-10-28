// Play: a daily guess-the-player game, a point-by-point match simulator and an animated Elo race.
import { h, clear, fmtInt, fmtPct, fmtDate, isNum, store, countryChip, countryName, ageOn, regionOf } from '../util.js';
import { D, SEASON, runElo, eloNow, activeSince } from '../data.js';
import { card } from '../charts.js';
import { pageHead, playerPicker, segmented, playerLink, keepTabVisible } from '../components.js';
import { setQuery } from '../main.js';
import { pairInputs, calibrate } from '../predict.js';
import { wpModel } from '../winprob.js';

const TABS = [['daily', 'Mystery player'], ['sim', 'Match simulator'], ['race', 'Elo race']];
const DAY = 864e5;

export function render(root, { params }) {
  let tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'daily';
  root.appendChild(pageHead('Play', 'Games and simulations',
    'Guess the daily mystery player, play out any match point by point, or watch the season’s rating race unfold.'));
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  root.append(tabsEl, body);
  let stop = null;          // stops the current tab's timers
  const show = () => {
    if (stop) stop();
    clear(body);
    stop = (tab === 'daily' ? daily : tab === 'sim' ? simulator : race)(body, params) || null;
  };
  const drawTabs = () => {
    clear(tabsEl);
    for (const [k, label] of TABS) tabsEl.appendChild(h('button', { type: 'button', role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': String(k === tab),
      onclick: () => { tab = k; setQuery({ tab: k }); drawTabs(); show(); } }, label));
    keepTabVisible(tabsEl);
  };
  drawTabs();
  show();
}

// ======================================================================================================
// Daily mystery player
// ======================================================================================================
const MAX_GUESSES = 8;
const LAUNCH = Date.UTC(2026, 9, 28);            // puzzle #1

function titleCounts() {
  const t = new Map();
  for (const e of D.eventList) if (e.champ) t.set(e.champ, (t.get(e.champ) || 0) + 1);
  return t;
}
/** Players eligible as the answer: 12+ matches dated at least two days ago (so tonight's update can't change the
 *  day's answer), with a known country, birth date and hand. Sorted by id so the daily pick is the same for everyone. */
function answerPool() {
  const cutoff = Date.now() - 2 * DAY;
  return Object.values(D.players).filter(p => p.dob && p.c && p.h && (D.byPlayer[p.id] || []).filter(m => m.t && m.t < cutoff).length >= 12)
    .map(p => p.id).sort();
}
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

function profile(pid, titles) {
  const p = D.players[pid], ms = D.byPlayer[pid] || [];
  const bySurf = {};
  for (const m of ms) bySurf[m.surface] = (bySurf[m.surface] || 0) + 1;
  const surf = Object.entries(bySurf).sort((a, b) => b[1] - a[1])[0];
  return { pid, name: p.name, c: p.c, region: regionOf(p.c), age: p.dob ? Math.floor(ageOn(p.dob)) : null, hand: p.h || null, bh: p.bh || null,
    elo: isNum(p.elo) ? p.elo : null, rk: p.rk || null, titles: titles.get(pid) || 0, surf: surf ? surf[0] : null };
}

// Each clue: hit (exact), near (close), miss; arrows say which way the answer lies
const CLUES = [
  { k: 'c', label: 'Country', show: v => v.c ? h('span', {}, countryChip(v.c)) : '?', cmp: (g, t) => g.c === t.c ? 'hit' : g.region && g.region === t.region ? 'near' : 'miss', note: 'yellow = same continent' },
  { k: 'age', label: 'Age', num: true, cmp: (g, t) => numCmp(g.age, t.age, 0, 2), arrow: (g, t) => arrow(g.age, t.age, false) },
  { k: 'hand', label: 'Plays', show: v => ({ R: 'Right', L: 'Left' }[v.hand] || '?'), cmp: (g, t) => g.hand === t.hand ? 'hit' : 'miss' },
  { k: 'bh', label: 'Backhand', show: v => ({ 1: 'One-handed', 2: 'Two-handed' }[v.bh] || '?'), cmp: (g, t) => g.bh && g.bh === t.bh ? 'hit' : 'miss' },
  { k: 'elo', label: 'Elo', num: true, cmp: (g, t) => numCmp(g.elo, t.elo, 20, 75), arrow: (g, t) => arrow(g.elo, t.elo, false), show: v => isNum(v.elo) ? fmtInt(v.elo) : '?' },
  { k: 'rk', label: 'ATP rank', cmp: (g, t) => (!g.rk && !t.rk ? 'hit' : numCmp(g.rk, t.rk, 0, Math.max(15, Math.round((t.rk || 0) * 0.15)))), arrow: (g, t) => arrow(g.rk, t.rk, true), show: v => v.rk ? '#' + v.rk : 'NR' },
  { k: 'titles', label: 'Titles', num: true, cmp: (g, t) => numCmp(g.titles, t.titles, 0, 1), arrow: (g, t) => arrow(g.titles, t.titles, false) },
  { k: 'surf', label: 'Main surface', show: v => v.surf || '?', cmp: (g, t) => g.surf === t.surf ? 'hit' : 'miss' },
];
function numCmp(g, t, hit, near) {
  if (!isNum(g) || !isNum(t)) return 'miss';
  const d = Math.abs(g - t);
  return d <= hit ? 'hit' : d <= near ? 'near' : 'miss';
}
/** Arrow pointing toward the answer: up = answer is higher; for rankings "up" means a better (smaller) rank. */
function arrow(g, t, rank) {
  if (!isNum(g) || !isNum(t) || g === t) return '';
  if (rank) return t < g ? ' ▲' : ' ▼';
  return t > g ? ' ▲' : ' ▼';
}

function daily(host) {
  const titles = titleCounts();
  const pool = answerPool();
  if (pool.length < 20) { host.appendChild(h('div', { class: 'empty' }, 'Not enough players with match history yet.')); return null; }
  const today = new Date().toISOString().slice(0, 10);
  const num = Math.max(1, Math.floor((Date.parse(today) - LAUNCH) / DAY) + 1);
  const key = `ca-daily|${SEASON}|${today}`;
  let practice = null;          // a random answer that doesn't touch the daily stats
  const answerOf = () => practice || pool[hashStr(`${SEASON}|${today}`) % pool.length];
  const stateOf = () => (practice ? practiceState : store.get(key, { guesses: [], done: false, won: false }));
  let practiceState = null;
  const save = st => { if (practice) practiceState = st; else store.set(key, st); };

  const gameCol = h('div'), sideCol = h('div', { class: 'grid g2 mt' });
  host.append(gameCol, sideCol);

  const draw = () => {
    clear(gameCol); clear(sideCol);
    const ans = profile(answerOf(), titles);
    const st = stateOf();
    const guesses = st.guesses.map(pid => profile(pid, titles));
    const left = MAX_GUESSES - guesses.length;
    gameCol.appendChild(card(practice ? 'Practice round' : `Mystery player #${num}`,
      practice ? 'A random player; your daily stats are unaffected' : `A new ${SEASON} Challenger player every day at midnight UTC. ${MAX_GUESSES} guesses.`,
      h('div', {},
        st.done ? null : h('div', { class: 'guess-row' }, playerPicker(null, pid => guess(pid), { placeholder: `Guess ${guesses.length + 1} of ${MAX_GUESSES}: type a player’s name…`, minMatches: 3 }),
          h('span', { class: 'muted guess-left' }, `${left} left`)),
        guesses.length ? guessTable(guesses, ans) : h('p', { class: 'muted' }, 'Each guess shows how close you are: green is a match, yellow is close, and the arrows point toward the answer.'),
        !st.done && guesses.length >= 4 ? h('div', { class: 'notice mt' }, h('b', {}, 'Hint: '), hintText(ans, guesses.length)) : null,
        st.done ? reveal(ans, st, guesses) : null)));
    sideCol.appendChild(howTo());
    sideCol.appendChild(practice ? h('div') : statsCard());
  };
  const guess = pid => {
    const st = stateOf();
    if (st.done || st.guesses.includes(pid)) return;
    st.guesses.push(pid);
    if (pid === answerOf()) { st.done = true; st.won = true; } else if (st.guesses.length >= MAX_GUESSES) st.done = true;
    save(st);
    if (st.done && !practice) recordStats(st);
    draw();
  };
  const recordStats = st => {
    const s = store.get(`ca-daily-stats|${SEASON}`, { played: 0, won: 0, streak: 0, best: 0, dist: Array(MAX_GUESSES).fill(0), last: null });
    if (s.lastDone === today) return;
    s.played++;
    if (st.won) {
      s.won++;
      const yesterday = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
      s.streak = s.last === yesterday ? s.streak + 1 : 1;
      s.best = Math.max(s.best, s.streak);
      s.dist[st.guesses.length - 1]++;
      s.last = today;
    } else s.streak = 0;
    s.lastDone = today;
    store.set(`ca-daily-stats|${SEASON}`, s);
  };
  const hintText = (ans, n) => {
    const p = D.players[ans.pid];
    const last = (D.byPlayer[ans.pid] || []).slice().sort((a, b) => b.t - a.t)[0];
    if (n >= 6 && last) return `their most recent Challenger was ${last.e?.city || 'unknown'} (${fmtDate(last.date)}). Last name starts with “${(p.last || p.name)[0]}”.`;
    return `their last name starts with “${(p.last || p.name)[0]}”.`;
  };
  const reveal = (ans, st, guesses) => {
    const share = shareText(st, guesses, ans);
    const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(share); btn.textContent = 'Copied!'; } catch { prompt('Copy your result:', share); }
    } }, 'Share result');
    const nextUtc = new Date(); nextUtc.setUTCHours(24, 0, 0, 0);
    const hrs = Math.max(0, Math.round((nextUtc - Date.now()) / 36e5));
    return h('div', { class: 'reveal mt' },
      h('div', { class: 'reveal-head' }, st.won ? h('b', {}, `Got it in ${st.guesses.length}!`) : h('b', {}, 'Out of guesses.'), ' The answer was ',
        playerLink(ans.pid), '.'),
      h('p', { class: 'muted' }, `${countryName(ans.c)} · age ${ans.age ?? '?'} · Elo ${isNum(ans.elo) ? fmtInt(ans.elo) : '?'} · ${ans.titles} title${ans.titles === 1 ? '' : 's'} in ${SEASON}.`),
      h('div', { class: 'row' }, practice ? null : btn,
        h('button', { class: 'btn-ghost', type: 'button', onclick: () => { practice = pool[Math.floor(Math.random() * pool.length)]; practiceState = { guesses: [], done: false, won: false }; draw(); } }, practice ? 'Another practice round' : 'Practice with a random player'),
        practice ? h('button', { class: 'btn-ghost', type: 'button', onclick: () => { practice = null; draw(); } }, 'Back to today’s puzzle') : null),
      practice ? null : h('p', { class: 'muted mt', style: { fontSize: '12.5px' } }, `Next mystery player in about ${hrs} hour${hrs === 1 ? '' : 's'}.`));
  };
  const shareText = (st, guesses, ans) => {
    const sq = { hit: '🟩', near: '🟨', miss: '⬛' };
    const rows = guesses.map(g => CLUES.map(c => sq[c.cmp(g, ans)]).join(''));
    return `Challenger Analytics · Mystery player #${num} · ${st.won ? st.guesses.length : 'X'}/${MAX_GUESSES}\n${rows.join('\n')}\n${location.origin}${location.pathname}#/play`;
  };
  const statsCard = () => {
    const s = store.get(`ca-daily-stats|${SEASON}`, { played: 0, won: 0, streak: 0, best: 0, dist: Array(MAX_GUESSES).fill(0) });
    const mx = Math.max(1, ...s.dist);
    return h('div', {}, card('Your record', 'Saved on this device', h('div', {},
      h('div', { class: 'kpis', style: { justifyContent: 'flex-start' } },
        kpi('Played', fmtInt(s.played)), kpi('Win %', s.played ? fmtPct(s.won / s.played).replace('.0%', '%') : '–'), kpi('Streak', fmtInt(s.streak)), kpi('Best', fmtInt(s.best))),
      h('div', { class: 'dist mt' }, s.dist.map((n, i) => h('div', { class: 'dist-row' }, h('span', {}, i + 1),
        h('span', { class: 'dist-bar' }, h('span', { style: { width: Math.max(4, 100 * n / mx) + '%' } }, n || ''))))))));
  };
  const howTo = () => card('How to play', null, h('div', { class: 'clutch-note' },
    h('p', {}, 'Guess the mystery Challenger player of the day. After each guess, every clue compares your player with the answer:'),
    h('ul', {}, h('li', {}, h('span', { class: 'g-cell hit' }, 'Green'), ' is a match.'),
      h('li', {}, h('span', { class: 'g-cell near' }, 'Yellow'), ' is close: the same continent, within 2 years, 75 Elo, about 15% of the ranking or 1 title.'),
      h('li', {}, '▲ and ▼ point toward the answer. For ATP rank, ▲ means the answer is ranked better (a smaller number).')),
    h('p', { class: 'muted' }, `The answer always has at least 12 Challenger matches this season. A hint appears after 4 guesses.`)));
  draw();
  return null;
}
function guessTable(guesses, ans) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact guess-tbl' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Player'), CLUES.map(c => h('th', { class: 'c' }, c.label)))),
    h('tbody', {}, guesses.map(g => h('tr', { class: g.pid === ans.pid ? 'win' : '' },
      h('td', {}, h('b', {}, D.players[g.pid]?.short || g.pid)),
      CLUES.map(c => {
        const res = c.cmp(g, ans);
        const val = c.show ? c.show(g) : (isNum(g[c.k]) ? fmtInt(g[c.k]) : '?');
        return h('td', { class: 'c' }, h('span', { class: 'g-cell ' + res }, val, c.arrow && res !== 'hit' ? c.arrow(g, ans) : ''));
      }))))));
}
function kpi(k, v) { return h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }

// ======================================================================================================
// Match simulator
// ======================================================================================================
/** A best-of-three match (7-point tiebreak at 6-6 in every set), one point at a time. qa/qb: serve-point chances. */
function newMatch(first) {
  return { sets: [], sa: 0, sb: 0, ga: 0, gb: 0, a: 0, b: 0, server: first, tb: false, tbFirst: null, over: false, winner: null,
    won: [0, 0], srvW: [0, 0], srvP: [0, 0], breaks: [0, 0], bpW: [0, 0], bpF: [0, 0], run: [0, 0], best: [0, 0], lastWinner: null };
}
const pointServer = st => {
  if (!st.tb) return st.server;
  const n = st.a + st.b;
  return n === 0 ? st.tbFirst : (Math.floor((n - 1) / 2) % 2 === 1 ? st.tbFirst : 1 - st.tbFirst);
};
/** Situation before the next point: break / set / match point for either player. */
function situation(st) {
  const srv = pointServer(st), pts = [st.a, st.b];
  const winsGame = p => (st.tb ? pts[p] >= 6 && pts[p] - pts[1 - p] >= 1 : pts[p] >= 3 && pts[p] - pts[1 - p] >= 1);
  const games = [st.ga, st.gb], sets = [st.sa, st.sb];
  const winsSet = p => winsGame(p) && (st.tb || (games[p] + 1 >= 6 && games[p] + 1 - games[1 - p] >= 2) || games[p] + 1 === 7);
  const out = { srv, bp: !st.tb && winsGame(1 - srv), sp: [false, false], mp: [false, false] };
  for (const p of [0, 1]) { out.sp[p] = winsSet(p); out.mp[p] = out.sp[p] && sets[p] === 1; }
  return out;
}
/** Plays one point; returns a list of notable events (strings) for the commentary. */
function playPoint(st, qa, qb, names) {
  const sit = situation(st);
  const srv = sit.srv;
  const w = Math.random() < (srv === 0 ? qa : qb) ? srv : 1 - srv;
  const ev = [];
  st.won[w]++; st.srvP[srv]++; if (w === srv) st.srvW[srv]++;
  st.run[w] = st.lastWinner === w ? st.run[w] + 1 : 1; st.lastWinner = w; st.best[w] = Math.max(st.best[w], st.run[w]);
  if (sit.bp) { st.bpF[srv]++; if (w === srv) st.bpW[srv]++; }
  for (const p of [0, 1]) if (sit.mp[p] && w !== p) ev.push(`${names[1 - p]} saves a match point`);
  if (!sit.mp[0] && !sit.mp[1] && sit.bp && w === srv) ev.push(`${names[srv]} saves a break point`);
  if (w === 0) st.a++; else st.b++;
  const pts = [st.a, st.b];
  const gameOver = st.tb ? (pts[w] >= 7 && pts[w] - pts[1 - w] >= 2) : (pts[w] >= 4 && pts[w] - pts[1 - w] >= 2);
  if (!gameOver) return ev;
  // game (or tiebreak) won by w
  const tbScore = st.tb ? Math.min(st.a, st.b) : null;
  if (w === 0) st.ga++; else st.gb++;
  if (!st.tb && w !== srv) { st.breaks[w]++; ev.push(`${names[w]} breaks for ${w === 0 ? st.ga : st.gb}-${w === 0 ? st.gb : st.ga}`); }
  const wasTb = st.tb;
  st.a = 0; st.b = 0;
  const g = [st.ga, st.gb];
  const setOver = wasTb || (g[w] >= 6 && g[w] - g[1 - w] >= 2);
  if (!setOver) {
    st.server = 1 - st.server;
    if (st.ga === 6 && st.gb === 6) { st.tb = true; st.tbFirst = st.server; ev.push('Tiebreak!'); }
    return ev;
  }
  st.sets.push([st.ga, st.gb, tbScore]);
  if (w === 0) st.sa++; else st.sb++;
  st.server = wasTb ? 1 - st.tbFirst : 1 - st.server;
  st.ga = 0; st.gb = 0; st.tb = false; st.tbFirst = null;
  const sc = st.sets[st.sets.length - 1];
  const setTxt = w === 0 ? `${sc[0]}-${sc[1]}` : `${sc[1]}-${sc[0]}`;
  if (st.sa === 2 || st.sb === 2) {
    st.over = true; st.winner = w;
    ev.push(`Game, set and match ${names[w]}: ${st.sets.map(s => (w === 0 ? `${s[0]}-${s[1]}` : `${s[1]}-${s[0]}`) + (s[2] != null ? `(${s[2]})` : '')).join(' ')}`);
  } else ev.push(`${names[w]} takes the ${st.sets.length === 1 ? 'first' : 'second'} set ${setTxt}`);
  return ev;
}
const PT = ['0', '15', '30', '40'];
function pointText(st) {
  if (st.tb) return [String(st.a), String(st.b)];
  if (st.a >= 3 && st.b >= 3) return st.a === st.b ? ['40', '40'] : st.a > st.b ? ['AD', ''] : ['', 'AD'];
  return [PT[st.a], PT[st.b]];
}

function simulator(host, params) {
  const since = activeSince();
  const top = Object.keys(D.byPlayer).filter(pid => (D.byPlayer[pid] || []).length >= 10 && D.byPlayer[pid].some(m => m.t >= since))
    .map(pid => [pid, eloNow(pid, null)]).filter(x => isNum(x[1])).sort((x, y) => y[1] - x[1]);
  const st = { a: (params.a || (top[0] && top[0][0]) || '').toUpperCase(), b: (params.b || (top[1] && top[1][0]) || '').toUpperCase(),
    surf: ['Hard', 'Clay', 'Grass'].includes(params.surf) ? params.surf : 'Hard', speed: 'fast' };
  let timer = null;
  const halt = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const ctrl = h('div', { class: 'sim-ctrl' });
  const pre = h('div', { class: 'sim-pre' });
  const stage = h('div', { class: 'mt' });
  host.append(ctrl, pre, stage);

  const sync = () => { halt(); setQuery({ tab: 'sim', a: st.a, b: st.b, surf: st.surf }); drawPre(); clear(stage); };
  ctrl.append(
    h('div', { class: 'sim-players' },
      h('div', {}, h('div', { class: 'k' }, 'Player A'), playerPicker(st.a, id => { st.a = id; sync(); }, { placeholder: 'Player A…', minMatches: 3 })),
      h('div', { class: 'sim-vs' }, 'vs'),
      h('div', {}, h('div', { class: 'k' }, 'Player B'), playerPicker(st.b, id => { st.b = id; sync(); }, { placeholder: 'Player B…', minMatches: 3 }))),
    h('div', { class: 'row mt' },
      segmented([['Hard', 'Hard'], ['Clay', 'Clay'], ['Grass', 'Grass']], st.surf, v => { st.surf = v; sync(); }),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Speed'),
      segmented([['slow', 'Slow'], ['fast', 'Fast'], ['instant', 'Instant']], st.speed, v => { st.speed = v; }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => playLive() }, '▶ Play a match'),
      h('button', { class: 'btn-ghost', type: 'button', onclick: () => monteCarlo() }, 'Simulate 10,000 matches')));

  let model = null;
  function drawPre() {
    clear(pre);
    model = null;
    if (!D.players[st.a] || !D.players[st.b] || st.a === st.b) { pre.appendChild(h('div', { class: 'empty' }, 'Pick two different players.')); return; }
    const P = pairInputs(st.a, st.b, st.surf);
    const [qa, qb] = calibrate(P.pa, P.pb, P.pBlend);
    model = { P, qa, qb };
    const A = D.players[st.a], B = D.players[st.b];
    pre.appendChild(h('div', { class: 'sim-odds' },
      h('div', {}, h('div', { class: 'sim-n' }, A.short), h('div', { class: 'big' }, fmtPct(P.pBlend))),
      h('div', { class: 'sim-oddsbar' }, h('span', { style: { width: (P.pBlend * 100).toFixed(1) + '%' } })),
      h('div', { class: 'r' }, h('div', { class: 'sim-n' }, B.short), h('div', { class: 'big' }, fmtPct(1 - P.pBlend)))));
    pre.appendChild(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 0' } },
      `Best of three on ${st.surf.toLowerCase()}: the same prediction as the Head-to-head page (Elo plus a serve and return model). On serve, ${A.short} wins ${fmtPct(qa)} of points and ${B.short} ${fmtPct(qb)}. Every point is then played at random with those chances, so no two matches are alike.`));
  }

  function playLive() {
    halt();
    if (!model) return;
    const names = [D.players[st.a].short, D.players[st.b].short];
    const M = wpModel(model.qa, model.qb);
    const m = newMatch(Math.random() < 0.5 ? 0 : 1);
    const wps = [];
    const feed = [];
    clear(stage);
    const board = h('div', { class: 'sim-board' });
    const chartHost = h('div', { class: 'sim-chart' });
    const feedEl = h('ul', { class: 'sim-feed' });
    const statsHost = h('div');
    stage.append(h('div', { class: 'grid g-21' }, h('div', {}, board, chartHost), card('Match commentary', null, feedEl)), statsHost);
    const wpNow = () => M.wp(m.sa, m.sb, m.ga, m.gb, m.server, m.a, m.b, m.tb, m.tb ? m.tbFirst : m.server);
    const paint = () => {
      const [pa, pb] = pointText(m);
      const srv = m.over ? null : pointServer(m);
      const sit = m.over ? null : situation(m);
      const tag = sit ? (sit.mp[0] || sit.mp[1] ? 'MATCH POINT' : sit.sp[0] || sit.sp[1] ? 'SET POINT' : sit.bp ? 'BREAK POINT' : m.tb ? 'TIEBREAK' : '') : 'FINAL';
      clear(board).append(
        h('div', { class: 'sim-tag' + (tag && tag !== 'TIEBREAK' && tag !== 'FINAL' ? ' hot' : '') }, tag || ' '),
        ...[0, 1].map(p => h('div', { class: 'sim-row' + (m.over && m.winner === p ? ' won' : '') },
          h('span', { class: 'sim-srv' }, srv === p ? '●' : ''), h('span', { class: 'sim-name' }, names[p]),
          ...m.sets.map(s => h('span', { class: 'sim-set' + ((p === 0 ? s[0] > s[1] : s[1] > s[0]) ? ' w' : '') }, p === 0 ? s[0] : s[1],
            s[2] != null && (p === 0 ? s[0] < s[1] : s[1] < s[0]) ? h('sup', {}, s[2]) : null)),
          m.over ? null : h('span', { class: 'sim-set cur' }, p === 0 ? m.ga : m.gb),
          m.over ? null : h('span', { class: 'sim-pt' }, p === 0 ? pa : pb))));
      wpChart(chartHost, wps, names);
      clear(feedEl);
      for (const f of feed.slice(-14).reverse()) feedEl.appendChild(h('li', {}, f));
    };
    const step = () => {
      if (!board.isConnected) { halt(); return; }
      wps.push(wpNow());
      const ev = playPoint(m, model.qa, model.qb, names);
      feed.push(...ev);
      if (m.over) { wps.push(m.winner === 0 ? 1 : 0); paint(); statsHost.appendChild(matchStats(m, names)); timer = null; return; }
      if (st.speed === 'instant') { step(); return; }
      paint();
      const pause = st.speed === 'slow' ? 650 : 110;
      timer = setTimeout(step, ev.length ? pause * 2.2 : pause);
    };
    paint();
    if (st.speed === 'instant') step(); else timer = setTimeout(step, 400);
  }

  function monteCarlo() {
    halt();
    if (!model) return;
    const N = 10000;
    const names = [D.players[st.a].short, D.players[st.b].short];
    const res = { a: 0, lines: { '2-0': 0, '2-1': 0, '1-2': 0, '0-2': 0 }, games: 0, tb: 0, scores: new Map(), longest: 0 };
    for (let i = 0; i < N; i++) {
      const m = newMatch(i % 2);
      while (!m.over) playPoint(m, model.qa, model.qb, names);
      if (m.winner === 0) res.a++;
      res.lines[`${m.sa}-${m.sb}`]++;
      const g = m.sets.reduce((x, s) => x + s[0] + s[1], 0);
      res.games += g; res.longest = Math.max(res.longest, g);
      if (m.sets.some(s => s[2] != null)) res.tb++;
      const key = m.sets.map(s => `${s[0]}-${s[1]}`).join(' ');
      res.scores.set(key, (res.scores.get(key) || 0) + 1);
    }
    clear(stage);
    const pA = res.a / N;
    const lines = [['2-0', `${names[0]} in straight sets`], ['2-1', `${names[0]} in three`], ['1-2', `${names[1]} in three`], ['0-2', `${names[1]} in straight sets`]];
    const top = [...res.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    stage.append(
      h('div', { class: 'tiles n4' },
        tile(`${names[0]} wins`, fmtPct(pA), `model said ${fmtPct(model.P.pBlend)}`),
        tile('Goes to a third set', fmtPct((res.lines['2-1'] + res.lines['1-2']) / N), `${fmtInt(res.lines['2-1'] + res.lines['1-2'])} of ${fmtInt(N)}`),
        tile('Has a tiebreak', fmtPct(res.tb / N), 'at least one set to 7-6'),
        tile('Average length', `${(res.games / N).toFixed(1)} games`, `longest: ${res.longest} games`)),
      h('div', { class: 'grid g2 mt' },
        card('How it ends', `${fmtInt(N)} simulated matches`, h('div', { class: 'sim-lines' }, lines.map(([k, label]) => {
          const p = res.lines[k] / N;
          return h('div', { class: 'sim-line' }, h('span', {}, label), h('span', { class: 'sim-lbar' }, h('span', { class: k[0] === '2' ? 'a' : 'b', style: { width: (p * 100).toFixed(1) + '%' } })), h('b', {}, fmtPct(p)));
        }))),
        card('Most likely scorelines', `${names[0]}'s games first`, h('ol', { class: 'list-plain sim-scores' }, top.map(([k, n]) => h('li', {}, h('span', {}, k), h('span', { class: 'val' }, fmtPct(n / N))))))));
  }
  drawPre();
  return halt;
}
function tile(label, value, delta) { return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), delta ? h('div', { class: 'delta' }, delta) : null); }
function matchStats(m, names) {
  const row = (label, a, b) => h('tr', {}, h('td', { class: 'r num' }, a), h('td', { class: 'c muted' }, label), h('td', { class: 'num' }, b));
  const pct = (w, n) => (n ? fmtPct(w / n) : '–');
  return h('div', { class: 'mt' }, card('Match stats', 'This simulated match', h('table', { class: 'tbl compact sim-stats' },
    h('thead', {}, h('tr', {}, h('th', { class: 'r' }, names[0]), h('th', { class: 'c' }, ''), h('th', {}, names[1]))),
    h('tbody', {},
      row('Points won', m.won[0], m.won[1]),
      row('Service points won', pct(m.srvW[0], m.srvP[0]), pct(m.srvW[1], m.srvP[1])),
      row('Breaks of serve', m.breaks[0], m.breaks[1]),
      row('Break points saved', `${m.bpW[0]}/${m.bpF[0]}`, `${m.bpW[1]}/${m.bpF[1]}`),
      row('Longest run of points', m.best[0], m.best[1])))));
}
/** Win-probability line for player A, redrawn as the match goes on. */
function wpChart(host, wps, names) {
  const W = 640, H = 150, n = Math.max(wps.length, 60);
  const x = i => 30 + (i / (n - 1)) * (W - 40), y = p => 10 + (1 - p) * (H - 30);
  const pts = wps.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = wps.length ? wps[wps.length - 1] : 0.5;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg sim-wp" role="img" aria-label="Win probability for ${names[0]}">
    <line x1="30" x2="${W - 10}" y1="${y(0.5)}" y2="${y(0.5)}" class="ref"/>
    <text x="4" y="${y(1) + 4}" class="tick">100%</text><text x="10" y="${y(0.5) + 4}" class="tick">50%</text><text x="16" y="${y(0) + 4}" class="tick">0%</text>
    ${wps.length > 1 ? `<polyline points="${pts}" fill="none" stroke="var(--series-1)" stroke-width="2.2" stroke-linejoin="round"/>` : ''}
    <text x="${W - 12}" y="16" text-anchor="end" class="tick">${names[0]}: ${(last * 100).toFixed(0)}% to win</text></svg>`;
}

// ======================================================================================================
// Elo race
// ======================================================================================================
function race(host, params) {
  const TOP = 10, ROW = 36;
  const E = runElo(null);
  const ts = D.matches.map(m => m.t).filter(Boolean);
  if (!ts.length) return null;
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const frames = [];
  for (let t = t0 + 6 * DAY; t < t1 + 7 * DAY; t += 7 * DAY) frames.push(Math.min(t, t1));
  // one pass per player: rating and match count at each frame (active = played in the 8 weeks before the frame)
  const tl = [...E.tl.entries()];
  const snaps = frames.map(() => []);
  for (const [pid, line] of tl) {
    let i = -1;
    frames.forEach((T, f) => {
      while (i + 1 < line.length && line[i + 1][0] <= T) i++;
      if (i >= 4 && T - line[i][0] <= 56 * DAY) snaps[f].push([pid, line[i][1]]);
    });
  }
  for (const s of snaps) s.sort((a, b) => b[1] - a[1]);
  let f = 0, playing = false, timer = null, follow = params.p && D.players[params.p.toUpperCase()] ? params.p.toUpperCase() : null;
  const halt = () => { playing = false; if (timer) clearTimeout(timer); timer = null; playBtn.textContent = '▶ Play'; };
  const dateEl = h('div', { class: 'race-date' });
  const box = h('div', { class: 'race-box', style: { height: TOP * ROW + 'px' } });
  const followEl = h('div', { class: 'race-follow muted' });
  const slider = h('input', { type: 'range', min: 0, max: frames.length - 1, value: 0, class: 'race-slider', 'aria-label': 'Week' });
  const playBtn = h('button', { class: 'btn', type: 'button' }, '▶ Play');
  const bars = new Map();
  host.append(card(`${SEASON} Elo race`, 'The top 10 by Elo rating each week (players with 5+ matches who played in the previous 8 weeks)',
    h('div', {}, h('div', { class: 'row' }, playBtn, slider, dateEl),
      h('div', { class: 'row mt' }, h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Follow a player'),
        playerPicker(follow, id => { follow = id; setQuery({ tab: 'race', p: id }); paint(); }, { placeholder: 'Highlight a player…', minMatches: 5 }), followEl),
      box)));
  const paint = () => {
    const snap = snaps[f];
    const top = snap.slice(0, TOP);
    const hi = top.length ? top[0][1] : 2000, lo = top.length ? top[top.length - 1][1] - 60 : 1700;
    const seen = new Set();
    top.forEach(([pid, r], i) => {
      seen.add(pid);
      let b = bars.get(pid);
      if (!b) {
        const p = D.players[pid];
        b = h('div', { class: 'rbar' }, h('span', { class: 'rbar-fill' }), h('span', { class: 'rbar-rank' }), h('span', { class: 'rbar-name' }, p && p.c ? countryChip(p.c) : null, p ? p.short : pid), h('span', { class: 'rbar-val' }));
        b.style.transform = `translateY(${TOP * ROW}px)`;
        box.appendChild(b);
        bars.set(pid, b);
      }
      b.classList.toggle('me', pid === follow);
      b.style.opacity = '1';
      b.style.transform = `translateY(${i * ROW}px)`;
      b.querySelector('.rbar-fill').style.width = Math.max(8, 100 * (r - lo) / (hi - lo || 1)) + '%';
      b.querySelector('.rbar-val').textContent = fmtInt(r);
      b.querySelector('.rbar-rank').textContent = i + 1;
    });
    for (const [pid, b] of bars) if (!seen.has(pid)) { b.style.opacity = '0'; b.style.transform = `translateY(${TOP * ROW}px)`; }
    dateEl.textContent = `Week of ${fmtDate(new Date(frames[f]).toISOString().slice(0, 10), true)}`;
    slider.value = String(f);
    if (follow) {
      const k = snap.findIndex(x => x[0] === follow);
      followEl.textContent = k >= 0 ? `${D.players[follow].short}: #${k + 1} (${fmtInt(snap[k][1])})` : `${D.players[follow].short}: not active in the 8 weeks before this date`;
    } else followEl.textContent = '';
  };
  const tick = () => {
    if (!box.isConnected) { halt(); return; }
    if (f >= frames.length - 1) { halt(); return; }
    f++; paint();
    timer = setTimeout(tick, 700);
  };
  playBtn.addEventListener('click', () => {
    if (playing) { halt(); return; }
    if (f >= frames.length - 1) f = 0;
    playing = true; playBtn.textContent = '❚❚ Pause';
    paint(); timer = setTimeout(tick, 500);
  });
  slider.addEventListener('input', () => { halt(); f = +slider.value; paint(); });
  f = frames.length - 1;
  paint();
  return halt;
}

