// Data model: loading, filters, aggregation, metrics, Elo and match-probability models.
import { ratio, isNum, regionOf, ROUND_ORDER, fmtPct, fmt1, fmt2, fmtInt, ageOn, store } from './util.js';

// View mode: "simple" (key numbers, plain labels; the default) or "advanced" (every stat, column and technical section).
// Pages read isAdv(); table columns marked {adv: true} and sections built only when isAdv() are hidden in simple mode.
export const MODE = { adv: store.get('ca-mode', 'simple') === 'advanced' };
export const isAdv = () => MODE.adv;
export function setMode(adv) { MODE.adv = !!adv; store.set('ca-mode', adv ? 'advanced' : 'simple'); }

// Seasons: the current season lives in data/ (rebuilt every night); past seasons in seasons/<year>/ (built once).
// The season in view comes from ?season=<year> in the address, so every page and link can point at a season.
export const CURRENT_SEASON = 2026;
export const SEASONS = [2026, 2025];      // past seasons are built once into site/seasons/<year> (see README "Past seasons")
export const SEASON = (() => {
  try { const s = +new URLSearchParams(location.search).get('season'); return SEASONS.includes(s) ? s : CURRENT_SEASON; } catch { return CURRENT_SEASON; }
})();
const SEASON_FILE = /^data\/(core|core\.web|version|calendar|rankings|tour_points|cv_summary|cv_players|drama|serve_states)\.json$|^data\/(ev|cv|cvp)\//;
/** Path of a data file for the season in view (betting, tracking and other current-season files stay in data/). */
export function dataPath(p) {
  return SEASON !== CURRENT_SEASON && SEASON_FILE.test(p.split('?')[0]) ? p.replace(/^data\//, `seasons/${SEASON}/`) : p;
}
export const PAST = SEASON !== CURRENT_SEASON;
// Files about the current season only (betting slate and track record, the matchup model, video tracking).
const CURRENT_ONLY = /^data\/(betting|matchup|track)\.json|^data\/vt\//;
/** "29 Dec 2025": the ranking week the season's Elo ratings were seeded from. */
export function seedLabel() {
  const w = D.core && D.core.seedWeek;
  const d = w ? new Date(w + 'T00:00:00Z') : new Date(Date.UTC(SEASON - 1, 11, 29));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
/** Address of the same page in another season (pages tied to one season's ids fall back to the overview). */
export function seasonHref(season, target) {
  const hash = target ?? location.hash;       // an explicit target is kept as given (e.g. a match of that season)
  const page = (hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || '';
  const keep = ['', 'rankings', 'players', 'matches', 'tournaments', 'leaders', 'compare', 'insights', 'hawkeye', 'about', 'player', 'betting', 'play'];
  return location.pathname + (season === CURRENT_SEASON ? '' : `?season=${season}`) + (target != null || keep.includes(page) ? hash : '#/');
}

export const D = {
  core: null, events: {}, eventList: [], players: {}, matches: [], byPlayer: {}, K: {}, keys: [],
  lastDate: null, firstDate: null, cache: new Map(), lazy: {}, season: SEASON,
};

// Data files are requested with ?v=<build id> so a fresh daily build is never hidden by caches.
let DATA_V = '';
const vurl = path => { const p = dataPath(path); return DATA_V ? `${p}${p.includes('?') ? '&' : '?'}v=${DATA_V}` : p; };
export async function loadCore(onProgress) {
  try {
    const vr = await fetch(dataPath('data/version.json'), { cache: 'no-store' });
    if (vr.ok) DATA_V = encodeURIComponent((await vr.json()).v || '');
  } catch { /* version file is optional */ }
  // core.web.json: the same data with the match table stored by column (smaller to download); core.json as a fallback
  let res = await fetch(vurl('data/core.web.json'));
  if (!res.ok) res = await fetch(vurl('data/core.json'));
  if (!res.ok) throw new Error(`Could not load the ${SEASON} data (` + res.status + ')');
  const total = +res.headers.get('content-length') || 0;
  let text;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onProgress(Math.min(1, got / total));
    }
    text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  } else text = await res.text();
  build(JSON.parse(text));
}

/** Rows from the column-stored match table of core.web.json (pipeline/build_data.py web_core). */
function matchRows(core) {
  const n = core.nMatches, cols = core.matchCols.map(k => core.columns[k]);
  const st = core.matchCols.map(k => core.statColumns[k]), has = core.matchCols.map(k => core.statHas[k]);
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = core.matchCols.map((k, j) => (st[j] ? (has[j][i] ? st[j].map(a => a[i]) : null) : cols[j][i]));
  }
  return rows;
}

function build(core) {
  if (!core.matches && core.columns) { core.matches = matchRows(core); delete core.columns; delete core.statColumns; delete core.statHas; }
  D.core = core;
  D.keys = core.statKeys;
  core.statKeys.forEach((k, i) => { D.K[k] = i; });
  for (const e of core.events) { D.events[e.id] = e; e.region = regionOf(e.cc); if (e.loc) e.loc = e.loc.replace(/\s+,/g, ','); }
  D.eventList = core.events;
  D.players = core.players;
  for (const pid in D.players) {
    const p = D.players[pid];
    p.id = pid;
    p.name = p.n || pid;
    // p.fw = words in the first name when it is not 1 ("Juan Manuel Cerundolo" -> J.M. Cerundolo)
    const parts = p.name.split(' '), fw = Math.min(p.fw || 1, parts.length - 1);
    const first = parts.slice(0, fw).join(' ');
    p.last = parts.slice(fw).join(' ') || p.name;
    // initials only for capitalised parts: "Yun seong" -> "Y.", "Jean-Marc" -> "J.M."
    const ini = first.split(/[\s-]+/).filter(w => w && w[0] !== w[0].toLowerCase()).map(w => w[0] + '.').join('') || (first[0] ? first[0] + '.' : '');
    p.short = parts.length > 1 ? ini + ' ' + p.last : p.name;
  }
  const c = core.matchCols.reduce((o, k, i) => (o[k] = i, o), {});
  D.matches = core.matches.map((r, idx) => {
    const e = D.events[r[c.e]];
    const m = {
      idx, id: r[c.id], e, eid: r[c.e], date: r[c.date], t: r[c.date] ? Date.parse(r[c.date]) : 0, rd: r[c.rd],
      w: r[c.w], l: r[c.l], sets: r[c.sets] || [], mins: r[c.mins], flag: r[c.flag], wTag: r[c.wTag], lTag: r[c.lTag],
      wRank: r[c.wRank], lRank: r[c.lRank], wElo: r[c.wElo], lElo: r[c.lElo], wSElo: r[c.wSElo], lSElo: r[c.lSElo],
      ws: r[c.ws], ls: r[c.ls], hasMB: !!r[c.mb], hasCV: !!r[c.cv], hasRally: !!r[c.rally],
    };
    m.mid = m.id.split('-')[1];
    // ATP match ids: QSnnn = qualifying, MSnnn = main draw ("QF" is a main-draw round)
    m.q = m.mid.startsWith('QS') || /^Q\d?$/.test(m.rd || '');
    m.surface = e ? e.surface : 'Unknown';
    m.score = scoreStr(m);
    m.nSets = m.sets.length;
    m.pWin = (isNum(m.wElo) && isNum(m.lElo)) ? 1 / (1 + Math.pow(10, (m.lElo - m.wElo) / ELO.scale)) : null;
    return m;
  });
  D.byPlayer = {};
  for (const m of D.matches) {
    (D.byPlayer[m.w] = D.byPlayer[m.w] || []).push(m);
    (D.byPlayer[m.l] = D.byPlayer[m.l] || []).push(m);
  }
  const dates = D.matches.map(m => m.date).filter(Boolean).sort();
  D.firstDate = dates[0]; D.lastDate = dates[dates.length - 1];
  for (const e of D.eventList) {
    e.matches = D.matches.filter(m => m.eid === e.id);
  }
}

export function scoreStr(m) {
  const s = m.sets.map(([a, b, tb]) => tb != null ? `${a}-${b}(${tb})` : `${a}-${b}`).join(' ');
  return s + (m.flag === 'RET' ? ' ret.' : m.flag === 'DEF' ? ' def.' : '');
}

export async function lazy(path) {
  if (PAST && CURRENT_ONLY.test(path)) throw new Error(`${path} covers the ${CURRENT_SEASON} season only`);
  if (D.lazy[path]) return D.lazy[path];
  D.lazy[path] = fetch(vurl(path)).then(r => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
  try { return await D.lazy[path]; } catch (e) { delete D.lazy[path]; throw e; }
}

// ---------------- Filters ----------------
export const F = { period: 'all', surface: 'all', cat: 'all', draw: 'all', io: 'all', region: 'all' };
export const PERIODS = () => {
  const out = [['all', 'Full season'], ['l4w', 'Last 4 weeks'], ['l13w', 'Last 3 months'], ['l26w', 'Last 6 months'],
    ['q1', 'Jan – Mar'], ['q2', 'Apr – Jun'], ['q3', 'Jul – Sep'], ['q4', 'Oct – Dec']];
  return out;
};
export function periodRange(p) {
  const last = D.lastDate ? Date.parse(D.lastDate) : Date.now();
  const day = 864e5;
  const y = SEASON;
  switch (p) {
    case 'l4w': return [last - 27 * day, last];
    case 'l13w': return [last - 90 * day, last];
    case 'l26w': return [last - 181 * day, last];
    case 'q1': return [Date.UTC(y, 0, 1), Date.UTC(y, 2, 31)];
    case 'q2': return [Date.UTC(y, 3, 1), Date.UTC(y, 5, 30)];
    case 'q3': return [Date.UTC(y, 6, 1), Date.UTC(y, 8, 30)];
    case 'q4': return [Date.UTC(y, 9, 1), Date.UTC(y, 11, 31)];
    default: return [-Infinity, Infinity];
  }
}
export function filterKey(extra = '') { return JSON.stringify(F) + extra; }
export function passes(m, f = F) {
  if (f.surface !== 'all' && m.surface !== f.surface) return false;
  if (f.cat !== 'all' && String(m.e && m.e.cat) !== f.cat) return false;
  if (f.draw === 'main' && m.q) return false;
  if (f.draw === 'qual' && !m.q) return false;
  if (f.io !== 'all' && (m.e && m.e.io) !== f.io) return false;
  if (f.region !== 'all' && (m.e && m.e.region) !== f.region) return false;
  if (f.period !== 'all') {
    const [a, b] = periodRange(f.period);
    if (m.t < a || m.t > b) return false;
  }
  return true;
}
/** Players count as active with a match in the last ACTIVE_WEEKS weeks before the end of the period in view. */
export const ACTIVE_WEEKS = 8;
export function periodEnd() {
  const last = D.lastDate ? Date.parse(D.lastDate) : Date.now();
  return F.period === 'all' ? last : Math.min(periodRange(F.period)[1], last);
}
export function activeSince() { return periodEnd() - ACTIVE_WEEKS * 7 * 864e5; }
export function filtered() {
  const key = 'fm' + filterKey();
  if (!D.cache.has(key)) D.cache.set(key, D.matches.filter(m => passes(m)));
  return D.cache.get(key);
}
export function filteredEvents() {
  const ms = filtered();
  const ids = new Set(ms.map(m => m.eid));
  return D.eventList.filter(e => ids.has(e.id));
}
export function memo(key, fn) {
  const k = key + '|' + filterKey();
  if (!D.cache.has(k)) D.cache.set(k, fn());
  return D.cache.get(k);
}

// ---------------- Aggregation ----------------
/**
 * Aggregate one player's matches. Sums are kept per data source so ratios only
 * combine numerators and denominators from the same matches.
 */
export function newAgg(pid) {
  return {
    pid, m: 0, w: 0, l: 0, ret: 0, titles: 0, finals: 0, setsW: 0, setsL: 0, gamesW: 0, gamesL: 0,
    tbW: 0, tbL: 0, decW: 0, decL: 0, firstSetLostW: 0, firstSetLostM: 0, firstSetWonW: 0, firstSetWonM: 0,
    s: new Float64Array(D.keys.length), o: new Float64Array(D.keys.length), n: new Uint16Array(D.keys.length),
    nAtp: 0, cls: { m: 0, W: 0, UE: 0, FE: 0, ace: 0, df: 0, tp: 0, oW: 0, oUE: 0, oFE: 0, oAce: 0 },
    mins: 0, minsN: 0, vsTop100: [0, 0], vsTop200: [0, 0], vsHigher: [0, 0], vsLower: [0, 0], expW: 0, expN: 0,
    last: null, first: null, form: [], qual: [0, 0], main: [0, 0], bySurface: {}, byRound: {}, opps: new Set(),
  };
}
export function addMatch(a, m) {
  const won = m.w === a.pid;
  const me = won ? m.ws : m.ls, op = won ? m.ls : m.ws;
  a.m++; won ? a.w++ : a.l++;
  if (m.flag === 'RET' && !won) a.ret++;
  if (m.rd === 'F') { a.finals++; if (won) a.titles++; }
  const surf = m.surface;
  const bs = a.bySurface[surf] || (a.bySurface[surf] = [0, 0]); bs[won ? 0 : 1]++;
  const br = a.byRound[m.rd] || (a.byRound[m.rd] = [0, 0]); br[won ? 0 : 1]++;
  const qm = m.q ? a.qual : a.main; qm[won ? 0 : 1]++;
  a.opps.add(won ? m.l : m.w);
  if (!a.first || m.t < a.first.t) a.first = m;
  if (!a.last || m.t > a.last.t) a.last = m;
  // sets / games / tiebreaks / deciding sets
  let sw = 0, sl = 0;
  m.sets.forEach(([x, y, tb], i) => {
    const g1 = won ? x : y, g2 = won ? y : x;
    a.gamesW += g1; a.gamesL += g2;
    const setWon = g1 > g2;
    const complete = (Math.max(x, y) >= 6 && Math.abs(x - y) >= 2) || Math.max(x, y) === 7;
    if (complete) { setWon ? (sw++, a.setsW++) : (sl++, a.setsL++); }
    if (tb != null || (Math.max(x, y) === 7 && Math.min(x, y) === 6)) { setWon ? a.tbW++ : a.tbL++; }
    if (i === 0 && complete) {
      if (setWon) { a.firstSetWonM++; if (won) a.firstSetWonW++; } else { a.firstSetLostM++; if (won) a.firstSetLostW++; }
    }
  });
  if (m.sets.length === 3 && !m.flag) { won ? a.decW++ : a.decL++; }
  if (isNum(m.mins) && m.mins > 20 && !m.flag) { a.mins += m.mins; a.minsN++; }
  // ranking context
  const oppRank = won ? m.lRank : m.wRank, myRank = won ? m.wRank : m.lRank;
  if (oppRank && oppRank <= 100) a.vsTop100[won ? 0 : 1]++;
  if (oppRank && oppRank <= 200) a.vsTop200[won ? 0 : 1]++;
  if (oppRank && myRank) {
    if (oppRank < myRank) a.vsHigher[won ? 0 : 1]++; else a.vsLower[won ? 0 : 1]++;
  }
  if (m.pWin != null) { a.expW += won ? m.pWin : 1 - m.pWin; a.expN++; }
  a.form.push(m);
  if (me && op) {
    const K = D.K;
    if (isNum(me[K.sv])) a.nAtp++;
    for (let i = 0; i < D.keys.length; i++) {
      const v = me[i], ov = op[i];
      if (isNum(v)) { a.s[i] += v; a.n[i]++; }
      if (isNum(ov)) a.o[i] += ov;
    }
    // Point-ending classification only counts matches where >= 80% of points are classified
    if (m.hasMB && isNum(me[K.mCls]) && isNum(me[K.tp]) && me[K.tp] > 0 && me[K.mCls] / me[K.tp] >= 0.8) {
      const c = a.cls;
      c.m++; c.W += me[K.mW] || 0; c.UE += me[K.mUE] || 0; c.FE += me[K.mFE] || 0; c.ace += me[K.ace] || 0;
      c.df += me[K.df] || 0; c.tp += me[K.tp] || 0; c.oW += op[K.mW] || 0; c.oUE += op[K.mUE] || 0;
      c.oFE += op[K.mFE] || 0; c.oAce += op[K.ace] || 0;
    }
  }
}
export function finishAgg(a) {
  a.form.sort((x, y) => x.t - y.t || (ROUND_ORDER[x.rd] || 0) - (ROUND_ORDER[y.rd] || 0));
  return a;
}
export function aggregate(matches) {
  const map = new Map();
  for (const m of matches) {
    for (const pid of [m.w, m.l]) {
      let a = map.get(pid);
      if (!a) { a = newAgg(pid); map.set(pid, a); }
      addMatch(a, m);
    }
  }
  for (const a of map.values()) finishAgg(a);
  return map;
}
/** Finals decided by walkover are not matches, but they still count as titles / finals (ATP convention). */
export function woFinals(f = F) {
  return D.eventList.filter(e => e.finalWO && e.champ && passes({ surface: e.surface, e, q: false, t: e.end ? Date.parse(e.end) : 0 }, f));
}
export const NO_FILTER = { period: 'all', surface: 'all', cat: 'all', draw: 'all', io: 'all', region: 'all' };
function addWalkovers(get, f = F) {
  for (const e of woFinals(f)) {
    const c = get(e.champ), r = get(e.runner);
    if (c) { c.titles++; c.finals++; }
    if (r) r.finals++;
  }
}
export function aggregateFiltered() {
  return memo('agg', () => { const map = aggregate(filtered()); addWalkovers(pid => map.get(pid)); return map; });
}
/** f = filter set used for walkover finals (null = none). */
export function playerAgg(pid, matches, f = F) {
  const a = newAgg(pid);
  for (const m of matches) addMatch(a, m);
  if (f) addWalkovers(x => (x === pid ? a : null), f);
  return finishAgg(a);
}

// ---------------- Metrics ----------------
const S = (a, k) => a.s[D.K[k]];
const O = (a, k) => a.o[D.K[k]];
const N = (a, k) => a.n[D.K[k]];
/** Each metric: label, group, fmt, val(agg) -> number|null, n(agg) sample size, dir 1 = higher is better. */
export const METRICS = {
  elo: { label: 'Elo rating', short: 'Elo', group: 'Rating', fmt: fmtInt, dir: 1, desc: 'Current Elo rating from Challenger matches, seeded from the start-of-season ATP ranking (and last season\'s Elo for players with 5+ Challenger matches then).' },
  winPct: { label: 'Win %', short: 'Win%', group: 'Results', fmt: fmtPct, dir: 1, val: a => ratio(a.w, a.m), n: a => a.m },
  wins: { label: 'Wins', short: 'W', group: 'Results', fmt: fmtInt, dir: 1, val: a => a.w, n: a => a.m },
  titles: { label: 'Titles', short: 'Titles', group: 'Results', fmt: fmtInt, dir: 1, val: a => a.titles, n: a => a.m },
  setsPct: { label: 'Sets won %', short: 'Sets%', group: 'Results', fmt: fmtPct, dir: 1, val: a => ratio(a.setsW, a.setsW + a.setsL), n: a => a.m },
  gamesPct: { label: 'Games won %', short: 'Games%', group: 'Results', fmt: fmtPct, dir: 1, val: a => ratio(a.gamesW, a.gamesW + a.gamesL), n: a => a.m },
  overExp: { label: 'Wins above Elo expectation', short: 'W+Exp', group: 'Results', fmt: v => (v > 0 ? '+' : '') + fmt1(v), dir: 1, val: a => a.expN ? a.w - a.expW : null, n: a => a.expN, desc: 'Actual wins minus the wins expected from pre-match Elo win probabilities.' },
  // Serve
  acePct: { label: 'Ace %', short: 'Ace%', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'ace'), S(a, 'sv')), n: a => a.nAtp, desc: 'Aces per service point.' },
  dfPct: { label: 'Double fault %', short: 'DF%', group: 'Serve', fmt: fmtPct, dir: -1, val: a => ratio(S(a, 'df'), S(a, 'sv')), n: a => a.nAtp, desc: 'Double faults per service point.' },
  firstIn: { label: '1st serve in %', short: '1st In', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'fsIn'), S(a, 'sv')), n: a => a.nAtp },
  firstWon: { label: '1st serve points won %', short: '1st Won', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'fsW'), S(a, 'fsIn')), n: a => a.nAtp },
  secondWon: { label: '2nd serve points won %', short: '2nd Won', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'ssW'), S(a, 'sv') - S(a, 'fsIn')), n: a => a.nAtp },
  spw: { label: 'Service points won %', short: 'SPW', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'fsW') + S(a, 'ssW'), S(a, 'sv')), n: a => a.nAtp },
  hold: { label: 'Service games held %', short: 'Hold%', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'sg') - (S(a, 'bpF') - S(a, 'bpS')), S(a, 'sg')), n: a => a.nAtp },
  acesPerM: { label: 'Aces per match', short: 'Aces/M', group: 'Serve', fmt: fmt1, dir: 1, val: a => ratio(S(a, 'ace'), a.nAtp), n: a => a.nAtp },
  serveRating: { label: 'Serve rating', short: 'Srv Rtg', group: 'Serve', fmt: fmt1, dir: 1, desc: 'ATP formula: 1st in % + 1st won % + 2nd won % + hold % + aces/match − DFs/match.', val: a => {
    const f = ratio(S(a, 'fsIn'), S(a, 'sv')), w1 = ratio(S(a, 'fsW'), S(a, 'fsIn')), w2 = ratio(S(a, 'ssW'), S(a, 'sv') - S(a, 'fsIn'));
    const hd = ratio(S(a, 'sg') - (S(a, 'bpF') - S(a, 'bpS')), S(a, 'sg'));
    if (f == null || w1 == null || w2 == null || hd == null) return null;
    return 100 * (f + w1 + w2 + hd) + S(a, 'ace') / a.nAtp - S(a, 'df') / a.nAtp;
  }, n: a => a.nAtp },
  bpFacedPerSg: { label: 'Break points faced per service game', short: 'BPF/SG', group: 'Serve', fmt: fmt2, dir: -1, val: a => ratio(S(a, 'bpF'), S(a, 'sg')), n: a => a.nAtp },
  v1: { label: 'Avg 1st serve speed (km/h)', short: '1st km/h', group: 'Serve', fmt: fmt1, dir: 1, val: a => ratio(S(a, 'sp1Sum'), S(a, 'sp1N')), n: a => N(a, 'sp1N') ? S(a, 'sp1N') / 40 : 0, desc: 'Hawk-Eye tracked matches only.' },
  v2: { label: 'Avg 2nd serve speed (km/h)', short: '2nd km/h', group: 'Serve', fmt: fmt1, dir: 1, val: a => ratio(S(a, 'sp2Sum'), S(a, 'sp2N')), n: a => N(a, 'sp2N') ? S(a, 'sp2N') / 15 : 0, desc: 'Hawk-Eye tracked matches only.' },
  vmax: { label: 'Fastest serve (km/h)', short: 'Max km/h', group: 'Serve', fmt: fmtInt, dir: 1, noAvg: true, desc: 'Hawk-Eye tracked matches; isolated radar spikes are ignored.', val: a => { const i = D.K.spMax; let mx = 0; for (const m of a.form) { const me = m.w === a.pid ? m.ws : m.ls; if (me && me[i] > mx) mx = me[i]; } return mx || null; }, n: a => N(a, 'sp1N') },
  firstPt: { label: 'First point of service game won %', short: '15-0 %', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'fpW'), S(a, 'fpP')), n: a => N(a, 'fpP') },
  loveHold: { label: 'Love holds %', short: 'Love%', group: 'Serve', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'lhold'), S(a, 'sgM')), n: a => N(a, 'sgM') },
  // Return
  rpw: { label: 'Return points won %', short: 'RPW', group: 'Return', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r1W') + S(a, 'r2W'), S(a, 'r1P') + S(a, 'r2P')), n: a => a.nAtp },
  r1: { label: '1st serve return points won %', short: 'vs 1st', group: 'Return', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r1W'), S(a, 'r1P')), n: a => a.nAtp },
  r2: { label: '2nd serve return points won %', short: 'vs 2nd', group: 'Return', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r2W'), S(a, 'r2P')), n: a => a.nAtp },
  brk: { label: 'Return games won %', short: 'Break%', group: 'Return', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'bpC'), S(a, 'rg')), n: a => a.nAtp },
  bpOppPerRg: { label: 'Break chances per return game', short: 'BPO/RG', group: 'Return', fmt: fmt2, dir: 1, val: a => ratio(S(a, 'bpO'), S(a, 'rg')), n: a => a.nAtp },
  oppAce: { label: 'Opponent ace % (lower = better returner)', short: 'Opp Ace%', group: 'Return', fmt: fmtPct, dir: -1, val: a => ratio(O(a, 'ace'), S(a, 'r1P') + S(a, 'r2P')), n: a => a.nAtp },
  returnRating: { label: 'Return rating', short: 'Ret Rtg', group: 'Return', fmt: fmt1, dir: 1, desc: 'ATP formula: 1st return won % + 2nd return won % + return games won % + break points converted %.', val: a => {
    const x = ratio(S(a, 'r1W'), S(a, 'r1P')), y = ratio(S(a, 'r2W'), S(a, 'r2P')), z = ratio(S(a, 'bpC'), S(a, 'rg')), bp = ratio(S(a, 'bpC'), S(a, 'bpO'));
    if (x == null || y == null || z == null) return null;
    return 100 * (x + y + z + (bp || 0));
  }, n: a => a.nAtp },
  // Overall
  tpw: { label: 'Total points won %', short: 'TPW', group: 'Overall', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'tpW'), S(a, 'tp')), n: a => a.nAtp },
  dr: { label: 'Dominance ratio', short: 'DR', group: 'Overall', fmt: fmt2, dir: 1, desc: 'Return points won % ÷ service points lost %. Above 1.00 means winning more return points than you lose on serve.', val: a => {
    const r = ratio(S(a, 'r1W') + S(a, 'r2W'), S(a, 'r1P') + S(a, 'r2P')); const sp = ratio(S(a, 'fsW') + S(a, 'ssW'), S(a, 'sv'));
    return r != null && sp != null && sp < 1 ? r / (1 - sp) : null;
  }, n: a => a.nAtp },
  minsPerM: { label: 'Average match length (min)', short: 'Min/M', group: 'Overall', fmt: fmtInt, dir: 0, val: a => ratio(a.mins, a.minsN), n: a => a.minsN },
  // Pressure
  bpSaved: { label: 'Break points saved %', short: 'BP Svd', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'bpS'), S(a, 'bpF')), n: a => S(a, 'bpF') / 4 },
  bpConv: { label: 'Break points converted %', short: 'BP Conv', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'bpC'), S(a, 'bpO')), n: a => S(a, 'bpO') / 4 },
  tbPct: { label: 'Tiebreaks won %', short: 'TB%', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(a.tbW, a.tbW + a.tbL), n: a => a.tbW + a.tbL },
  decPct: { label: 'Deciding sets won %', short: 'Dec%', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(a.decW, a.decW + a.decL), n: a => a.decW + a.decL },
  bigServe: { label: 'Serve points won at 30-30 / deuce', short: 'Big Srv', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'bigSW'), S(a, 'bigSP')), n: a => S(a, 'bigSP') / 8 },
  bigReturn: { label: 'Return points won at 30-30 / deuce', short: 'Big Ret', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'bigRW'), S(a, 'bigRP')), n: a => S(a, 'bigRP') / 8 },
  clutch: { label: 'Clutch serve (BP saved % − SPW %)', short: 'Clutch', group: 'Pressure', fmt: v => (v > 0 ? '+' : '') + fmt1(v * 100), dir: 1, desc: 'Positive = serves better on break points than on average points (percentage points).', val: a => {
    const b = ratio(S(a, 'bpS'), S(a, 'bpF')), sp = ratio(S(a, 'fsW') + S(a, 'ssW'), S(a, 'sv'));
    return b != null && sp != null ? b - sp : null;
  }, n: a => S(a, 'bpF') / 4 },
  comeback: { label: 'Wins after losing 1st set %', short: 'Comeback', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(a.firstSetLostW, a.firstSetLostM), n: a => a.firstSetLostM },
  closeOut: { label: 'Wins after winning 1st set %', short: 'Close-out', group: 'Pressure', fmt: fmtPct, dir: 1, val: a => ratio(a.firstSetWonW, a.firstSetWonM), n: a => a.firstSetWonM },
  pressureRating: { label: 'Under-pressure rating', short: 'Pressure', group: 'Pressure', fmt: fmt1, dir: 1, desc: 'ATP formula: BP converted % + BP saved % + tiebreaks won % + deciding sets won %.', val: a => {
    const x = ratio(S(a, 'bpC'), S(a, 'bpO')), y = ratio(S(a, 'bpS'), S(a, 'bpF')), z = ratio(a.tbW, a.tbW + a.tbL), d = ratio(a.decW, a.decW + a.decL);
    if (x == null || y == null) return null;
    return 100 * (x + y + (z ?? 0.5) + (d ?? 0.5));
  }, n: a => a.nAtp },
  // Point endings (umpire-logged classification; matches with >= 80% classified points)
  winnersPerM: { label: 'Winners per match (incl. aces)', short: 'Win/M', group: 'Point endings', fmt: fmt1, dir: 1, val: a => ratio(a.cls.W + a.cls.ace, a.cls.m), n: a => a.cls.m },
  uePerM: { label: 'Unforced errors per match', short: 'UE/M', group: 'Point endings', fmt: fmt1, dir: -1, val: a => ratio(a.cls.UE, a.cls.m), n: a => a.cls.m },
  wUe: { label: 'Winner / unforced error ratio', short: 'W/UE', group: 'Point endings', fmt: fmt2, dir: 1, val: a => ratio(a.cls.W + a.cls.ace, a.cls.UE), n: a => a.cls.m },
  winnerPct: { label: 'Points won by own winner %', short: 'Wnr%', group: 'Point endings', fmt: fmtPct, dir: 1, val: a => ratio(a.cls.W + a.cls.ace, a.cls.tp), n: a => a.cls.m },
  uePct: { label: 'Points lost by own UE %', short: 'UE%', group: 'Point endings', fmt: fmtPct, dir: -1, val: a => ratio(a.cls.UE, a.cls.tp), n: a => a.cls.m },
  feInduced: { label: 'Forced errors induced per match', short: 'FE ind.', group: 'Point endings', fmt: fmt1, dir: 1, val: a => ratio(a.cls.oFE, a.cls.m), n: a => a.cls.m },
  aggression: { label: 'Aggression index', short: 'Aggr.', group: 'Point endings', fmt: fmtPct, dir: 0, desc: '(Winners + forced errors induced + UEs) ÷ points played: how often the player ends the point.', val: a => ratio(a.cls.W + a.cls.ace + a.cls.oFE + a.cls.UE, a.cls.tp), n: a => a.cls.m },
  // Rally (Hawk-Eye tracked)
  rally4: { label: 'Points won, rallies 1-4 shots', short: '1-4', group: 'Rally', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r4W'), S(a, 'r4P')), n: a => S(a, 'r4P') / 40 },
  rally8: { label: 'Points won, rallies 5-8 shots', short: '5-8', group: 'Rally', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r8W'), S(a, 'r8P')), n: a => S(a, 'r8P') / 15 },
  rally9: { label: 'Points won, rallies 9+ shots', short: '9+', group: 'Rally', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'r9W'), S(a, 'r9P')), n: a => S(a, 'r9P') / 10 },
  avgRally: { label: 'Average rally length (shots)', short: 'Avg rally', group: 'Rally', fmt: fmt2, dir: 0, val: a => ratio(S(a, 'rlSum'), S(a, 'rlN')), n: a => S(a, 'rlN') / 40 },
  netPct: { label: 'Net points won %', short: 'Net%', group: 'Rally', fmt: fmtPct, dir: 1, val: a => ratio(S(a, 'netW'), S(a, 'netP')), n: a => S(a, 'netP') / 8 },
  netFreq: { label: 'Net approaches per match', short: 'Net/M', group: 'Rally', fmt: fmt1, dir: 0, val: a => ratio(S(a, 'netP'), N(a, 'netP')), n: a => N(a, 'netP') },
  // Strokes (forehand / backhand endings)
  fhWue: { label: 'Forehand winners ÷ unforced errors', short: 'FH W/UE', group: 'Strokes', fmt: fmt2, dir: 1, val: a => ratio(S(a, 'fhW'), S(a, 'fhUE')), n: a => N(a, 'fhW') },
  bhWue: { label: 'Backhand winners ÷ unforced errors', short: 'BH W/UE', group: 'Strokes', fmt: fmt2, dir: 1, val: a => ratio(S(a, 'bhW'), S(a, 'bhUE')), n: a => N(a, 'bhW') },
  fhShare: { label: 'Forehand share of winners', short: 'FH share', group: 'Strokes', fmt: fmtPct, dir: 0, val: a => ratio(S(a, 'fhW'), S(a, 'fhW') + S(a, 'bhW')), n: a => N(a, 'fhW') },
  // Ranking context
  vsTop100: { label: 'Win % vs top-100 opponents', short: 'vs T100', group: 'Results', fmt: fmtPct, dir: 1, val: a => ratio(a.vsTop100[0], a.vsTop100[0] + a.vsTop100[1]), n: a => (a.vsTop100[0] + a.vsTop100[1]) * 3 },
  vsHigher: { label: 'Win % vs higher-ranked opponents', short: 'vs Higher', group: 'Results', fmt: fmtPct, dir: 1, val: a => ratio(a.vsHigher[0], a.vsHigher[0] + a.vsHigher[1]), n: a => a.vsHigher[0] + a.vsHigher[1] },
};
for (const [k, m] of Object.entries(METRICS)) m.key = k;
export const METRIC_GROUPS = ['Results', 'Serve', 'Return', 'Overall', 'Pressure', 'Point endings', 'Rally', 'Strokes'];
export function mval(key, a) {
  const m = METRICS[key];
  if (key === 'elo') return eloNow(a.pid);
  return m.val ? m.val(a) : null;
}

/** Tour-wide reference values (all players combined) for a set of matches (default: the current filters). */
const tourCache = new WeakMap();
export function tourAgg(matches = filtered()) {
  // cached per match array (filtered() returns the same array while the filters are unchanged)
  let a = tourCache.get(matches);
  if (!a) {
    a = newAgg('__tour__');
    for (const m of matches) {
      a.pid = m.w; addMatch(a, m);
      a.pid = m.l; addMatch(a, m);
    }
    a.pid = '__tour__';
    tourCache.set(matches, a);
  }
  return a;
}

// ---------------- Elo ----------------
// Parameters tuned on the season (pipeline/tune_elo.py): seed slope, unranked start, K curve, logistic scale.
export const ELO = { b: 140, unranked: 1300, k: 250, exp: 0.6, scale: 275, n0: [20, 15, 2] };
function seedRating(pid) {
  const p = D.players[pid];
  if (p && p.s0 != null) return [p.s0, p.n0];      // carried over from last season (pipeline/build_data.py)
  const rk = p && p.rk0;
  if (!rk) return [ELO.unranked, ELO.n0[2]];
  return [1750 + ELO.b * Math.log(200) - ELO.b * Math.log(Math.max(1, rk)), rk <= 300 ? ELO.n0[0] : rk <= 1000 ? ELO.n0[1] : ELO.n0[2]];
}
const kf = n => ELO.k / Math.pow(n + 5, ELO.exp);
/** Run Elo over all matches (optionally one surface). Returns per-player timelines. */
export function runElo(surface = null) {
  const key = 'elo|' + (surface || 'all');
  if (D.cache.has(key)) return D.cache.get(key);
  const r = new Map(), n = new Map(), tl = new Map(), peak = new Map();
  const pre = new Map();
  const ms = D.matches.filter(m => !surface || m.surface === surface);
  const overall = surface ? runElo(null) : null;
  for (const m of ms) {
    for (const p of [m.w, m.l]) if (!r.has(p)) {
      // surface ratings start from the player's overall rating just before their first match on that surface
      const [s0, n0] = seedRating(p);
      const pre = overall && overall.pre.get(m.id);
      const r0 = pre ? pre[p === m.w ? 0 : 1] : s0;
      const nPrior = overall ? (overall.tl.get(p) || []).filter(x => x[0] < m.t).length + n0 : n0;
      r.set(p, r0); n.set(p, surface ? Math.max(2, Math.floor(nPrior / 2)) : n0); tl.set(p, []);
    }
    const rw = r.get(m.w), rl = r.get(m.l);
    pre.set(m.id, [rw, rl]);
    const e = 1 / (1 + Math.pow(10, (rl - rw) / ELO.scale));
    const mult = m.flag === 'RET' ? 0.5 : 1;
    const nw = rw + kf(n.get(m.w)) * mult * (1 - e), nl = rl - kf(n.get(m.l)) * mult * (1 - e);
    r.set(m.w, nw); r.set(m.l, nl);
    n.set(m.w, n.get(m.w) + 1); n.set(m.l, n.get(m.l) + 1);
    tl.get(m.w).push([m.t, nw, m]); tl.get(m.l).push([m.t, nl, m]);
    if (!peak.has(m.w) || nw > peak.get(m.w)) peak.set(m.w, nw);
    if (!peak.has(m.l) || nl > peak.get(m.l)) peak.set(m.l, nl);
  }
  const out = { r, n, tl, peak, pre };
  D.cache.set(key, out);
  return out;
}
/**
 * The ATP ranking players with this (overall, final) Elo usually hold: least-squares fit of log10(ATP rank) on Elo over
 * players with 5+ matches and a ranking, rounded to a familiar number ("plays like #130"); capped at #20, null past #1,500.
 */
export function eloAsAtp(elo) {
  if (!isNum(elo)) return null;
  let fit = D.cache.get('eloAtpFit');
  if (!fit) {
    const pts = Object.values(D.players).filter(p => p.rk > 0 && isNum(p.elo) && (D.byPlayer[p.id] || []).length >= 5).map(p => [p.elo, Math.log10(p.rk)]);
    const n = pts.length, mx = pts.reduce((a, q) => a + q[0], 0) / (n || 1), my = pts.reduce((a, q) => a + q[1], 0) / (n || 1);
    const b = pts.reduce((a, q) => a + (q[0] - mx) * (q[1] - my), 0) / (pts.reduce((a, q) => a + (q[0] - mx) ** 2, 0) || 1);
    fit = { n, mx, my, b };
    D.cache.set('eloAtpFit', fit);
  }
  if (fit.n < 50) return null;
  const r = Math.max(20, 10 ** (fit.my + fit.b * (elo - fit.mx)));      // the very best are capped at "#20"
  if (r > 1500) return null;
  const step = r < 30 ? 5 : r < 200 ? 10 : r < 600 ? 25 : 50;
  return Math.max(1, Math.round(r / step) * step);
}

/** Elo as of the end of the current period (surface-specific when a surface filter is set). */
export function eloNow(pid, surface = F.surface !== 'all' ? F.surface : null) {
  const E = runElo(surface);
  const t = E.tl.get(pid);
  if (!t || !t.length) return null;
  if (F.period === 'all') return t[t.length - 1][1];
  const [, end] = periodRange(F.period);
  let v = null;
  for (const [ts, rv] of t) { if (ts <= end) v = rv; else break; }
  return v;
}
export function eloAt(pid, ts, surface = null) {
  const t = runElo(surface).tl.get(pid);
  if (!t) return null;
  let v = seedRating(pid)[0];
  for (const [x, rv] of t) { if (x <= ts) v = rv; else break; }
  return v;
}
export const eloProb = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / ELO.scale));

// ---------------- Markov match model ----------------
/** P(server holds) given probability p of winning a service point. */
export function pGame(p) {
  const q = 1 - p;
  const deuce = (p * p) / (p * p + q * q);
  return Math.pow(p, 4) * (1 + 4 * q + 10 * q * q) + 20 * Math.pow(p, 3) * Math.pow(q, 3) * deuce;
}
/** P(player A wins a tiebreak to 7) where A serves first; pa / pb = serve point win probabilities. */
export function pTiebreak(pa, pb) {
  // dynamic programming over points (A serves point 1, then alternating pairs)
  const memoT = new Map();
  const serverOf = k => (k === 0 ? 0 : (Math.floor((k - 1) / 2) % 2 === 0 ? 1 : 0));
  function f(a, b) {
    if (a >= 7 && a - b >= 2) return 1;
    if (b >= 7 && b - a >= 2) return 0;
    if (a >= 6 && b >= 6 && a === b) {
      // from 6-6 on, points alternate in pairs; closed form for deuce-like state
      const pA = pa * (1 - pb), pB = (1 - pa) * pb;
      return pA / (pA + pB);
    }
    const key = a * 100 + b;
    if (memoT.has(key)) return memoT.get(key);
    const srv = serverOf(a + b);
    const pw = srv === 0 ? pa : 1 - pb;
    const v = pw * f(a + 1, b) + (1 - pw) * f(a, b + 1);
    memoT.set(key, v);
    return v;
  }
  return f(0, 0);
}
/** P(A wins a set) with A serving first. */
export function pSet(pa, pb) {
  const ga = pGame(pa), gb = pGame(pb);
  const tb = pTiebreak(pa, pb);
  const memoS = new Map();
  function f(a, b) {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 7) return 1; if (b === 7) return 0;
    if (a === 6 && b === 6) return tb;
    const key = a * 10 + b;
    if (memoS.has(key)) return memoS.get(key);
    const aServes = (a + b) % 2 === 0;
    const pw = aServes ? ga : 1 - gb;
    const v = pw * f(a + 1, b) + (1 - pw) * f(a, b + 1);
    memoS.set(key, v);
    return v;
  }
  return f(0, 0);
}
export function pMatchBo3(pa, pb) {
  const s = (pSet(pa, pb) + 1 - pSet(pb, pa)) / 2; // average over who serves first
  return s * s * (3 - 2 * s);
}
/** Barnett–Clarke combination: A's serve-point probability against B. */
export function matchupServe(aSpw, bRpw, tourSpw) {
  const tourRpw = 1 - tourSpw;
  return Math.min(0.95, Math.max(0.3, tourSpw + (aSpw - tourSpw) - (bRpw - tourRpw)));
}

// ---------------- misc helpers ----------------
export function playerName(pid, short = false) {
  const p = D.players[pid];
  return p ? (short ? p.short : p.name) : pid;
}
export function playerAge(pid, iso) { const p = D.players[pid]; return p && p.dob ? ageOn(p.dob, iso) : null; }
export function rankChip(r) { return r ? '#' + r : 'NR'; }
export function tagLabel(t) {
  if (!t) return '';
  return '(' + t + ')';
}
export function surfaceColorVar(surf) {
  return { Hard: 'var(--s-hard)', Clay: 'var(--s-clay)', Grass: 'var(--s-grass)', Carpet: 'var(--s-carpet)' }[surf] || 'var(--muted)';
}
