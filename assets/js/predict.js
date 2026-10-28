// Head-to-head prediction for any pair on a surface: Elo (overall and surface) blended with a point-level Markov model
// built from each player's serve and return points won. Used by the Head-to-head page and the match simulator.
import { isNum } from './util.js';
import { D, METRICS, playerAgg, tourAgg, matchupServe, pMatchBo3, eloNow, runElo, eloProb } from './data.js';

/**
 * Serve-point probabilities and win chances for a vs b on `surf`. `filtered` = each player's matches under the current
 * filters (the Head-to-head page passes them; the default is the whole season).
 */
export function pairInputs(a, b, surf, msA = D.byPlayer[a] || [], msB = D.byPlayer[b] || []) {
  const aA = playerAgg(a, msA), aB = playerAgg(b, msB);
  const surfMs = D.matches.filter(m => m.surface === surf);
  const tourSpw = METRICS.spw.val(tourAgg(surfMs));
  const sA = playerAgg(a, (D.byPlayer[a] || []).filter(m => m.surface === surf));
  const sB = playerAgg(b, (D.byPlayer[b] || []).filter(m => m.surface === surf));
  // shrink small samples toward the player's all-surface numbers, then toward tour average
  const blend = (vS, nS, vAll, prior) => { const v0 = isNum(vAll) ? vAll : prior; return isNum(vS) ? (vS * nS + v0 * 6) / (nS + 6) : v0; };
  const spwA = blend(METRICS.spw.val(sA), sA.nAtp, METRICS.spw.val(aA), tourSpw), rpwA = blend(METRICS.rpw.val(sA), sA.nAtp, METRICS.rpw.val(aA), 1 - tourSpw);
  const spwB = blend(METRICS.spw.val(sB), sB.nAtp, METRICS.spw.val(aB), tourSpw), rpwB = blend(METRICS.rpw.val(sB), sB.nAtp, METRICS.rpw.val(aB), 1 - tourSpw);
  const pa = matchupServe(spwA, rpwB, tourSpw), pb = matchupServe(spwB, rpwA, tourSpw);
  const pMarkov = pMatchBo3(pa, pb);
  const eA = eloNow(a, null), eB = eloNow(b, null);
  const surfElo = (pid, e) => { const t = runElo(surf).tl.get(pid); return t && t.length ? t[t.length - 1][1] : e; };
  const seA = surfElo(a, eA), seB = surfElo(b, eB);
  const pElo = isNum(eA) && isNum(eB) ? eloProb((eA + seA) / 2, (eB + seB) / 2) : null;
  const pBlend = isNum(pElo) ? 0.6 * pElo + 0.4 * pMarkov : pMarkov;
  return { aA, aB, sA, sB, tourSpw, spwA, rpwA, spwB, rpwB, pa, pb, pMarkov, eA, eB, seA, seB, pElo, pBlend };
}

/**
 * Serve-point probabilities [qa, qb] that keep the matchup's serve-vs-return character (pa, pb) but give player a the
 * match-win chance `target`: both are shifted in opposite directions until the Markov model agrees.
 */
export function calibrate(pa, pb, target) {
  const clamp = x => Math.min(0.95, Math.max(0.3, x));
  let lo = -0.25, hi = 0.25;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (pMatchBo3(clamp(pa + mid), clamp(pb - mid)) < target) lo = mid; else hi = mid;
  }
  const d = (lo + hi) / 2;
  return [clamp(pa + d), clamp(pb - d)];
}
