// Match centre.
import { h, clear, fmtInt, fmtPct, fmt1, fmt2, fmtDate, fmtMin, isNum, ratio, ROUND_NAMES, countryName, countryChip } from '../util.js';
import { D, lazy, eloProb, playerName, isAdv } from '../data.js';
import { card, compareRow, lineChart, columnChart, scatter, stackBars, showTip, hideTip } from '../charts.js';
import { playerLink, eventLink, surfaceDot, segmented, badges, keepTabVisible, tiles } from '../components.js';
import { winProbability, wpSummary } from '../winprob.js';
import { dataTable } from '../table.js';
import { court } from '../court.js';
import { parseHash, setQuery } from '../main.js';

const CA = 'var(--series-1)', CB = 'var(--series-2)';
const RES_NAME = { A: 'Ace', D: 'Double fault', W: 'Winner', U: 'Unforced error', F: 'Forced error', N: 'Unclassified' };

export async function render(root, { id }) {
  const m = D.matches.find(x => x.id === id);
  if (!m) { root.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Match not found'), h('p', { class: 'muted' }, id))); return; }
  const pw = D.players[m.w] || {}, pl = D.players[m.l] || {};
  root.dataset.title = `${pw.short || m.w} vs ${pl.short || m.l}`;
  root.appendChild(h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('a', { href: '#/tournament/' + m.eid, class: 'btn-ghost sm' }, '← ' + (m.e?.name || 'Tournament')),
    h('span', { class: 'muted' }, `${ROUND_NAMES[m.rd] || m.rd} · ${fmtDate(m.date, true)}`)));
  root.appendChild(scoreboard(m));

  let det = null;
  try { det = (await lazy(`data/ev/${m.eid}.json`))[m.mid] || null; } catch { det = null; }
  // a comeback worth flagging on every tab: the winner's chance fell low at some point
  const W = det && det.flow ? winProbability(det.flow, m.pWin, m.sets) : null;
  if (W) {
    const S = wpSummary(W);
    if (S.min < 0.25 || S.mpSaved) {
      const nA = D.players[m.w]?.short;
      root.appendChild(h('a', { class: 'escape-note', href: `#/match/${m.id}?tab=flow` },
        h('b', {}, S.min < 0.1 ? 'Great escape. ' : 'Comeback. '),
        `${nA}'s chance of winning fell to ${S.min >= 0.01 ? fmtPct(S.min) : '1 in ' + fmtInt(Math.round(1 / S.min))}` + (S.mpSaved ? `, with ${S.mpSaved} match point${S.mpSaved > 1 ? 's' : ''} saved` : '') + '. See the win-probability line →'));
    }
  }
  const tabs = [['stats', 'Stats'], ['flow', 'Momentum & flow'], ['pbp', 'Point-by-point']];
  if (m.hasCV) tabs.push(['hawkeye', 'Hawk-Eye 2D / 3D']);
  // matches tracked from the broadcast video (tennis-vision): see pipeline/vision.py
  let vtIndex = null;
  try { vtIndex = await lazy('data/vt/index.json'); } catch { vtIndex = null; }
  if (vtIndex && (vtIndex.matches || []).some(x => x.id === m.id)) tabs.push(['tracking', 'Ball tracking (video)']);
  let tab = parseHash().params.tab || 'stats';
  if (!tabs.some(t => t[0] === tab)) tab = 'stats';
  const tabsEl = h('div', { class: 'tabs mt' });
  const body = h('div');
  root.append(tabsEl, body);
  let cleanup = null;
  const drawTabs = () => {
    clear(tabsEl);
    for (const [k, label] of tabs) tabsEl.appendChild(h('button', { type: 'button', class: k === tab ? 'on' : '', onclick: () => { tab = k; setQuery({ tab: k }); drawTabs(); show(); } }, label));
    keepTabVisible(tabsEl);
  };
  const show = async () => {
    if (cleanup) { cleanup(); cleanup = null; }
    clear(body);
    if (tab === 'stats') statsTab(body, m, det);
    else if (tab === 'flow') flowTab(body, m, det);
    else if (tab === 'pbp') pbpTab(body, m, det);
    else if (tab === 'hawkeye') cleanup = await hawkeyeTab(body, m);
    else if (tab === 'tracking') {
      body.appendChild(h('div', { class: 'empty' }, 'Loading the ball tracking…'));
      try {
        const [mod, VT] = await Promise.all([import('../vt.js'), lazy(`data/vt/${m.id}.json`)]);
        clear(body);
        mod.trackingTab(body, m, VT);
      } catch (e) { clear(body).appendChild(h('div', { class: 'card empty' }, 'The ball tracking for this match could not be loaded.')); console.error(e); }
    }
  };
  drawTabs();
  await show();
  window.addEventListener('hashchange', () => { if (cleanup) { cleanup(); cleanup = null; } }, { once: true });
}

function scoreboard(m) {
  const sb = h('div', { class: 'scoreboard', style: { '--sets': Math.max(2, m.sets.length) } });
  const rows = [[m.w, m.wTag, m.wRank, m.wElo, 0], [m.l, m.lTag, m.lRank, m.lElo, 1]];
  for (const [pid, tag, rank, elo, side] of rows) {
    const p = D.players[pid] || {};
    const prob = isNum(m.wElo) && isNum(m.lElo) ? (side === 0 ? m.pWin : 1 - m.pWin) : null;
    sb.appendChild(h('div', { class: 'sb-row' },
      h('div', { class: 'sb-name' },
        h('span', { class: 'sdot', style: { background: side === 0 ? CA : CB, width: '10px', height: '10px' } }),
        p.c ? countryChip(p.c) : null,
        h('a', { href: '#/player/' + pid, class: 'pl' }, p.name || pid),
        tag ? h('span', { class: 'sub' }, `(${tag})`) : null,
        h('span', { class: 'sub' }, rank ? `#${rank}` : 'NR'),
        side === 0 ? h('span', { class: 'win-mark', title: 'Winner' }, '✓') : null),
      ...m.sets.map(([a, b, tb]) => {
        const mine = side === 0 ? a : b, theirs = side === 0 ? b : a;
        const won = mine > theirs;
        return h('div', { class: 'sb-set' + (won ? ' won' : '') }, String(mine), tb != null && !won ? h('sup', {}, tb) : null);
      }),
      h('div', { class: 'sb-prob', title: 'Elo rating before the match, and the chance of winning it gave' }, isNum(elo) ? `Elo ${fmtInt(elo)}` : '', h('br'), prob != null ? `${fmtPct(prob)} to win` : '')));
  }
  sb.appendChild(h('div', { class: 'sb-meta' },
    h('span', {}, surfaceDot(m.surface), eventLink(m.e, { city: false }), m.e ? ` · ${m.e.city} · Challenger ${m.e.cat || ''}` : ''),
    h('span', {}, ROUND_NAMES[m.rd] || m.rd),
    isNum(m.mins) ? h('span', {}, 'Duration ', h('b', {}, fmtMin(m.mins))) : null,
    h('span', { id: 'sb-court' }), badges(m)));
  lazy(`data/ev/${m.eid}.json`).then(d => {
    const x = d[m.mid]; const el = sb.querySelector('#sb-court');
    if (x && el) el.textContent = [x.court, x.ump ? 'Umpire: ' + x.ump : null,
      x.susp ? `Suspended and resumed later (${fmtMin(x.susp)} from first ball to last)` : null].filter(Boolean).join(' · ');
  }).catch(() => {});
  return sb;
}

// ---------- stats ----------
// ---------- written recap ----------
function matchRecap(m, det) {
  const K = D.K, A = D.players[m.w] || {}, B = D.players[m.l] || {};
  const nA = A.name || m.w, nB = B.name || m.l, sA = A.short || nA, sB = B.short || nB;
  const score = m.sets.map(x => `${x[0]}-${x[1]}${isNum(x[2]) ? `(${x[2]})` : ''}`).join(' ');
  const out = [];
  const where = `${ROUND_NAMES[m.rd] || m.rd}, ${m.e?.city || ''}`;
  if (m.flag === 'RET') out.push(`${nA} advanced when ${nB} retired at ${score} (${where}).`);
  else if (m.flag) out.push(`${nA} advanced against ${nB} (${where}).`);
  else out.push(`${nA} beat ${nB} ${score}${isNum(m.mins) ? ` in ${fmtMin(m.mins)}` : ''} (${where}).`);
  if (isNum(m.pWin) && !m.flag) {
    if (m.pWin < 0.3) out.push(`A big upset: Elo gave ${sA} a ${fmtPct(m.pWin)} chance before the match.`);
    else if (m.pWin < 0.45) out.push(`An upset: ${sA} started as the underdog (${fmtPct(m.pWin)} by Elo).`);
    else if (m.pWin > 0.75) out.push(`The favourite came through (${fmtPct(m.pWin)} by Elo).`);
  }
  const W = det && det.flow && !m.flag ? winProbability(det.flow, m.pWin, m.sets) : null;
  if (W) {
    const S = wpSummary(W), lo = W.pts[S.minI];
    if (S.min < 0.25) {
      const [, games, pts] = lo.score.split(' ');
      out.push(`${sA}'s chance of winning fell to ${S.min >= 0.01 ? fmtPct(S.min) : '1 in ' + fmtInt(Math.round(1 / S.min))} at ${games}, ${pts} in set ${lo.set}${S.mpSaved ? `, with ${S.mpSaved} match point${S.mpSaved > 1 ? 's' : ''} saved` : ''}.`);
    } else if (m.sets.length === 3 && m.sets[0][0] < m.sets[0][1]) out.push(`${sA} came back from a set down.`);
  } else if (!m.flag && m.sets.length === 3 && m.sets[0][0] < m.sets[0][1]) out.push(`${sA} came back from a set down.`);
  if (m.ws && m.ls) {
    const g = (v, k) => (v && isNum(v[K[k]]) ? v[K[k]] : null);
    const f1 = v => (g(v, 'fsIn') ? g(v, 'fsW') / g(v, 'fsIn') : null);
    if (isNum(f1(m.ws)) && isNum(f1(m.ls))) out.push(`First-serve points won: ${sA} ${fmtPct(f1(m.ws))}, ${sB} ${fmtPct(f1(m.ls))}.`);
    const bp = v => [g(v, 'bpC'), g(v, 'bpO')];
    const [ca, oa] = bp(m.ws), [cb, ob] = bp(m.ls);
    if (isNum(oa) && isNum(ob) && (oa || ob)) out.push(`Break points: ${sA} converted ${ca} of ${oa}, ${sB} ${cb} of ${ob}.`);
    const aa = g(m.ws, 'ace'), ab = g(m.ls, 'ace');
    if (isNum(aa) && isNum(ab) && Math.max(aa, ab) >= 12) out.push(`${aa >= ab ? sA : sB} served ${Math.max(aa, ab)} aces.`);
    const ta = g(m.ws, 'tpW'), tb = g(m.ls, 'tpW');
    if (isNum(ta) && isNum(tb) && ta < tb) out.push(`${sA} won the match despite winning fewer points (${ta} to ${tb}).`);
    else if (isNum(ta) && isNum(tb) && ta + tb > 0 && !m.flag && Math.abs(ta - tb) <= 3 && m.sets.length === 3) out.push(`It could hardly have been closer on points: ${ta} to ${tb}.`);
  }
  return h('div', { class: 'card recap' }, h('div', { class: 'eyebrow' }, 'Match report'), h('p', {}, out.join(' ')));
}

function statsTab(body, m, det) {
  const K = D.K;
  body.appendChild(matchRecap(m, det));
  if (!m.ws) { body.appendChild(h('div', { class: 'card mt' }, h('p', { class: 'muted' }, 'No detailed statistics were published for this match.'))); return; }
  const sets = (det && det.sets) || [];
  let sel = 'match';
  const opts = [['match', 'Match'], ...sets.map(s => [String(s[0]), 'Set ' + s[0]])];
  const statsCard = card('Match statistics', 'Official ATP / Infosys stats', null, { actions: segmented(opts, sel, v => { sel = v; drawStats(); }) });
  const sideCol = h('div', { class: 'stack' });
  const g = h('div', { class: 'grid g-21 mt' });
  g.append(statsCard, sideCol);
  body.appendChild(g);
  function vecs() {
    if (sel === 'match') return [m.ws, m.ls];
    const s = sets.find(x => String(x[0]) === sel);
    const pad = v => v ? v.concat(new Array(D.keys.length - v.length).fill(null)) : null;
    return s ? [pad(s[1]), pad(s[2])] : [m.ws, m.ls];
  }
  function drawStats() {
    const cb = clear(statsCard.querySelector('.card-body'));
    const [a, b] = vecs();
    const g = (v, k) => v ? v[K[k]] : null;
    const pct = (n, d) => ratio(n, d);
    const raw = (n, d) => (isNum(n) && isNum(d)) ? `${n}/${d}` : '–';
    cb.appendChild(h('div', { class: 'cmp-head' }, h('b', {}, playerLink(m.w, { short: true })), h('span', {}), h('b', { class: 'b' }, playerLink(m.l, { short: true }))));
    const row = (label, fa, fb, fmt, better = 1, rawPair) => cb.appendChild(compareRow(label, fa, fb, fmt, { better, raw: rawPair }));
    const sec = t => cb.appendChild(h('div', { class: 'mgroup', style: { marginTop: '14px' } }, t));
    sec('Serve');
    row('Aces', g(a, 'ace'), g(b, 'ace'), fmtInt);
    row('Double faults', g(a, 'df'), g(b, 'df'), fmtInt, -1);
    row('1st serve in', pct(g(a, 'fsIn'), g(a, 'sv')), pct(g(b, 'fsIn'), g(b, 'sv')), fmtPct, 1, [`${fmtPct(pct(g(a, 'fsIn'), g(a, 'sv')))} (${raw(g(a, 'fsIn'), g(a, 'sv'))})`, `${fmtPct(pct(g(b, 'fsIn'), g(b, 'sv')))} (${raw(g(b, 'fsIn'), g(b, 'sv'))})`]);
    row('1st serve points won', pct(g(a, 'fsW'), g(a, 'fsIn')), pct(g(b, 'fsW'), g(b, 'fsIn')), fmtPct);
    row('2nd serve points won', pct(g(a, 'ssW'), g(a, 'sv') - g(a, 'fsIn')), pct(g(b, 'ssW'), g(b, 'sv') - g(b, 'fsIn')), fmtPct);
    row('Break points saved', pct(g(a, 'bpS'), g(a, 'bpF')), pct(g(b, 'bpS'), g(b, 'bpF')), fmtPct, 1, [`${raw(g(a, 'bpS'), g(a, 'bpF'))}`, `${raw(g(b, 'bpS'), g(b, 'bpF'))}`]);
    row('Service points won', pct(g(a, 'fsW') + g(a, 'ssW'), g(a, 'sv')), pct(g(b, 'fsW') + g(b, 'ssW'), g(b, 'sv')), fmtPct);
    row('Serve rating', g(a, 'srat'), g(b, 'srat'), fmtInt);
    sec('Return');
    row('1st serve return points won', pct(g(a, 'r1W'), g(a, 'r1P')), pct(g(b, 'r1W'), g(b, 'r1P')), fmtPct);
    row('2nd serve return points won', pct(g(a, 'r2W'), g(a, 'r2P')), pct(g(b, 'r2W'), g(b, 'r2P')), fmtPct);
    row('Break points converted', pct(g(a, 'bpC'), g(a, 'bpO')), pct(g(b, 'bpC'), g(b, 'bpO')), fmtPct, 1, [`${raw(g(a, 'bpC'), g(a, 'bpO'))}`, `${raw(g(b, 'bpC'), g(b, 'bpO'))}`]);
    row('Return rating', g(a, 'rrat'), g(b, 'rrat'), fmtInt);
    sec('Points');
    row('Total points won', g(a, 'tpW'), g(b, 'tpW'), fmtInt);
    // Hawk-Eye extras
    const ks = det && det.ks && det.ks[sel === 'match' ? 'set0' : 'set' + sel];
    const ksv = (k, i) => ks && ks[k] ? ks[k][i] : null;
    if (ks || (sel === 'match' && isNum(g(a, 'win')))) {
      sec('Hawk-Eye');
      const wa = ks ? ksv('win', 0) : g(a, 'win'), wb = ks ? ksv('win', 1) : g(b, 'win');
      row('Winners (incl. aces)', wa, wb, fmtInt);
      row('Unforced errors', ks ? ksv('ue', 0) : g(a, 'ue'), ks ? ksv('ue', 1) : g(b, 'ue'), fmtInt, -1);
      const na = ks ? ksv('net', 0) : [g(a, 'netW'), g(a, 'netP')], nb = ks ? ksv('net', 1) : [g(b, 'netW'), g(b, 'netP')];
      if (Array.isArray(na) && Array.isArray(nb)) row('Net points won', pct(na[0], na[1]), pct(nb[0], nb[1]), fmtPct, 1, [`${raw(na[0], na[1])}`, `${raw(nb[0], nb[1])}`]);
      row('Fastest serve (km/h)', ks ? ksv('vmax', 0) : g(a, 'vmax'), ks ? ksv('vmax', 1) : g(b, 'vmax'), fmtInt);
      row('Avg 1st serve (km/h)', ks ? ksv('v1', 0) : g(a, 'v1'), ks ? ksv('v1', 1) : g(b, 'v1'), fmtInt);
      row('Avg 2nd serve (km/h)', ks ? ksv('v2', 0) : g(a, 'v2'), ks ? ksv('v2', 1) : g(b, 'v2'), fmtInt);
    }
    if (sel !== 'match') {
      const s = sets.find(x => String(x[0]) === sel);
      if (s && s[3]) cb.appendChild(h('p', { class: 'muted mt' }, `Set duration ${fmtMin(s[3])}`));
    }
  }
  drawStats();

  // point endings
  const a = m.ws, b = m.ls;
  const clsShare = m.hasMB && isNum(a[K.mCls]) ? ratio(a[K.mCls], a[K.tp]) : null;
  if (isNum(clsShare) && clsShare > 0 && clsShare < 0.5) {
    sideCol.appendChild(card('How points ended', null, h('div', { class: 'empty' }, `ATP's point record classifies how only ${fmtPct(clsShare)} of this match's points ended (winner, forced or unforced error), too few to chart.`)));
  } else if (m.hasMB && isNum(a[K.mCls]) && a[K.mCls] > 0) {
    const rows = [[m.w, a], [m.l, b]].map(([pid, v]) => ({ label: D.players[pid]?.short || pid, parts: { W: (v[K.mW] || 0) + (v[K.ace] || 0), F: v[K.mFE] || 0, U: v[K.mUE] || 0 } }));
    sideCol.appendChild(card('How points ended', `Winners incl. aces · errors committed · ${fmtPct(ratio(a[K.mCls], a[K.tp]))} of points classified`, el => stackBars(el, {
      rows, keys: [{ key: 'W', label: 'Winners', color: 'var(--series-1)' }, { key: 'F', label: 'Forced errors', color: 'var(--series-3)', dark: true }, { key: 'U', label: 'Unforced errors', color: 'var(--series-2)' }], labelWidth: 110, fmt: (v, t) => `${v} (${Math.round(100 * v / t)}%)`,
    })));
  }
  // pressure
  sideCol.appendChild(card('Pressure & patterns', null, h('dl', { class: 'kv' },
    kvRow('Break points', `${fmtInt(a[K.bpC])}/${fmtInt(a[K.bpO])} vs ${fmtInt(b[K.bpC])}/${fmtInt(b[K.bpO])}`),
    isNum(a[K.bigSP]) && isAdv() ? kvRow('30-30 / deuce pts won on serve', `${fmtPct(ratio(a[K.bigSW], a[K.bigSP]))} vs ${fmtPct(ratio(b[K.bigSW], b[K.bigSP]))}`) : null,
    isNum(a[K.tbP]) && a[K.tbP] ? kvRow('Tiebreak points won', `${a[K.tbW]} vs ${b[K.tbW]}`) : null,
    isNum(a[K.fpP]) && isAdv() ? kvRow('15-0 on serve', `${fmtPct(ratio(a[K.fpW], a[K.fpP]))} vs ${fmtPct(ratio(b[K.fpW], b[K.fpP]))}`) : null,
    isNum(a[K.lhold]) ? kvRow('Love holds', `${a[K.lhold]} vs ${b[K.lhold]}`) : null,
    isNum(a[K.rlN]) && a[K.rlN] ? kvRow('Average rally', `${fmt1(ratio(a[K.rlSum], a[K.rlN]))} shots`) : null)));
  // stroke summary
  if (det && det.ss && (det.ss.w || det.ss.l)) {
    const rows = [];
    for (const hand of ['fh', 'bh']) {
      const wa = (det.ss.w || {})[hand] || [], lb = (det.ss.l || {})[hand] || [];
      wa.forEach((r, i) => {
        const o = lb[i] || [r[0], 0, 0, 0];
        if (r[1] + r[2] + r[3] + o[1] + o[2] + o[3] === 0) return;
        rows.push([`${hand === 'fh' ? 'Forehand' : 'Backhand'} ${r[0].toLowerCase()}`, r[1], r[3], r[2], o[1], o[3], o[2]]);
      });
    }
    if (rows.length) body.appendChild(h('div', { class: 'mt' }, card('Stroke summary', `Points ended by each stroke · W = winners, UE = unforced errors, FE = forced errors`, h('div', {}, dataTable({
      rows, sortKey: 0, sortDir: 1, sticky: false, compact: true, pageSize: 20,
      cols: [
        { key: 0, label: 'Stroke', get: r => r[0], sortDir: 1 },
        { key: 1, label: `${D.players[m.w]?.short} W`, align: 'r' }, { key: 2, label: 'UE', align: 'r' }, { key: 3, label: 'FE', align: 'r' },
        { key: 4, label: `${D.players[m.l]?.short} W`, align: 'r' }, { key: 5, label: 'UE', align: 'r' }, { key: 6, label: 'FE', align: 'r' },
      ],
    })))));
  }
}
function kvRow(k, v) { return [h('dt', {}, k), h('dd', {}, v)]; }

// ---------- flow ----------
function parsePoints(det) {
  // returns [{set, game, server, scorer, sn, res, bp, crucial, stroke, hand, rally, speed, tb, n}]
  const out = [];
  if (!det || !det.flow) return out;
  let n = 0;
  for (const g of det.flow) {
    const [set, game, server, winner, dur, tb, momA, momB, str] = g;
    if (!str) continue;
    for (const code of str.split(',')) {
      if (!code) continue;
      const [head, speed] = code.split(':');
      const rally = head.slice(7);
      out.push({ set, game, server, gw: winner, scorer: +head[0], sn: +head[1], res: head[2], bp: head[3] === '1', crucial: head[4] === '1', stroke: head[5] === '-' ? null : head[5], hand: head[6] === '-' ? null : head[6], rally: rally ? +rally : null, speed: speed ? +speed : null, tb: !!tb, n: n++ });
    }
  }
  return out;
}
function flowTab(body, m, det) {
  const pts = parsePoints(det);
  if (!pts.length) { body.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Point-by-point data is not available for this match.'))); return; }
  // cumulative point differential (winner minus loser)
  let diff = 0;
  const vals = pts.map(p => { diff += p.scorer === 0 ? 1 : -1; return { x: p.n + 1, y: diff, p }; });
  const bands = [];
  let start = 1;
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || pts[i].set !== pts[i - 1].set) { if (pts[i - 1].set % 2 === 0) bands.push({ x0: start, x1: i }); start = i + 1; }
  }
  const nameA = D.players[m.w]?.short, nameB = D.players[m.l]?.short;
  winProbabilitySection(body, m, det, bands, nameA, nameB);
  body.appendChild(h('div', { class: 'mt' }, card('Momentum', `Running point differential: above zero = ${nameA} has won more points. Shaded = even-numbered sets.`, el => lineChart(el, {
    series: [{ name: `${nameA} − ${nameB}`, color: CA, values: vals, area: false }], height: 260, xType: 'num', xFmt: v => fmtInt(v), yFmt: v => (v > 0 ? '+' : '') + fmtInt(v),
    refY: [{ y: 0, label: 'Level' }], bands,
    tipTitle: pt => `Point ${pt.x} · set ${pt.p.set}, game ${pt.p.game}`,
    tipNote: pt => `${D.players[[m.w, m.l][pt.p.scorer]]?.short} won · ${RES_NAME[pt.p.res] || ''}${pt.p.bp ? ' · break point' : ''}`,
  }))));
  // game strip
  const gamesCard = card('Game flow', 'Each box is a game, coloured by who won it. Ball = server, red dot = break of serve, number = minutes.', null);
  body.appendChild(h('div', { class: 'mt' }, gamesCard));
  const gb = gamesCard.querySelector('.card-body');
  gb.appendChild(h('div', { class: 'legend' }, h('span', { class: 'lg-item' }, h('span', { class: 'lg-rect', style: { background: CA } }), nameA), h('span', { class: 'lg-item' }, h('span', { class: 'lg-rect', style: { background: CB } }), nameB)));
  const bySet = {};
  for (const g of det.flow) (bySet[g[0]] = bySet[g[0]] || []).push(g);
  for (const [set, games] of Object.entries(bySet)) {
    const row = h('div', { class: 'row', style: { gap: '4px', marginBottom: '8px', alignItems: 'stretch' } }, h('span', { class: 'muted', style: { width: '44px', fontSize: '12px', alignSelf: 'center' } }, 'Set ' + set));
    let a = 0, b = 0;
    for (const g of games) {
      const [, game, server, winner, dur, tb] = g;
      if (winner === 0) a++; else if (winner === 1) b++;
      const brk = !tb && winner != null && winner !== server;
      const box = h('div', { style: { width: '42px', borderRadius: '6px', padding: '4px 0', textAlign: 'center', fontSize: '11px', fontWeight: 650, background: `color-mix(in srgb, ${winner === 0 ? CA : CB} ${brk ? 75 : 30}%, transparent)`, position: 'relative', cursor: 'default' } },
        h('div', {}, server === 0 ? h('span', { class: 'srv-ball' }) : null, `${a}-${b}`, server === 1 ? h('span', { class: 'srv-ball', style: { marginLeft: '4px', marginRight: 0 } }) : null),
        h('div', { class: brk ? '' : 'muted', style: { fontWeight: 500, fontSize: '10px', opacity: brk ? 0.85 : 1 } }, tb ? 'TB' : isNum(dur) ? Math.round(dur / 60) + 'm' : ''),
        brk ? h('span', { style: { position: 'absolute', top: '3px', right: '3px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--series-8)' } }) : null);
      box.addEventListener('pointermove', ev => showTip(ev, `Set ${set}, game ${game}${tb ? ' (tiebreak)' : ''}`, [
        { value: D.players[[m.w, m.l][winner]]?.short || '–', label: 'won the game', color: winner === 0 ? CA : CB, line: false },
        { value: D.players[[m.w, m.l][server]]?.short || '–', label: 'served' },
        { value: isNum(dur) ? Math.round(dur / 60) + ' min' : '–', label: 'duration' }], brk ? 'Break of serve' : null));
      box.addEventListener('pointerleave', hideTip);
      row.appendChild(box);
    }
    gb.appendChild(row);
  }
  // serve speed + rally
  const g2 = h('div', { class: 'grid g2 mt' });
  const sp = pts.filter(p => p.speed);
  if (sp.length > 10) {
    g2.appendChild(card('Serve speed through the match', 'Every serve that started a point (km/h), Hawk-Eye radar', el => scatter(el, {
      points: sp.map(p => ({ x: p.n + 1, y: p.speed, color: p.server === 0 ? CA : CB, label: `${D.players[[m.w, m.l][p.server]]?.short} · ${p.sn === 1 ? '1st' : '2nd'} serve`, sub: `Set ${p.set}, game ${p.game} · ${p.scorer === p.server ? 'won' : 'lost'} the point` })),
      xLabel: 'Point number', yLabel: 'km/h', xFmt: fmtInt, yFmt: fmtInt, height: 280,
      legend: [{ label: nameA, color: CA }, { label: nameB, color: CB }],
    })));
  }
  const rl = pts.filter(p => p.rally);
  if (rl.length > 10) {
    const bins = {};
    for (const p of rl) { const k = Math.min(p.rally, 15); const b = bins[k] || (bins[k] = { a: 0, b: 0 }); p.scorer === 0 ? b.a++ : b.b++; }
    const data = Object.keys(bins).map(Number).sort((x, y) => x - y).map(k => ({ label: k === 15 ? '15+' : String(k), tipTitle: `${k === 15 ? '15+' : k}-shot rallies`, parts: bins[k] }));
    g2.appendChild(card('Rally length', 'Points by number of shots, split by who won the point', el => columnChart(el, { data, stacked: [{ key: 'a', label: nameA, color: CA }, { key: 'b', label: nameB, color: CB }], fmt: fmtInt, height: 260 }),
      { table: () => ({ cols: ['Shots', nameA, nameB], rows: data.map(d => [d.label, d.parts.a, d.parts.b]) }) }));
  }
  // point ending by player and serve
  const servePts = [0, 1].map(s => { const mine = pts.filter(p => p.server === s); return { first: mine.filter(p => p.sn === 1), second: mine.filter(p => p.sn === 2) }; });
  g2.appendChild(card('Serve breakdown from point data', null, h('div', {}, dataTable({
    rows: [0, 1].map(s => ({ s, ...servePts[s] })), sortKey: 's', sortDir: 1, sticky: false, compact: true, pageSize: 2, cols: [
      { key: 's', label: 'Server', render: r => playerLink([m.w, m.l][r.s], { short: true }) },
      { key: 'p1', label: '1st serve pts', align: 'r', get: r => r.first.length },
      { key: 'w1', label: 'Won', align: 'r', get: r => ratio(r.first.filter(p => p.scorer === r.s).length, r.first.length), fmt: fmtPct },
      { key: 'p2', label: '2nd serve pts', align: 'r', get: r => r.second.length },
      { key: 'w2', label: 'Won', align: 'r', get: r => ratio(r.second.filter(p => p.scorer === r.s).length, r.second.length), fmt: fmtPct },
      { key: 'bp', label: 'BPs faced', align: 'r', get: r => pts.filter(p => p.server === r.s && p.bp).length },
    ],
  }))));
  if (g2.children.length === 1) g2.className = 'mt';     // the serve table alone takes the full width
  body.appendChild(g2);
}

// ---------- win probability ----------
function scoreText(p, nameA, nameB) {
  const [, games, pts] = p.score.split(' ');
  return `Set ${p.set}: ${games}, ${p.tb ? 'tiebreak ' : ''}${pts} · ${p.server === 0 ? nameA : nameB} serving`;
}
function howText(p, nameA, nameB) {
  const won = p.scorer === 0 ? nameA : nameB, lost = p.scorer === 0 ? nameB : nameA, srv = p.server === 0 ? nameA : nameB;
  return { A: `Ace (${srv})`, D: `Double fault (${srv})`, W: `Winner (${won})`, U: `Unforced error (${lost})`, F: `Forced error (${lost})` }[p.res] || '–';
}
function winProbabilitySection(body, m, det, bands, nameA, nameB) {
  const W = winProbability(det.flow, m.pWin, m.sets);
  if (!W) {
    if (isNum(m.pWin)) body.appendChild(h('div', { class: 'notice', style: { marginBottom: '14px' } }, 'Win probability is not shown for this match: its point-by-point record does not add up to the final score (a game is missing or duplicated in the feed).'));
    return;
  }
  const S = wpSummary(W), P = W.pts;
  const lowP = P[S.minI], bigP = P[S.bigI];
  const after = i => (i + 1 < P.length ? P[i + 1].wp : 1);
  body.appendChild(tiles([
    { label: `${nameA}'s lowest chance`, value: fmtPct(S.min), delta: `${scoreText(lowP, nameA, nameB)}`, title: 'The eventual winner\'s chance of winning the match at the worst moment' },
    { label: `Match points ${nameA} saved`, value: fmtInt(S.mpSaved), delta: S.mpSaved ? `${nameB} could have closed it ${S.mpSaved === 1 ? 'once' : S.mpSaved + ' times'}` : `${nameB} never reached match point` },
    { label: 'Lead changes', value: fmtInt(S.leadChanges), delta: 'times the favourite (by win chance) changed' },
    { label: 'Biggest single-point swing', value: `${fmtInt(S.big * 100)} pts`, delta: scoreText(bigP, nameA, nameB) },
  ]));
  const vals = P.map((p, i) => ({ x: i + 1, y: p.wp * 100, p, i })).concat([{ x: P.length + 1, y: 100, p: null }]);
  body.appendChild(h('div', { class: 'mt' }, card('Win probability', `${nameA}'s chance of winning the match before every point. It starts at the pre-match Elo forecast (${fmtPct(m.pWin)}) and follows from the score. Scores show ${nameA} first; shaded = even-numbered sets.`, el => lineChart(el, {
    series: [{ name: `${nameA} win chance`, color: CA, values: vals, area: true }], height: 280, xType: 'num', xFmt: v => fmtInt(v), yFmt: v => fmtInt(v) + '%',
    yMin: 0, yMax: 100, yFixed: true, refY: [{ y: 50, label: '50%' }], bands,
    tipTitle: pt => (pt.p ? `Point ${pt.x} · ${scoreText(pt.p, nameA, nameB)}` : 'Match over'),
    tipNote: pt => (pt.p ? `${D.players[[m.w, m.l][pt.p.scorer]]?.short} won the point · ${howText(pt.p, nameA, nameB)}` +
      (pt.p.mpB ? ` · match point ${nameB}${pt.p.scorer === 0 ? ' (saved)' : ''}` : pt.p.mpA ? ` · match point ${nameA}` : pt.p.bp ? ' · break point' : '') +
      ` · chance after: ${fmtPct(after(pt.i))}` : ''),
  }), { table: () => ({ cols: ['Point', 'Score before', `${nameA} chance before`, 'Point won by', 'Ending'], rows: P.map((p, i) => [i + 1, p.score, fmtPct(p.wp), [nameA, nameB][p.scorer], RES_NAME[p.res] || '']) }) })));
  // the points that moved the match the most
  const key = P.map((p, i) => ({ p, i, d: after(i) - p.wp })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8).sort((a, b) => a.i - b.i);
  body.appendChild(h('div', { class: 'mt' }, card('Key moments', `The ${key.length} points that changed ${nameA}'s chance the most (scores show ${nameA} first)`, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
    h('thead', {}, h('tr', {}, ['Point', 'Situation', 'Won by', 'How', `${nameA}'s chance`].map((t, k) => h('th', { class: k === 0 || k === 4 ? 'r' : '' }, t)))),
    h('tbody', {}, key.map(({ p, i, d }) => h('tr', {},
      h('td', { class: 'r num' }, fmtInt(i + 1)),
      h('td', {}, scoreText(p, nameA, nameB), p.mpB ? h('span', { class: 'badge mp' }, `MP ${nameB}`) : p.mpA ? h('span', { class: 'badge mp' }, `MP ${nameA}`) : p.bp ? h('span', { class: 'badge' }, 'BP') : null),
      h('td', {}, h('span', { class: 'sdot', style: { background: p.scorer === 0 ? CA : CB } }), p.scorer === 0 ? nameA : nameB),
      h('td', { class: 'muted' }, howText(p, nameA, nameB)),
      h('td', { class: 'r num' }, `${fmtPct(p.wp)} → ${fmtPct(after(i))} `, h('span', { class: d >= 0 ? 'pos' : 'neg' }, `(${d >= 0 ? '+' : '−'}${fmtInt(Math.abs(d) * 100)})`)))))))),
  ));
}

// ---------- point by point ----------
const LBL = ['0', '15', '30', '40'];
function pbpTab(body, m, det) {
  const pts = parsePoints(det);
  if (!pts.length) { body.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Point-by-point data is not available for this match.'))); return; }
  const nameA = D.players[m.w]?.short, nameB = D.players[m.l]?.short;
  const W = !m.flag ? winProbability(det.flow, m.pWin, m.sets) : null;
  const c = card('Point-by-point', 'Each chip is a point, coloured by who won it (blue = ' + nameA + ', orange = ' + nameB + '). Letters: A ace, D double fault, W winner, U unforced error, F forced error. Outlined = break point.' + (W ? ' Underlined = big point: the match swung 10+ points of win probability on it.' : ''), null);
  body.appendChild(c);
  const list = h('div', { class: 'pbp' });
  c.querySelector('.card-body').appendChild(list);
  let a = 0, b = 0, curSet = null;
  const games = new Map();
  for (const p of pts) { const k = p.set + '-' + p.game; if (!games.has(k)) games.set(k, []); games.get(k).push(p); }
  for (const [k, gp] of games) {
    const first = gp[0];
    if (first.set !== curSet) { curSet = first.set; a = 0; b = 0; list.appendChild(h('div', { class: 'mgroup', style: { margin: '10px 0 4px' } }, 'Set ' + curSet)); }
    const server = first.server, gw = first.gw;
    if (gw === 0) a++; else if (gw === 1) b++;
    let sA = 0, sB = 0;
    const chips = gp.map(p => {
      p.scorer === 0 ? sA++ : sB++;
      let score;
      if (p.tb) score = `${sA}-${sB}`;
      else {
        const sv = server === 0 ? sA : sB, rt = server === 0 ? sB : sA;
        const lab = (x, y) => x >= 3 && y >= 3 ? (x === y ? '40' : x > y ? 'AD' : '40') : LBL[Math.min(3, x)];
        score = `${lab(sv, rt)}-${lab(rt, sv)}`;
      }
      const wpp = W ? W.pts[p.n] : null;
      const chip = h('span', { class: 'pt ' + (p.scorer === 0 ? 'a' : 'b') + (p.bp ? ' bp' : '') + (wpp && wpp.lev >= 0.1 ? ' big' : '') }, p.res !== 'N' ? p.res : '·');
      chip.addEventListener('pointermove', ev => showTip(ev, `Point ${p.n + 1} · ${score} (server first)`, [
        { value: D.players[[m.w, m.l][p.scorer]]?.short, label: 'won the point', color: p.scorer === 0 ? CA : CB, line: false },
        { value: RES_NAME[p.res] || '–', label: 'ending' },
        { value: p.sn === 2 ? '2nd serve' : '1st serve', label: p.speed ? `${p.speed} km/h` : '' },
        p.rally ? { value: String(p.rally), label: 'shots' } : null,
        wpp ? { value: fmtPct(wpp.wp), label: `${nameA} win chance before` } : null,
        wpp ? { value: `${fmtInt(wpp.lev * 100)} pts`, label: 'riding on the point' } : null,
      ].filter(Boolean), [p.bp ? 'Break point' : null, wpp && wpp.mpB ? `Match point ${nameB}` : wpp && wpp.mpA ? `Match point ${nameA}` : null].filter(Boolean).join(' · ') || null));
      chip.addEventListener('pointerleave', hideTip);
      return chip;
    });
    const brk = !first.tb && gw != null && gw !== server;
    list.appendChild(h('div', { class: 'pbp-game' },
      h('span', { class: 'gs' }, `${a}-${b}`),
      h('span', { class: 'muted', style: { fontSize: '11.5px' } }, h('span', { class: 'srv-ball' }), server === 0 ? nameA : nameB),
      h('div', { class: 'pbp-pts' }, chips),
      h('span', { class: brk ? 'brk' : 'muted', style: { fontSize: '11px', textAlign: 'right' } }, first.tb ? 'TB' : brk ? 'BREAK' : 'hold')));
  }
}

// ---------- Hawk-Eye ----------
function hex(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
async function hawkeyeTab(body, m) {
  body.appendChild(h('div', { class: 'empty' }, 'Loading Hawk-Eye tracking…'));
  let file;
  try { file = await lazy(`data/cv/${m.eid}.json`); } catch { clear(body).appendChild(h('div', { class: 'empty' }, 'No tracking file.')); return null; }
  const C = Object.fromEntries(file.cols.map((k, i) => [k, i]));
  const rows = (file.matches[m.mid] || []).map(r => Object.fromEntries(file.cols.map((k, i) => [k, r[i]])));
  clear(body);
  if (!rows.length) { body.appendChild(h('div', { class: 'empty' }, 'No tracked points for this match.')); return null; }
  const st = { view: '2d', who: 'all', kind: 'end', sn: 'all' };
  const nameA = D.players[m.w]?.short, nameB = D.players[m.l]?.short;
  const COL = { A: '--series-1', W: '--series-1', U: '--series-2', E: '--series-3', F: '--muted', D: '--muted', N: '--axis' };
  const LBL = { A: 'Ace', W: 'Winner', U: 'Unforced error', E: 'Forced error', F: 'Serve fault', D: 'Double fault', N: 'Other' };
  const controls = h('div', { class: 'row', style: { marginBottom: '12px' } },
    segmented([['2d', '2D court'], ['3d', '3D flight paths']], st.view, v => { st.view = v; draw(); }),
    segmented([['all', 'Both players'], ['0', nameA], ['1', nameB]], st.who, v => { st.who = v; draw(); }),
    segmented([['end', 'Point-ending shots'], ['serve', 'Serves'], ['ace', 'Aces & faults']], st.kind, v => { st.kind = v; draw(); }),
    segmented([['all', 'All serves'], ['1', '1st'], ['2', '2nd']], st.sn, v => { st.sn = v; draw(); }));
  const host = h('div');
  const info = h('div', { class: 'pick-info' }, 'Tip: in 3D, drag to orbit, click inside then scroll to zoom, click a flight path to inspect it.');
  body.append(controls, host, info);
  let viewer = null;
  function select() {
    return rows.filter(r => {
      if (st.sn !== 'all' && String(r.serve) !== st.sn) return false;
      if (st.kind === 'end') { if (!['W', 'U', 'E'].includes(r.end)) return false; const hitter = r.end === 'W' ? r.scorer : 1 - r.scorer; return st.who === 'all' || String(hitter) === st.who; }
      if (st.kind === 'ace') { if (!['A', 'F', 'D'].includes(r.end)) return false; return st.who === 'all' || String(r.server) === st.who; }
      return r.serveBounce && (st.who === 'all' || String(r.server) === st.who) && r.end !== 'F' && r.end !== 'D';
    });
  }
  function describe(r) {
    const hitter = ['W', 'U', 'E'].includes(r.end) ? (r.end === 'W' ? r.scorer : 1 - r.scorer) : r.server;
    return `${D.players[[m.w, m.l][hitter]]?.short} · ${LBL[r.end] || ''} · set ${r.set}, game ${r.game}, ${r.serve === 2 ? '2nd' : '1st'} serve` +
      (r.speed ? ` · ${fmtInt(r.speed)} km/h` : '') + (isNum(r.netClear) ? ` · ${fmt2(r.netClear)} m over the net` : '') + (r.rally ? ` · ${r.rally}-shot rally` : '') + (r.spin ? ` · ${fmtInt(r.spin)} rpm` : '');
  }
  function draw() {
    if (viewer) { viewer.dispose(); viewer = null; }
    clear(host);
    const sel = select();
    const kinds = [...new Set(sel.map(r => st.kind === 'serve' ? (r.scorer === r.server ? 'won' : 'lost') : r.end))];
    const sCol = { won: 'var(--series-1)', lost: 'var(--series-2)' };
    host.appendChild(h('div', { class: 'legend' }, kinds.map(k => h('span', { class: 'lg-item' }, h('span', { class: 'lg-dot', style: { background: st.kind === 'serve' ? sCol[k] : `var(${COL[k]})` } }),
      `${st.kind === 'serve' ? (k === 'won' ? 'Server won point' : 'Server lost point') : LBL[k]} (${sel.filter(r => (st.kind === 'serve' ? (r.scorer === r.server ? 'won' : 'lost') : r.end) === k).length})`))));
    if (st.view === '2d') {
      const pts = sel.map(r => {
        const b = st.kind === 'serve' ? r.serveBounce : (r.bounce || r.serveBounce);
        if (!b) return null;
        const color = st.kind === 'serve' ? sCol[r.scorer === r.server ? 'won' : 'lost'] : `var(${COL[r.end]})`;
        return { x: b[0], y: b[1], color, r: 4, tip: { title: LBL[r.end] || 'Serve', rows: [{ value: r.speed ? fmtInt(r.speed) + ' km/h' : '–', label: 'speed' }], note: describe(r) }, r0: r };
      }).filter(Boolean);
      const segs = st.kind === 'end' ? sel.filter(r => r.hit && r.bounce).map(r => ({ x1: r.hit[0], y1: r.hit[1], x2: r.bounce[0], y2: r.bounce[1], color: `var(${COL[r.end]})`, opacity: 0.25 })) : [];
      court(host, { mode: 'full', points: pts, segments: segs, maxWidth: 900, onClick: p => { info.textContent = describe(p.r0); } });
      return;
    }
    import('../court3d.js').then(({ court3d }) => {
      if (st.view !== '3d') return;
      viewer = court3d(host, { onPick: r => { info.textContent = r ? describe(r.raw) : 'Click a flight path to inspect it.'; } });
      const shots = sel.map(r => {
        const color = st.kind === 'serve' ? hex(r.scorer === r.server ? '--series-1' : '--series-2') : hex(COL[r.end]);
        if (st.kind === 'serve') {
          // in-play serve: approximate the contact point behind the baseline on the server's side
          const sb = r.serveBounce; if (!sb) return null;
          const side = sb[0] < 0 ? 1 : -1;
          // serves go cross-court, so the server stands on the opposite side of the centre line from the bounce
          return { hit: [side * 11.95, -Math.sign(sb[1] || 1) * 0.6, 2.8], net: null, bounce: sb, last: null, color, raw: r };
        }
        if (!r.hit) return null;
        return { hit: r.hit, net: r.net, bounce: r.bounce, last: r.last, after: r.end === 'W', color, raw: r };
      }).filter(Boolean);
      viewer.setShots(shots);
      const vb = h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Camera'),
        ...Object.keys(viewer.views).map(k => h('button', { class: 'btn sm', type: 'button', onclick: () => viewer.views[k]() }, k[0].toUpperCase() + k.slice(1))));
      if (Object.keys(viewer.views).length) host.appendChild(vb);
    });
  }
  draw();
  return () => { if (viewer) viewer.dispose(); };
}
