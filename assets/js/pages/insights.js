// Insights lab: model checks and season-wide patterns.
import { h, clear, fmtInt, fmtPct, fmt1, fmt2, isNum, ratio, countryName, ageOn, ROUND_ORDER, ROUND_NAMES, SURFACES } from '../util.js';
import { D, F, filtered, aggregateFiltered, METRICS, mval, tourAgg, lazy, eloNow, surfaceColorVar, SEASONS, isAdv } from '../data.js';
import { card, scatter, barChart, columnChart, lineChart, stackBars } from '../charts.js';
import { pageHead, tiles, playerLink, filterSummary, segmented } from '../components.js';
import { dataTable } from '../table.js';
import { scoreGrid } from '../scoregrid.js';
import { drawTree, titleOdds } from './tournament.js';

export async function render(root) {
  root.appendChild(pageHead('Insights', 'Analytics lab', `Season-wide patterns and model checks (${filterSummary()}). Hover any chart for values; every chart has a table view.`));
  const toc = h('nav', { class: 'toc', 'aria-label': 'On this page' }, h('span', { class: 'toc-k' }, 'Jump to'), SECTIONS.map(([, label, adv], i) => (adv && !isAdv() ? null : tocChip(label, 'sec-' + i))));
  root.appendChild(toc);
  const ms = filtered();
  const agg = aggregateFiltered();
  const qual = [...agg.values()].filter(a => a.m >= 10);

  // advanced-only sections are built, then dropped in simple mode (keeps the code paths identical)
  let advMark = 0;
  const advStart = () => { advMark = root.childNodes.length; };
  const advEnd = () => { if (!isAdv()) while (root.childNodes.length > advMark) root.lastChild.remove(); };
  if (!isAdv()) root.appendChild(h('div', { class: 'notice mt' }, 'Simple view: model checks, playing-style statistics and ball-tracking distributions are hidden. Switch to Advanced at the top to see every section.'));
  // ---------- 1. Prediction quality ----------
  advStart();
  section(root, 'How predictable is the Challenger Tour?');
  const em = ms.filter(m => m.pWin != null && !m.flag);
  const favWon = em.filter(m => m.pWin > 0.5).length;
  const rk = ms.filter(m => m.wRank && m.lRank && !m.flag);
  const rkFav = rk.filter(m => m.wRank < m.lRank).length;
  const brier = em.reduce((s, m) => s + Math.pow(1 - m.pWin, 2), 0) / (em.length || 1);
  root.appendChild(tiles([
    { label: 'Elo favourite wins', value: fmtPct(ratio(favWon, em.length)), delta: `${fmtInt(em.length)} completed matches` },
    { label: 'Better-ranked player wins', value: fmtPct(ratio(rkFav, rk.length)), delta: 'by ATP ranking at match time' },
    { label: 'Brier score (Elo)', value: fmt2(brier), delta: 'lower is better · 0.25 = coin flip' },
    { label: 'Favourites ≥ 80% that lost', value: fmtInt(em.filter(m => m.pWin < 0.2).length), delta: 'massive upsets' },
  ]));
  const bins = [];
  for (let lo = 0.5; lo < 1; lo += 0.05) {
    const sel = em.filter(m => { const p = Math.max(m.pWin, 1 - m.pWin); return p >= lo && p < lo + 0.05; });
    if (sel.length >= 15) bins.push({ x: lo + 0.025, y: ratio(sel.filter(m => m.pWin > 0.5).length, sel.length), n: sel.length });
  }
  const g1 = h('div', { class: 'grid g2 mt' });
  g1.appendChild(card('Elo calibration', 'Predicted favourite win probability vs how often favourites actually won. Points on the diagonal = perfectly calibrated.', el => scatter(el, {
    points: bins.map(b => ({ x: b.x, y: b.y, label: `Predicted ${fmtPct(b.x - 0.025)}–${fmtPct(b.x + 0.025)}`, extra: [{ value: fmtInt(b.n), label: 'matches' }], r: 5 })),
    xLabel: 'Predicted favourite win %', yLabel: 'Actual favourite win %', xFmt: fmtPct, yFmt: fmtPct, xDomain: [0.5, 1], yDomain: [0.4, 1], diag: true, height: 300,
  }), { table: () => ({ cols: ['Predicted', 'Actual', 'Matches'], rows: bins.map(b => [fmtPct(b.x), fmtPct(b.y), b.n]) }) }));
  // upset rate by round
  const rounds = [...new Set(em.map(m => m.rd))].sort((a, b) => (ROUND_ORDER[a] || 0) - (ROUND_ORDER[b] || 0));
  const upRows = rounds.map(r => { const sel = em.filter(m => m.rd === r); return { label: r, value: ratio(sel.filter(m => m.pWin < 0.5).length, sel.length), note: `${sel.length} matches`, n: sel.length }; }).filter(r => r.n >= 10);
  g1.appendChild(card('Upset rate by round', 'Share of matches won by the Elo underdog', el => columnChart(el, { data: upRows.map(r => ({ ...r, tipTitle: ROUND_NAMES[r.label] || r.label })), fmt: fmtPct, yFmt: v => Math.round(v * 100) + '%', height: 300, valueLabel: 'underdog wins' }),
    { table: () => ({ cols: ['Round', 'Upset rate', 'Matches'], rows: upRows.map(r => [r.label, fmtPct(r.value), r.n]) }) }));
  root.appendChild(g1);

  advEnd();
  // ---------- 2. Entry types ----------
  section(root, 'Seeds, qualifiers and wildcards');
  const cls = t => {
    if (!t) return 'Direct entry (unseeded)';
    const s = t.split('/')[0];
    if (/^\d+$/.test(s)) return +s <= 2 ? 'Top-2 seed' : +s <= 4 ? 'Seeds 3-4' : 'Seeds 5+';
    return { Q: 'Qualifier', LL: 'Lucky loser', WC: 'Wildcard', Alt: 'Alternate', PR: 'Protected ranking', SE: 'Special exempt', NG: 'Next Gen accelerator', CO: 'College accelerator', JR: 'Junior exempt', ITF: 'ITF exempt' }[s] || s;
  };
  const mainMs = ms.filter(m => !m.q);
  const ent = new Map();
  for (const m of mainMs) for (const [tag, won, pid] of [[m.wTag, 1, m.w], [m.lTag, 0, m.l]]) {
    const k = cls(tag); const r = ent.get(k) || { k, w: 0, l: 0, titles: 0 };
    won ? r.w++ : r.l++; if (won && m.rd === 'F') r.titles++; ent.set(k, r);
  }
  const entRows = [...ent.values()].filter(r => r.w + r.l >= 20).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l));
  const g2 = h('div', { class: 'grid g2 mt' });
  g2.appendChild(card('Main-draw win % by entry type', 'Seeds from the seed number shown in the draw', el => barChart(el, {
    data: entRows.map(r => ({ label: r.k, value: r.w / (r.w + r.l), note: `${r.w}-${r.l} · ${r.titles} titles` })), fmt: fmtPct, labelWidth: 170, ref: 0.5,
  }), { table: () => ({ cols: ['Entry', 'W-L', 'Win %', 'Titles'], rows: entRows.map(r => [r.k, `${r.w}-${r.l}`, fmtPct(r.w / (r.w + r.l)), r.titles]) }) }));
  const champTags = new Map();
  for (const m of mainMs.filter(m => m.rd === 'F')) { const k = cls(m.wTag); champTags.set(k, (champTags.get(k) || 0) + 1); }
  const ctRows = [...champTags.entries()].sort((a, b) => b[1] - a[1]);
  g2.appendChild(card('Who wins titles?', 'Champions by entry type', el => barChart(el, { data: ctRows.map(([k, v]) => ({ label: k, value: v })), fmt: fmtInt, labelWidth: 170 }),
    { table: () => ({ cols: ['Entry', 'Titles'], rows: ctRows }) }));
  root.appendChild(g2);
  // titles vs pre-draw odds (Elo + draw) for every completed main draw in view
  {
    const evIds = new Set(ms.map(m => m.eid));
    const exp = new Map(), won = new Map();
    let nEv = 0, favWon = 0;
    for (const e of D.eventList) {
      if (!evIds.has(e.id) || !e.champ) continue;
      const tree = drawTree((e.matches || []).filter(m => !m.q));
      if (!tree) continue;
      const t = titleOdds(tree, 'pre').title;
      nEv++;
      for (const [pid, p] of t) exp.set(pid, (exp.get(pid) || 0) + p);
      won.set(e.champ, (won.get(e.champ) || 0) + 1);
      if ([...t.entries()].sort((a, b) => b[1] - a[1])[0][0] === e.champ) favWon++;
    }
    if (nEv >= 5) {
      const rows = [...exp.entries()].map(([pid, x]) => ({ pid, exp: x, won: won.get(pid) || 0 })).filter(r => r.won || r.exp >= 0.5).map(r => ({ ...r, diff: r.won - r.exp }));
      root.appendChild(h('div', { class: 'mt' }, card('Titles vs pre-draw odds', `${fmtInt(nEv)} completed main draws in view. Expected titles = the sum of each player's title chance before the main draw (Elo and the draw). The pre-draw favourite won ${fmtInt(favWon)} (${fmtPct(favWon / nEv)}).`, h('div', {}, dataTable({
        rows, sortKey: 'diff', sortDir: -1, pageSize: 10, compact: true, sticky: false, rank: true, csvName: 'titles-vs-odds.csv',
        cols: [
          { key: 'pid', label: 'Player', get: r => D.players[r.pid]?.name, render: r => playerLink(r.pid, { short: true }), sortDir: 1 },
          { key: 'won', label: 'Titles', align: 'r' },
          { key: 'exp', label: 'Expected', align: 'r', fmt: v => fmt2(v) },
          { key: 'diff', label: 'Above expectation', align: 'r', render: r => h('span', { class: r.diff >= 0 ? 'pos' : 'neg' }, (r.diff >= 0 ? '+' : '−') + fmt2(Math.abs(r.diff))) },
        ],
      })))));
    }
  }

  // ---------- 3. Age & nations ----------
  section(root, 'Age, nations and home advantage');
  const ageBins = [[0, 19, '≤19'], [20, 21, '20-21'], [22, 23, '22-23'], [24, 25, '24-25'], [26, 27, '26-27'], [28, 29, '28-29'], [30, 31, '30-31'], [32, 99, '32+']];
  const ageAgg = ageBins.map(([lo, hi, label]) => ({ label, w: 0, n: 0 }));
  for (const m of ms) for (const [pid, won] of [[m.w, 1], [m.l, 0]]) {
    const p = D.players[pid]; if (!p || !p.dob) continue;
    const a = ageOn(p.dob, m.date);
    const i = ageBins.findIndex(([lo, hi]) => a >= lo && a < hi + 1);
    if (i >= 0) { ageAgg[i].n++; ageAgg[i].w += won; }
  }
  const g3 = h('div', { class: 'grid g3 mt' });
  g3.appendChild(card('Win % by age', 'Age on match day · 50% = average', el => columnChart(el, { data: ageAgg.filter(r => r.n >= 30).map(r => ({ label: r.label, value: r.w / r.n, note: `${fmtInt(r.n)} player-matches` })), fmt: fmtPct, yFmt: v => Math.round(v * 100) + '%', height: 240 }),
    { table: () => ({ cols: ['Age', 'Win %', 'Player-matches'], rows: ageAgg.map(r => [r.label, fmtPct(ratio(r.w, r.n)), r.n]) }) }));
  const nat = new Map();
  for (const m of ms) for (const [pid, won] of [[m.w, 1], [m.l, 0]]) {
    const c = D.players[pid]?.c; if (!c) continue;
    const r = nat.get(c) || { c, w: 0, l: 0, titles: 0, players: new Set() };
    won ? r.w++ : r.l++; if (won && m.rd === 'F') r.titles++; r.players.add(pid); nat.set(c, r);
  }
  const natRows = [...nat.values()].sort((a, b) => b.w - a.w);
  g3.appendChild(card('Nations by match wins', 'Top 12', el => barChart(el, { data: natRows.slice(0, 12).map(r => ({ label: countryName(r.c), value: r.w, note: `${r.w}-${r.l} · ${r.titles} titles · ${r.players.size} players` })), fmt: fmtInt, labelWidth: 120, barH: 14, gap: 7 }),
    { table: () => ({ cols: ['Country', 'Wins', 'Losses', 'Titles', 'Players'], rows: natRows.map(r => [countryName(r.c), r.w, r.l, r.titles, r.players.size]) }) }));
  // home advantage
  let homeW = 0, homeN = 0, awayW = 0, awayN = 0;
  const homeMatches = [];
  for (const m of ms) {
    const cc = m.e?.cc; if (!cc) continue;
    const wh = D.players[m.w]?.c === cc, lh = D.players[m.l]?.c === cc;
    if (wh === lh) continue; // both or neither at home
    homeN++; awayN++;
    if (wh) { homeW++; homeMatches.push(m); } else awayW++;
  }
  const expHome = (() => { let s = 0, n = 0; for (const m of ms) { const cc = m.e?.cc; if (!cc || m.pWin == null) continue; const wh = D.players[m.w]?.c === cc, lh = D.players[m.l]?.c === cc; if (wh === lh) continue; s += wh ? m.pWin : 1 - m.pWin; n++; } return ratio(s, n); })();
  g3.appendChild(card('Home advantage', 'Matches where exactly one player represents the host country', h('div', { style: { padding: '6px 0' } },
    h('div', { class: 'ins-num' }, fmtPct(ratio(homeW, homeN))), h('div', { class: 'muted' }, `home player win rate in ${fmtInt(homeN)} matches`),
    h('div', { class: 'mt kv' }, h('dt', {}, 'Expected by Elo'), h('dd', {}, fmtPct(expHome)), h('dt', {}, 'Home edge'), h('dd', {}, isNum(expHome) ? ((ratio(homeW, homeN) - expHome) * 100).toFixed(1) + ' pts' : '–')),
    h('p', { class: 'muted mt', style: { fontSize: '12.5px' } }, 'Home players also include many wildcards, so the raw rate is compared with the Elo expectation for the same matches.'))));
  root.appendChild(g3);

  // ---------- 4. Player styles ----------
  advStart();
  section(root, 'Playing styles');
  const tour = tourAgg(ms);
  const pts = qual.map(a => ({ a, x: mval('spw', a), y: mval('rpw', a) })).filter(p => isNum(p.x) && isNum(p.y));
  const topIds = new Set(pts.slice().sort((p, q) => (q.x + q.y) - (p.x + p.y)).slice(0, 8).map(p => p.a.pid));
  const g4 = h('div', { class: 'grid g2 mt' });
  g4.appendChild(card('Serve vs return', 'Players with 10+ matches. Lines = tour averages; top-right = elite on both.', el => scatter(el, {
    points: pts.map(p => ({ x: p.x, y: p.y, id: p.a.pid, label: D.players[p.a.pid]?.name, sub: `${p.a.w}-${p.a.l}`, color: topIds.has(p.a.pid) ? 'var(--series-2)' : 'var(--series-1)', hl: topIds.has(p.a.pid) })),
    xLabel: 'Service points won %', yLabel: 'Return points won %', xFmt: fmtPct, yFmt: fmtPct, refX: mval('spw', tour), refY: mval('rpw', tour), labelIds: topIds, height: 360,
    onClick: p => { location.hash = '#/player/' + p.id; },
  }), { table: () => ({ cols: ['Player', 'SPW', 'RPW'], rows: pts.map(p => [D.players[p.a.pid]?.name, fmtPct(p.x), fmtPct(p.y)]) }) }));
  const cl = qual.map(a => ({ a, x: mval('spw', a), y: mval('bpSaved', a), n: a.s[D.K.bpF] })).filter(p => isNum(p.x) && isNum(p.y) && p.n >= 20);
  const clutchIds = new Set(cl.slice().sort((p, q) => (q.y - q.x) - (p.y - p.x)).slice(0, 5).map(p => p.a.pid));
  g4.appendChild(card('Clutch serving', 'Break points saved vs overall service points won (20+ BPs faced). Above the diagonal = better under pressure.', el => scatter(el, {
    points: cl.map(p => ({ x: p.x, y: p.y, id: p.a.pid, label: D.players[p.a.pid]?.name, sub: `${fmtInt(p.n)} break points faced`, color: clutchIds.has(p.a.pid) ? 'var(--series-2)' : 'var(--series-1)', hl: clutchIds.has(p.a.pid) })),
    xLabel: 'Service points won %', yLabel: 'Break points saved %', xFmt: fmtPct, yFmt: fmtPct, diag: true, labelIds: clutchIds, height: 360,
    onClick: p => { location.hash = '#/player/' + p.id; },
  }), { table: () => ({ cols: ['Player', 'SPW', 'BP saved', 'BP faced'], rows: cl.map(p => [D.players[p.a.pid]?.name, fmtPct(p.x), fmtPct(p.y), p.n]) }) }));
  // surface specialists
  const sp = [...agg.values()].map(a => {
    const hd = a.bySurface.Hard || [0, 0], cy = a.bySurface.Clay || [0, 0];
    return { a, hn: hd[0] + hd[1], cn: cy[0] + cy[1], x: ratio(hd[0], hd[0] + hd[1]), y: ratio(cy[0], cy[0] + cy[1]) };
  }).filter(p => p.hn >= 8 && p.cn >= 8);
  const spIds = new Set([...sp].sort((p, q) => Math.abs(q.y - q.x) - Math.abs(p.y - p.x)).slice(0, 6).map(p => p.a.pid));
  g4.appendChild(card('Surface specialists', 'Hard vs clay win % (8+ matches on each). Far from the diagonal = strong surface preference.', el => scatter(el, {
    points: sp.map(p => ({ x: p.x, y: p.y, id: p.a.pid, label: D.players[p.a.pid]?.name, sub: `Hard ${p.hn} matches · clay ${p.cn}`, color: spIds.has(p.a.pid) ? 'var(--series-2)' : 'var(--series-1)', hl: spIds.has(p.a.pid) })),
    xLabel: 'Hard-court win %', yLabel: 'Clay-court win %', xFmt: fmtPct, yFmt: fmtPct, diag: true, xDomain: [0, 1], yDomain: [0, 1], labelIds: spIds, height: 360,
    onClick: p => { location.hash = '#/player/' + p.id; },
  }), { table: () => ({ cols: ['Player', 'Hard', 'Clay'], rows: sp.map(p => [D.players[p.a.pid]?.name, fmtPct(p.x), fmtPct(p.y)]) }) }));
  const st = qual.map(a => ({ a, x: mval('winnersPerM', a), y: mval('uePerM', a) })).filter(p => isNum(p.x) && isNum(p.y) && p.a.cls.m >= 8);
  const stIds = new Set(st.slice().sort((p, q) => (q.x - q.y) - (p.x - p.y)).slice(0, 6).map(p => p.a.pid));
  g4.appendChild(card('Winners vs unforced errors', 'Per match, umpire-logged point endings (8+ classified matches). Bottom-right = clean aggression.', el => scatter(el, {
    points: st.map(p => ({ x: p.x, y: p.y, id: p.a.pid, label: D.players[p.a.pid]?.name, color: stIds.has(p.a.pid) ? 'var(--series-2)' : 'var(--series-1)', hl: stIds.has(p.a.pid) })),
    xLabel: 'Winners per match (incl. aces)', yLabel: 'Unforced errors per match', xFmt: fmt1, yFmt: fmt1, labelIds: stIds, height: 360, diag: true,
    onClick: p => { location.hash = '#/player/' + p.id; },
  }), { table: () => ({ cols: ['Player', 'Winners/M', 'UE/M'], rows: st.map(p => [D.players[p.a.pid]?.name, fmt1(p.x), fmt1(p.y)]) }) }));
  root.appendChild(g4);

  advEnd();
  // ---------- 5. Match dynamics ----------
  section(root, 'Match dynamics');
  const done = ms.filter(m => !m.flag && m.sets.length >= 2);
  const firstWon = done.filter(m => m.sets[0][0] > m.sets[0][1]).length;
  const tbSet1 = done.filter(m => Math.max(...m.sets[0].slice(0, 2)) === 7 && Math.min(...m.sets[0].slice(0, 2)) === 6);
  const g5 = h('div', { class: 'grid g2 mt' });
  const surfRows = SURFACES.filter(s => done.some(m => m.surface === s)).map(s => {
    const sm = done.filter(m => m.surface === s);
    return { s, n: sm.length, first: ratio(sm.filter(m => m.sets[0][0] > m.sets[0][1]).length, sm.length), three: ratio(sm.filter(m => m.sets.length === 3).length, sm.length), bagel: ratio(sm.filter(m => m.sets.some(([a, b]) => Math.min(a, b) === 0)).length, sm.length) };
  });
  g5.appendChild(card('Set-one winners and comebacks', `Overall, the first-set winner takes the match ${fmtPct(ratio(firstWon, done.length))} of the time (${fmtPct(ratio(tbSet1.filter(m => m.sets[0][0] > m.sets[0][1]).length, tbSet1.length))} after a first-set tiebreak).`, h('div', {}, dataTable({
    rows: surfRows, sortKey: 'n', sticky: false, compact: true, pageSize: 6, cols: [
      { key: 's', label: 'Surface', render: r => h('span', {}, h('span', { class: 'sdot', style: { background: surfaceColorVar(r.s) } }), r.s), sortDir: 1 },
      { key: 'n', label: 'Matches', align: 'r', fmt: fmtInt },
      { key: 'first', label: 'Set-1 winner wins', align: 'r', fmt: fmtPct },
      { key: 'three', label: 'Three sets', align: 'r', fmt: fmtPct },
      { key: 'bagel', label: 'Contains a bagel', align: 'r', fmt: fmtPct },
    ],
  }))));
  const scoreCount = new Map();
  for (const m of done) { const s = m.sets.map(([a, b]) => `${a}-${b}`).join(' '); scoreCount.set(s, (scoreCount.get(s) || 0) + 1); }
  const topScores = [...scoreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  g5.appendChild(card('Most common scorelines', 'Completed matches, winner’s games first', el => barChart(el, { data: topScores.map(([s, n]) => ({ label: s, value: n, note: fmtPct(n / done.length) + ' of matches' })), fmt: fmtInt, labelWidth: 120, barH: 14, gap: 7 }),
    { table: () => ({ cols: ['Score', 'Matches'], rows: [...scoreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50) }) }));
  root.appendChild(g5);

  // ---------- 5b. Win probability: comebacks and match points ----------
  section(root, 'Great escapes: win probability through every match');
  const dramaHost = h('div');
  root.appendChild(dramaHost);
  try { dramaSection(dramaHost, await lazy('data/drama.json'), ms); }
  catch { dramaHost.appendChild(h('div', { class: 'empty' }, 'Win-probability data unavailable.')); }

  // ---------- 5c. Season to season (data/seasons.json) ----------
  const yoyHost = h('div');
  root.appendChild(yoyHost);
  lazy('data/seasons.json').then(S => { seasonToSeason(yoyHost, S); if (yoyHost.firstChild) { const last = toc.lastChild; if (isAdv()) toc.insertBefore(tocChip(`Since ${D.season - 1}`, 'sec-yoy'), last); else toc.appendChild(tocChip(`Since ${D.season - 1}`, 'sec-yoy')); } }).catch(() => {});

  // ---------- 6. Hawk-Eye point data ----------
  if (!isAdv()) return;
  section(root, 'Rallies and serve speed (Hawk-Eye tracked events)');
  const host = h('div', { class: 'grid g2 mt' });
  root.appendChild(host);
  let tp;
  try { tp = await lazy('data/tour_points.json'); } catch { host.appendChild(h('div', { class: 'empty' }, 'Point data unavailable.')); return; }
  const surfs = Object.keys(tp.rally || {}).filter(s => Object.values(tp.rally[s]).reduce((a, v) => a + v[0], 0) > 500);
  // The feed counts shots up to the last ball in play (an error is not a shot), so an odd length always means
  // the server won the point. Pairs of lengths (1-2, 3-4, ...) mix both endings and give a fair win rate.
  const RB = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 99]];
  const rbLabel = ([a, b]) => b === 99 ? `${a}+` : `${a}–${b}`;
  const rallyBins = s => RB.map(([a, b]) => {
    let n = 0, w = 0;
    for (const [k, v] of Object.entries(tp.rally[s])) if (+k >= a && +k <= b) { n += v[0]; w += v[1]; }
    return { n, w };
  });
  const rallySeries = surfs.map(s => ({ name: s, color: surfaceColorVar(s), values: rallyBins(s).map((b, i) => ({ x: i, y: ratio(b.w, b.n), n: b.n })).filter(p => p.n >= 40) }));
  host.appendChild(card('Server win % by rally length', 'Share of points the server wins, by rally length in shots (serve = shot 1). Short points belong to the server; long rallies even out.', el => lineChart(el, {
    series: rallySeries, xType: 'num', xFmt: v => Number.isInteger(v) && RB[v] ? rbLabel(RB[v]) : '', yFmt: fmtPct, height: 280, markers: true, endLabels: true, refY: [{ y: 0.5, label: '50%' }],
    tipTitle: p => `${rbLabel(RB[p.x])} shots`,
  }), { table: () => ({ cols: ['Shots', ...surfs], rows: RB.map((r, i) => [rbLabel(r), ...surfs.map(s => { const b = rallyBins(s)[i]; return b.n ? fmtPct(b.w / b.n) + ` (${fmtInt(b.n)})` : '–'; })]) }) }));
  const dist = surfs.map(s => { const tot = Object.values(tp.rally[s]).reduce((a, v) => a + v[0], 0); return { s, tot, short: ratio(Object.entries(tp.rally[s]).filter(([k]) => +k <= 4).reduce((a, [, v]) => a + v[0], 0), tot), mid: ratio(Object.entries(tp.rally[s]).filter(([k]) => +k >= 5 && +k <= 8).reduce((a, [, v]) => a + v[0], 0), tot) }; });
  host.appendChild(card('Rally length mix', 'Share of points by rally length', el => stackBars(el, {
    rows: dist.map(d => ({ label: `${d.s} (${fmtInt(d.tot)} pts)`, parts: { a: d.short, b: d.mid, c: 1 - d.short - d.mid } })),
    keys: [{ key: 'a', label: '1-4 shots', color: 'var(--series-1)' }, { key: 'b', label: '5-8 shots', color: 'var(--series-2)' }, { key: 'c', label: '9+ shots', color: 'var(--series-3)', dark: true }], labelWidth: 150,
    fmt: (v, t) => fmtPct(v / t),
  })));
  const speedSurf = Object.keys(tp.speed || {});
  if (speedSurf.length) {
    let cur = speedSurf.includes('Hard') ? 'Hard' : speedSurf[0];
    const toggle = () => segmented(speedSurf.map(s => [s, s]), cur, v => { cur = v; drawSpeed(); });
    const sc = card('Serve speed distribution', 'Share of serves by speed (5 km/h bins)', null, { actions: toggle() });
    const wc = card('Does serving faster pay off?', 'Points won by the server, by serve speed (bins with 150+ serves)', null, { actions: toggle() });
    host.append(sc, wc);
    const drawSpeed = () => {
      for (const c of [sc, wc]) c.querySelector('.card-actions').replaceChildren(toggle());
      const b = clear(sc.querySelector('.card-body'));
      const d1 = Object.fromEntries(tp.speed[cur]['1'] || []), d2 = Object.fromEntries(tp.speed[cur]['2'] || []);
      const t1 = Object.values(d1).reduce((a, v) => a + v, 0) || 1, t2 = Object.values(d2).reduce((a, v) => a + v, 0) || 1;
      const keys = [...new Set([...Object.keys(d1), ...Object.keys(d2)].map(Number))].filter(k => k >= 100 && k <= 240).sort((a, b) => a - b);
      lineChart(b, {
        series: [{ name: '1st serve', color: 'var(--series-1)', values: keys.map(k => ({ x: k, y: (d1[k] || 0) / t1 })), area: true }, { name: '2nd serve', color: 'var(--series-2)', values: keys.map(k => ({ x: k, y: (d2[k] || 0) / t2 })), area: true }],
        xType: 'num', xFmt: v => fmtInt(v), yFmt: v => (v * 100).toFixed(1) + '%', height: 260, endLabels: false, yZero: true, tipTitle: p => `${p.x}–${p.x + 4} km/h`,
      });
      const wb = clear(wc.querySelector('.card-body'));
      const won = tp.speedWon && tp.speedWon[cur];
      if (!won) { wb.appendChild(h('div', { class: 'empty' }, 'Not available')); return; }
      const ser = [['1', '1st serve', 'var(--series-1)', d1], ['2', '2nd serve', 'var(--series-2)', d2]].map(([sn, name, color, dn]) => {
        const w = Object.fromEntries(won[sn] || []);
        return { name, color, values: Object.keys(dn).map(Number).filter(k => dn[k] >= 150).sort((a, b) => a - b).map(k => ({ x: k, y: (w[k] || 0) / dn[k], n: dn[k] })) };
      });
      lineChart(wb, {
        series: ser, xType: 'num', xFmt: v => fmtInt(v), yFmt: fmtPct, height: 260, markers: true, endLabels: true, refY: [{ y: 0.5, label: '50%' }],
        tipTitle: p => `${p.x}–${p.x + 4} km/h`,
      });
    };
    drawSpeed();
  }
}
function section(root, title) { root.appendChild(h('h2', { class: 'mt2', id: 'sec-' + SECTIONS.findIndex(x => x[0] === title) }, title)); }
// Contents: [section title, short label]
const SECTIONS = [
  ['How predictable is the Challenger Tour?', 'Predictability', true], ['Seeds, qualifiers and wildcards', 'Seeds & qualifiers'],
  ['Age, nations and home advantage', 'Age & nations'], ['Playing styles', 'Playing styles', true], ['Match dynamics', 'Match dynamics'],
  ['Great escapes: win probability through every match', 'Great escapes'], ['Rallies and serve speed (Hawk-Eye tracked events)', 'Rallies & serve speed', true],
];
function tocChip(label, target) {
  return h('button', { type: 'button', class: 'toc-chip', onclick: () => { const el = document.getElementById(target); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, label);
}

const chance = v => (!isNum(v) ? '–' : v >= 0.01 ? fmtPct(v) : v > 0 ? `1 in ${fmtInt(Math.round(1 / v))}` : '<0.01%');
/** Returning players, newcomers and the biggest Elo moves since last season (full seasons; ignores the filters). */
function seasonToSeason(host, S) {
  const y = String(D.season), py = String(D.season - 1);
  const C = Object.fromEntries(S.cols.map((c, i) => [c, i]));
  const all = Object.entries(S.players);
  if (!all.some(([, r]) => r[py])) return;
  const nm = r => r[C.w] + r[C.l];
  const inNow = all.filter(([, r]) => r[y]);
  const back = inNow.filter(([, r]) => r[py]);
  const titles = inNow.reduce((a, [, r]) => a + r[y][C.titles], 0);
  const newTitles = inNow.filter(([, r]) => !r[py]).reduce((a, [, r]) => a + r[y][C.titles], 0);
  const rows = back.filter(([, r]) => nm(r[y]) >= 10 && nm(r[py]) >= 10 && isNum(r[y][C.elo]) && isNum(r[py][C.elo]))
    .map(([pid, r]) => ({ pid, prev: r[py][C.elo], now: r[y][C.elo], d: r[y][C.elo] - r[py][C.elo], tPrev: r[py][C.titles], t: r[y][C.titles] }));
  if (rows.length < 20) return;
  const ds = rows.map(r => r.d).sort((a, b) => a - b), med = ds[Math.floor(ds.length / 2)];
  // title defences: last season's champion at the same event (same ATP id) this season
  const prevEv = (S.events || {})[py] || {}, nowEv = (S.events || {})[y] || {};
  let defended = 0, retained = 0;
  const kept = [];
  for (const [eid, v] of Object.entries(nowEv)) {
    const c = (prevEv[eid] || [])[0], ev = D.events[eid];
    if (!c || !ev || !v[0] || !ev.matches.some(m => m.w === c || m.l === c)) continue;
    defended++;
    if (v[0] === c) { retained++; kept.push(`${D.players[c]?.short || c} (${ev.city})`); }
  }
  const live = +y === SEASONS[0];
  host.appendChild(h('h2', { class: 'mt2', id: 'sec-yoy' }, `From ${py} to ${y}`));
  host.appendChild(tiles([
    { label: `Back from ${py}`, value: fmtInt(back.length), delta: `${fmtPct(back.length / inNow.length)} of this season's ${fmtInt(inNow.length)} players` },
    { label: 'New to the tour', value: fmtInt(inNow.length - back.length), delta: `no Challenger match in ${py}` },
    { label: 'Titles by newcomers', value: fmtInt(newTitles), delta: `of ${fmtInt(titles)} titles (${fmtPct(ratio(newTitles, titles))})` },
    { label: 'Typical Elo change', value: (med >= 0 ? '+' : '−') + fmtInt(Math.abs(med)), delta: `median, ${fmtInt(rows.length)} players with 10+ matches in both` },
    defended ? { label: 'Titles defended', value: `${retained} of ${defended}`, delta: kept.length ? kept.join(', ') : `champions who came back to the same event` } : null,
  ].filter(Boolean)));
  const cols = [
    { key: 'pid', label: 'Player', get: r => D.players[r.pid]?.name, render: r => playerLink(r.pid, { short: true }), sortDir: 1 },
    { key: 'prev', label: `${py} final`, align: 'r', fmt: fmtInt },
    { key: 'now', label: live ? 'Now' : `${y} final`, align: 'r', fmt: fmtInt },
    { key: 'd', label: 'Change', align: 'r', render: r => h('span', { class: r.d >= 0 ? 'pos' : 'neg' }, (r.d >= 0 ? '+' : '−') + fmtInt(Math.abs(r.d))) },
    { key: 't', label: 'Titles', align: 'r', get: r => r.t, render: r => `${r.tPrev} → ${r.t}` },
  ];
  const tbl = (rs, dir) => h('div', {}, dataTable({ rows: rs, cols, sortKey: 'd', sortDir: dir, pageSize: 10, compact: true, sticky: false, rank: true }));
  const g = h('div', { class: 'grid g2 mt' });
  g.append(
    card('Biggest climbers', `Final ${py} Elo against ${live ? 'today\'s' : `final ${y}`}, for players with 10+ Challenger matches in both seasons`, tbl(rows.filter(r => r.d > 0), -1)),
    card('Biggest drops', `Same players, largest falls${live ? ' so far' : ''}`, tbl(rows.filter(r => r.d < 0), 1)));
  host.appendChild(g);
}

function dramaSection(host, dr, ms) {
  const label = new Map([...dr.comebacks, ...dr.matchPoints, ...dr.dramatic].map(x => [x.id, x]));
  const rows = ms.filter(m => !m.flag && dr.byMatch[m.id]).map(m => { const [min, mps, swing] = dr.byMatch[m.id]; return { m, min, mps, swing }; });
  if (!rows.length) { host.appendChild(h('div', { class: 'empty' }, 'No matches with point-by-point data under these filters.')); return; }
  const escapes = rows.filter(r => r.min < 0.1), mpWins = rows.filter(r => r.mps > 0);
  const mostMp = rows.reduce((a, r) => (r.mps > a.mps ? r : a), rows[0]);
  host.appendChild(h('p', { class: 'muted', style: { margin: '6px 0 12px', maxWidth: '900px' } },
    `Every match with a complete point-by-point record gets a win-probability line: each player's chance of winning the match before every point, starting from the pre-match Elo forecast and following the score. Open any match's "Momentum & flow" tab to see it. ${fmtInt(rows.length)} matches under the current filters.`));
  host.appendChild(tiles([
    { label: 'Winner was below 10% at some point', value: fmtPct(escapes.length / rows.length), delta: `${fmtInt(escapes.length)} great escapes` },
    { label: 'Winner saved a match point', value: fmtPct(mpWins.length / rows.length), delta: `${fmtInt(mpWins.length)} matches` },
    { label: 'Most match points saved', value: fmtInt(mostMp.mps), delta: `${D.players[mostMp.m.w]?.short} d. ${D.players[mostMp.m.l]?.short} · ${mostMp.m.e?.city || ''}` },
    { label: 'Lowest chance overcome', value: chance(Math.min(...rows.map(r => r.min))), delta: 'by an eventual winner' },
  ]));
  const go = r => { location.hash = '#/match/' + r.m.id + '?tab=flow'; };
  const sc = m => m.sets.map(x => `${x[0]}-${x[1]}${isNum(x[2]) ? `(${x[2]})` : ''}`).join(' ');
  const matchCell = (r, extra) => h('span', {}, playerLink(r.m.w, { short: true }), ' d. ', playerLink(r.m.l, { short: true }),
    h('div', { class: 'muted', style: { fontSize: '11.5px' } }, `${r.m.e?.city || ''} ${r.m.rd} · ${r.m.date.slice(5).replace('-', '/')} · ${sc(r.m)}${extra ? ' · ' + extra : ''}`));
  const matchCol = extra => ({ key: 'w', label: 'Match', get: r => D.players[r.m.w]?.name, render: r => matchCell(r, extra && extra(r)), sortDir: 1 });
  const g = h('div', { class: 'grid g2 mt' });
  g.appendChild(card('Greatest escapes', 'Lowest chance the eventual winner had at any point, and the score at that moment (winner first)', h('div', {}, dataTable({
    rows: rows.slice().sort((a, b) => a.min - b.min).slice(0, 60), sortKey: 'min', sortDir: 1, pageSize: 10, compact: true, sticky: false, csvName: 'great-escapes.csv', onRowClick: go,
    cols: [matchCol(r => (label.get(r.m.id)?.minScore ? 'low point at ' + label.get(r.m.id).minScore : '')), { key: 'min', label: 'Lowest chance', align: 'r', fmt: chance, sortDir: 1 }, { key: 'mps', label: 'MPs saved', align: 'r' }],
  }))));
  g.appendChild(card('Most match points saved', 'Matches won after the opponent stood one point from victory', h('div', {}, dataTable({
    rows: mpWins.slice().sort((a, b) => b.mps - a.mps || a.min - b.min).slice(0, 60), sortKey: 'mps', sortDir: -1, pageSize: 10, compact: true, sticky: false, csvName: 'match-points-saved.csv', onRowClick: go,
    cols: [matchCol(), { key: 'mps', label: 'MPs saved', align: 'r' }, { key: 'min', label: 'Lowest chance', align: 'r', fmt: chance, sortDir: 1 }],
  }))));
  host.appendChild(g);
  // players: who escapes, who lets matches slip
  const P = new Map();
  for (const r of rows) {
    for (const [pid, won] of [[r.m.w, true], [r.m.l, false]]) {
      const q = P.get(pid) || { pid, n: 0, esc: 0, mpw: 0, mps: 0, col: 0, swing: 0 };
      q.n++; q.swing += r.swing;
      if (won) { q.esc += r.min < 0.1; q.mpw += r.mps > 0; q.mps += r.mps; } else { q.col += r.min < 0.1; }
      P.set(pid, q);
    }
  }
  const pl = [...P.values()].filter(q => q.n >= 10);
  const g2 = h('div', { class: 'grid g-21 mt' });
  g2.appendChild(card('Escape artists and slip-ups', 'Per player (10+ matches with point data): wins after falling below a 10% chance, wins after facing match point, and losses after holding a 90%+ chance', h('div', {}, dataTable({
    rows: pl, sortKey: 'esc', sortDir: -1, pageSize: 12, compact: true, sticky: false, csvName: 'escapes-by-player.csv', rank: true,
    cols: [
      { key: 'pid', label: 'Player', get: q => D.players[q.pid]?.name, render: q => playerLink(q.pid, { short: true }), sortDir: 1 },
      { key: 'n', label: 'Matches', align: 'r' },
      { key: 'esc', label: 'Escapes (<10%)', align: 'r' },
      { key: 'mpw', label: 'Won from MP down', align: 'r' },
      { key: 'mps', label: 'MPs saved', align: 'r' },
      { key: 'col', label: 'Slipped (>90%)', align: 'r' },
      { key: 'net', label: 'Net', align: 'r', get: q => q.esc - q.col, render: q => h('span', { class: q.esc - q.col > 0 ? 'pos' : q.esc - q.col < 0 ? 'neg' : '' }, (q.esc - q.col > 0 ? '+' : '') + (q.esc - q.col)) },
      { key: 'drama', label: 'Drama / match', align: 'r', get: q => q.swing / q.n, fmt: v => fmtInt(v * 100) },
    ],
  }))));
  g2.appendChild(card('Most dramatic matches', 'Total movement in win probability, in points: every point that shifts the chance by 5% adds 5', h('div', {}, dataTable({
    rows: rows.slice().sort((a, b) => b.swing - a.swing).slice(0, 40), sortKey: 'swing', sortDir: -1, pageSize: 10, compact: true, sticky: false, onRowClick: go,
    cols: [{ key: 'w', label: 'Match', get: r => D.players[r.m.w]?.name, render: r => h('span', {}, `${D.players[r.m.w]?.short} d. ${D.players[r.m.l]?.short}`, h('div', { class: 'muted', style: { fontSize: '11.5px' } }, `${r.m.e?.city || ''} ${r.m.rd} · ${r.m.sets.map(x => `${x[0]}-${x[1]}`).join(' ')}`)) },
      { key: 'swing', label: 'Drama', align: 'r', fmt: v => fmtInt(v * 100) }],
  }))));
  host.appendChild(g2);
  // clutch on big points (season-wide; not affected by the filters)
  if (dr.clutch && isAdv()) {
    const C = Object.entries(dr.clutch).map(([pid, v]) => ({ pid, n: v[0], won: v[1], exp: v[2], bn: v[3], bw: v[4], be: v[5], clutch: v[6] }));
    const rel = dr.clutchReliability;
    const big = C.reduce((a, c) => a + c.bn, 0), all = C.reduce((a, c) => a + c.n, 0);
    const g3 = h('div', { class: 'grid g-12 mt' });
    g3.appendChild(card('Is "clutch" real?', 'Big points: points where the winner of the point gains 10+ points of win probability', h('div', { class: 'clutch-note' },
      h('p', {}, `About ${fmtPct(big / all)} of points are big points: break and set points, deuce points late in sets, tiebreaks. For each player we compare the big points won with what the win-probability model expected, and subtract how far the player beat the model on all points. What is left is the "clutch" score.`),
      rel && isNum(rel.r) ? h('p', {}, h('b', {}, `Split-half check: r = ${fmt2(rel.r)}. `), `Splitting each player's matches into two halves, the clutch score in one half predicts almost nothing about the other (${fmtInt(rel.n)} players). Over a season, winning big points beyond your usual level is mostly luck, which is what studies of the main tour have found too. A true skill would show a clear positive correlation.`) : null,
      h('p', { class: 'muted' }, 'So read the table as who ran hot or cold on big points this year, not as a trait. With a few hundred big points per player, ±6 points is within normal luck.'))));
    g3.appendChild(card('Clutch on big points', 'Season to date, players with 150+ big points. Clutch = beat the model on big points minus beat it on all points (percentage points).', h('div', {}, dataTable({
      rows: C, sortKey: 'clutch', sortDir: -1, pageSize: 12, compact: true, sticky: false, rank: true, csvName: 'clutch-big-points.csv',
      cols: [
        { key: 'pid', label: 'Player', get: c => D.players[c.pid]?.name, render: c => playerLink(c.pid, { short: true }), sortDir: 1 },
        { key: 'bn', label: 'Big points', align: 'r', fmt: fmtInt },
        { key: 'bwr', label: 'Won', align: 'r', get: c => c.bw / c.bn, fmt: fmtPct },
        { key: 'ber', label: 'Expected', align: 'r', get: c => c.be / c.bn, fmt: fmtPct },
        { key: 'allx', label: 'All points vs model', align: 'r', get: c => (c.won - c.exp) / c.n, render: c => { const v = (c.won - c.exp) / c.n; return (v >= 0 ? '+' : '−') + fmt1(Math.abs(v) * 100); } },
        { key: 'clutch', label: 'Clutch', align: 'r', render: c => h('span', { class: c.clutch > 0 ? 'pos' : 'neg' }, (c.clutch >= 0 ? '+' : '−') + fmt1(Math.abs(c.clutch) * 100)) },
      ],
    }))));
    host.appendChild(g3);
  }
  if (isAdv()) lazy('data/serve_states.json').then(S => {
    const t = S.players._tour;
    if (!t) return;
    const flat = t.map(c => [c[0], c[1]]);
    const n = flat.reduce((x, c) => x + c[0], 0);
    const g4 = h('div', { class: 'grid g2 mt' });
    g4.appendChild(card('Serving by score, whole tour', `Share of service points the server won at each game score (${fmtInt(n)} points). Green/orange = above/below the overall rate.`,
      scoreGrid({ states: S.states, cells: flat, relative: true, refLabel: 'tour average', minN: 500 })));
    g4.appendChild(card('Reading the grid', null, h('div', { class: 'clutch-note' },
      h('p', {}, 'Servers win most at 40-0 and least at 0-40. Part of that is pressure, but most of it is who gets there: strong servers reach 40-0 often, weak ones reach 0-40. The same selection effect is why each player\'s own grid (on the Scouting tab) is compared with that player\'s own average.'),
      h('p', {}, 'Break points (30-40, 15-40, 0-40, 40-AD) are below average, and big points behave like the clutch analysis above suggests: small, noisy differences.'))));
    host.appendChild(g4);
  }).catch(() => {});
}
