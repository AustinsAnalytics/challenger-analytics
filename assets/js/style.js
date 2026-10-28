// Playing-style profiles: each player's serve, return and pressure numbers as z-scores against players with 15+
// matches under the current filters; used for "stands out for", "most similar profiles" and head-to-head likeness.
import { isNum } from './util.js';
import { METRICS, aggregateFiltered } from './data.js';

export const STYLE = [
  ['acePct', 'Big server', 'Few aces'], ['dfPct', 'Double-fault prone', 'Rarely double-faults'], ['firstIn', 'High first-serve percentage', 'Low first-serve percentage'],
  ['firstWon', 'Dominant first serve', 'Attackable first serve'], ['secondWon', 'Strong second serve', 'Vulnerable second serve'],
  ['r1', 'Strong returner of first serves', 'Struggles against first serves'], ['r2', 'Punishes second serves', 'Passive against second serves'],
  ['bpSaved', 'Tough on break points', 'Fragile on break points'], ['bpConv', 'Clinical on break chances', 'Wasteful on break chances'],
];

export function stylePool(minMatches = 15) {
  const pool = [...aggregateFiltered().values()].filter(a => a.m >= minMatches);
  const stats = STYLE.map(([k]) => {
    const xs = pool.map(a => METRICS[k].val(a)).filter(isNum);
    const mu = xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length || 1)) || 1;
    return { mu, sd, xs: xs.slice().sort((a, b) => a - b) };
  });
  const z = a => STYLE.map(([k], i) => { const v = METRICS[k].val(a); return isNum(v) ? (v - stats[i].mu) / stats[i].sd : 0; });
  const pctile = (i, v) => { const xs = stats[i].xs; let lo = 0; while (lo < xs.length && xs[lo] < v) lo++; return lo / (xs.length || 1); };
  return { pool, stats, z, pctile };
}

/** 0..1: how alike two style vectors are (1 = identical). */
export function likeness(za, zb) {
  const d = Math.sqrt(za.reduce((s, x, i) => s + (x - zb[i]) ** 2, 0) / za.length);
  return Math.exp(-d * d / 2);
}
