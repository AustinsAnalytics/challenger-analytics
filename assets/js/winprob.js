// In-match win probability from point-by-point data.
// Each player's chance of winning a point on serve is set so that at 0-0 the model gives the pre-match Elo
// probability; from any score the chance of winning the match then follows exactly from the scoring rules
// (best of three sets, 7-point tiebreak at 6-6 in every set). pipeline/drama.py uses the same maths for the
// season leaderboards, so the numbers on the match page and in the leaderboards agree.
export const WP_BASE = 0.63;      // share of service points won in a typical Challenger match

const r3 = x => Math.floor(x * 1000 + 0.5 + 1e-9) / 1000;      // half up, exactly as pipeline/drama.py

function model(pa, pb) {
  const gm = new Map(), tm = new Map(), sm = new Map(), mm = new Map();
  // P(the server wins the game) from a-b, server's points first
  function game(p, a, b) {
    if (a >= 4 && a - b >= 2) return 1;
    if (b >= 4 && b - a >= 2) return 0;
    if (a >= 3 && b >= 3) {
      const d = (p * p) / (p * p + (1 - p) * (1 - p));
      return a === b ? d : a > b ? p + (1 - p) * d : p * d;
    }
    const k = `${p}|${a}|${b}`;
    let v = gm.get(k);
    if (v === undefined) { v = p * game(p, a + 1, b) + (1 - p) * game(p, a, b + 1); gm.set(k, v); }
    return v;
  }
  // P(A wins the tiebreak) at a-b; first = 0 if A served the tiebreak's first point
  function tiebreak(a, b, first) {
    if (a >= 7 && a - b >= 2) return 1;
    if (b >= 7 && b - a >= 2) return 0;
    if (a >= 6 && b >= 6 && a === b) { const x = pa * (1 - pb), y = (1 - pa) * pb; return x / (x + y); }
    const k = a * 1000 + b * 10 + first;
    let v = tm.get(k);
    if (v === undefined) {
      const n = a + b;
      const srv = n === 0 ? first : (Math.floor((n - 1) / 2) % 2 === 1 ? first : 1 - first);
      const pw = srv === 0 ? pa : 1 - pb;
      v = pw * tiebreak(a + 1, b, first) + (1 - pw) * tiebreak(a, b + 1, first);
      tm.set(k, v);
    }
    return v;
  }
  // P(A wins the set) at ga-gb with srv about to serve
  function set(ga, gb, srv) {
    if (ga >= 6 && ga - gb >= 2) return 1;
    if (gb >= 6 && gb - ga >= 2) return 0;
    if (ga >= 7 && ga > gb) return 1;
    if (gb >= 7 && gb > ga) return 0;
    if (ga >= 6 && gb >= 6) return tiebreak(0, 0, srv);
    const k = ga * 100 + gb * 10 + srv;
    let v = sm.get(k);
    if (v === undefined) {
      const hold = srv === 0 ? game(pa, 0, 0) : 1 - game(pb, 0, 0);
      v = hold * set(ga + 1, gb, 1 - srv) + (1 - hold) * set(ga, gb + 1, 1 - srv);
      sm.set(k, v);
    }
    return v;
  }
  function matchFromSets(sa, sb, srv) {
    if (sa >= 2) return 1;
    if (sb >= 2) return 0;
    const k = sa * 100 + sb * 10 + srv;
    let v = mm.get(k);
    if (v === undefined) {
      const s = set(0, 0, srv);
      v = s * matchFromSets(sa + 1, sb, 1 - srv) + (1 - s) * matchFromSets(sa, sb + 1, 1 - srv);
      mm.set(k, v);
    }
    return v;
  }
  // P(A wins the match) before a point at sets sa-sb, games ga-gb, points a-b (A's numbers first)
  function wp(sa, sb, ga, gb, srv, a, b, tb, first) {
    let pset, nxt;
    if (tb) { pset = tiebreak(a, b, first); nxt = 1 - first; }
    else {
      const hold = srv === 0 ? game(pa, a, b) : 1 - game(pb, b, a);
      pset = hold * set(ga + 1, gb, 1 - srv) + (1 - hold) * set(ga, gb + 1, 1 - srv);
      nxt = 1 - srv;
    }
    return pset * matchFromSets(sa + 1, sb, nxt) + (1 - pset) * matchFromSets(sa, sb + 1, nxt);
  }
  return { wp, matchFromSets };
}

/** The exact scoring model for serve-point probabilities pa (player A) and pb: wp(sets, games, points) before a point. */
export const wpModel = (pa, pb) => model(pa, pb);

/** Serve-point probabilities [pa, pb] that reproduce the pre-match probability pPre for player A. */
export function serveProbs(pPre, base = WP_BASE) {
  const f = d => {
    const a = model(r3(base + d / 2), r3(base - d / 2)).matchFromSets(0, 0, 0);
    const b = model(r3(base - d / 2), r3(base + d / 2)).matchFromSets(0, 0, 0);
    return 0.5 * a + 0.5 * (1 - b);
  };
  const target = pPre >= 0.5 ? pPre : 1 - pPre;
  let lo = 0, hi = 0.3;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; }
  const d = (pPre >= 0.5 ? 1 : -1) * (lo + hi) / 2;
  return [r3(base + d / 2), r3(base - d / 2)];
}

const PT = ['0', '15', '30', '40'];
function pointLabel(a, b, tb) {
  if (tb) return `${a}-${b}`;
  if (a >= 3 && b >= 3) return a === b ? '40-40' : a > b ? 'AD-40' : '40-AD';
  return `${PT[Math.min(a, 3)]}-${PT[Math.min(b, 3)]}`;
}

/**
 * Win probability of player A (side 0 in the point feed = the match winner) before every point.
 * flow: [[set, game, server, gameWinner, secs, tiebreak, momA, momB, codes], ...]; sets: official score [[a, b], ...].
 * Returns null when the point record does not replay to the official score (missing or duplicated games).
 */
export function winProbability(flow, pPre, sets) {
  if (!flow || !flow.length || !(pPre > 0 && pPre < 1)) return null;
  const [pa, pb] = serveProbs(Math.round(pPre * 1e6) / 1e6);
  const M = model(pa, pb);
  let sa = 0, sb = 0, cur = null, ga = 0, gb = 0;
  const pts = [], perSet = new Map();
  for (const g of flow) {
    const [st, gn, server, gw, , tbRaw, , , codes] = g;
    const tb = !!tbRaw;
    if (cur !== null && st !== cur) { if (ga > gb) sa++; else sb++; ga = 0; gb = 0; }
    cur = st;
    if (!codes || ga > 7 || gb > 7 || sa > 1 || sb > 1) return null;
    let a = 0, b = 0, last = null;
    for (const code of codes.split(',')) {
      if (!code) continue;
      const scorer = +code[0];
      const before = M.wp(sa, sb, ga, gb, server, a, b, tb, server);
      const ifA = M.wp(sa, sb, ga, gb, server, a + 1, b, tb, server), ifB = M.wp(sa, sb, ga, gb, server, a, b + 1, tb, server);
      pts.push({
        set: st, game: gn, tb, server, scorer, sn: +code[1], res: code[2], bp: code[3] === '1',
        wp: before, score: `${sa}-${sb} ${ga}-${gb} ${pointLabel(a, b, tb)}`,
        lev: ifA - ifB,                       // how much the match swings on this point
        mpA: ifA > 1 - 1e-9, mpB: ifB < 1e-9,
      });
      if (scorer === 0) a++; else b++;
      last = scorer;
    }
    if (gw === 0 || gw === 1) {
      if (last !== gw) return null;                 // the game's last point must go to the game's winner
      if (gw === 0) ga++; else gb++;
      const ps = perSet.get(st) || [0, 0];
      ps[gw]++;
      perSet.set(st, ps);
    }
  }
  const replay = [...perSet.keys()].sort((x, y) => x - y).map(k => perSet.get(k));
  if (sets && JSON.stringify(replay) !== JSON.stringify(sets.map(s => [s[0], s[1]]))) return null;
  if (pts.length < 40) return null;
  return { pa, pb, pts };
}

/** Headline numbers for a match: lowest chance of the eventual winner, match points saved, swings. */
export function wpSummary(res) {
  const p = res.pts;
  const after = i => (i + 1 < p.length ? p[i + 1].wp : 1);
  let minI = 0, big = 0, bigI = 0, swing = 0, changes = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i].wp < p[minI].wp) minI = i;
    const d = Math.abs(after(i) - p[i].wp);
    swing += d;
    if (d > big) { big = d; bigI = i; }
    if (i > 0 && (p[i - 1].wp - 0.5) * (p[i].wp - 0.5) < 0) changes++;
  }
  return {
    min: p[minI].wp, minI, swing, big, bigI, leadChanges: changes,
    mpSaved: p.filter(x => x.mpB && x.scorer === 0).length,         // the winner saved these
    mpNeeded: p.filter(x => x.mpA).length,                          // match points the winner had
    loserMax: 1 - p[minI].wp,
  };
}
