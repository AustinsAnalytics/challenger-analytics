// Player profile.
import { h, clear, fmtInt, fmtPct, fmt1, fmt2, fmtDate, fmtMin, isNum, ratio, countryName, ageOn, flag, ROUND_ORDER, ROUND_NAMES, MONTHS, SURFACES } from '../util.js';
import { D, F, NO_FILTER, passes, playerAgg, eloNow, runElo, METRICS, mval, lazy, tourAgg, filtered, surfaceColorVar, SEASON, SEASONS, seasonHref, seedLabel, isAdv, eloAsAtp } from '../data.js';
import { card, lineChart, barChart, columnChart, stackBars, compareRow, showTip, hideTip } from '../charts.js';
import { playerLink, eventLink, surfaceDot, matchCols, metricList, segmented, handStr, roundLabel, tiles, percentile, keepTabVisible } from '../components.js';
import { dataTable } from '../table.js';
import { court, ZONE_NAMES } from '../court.js';
import { parseHash, setQuery } from '../main.js';
import { scoreGrid } from '../scoregrid.js';
import { STYLE, stylePool, likeness } from '../style.js';
import { drawTree, titleOdds } from './tournament.js';

const TABS = [['overview', 'Overview'], ['stats', 'Scouting report'], ['matches', 'Matches'], ['opponents', 'Opponents'], ['events', 'Tournaments'], ['hawkeye', 'Hawk-Eye']];

export async function render(root, { id }) {
  const pid = (id || '').toUpperCase();
  const p = D.players[pid];
  if (!p) {
    let S = null;
    try { S = await lazy('data/seasons.json'); } catch { S = null; }
    const rec = (S && S.players[pid]) || {}, nm = (S && S.names[pid] && S.names[pid][0]) || `Player ${pid}`;
    const others = SEASONS.filter(y => y !== SEASON && (!S || rec[y]));
    const C = S ? Object.fromEntries(S.cols.map((c, i) => [c, i])) : {};
    root.appendChild(h('div', { class: 'card' }, h('h3', {}, `${nm}: no Challenger matches in ${SEASON}`),
      h('p', { class: 'muted' }, others.length ? `No completed Challenger singles match in the ${SEASON} season. Other seasons:` : `No completed Challenger singles match in any season on this site.`),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, others.map(y => h('a', { class: 'btn', href: seasonHref(y, '#/player/' + pid) },
        rec[y] ? `${y}: ${rec[y][C.w]}-${rec[y][C.l]}${rec[y][C.titles] ? `, ${rec[y][C.titles]} title${rec[y][C.titles] > 1 ? 's' : ''}` : ''} →` : `Look in ${y} →`)))));
    return;
  }
  root.dataset.title = p.name;
  const allM = (D.byPlayer[pid] || []).slice().sort((a, b) => a.t - b.t || (ROUND_ORDER[a.rd] || 0) - (ROUND_ORDER[b.rd] || 0));
  const ms = allM.filter(m => passes(m));
  const a = playerAgg(pid, ms);
  const aAll = playerAgg(pid, allM, NO_FILTER);
  const elo = eloNow(pid, null);
  const surfElo = F.surface !== 'all' ? eloNow(pid, F.surface) : null;
  const q = parseHash().params;
  let tab = q.tab || 'overview';
  if (tab === 'hawkeye' && !isAdv()) tab = 'overview';

  // Elo rank among players with 5+ matches overall
  const E = runElo(null);
  const pool = Object.keys(D.byPlayer).filter(x => D.byPlayer[x].length >= 5).map(x => [x, eloNow(x, null)]).filter(x => isNum(x[1])).sort((x, y) => y[1] - x[1]);
  const eloRank = pool.findIndex(x => x[0] === pid) + 1;
  const age = p.dob ? ageOn(p.dob) : null;

  root.appendChild(h('div', { class: 'phero' },
    h('div', { class: 'avatar' }, (p.name || '?').split(' ').map(x => x[0]).slice(0, 2).join(''), flag(p.c)),
    h('div', {},
      h('div', { class: 'eyebrow' }, countryName(p.c) + (p.rk ? ` · ATP #${p.rk}` : ' · Unranked') + (p.hi ? ` (career high #${p.hi})` : '')),
      h('h1', {}, p.name),
      h('div', { class: 'facts' },
        isNum(age) ? h('span', {}, 'Age ', h('b', {}, Math.floor(age))) : null,
        p.ht ? h('span', {}, 'Height ', h('b', {}, p.ht + ' cm')) : null,
        h('span', {}, h('b', {}, handStr(p))),
        p.pro ? h('span', {}, 'Turned pro ', h('b', {}, p.pro)) : null,
        p.bc ? h('span', {}, 'Born ', h('b', {}, p.bc)) : null,
        p.coach ? h('span', {}, 'Coach ', h('b', {}, p.coach)) : null)),
    h('div', { class: 'kpis' },
      kpi('Elo', isNum(elo) ? fmtInt(elo) : '–', !isAdv() && eloAsAtp(elo) ? `plays like ATP #${eloAsAtp(elo)}` : eloRank ? `#${eloRank} on tour` : '', true, 'Rating built from Challenger results: about 1,500 = qualifier level, 1,750 = typical main-draw player, 1,900+ = top-100 form. The rank counts players with 5+ matches'),
      surfElo ? kpi(F.surface + ' Elo', fmtInt(surfElo), '') : null,
      kpi('Record', `${aAll.w}-${aAll.l}`, fmtPct(aAll.w / aAll.m) + ' won'),
      kpi('Titles', String(aAll.titles), `${aAll.finals} finals`),
      kpi('ATP rank', p.rk ? '#' + p.rk : 'NR', p.rk0 ? `#${p.rk0} on ${seedLabel().replace(/ \d{4}$/, '')}` : ''))));
  const sum = summaryText(pid, p, aAll, allM, elo, eloRank, pool);
  if (sum) root.appendChild(h('p', { class: 'p-summary' }, sum));
  if (ms.length !== allM.length) root.appendChild(h('div', { class: 'notice mt' }, `Global filters are active: showing ${ms.length} of ${allM.length} Challenger matches in stats and charts.`));
  // record in other seasons
  let S = null;
  try { S = await lazy('data/seasons.json'); } catch { S = null; }
  if (S) seasonStrip(root, S, pid);
  // next match on the betting slate
  const nextHost = h('div');
  root.appendChild(nextHost);
  lazy('data/betting.json').then(B => {
    const m = (B.matches || []).find(x => x.players.some(p2 => p2.pid === pid) && (!x.start || Date.parse(x.start) > Date.now()));
    if (!m) return;
    const i = m.players[0].pid === pid ? 0 : 1, opp = m.players[1 - i];
    const ourP = i === 0 ? m.our : 1 - m.our, modelP = i === 0 ? m.p : 1 - m.p;
    const best = m.market && m.market.best[i];
    const am = d => { const a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); return a > 0 ? '+' + a : '−' + Math.abs(a); };
    const t = m.start ? new Date(m.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'time TBC';
    nextHost.appendChild(h('div', { class: 'notice mt next-match' },
      h('b', {}, 'Next match: '), `vs ${opp.name} · ${m.city}${m.round ? ' ' + m.round : ''} · ${t}. `,
      `Model ${fmtPct(modelP)}, our line ${fmtPct(ourP)} (fair ${am(1 / ourP)})${best ? `, best price ${am(best.dec)}` : ''}. `,
      h('a', { href: '#/betting?match=' + encodeURIComponent(m.id) }, 'Odds and factors →'),
      opp.pid ? [' · ', h('a', { href: `#/compare?a=${pid}&b=${opp.pid}&surf=${m.surface || 'Hard'}` }, 'Head-to-head →')] : null));
  }).catch(() => {});

  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  root.append(tabsEl, body);
  const drawTabs = () => {
    clear(tabsEl);
    for (const [k, label] of TABS.filter(([k2]) => k2 !== 'hawkeye' || isAdv())) tabsEl.appendChild(h('button', { type: 'button', role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => { tab = k; setQuery({ tab: k }); drawTabs(); show(); } }, label));
    keepTabVisible(tabsEl);
  };
  const show = async () => {
    clear(body);
    if (tab === 'overview') overview(body, pid, ms, a, allM, S);
    else if (tab === 'stats') stats(body, pid, a);
    else if (tab === 'matches') matchesTab(body, pid, ms);
    else if (tab === 'opponents') opponents(body, pid, ms);
    else if (tab === 'events') eventsTab(body, pid, ms);
    else if (tab === 'hawkeye') await hawkeye(body, pid, ms);
  };
  drawTabs();
  await show();
}
/** Dashed line at the player's final Elo of last season (overall Elo only). */
function prevEloRef(S, pid) {
  const r = S && S.players[pid] && S.players[pid][D.season - 1];
  const i = S ? S.cols.indexOf('elo') : -1;
  return F.surface === 'all' && r && isNum(r[i]) ? [{ y: r[i], label: `${D.season - 1} final ${fmtInt(r[i])}` }] : null;
}
/** A few plain sentences: record, level against the ATP ranking, surfaces, recent form and playing style. */
function summaryText(pid, p, a, allM, elo, eloRank, pool) {
  if (!allM.length) return null;
  const last = p.last || p.name;
  const out = [];
  const t = a.titles, fin = a.finals;
  out.push(`${last} is ${a.w}-${a.l} on the Challenger Tour in ${SEASON}` + (t ? `, with ${t} title${t > 1 ? 's' : ''}` : fin ? `, with ${fin} final${fin > 1 ? 's' : ''}` : '') + '.');
  // level: Elo against what players at that ATP ranking usually rate (least-squares line over the tour)
  if (isNum(elo) && eloRank) {
    const pts = pool.map(([x, r]) => [D.players[x]?.rk, r]).filter(([rk]) => rk > 0).map(([rk, r]) => [Math.log10(rk), r]);
    let txt = `Elo, a rating built from this season's results, puts ${last} #${eloRank} of ${fmtInt(pool.length)} regular players`;
    if (p.rk && pts.length > 50) {
      const n = pts.length, mx = pts.reduce((s2, q) => s2 + q[0], 0) / n, my = pts.reduce((s2, q) => s2 + q[1], 0) / n;
      const b = pts.reduce((s2, q) => s2 + (q[0] - mx) * (q[1] - my), 0) / pts.reduce((s2, q) => s2 + (q[0] - mx) ** 2, 0);
      const expct = my + b * (Math.log10(p.rk) - mx), d = elo - expct;
      const typ = fmtInt(Math.round(expct / 10) * 10);
      txt += Math.abs(d) < 50 ? `, in line with an ATP ranking of #${p.rk}` : d > 0 ? `, above the usual level for an ATP #${p.rk} (${fmtInt(elo)} vs about ${typ})`
        : `, below the usual level for an ATP #${p.rk} (${fmtInt(elo)} vs about ${typ})`;
    }
    out.push(txt + '.');
  }
  // surfaces
  const bySurf = {};
  for (const m of allM) { const r = bySurf[m.surface] = bySurf[m.surface] || [0, 0]; r[m.w === pid ? 0 : 1]++; }
  const ss = Object.entries(bySurf).filter(([, r]) => r[0] + r[1] >= 5).sort((x, y) => y[1][0] / (y[1][0] + y[1][1]) - x[1][0] / (x[1][0] + x[1][1]));
  if (ss.length >= 2) out.push(`Best on ${ss[0][0].toLowerCase()} (${ss[0][1][0]}-${ss[0][1][1]}); ${ss.slice(1).map(([sf, r]) => `${r[0]}-${r[1]} on ${sf.toLowerCase()}`).join(', ')}.`);
  else if (ss.length === 1 && ss[0][1][0] + ss[0][1][1] >= allM.length * 0.8) out.push(`Plays mostly on ${ss[0][0].toLowerCase()} courts (${ss[0][1][0]}-${ss[0][1][1]}).`);
  // form
  const recent = allM.slice(-10), wonR = recent.filter(m => m.w === pid).length;
  let streak = 0;
  for (let i = allM.length - 1; i >= 0 && allM[i].w === pid; i--) streak++;
  if (allM.length >= 6) out.push(streak >= 4 ? `On a ${streak}-match winning streak.` : `Won ${wonR} of the last ${recent.length} matches.`);
  // style
  const SP = stylePool(), me = SP.pool.find(x => x.pid === pid);
  if (me && SP.pool.length >= 30) {
    const zm = SP.z(me);
    const traits = STYLE.map(([, hi, lo], i) => ({ z: zm[i], label: zm[i] > 0 ? hi : lo })).filter(x => Math.abs(x.z) >= 1).sort((x, y) => Math.abs(y.z) - Math.abs(x.z)).slice(0, 2);
    if (traits.length) out.push(`Stands out: ${traits.map(x => x.label.toLowerCase()).join(', ')}.`);
  }
  return out.join(' ');
}
function seasonStrip(host, S, pid) {
  const rec = S.players[pid];
  if (!rec || Object.keys(rec).length < 2) return;
  const C = Object.fromEntries(S.cols.map((c, i) => [c, i]));
  host.appendChild(h('div', { class: 'season-strip mt' }, h('span', { class: 'ss-label' }, 'Seasons'),
    S.seasons.filter(y => rec[y]).map(y => {
      const r = rec[y], t = r[C.titles];
      const inner = [h('b', {}, String(y)), h('span', {}, `${r[C.w]}-${r[C.l]}`), t ? h('span', {}, `${t} title${t > 1 ? 's' : ''}`) : null,
        isNum(r[C.elo]) ? h('span', { class: 'muted' }, `${y === S.seasons[0] ? 'Elo' : 'final Elo'} ${fmtInt(r[C.elo])}`) : null];
      return y === SEASON ? h('span', { class: 'ss-item on' }, inner)
        : h('a', { class: 'ss-item', href: seasonHref(y, '#/player/' + pid), title: `Open the ${y} profile` }, inner, h('span', { class: 'muted' }, '→'));
    })));
}
function kpi(k, v, sub, lead, title) { return h('div', { class: 'kpi' + (lead ? ' lead' : ''), title: title || null }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'muted', style: { fontSize: '12px' } }, sub) : null); }

function overview(body, pid, ms, a, allM, S) {
  const E = runElo(null);
  const tl = E.tl.get(pid) || [];
  const series = [{ name: 'Elo (all surfaces)', color: 'var(--series-1)', area: F.surface === 'all', values: tl.map(([t, r, m]) => ({ x: t, y: r, m })) }];
  if (F.surface !== 'all') {
    const tls = runElo(F.surface).tl.get(pid) || [];
    series.push({ name: F.surface + ' Elo', color: 'var(--series-2)', values: tls.map(([t, r, m]) => ({ x: t, y: r, m })) });
  }
  const g = h('div', { class: 'grid g-21' });
  g.appendChild(card('Elo rating through the season', 'One point per match; hover for the result', el => lineChart(el, {
    series, xType: 'time', yFmt: fmtInt, height: 260, markers: tl.length < 60, endLabels: true, endFmt: v => fmtInt(v), refY: prevEloRef(S, pid),
    tipTitle: pt => pt.m ? `${fmtDate(pt.m.date)} · ${pt.m.e?.city || ''} ${pt.m.rd}` : '',
    tipNote: pt => pt.m ? `${pt.m.w === pid ? 'W' : 'L'} vs ${D.players[pt.m.w === pid ? pt.m.l : pt.m.w]?.name || ''} ${pt.m.w === pid ? pt.m.score : ''}` : '',
    onClick: pt => pt.m && (location.hash = '#/match/' + pt.m.id),
  }), { table: () => ({ cols: ['Date', 'Event', 'Round', 'Result', 'Elo after'], rows: tl.map(([t, r, m]) => [m.date, m.e?.city, m.rd, m.w === pid ? 'W' : 'L', Math.round(r)]) }) }));
  const rkHost = card('ATP ranking history', 'Official weekly ranking (higher on the chart = better)', h('div', { class: 'empty' }, 'Loading…'));
  g.appendChild(rkHost);
  lazy('data/rankings.json').then(R => {
    const ranks = R.ranks[pid];
    const body2 = rkHost.querySelector('.card-body');
    clear(body2);
    const vals = (ranks || []).map((r, i) => r ? { x: Date.parse(R.weeks[i]), y: -r } : null).filter(Boolean);
    if (!vals.length) { body2.appendChild(h('div', { class: 'empty' }, `No ATP ranking in ${SEASON}`)); return; }
    lineChart(body2, { series: [{ name: 'ATP rank', color: 'var(--series-1)', values: vals, area: true }], xType: 'time', yFmt: v => '#' + fmtInt(-v), height: 260, endLabels: true, endFmt: v => '#' + (-v) });
  }).catch(() => { clear(rkHost.querySelector('.card-body')).appendChild(h('div', { class: 'empty' }, 'Ranking history unavailable')); });
  body.appendChild(g);

  // results split
  const g2 = h('div', { class: 'grid g3 mt' });
  const surfRows = SURFACES.filter(s => a.bySurface[s]).map(s => ({ label: s, parts: { w: a.bySurface[s][0], l: a.bySurface[s][1] } }));
  const resultKeys = [{ key: 'w', label: 'Won', color: 'var(--series-1)' }, { key: 'l', label: 'Lost', color: 'var(--series-2)' }];
  g2.appendChild(card('Record by surface', null, el => surfRows.length ? stackBars(el, { rows: surfRows.map(r => ({ label: `${r.label} (${r.parts.w}-${r.parts.l})`, parts: r.parts })), keys: resultKeys }) : el.appendChild(h('div', { class: 'empty' }, 'No matches'))));
  const rounds = Object.keys(a.byRound).sort((x, y) => (ROUND_ORDER[x] || 0) - (ROUND_ORDER[y] || 0));
  g2.appendChild(card('Record by round', null, el => rounds.length ? stackBars(el, { rows: rounds.map(r => ({ label: `${r} (${a.byRound[r][0]}-${a.byRound[r][1]})`, parts: { w: a.byRound[r][0], l: a.byRound[r][1] } })), keys: resultKeys, labelWidth: 110 }) : null));
  const months = {};
  for (const m of ms) { const k = m.date.slice(0, 7); const x = months[k] || (months[k] = { w: 0, l: 0 }); m.w === pid ? x.w++ : x.l++; }
  g2.appendChild(card('Matches by month', null, el => columnChart(el, {
    data: Object.keys(months).sort().map(k => ({ label: MONTHS[+k.slice(5) - 1], parts: months[k] })), stacked: resultKeys, fmt: fmtInt, height: 200,
  })));
  body.appendChild(g2);

  // best wins + streaks
  const g2b = h('div', { class: 'grid g2 mt' });
  const wins = ms.filter(m => m.w === pid && isNum(m.lElo)).sort((x, y) => y.lElo - x.lElo).slice(0, 6);
  g2b.appendChild(card('Best wins', 'Opponents beaten, ranked by their Elo rating going into the match', wins.length ? h('ul', { class: 'list-plain' },
    wins.map(m => h('li', {}, playerLink(m.l, { short: true, rank: m.lRank }),
      h('a', { href: '#/match/' + m.id, class: 'muted', style: { fontSize: '12px' } }, `${m.e?.city || ''} ${m.rd} · ${m.score}`),
      h('span', { class: 'val' }, fmtInt(m.lElo))))) : h('div', { class: 'empty' }, 'No wins in view')));
  let cur = 0, curW = null, best = 0, run = 0;
  for (const m of ms) {
    const won = m.w === pid;
    run = won ? run + 1 : 0; best = Math.max(best, run);
    if (curW === won) cur++; else { curW = won; cur = 1; }
  }
  const formKv = h('dl', { class: 'kv' },
    h('dt', {}, 'Current streak'), h('dd', {}, ms.length ? h('span', { class: curW ? 'win-mark' : '' }, `${cur} ${curW ? (cur === 1 ? 'win' : 'wins') : (cur === 1 ? 'loss' : 'losses')}`) : '–'),
    h('dt', {}, 'Longest winning run'), h('dd', {}, `${best} matches`),
    h('dt', {}, 'Last 10'), h('dd', {}, `${ms.slice(-10).filter(m => m.w === pid).length}-${ms.slice(-10).filter(m => m.l === pid).length}`),
    h('dt', {}, 'Deciding sets'), h('dd', {}, `${a.decW}-${a.decL}`),
    h('dt', {}, 'Tiebreaks'), h('dd', {}, `${a.tbW}-${a.tbL}`),
    h('dt', {}, 'Won from a set down'), h('dd', {}, `${a.firstSetLostW} of ${a.firstSetLostM} matches`),
    h('dt', {}, 'Lost after winning set 1'), h('dd', {}, `${a.firstSetWonM - a.firstSetWonW} of ${a.firstSetWonM} matches`),
    h('dt', {}, 'vs top-100 opponents'), h('dd', {}, `${a.vsTop100[0]}-${a.vsTop100[1]}`),
    h('dt', {}, 'Wins vs Elo expectation'), h('dd', {}, a.expN ? `${a.w - a.expW >= 0 ? '+' : ''}${fmt1(a.w - a.expW)} (expected ${fmt1(a.expW)} wins)` : '–'));
  g2b.appendChild(card('Form & streaks', 'Under the current filters', formKv));
  body.appendChild(g2b);
  // escapes and slip-ups from the win-probability line of every match (pipeline/drama.py)
  lazy('data/drama.json').then(dr => {
    const wins = ms.filter(m => m.w === pid && dr.byMatch[m.id]), losses = ms.filter(m => m.l === pid && dr.byMatch[m.id]);
    if (!wins.length && !losses.length) return;
    const esc = wins.filter(m => dr.byMatch[m.id][0] < 0.1), mpw = wins.filter(m => dr.byMatch[m.id][1] > 0);
    const slip = losses.filter(m => dr.byMatch[m.id][0] < 0.1);
    const best = esc.slice().sort((x, y) => dr.byMatch[x.id][0] - dr.byMatch[y.id][0])[0];
    const link = m => h('a', { href: '#/match/' + m.id + '?tab=flow' }, `vs ${D.players[m.l === pid ? m.w : m.l]?.short || ''}`);
    formKv.append(
      h('dt', { title: 'Wins after the chance of winning fell below 10% at some point' }, 'Great escapes'), h('dd', {}, `${esc.length}`, best ? [' · best ', link(best), ` (${fmtPct(dr.byMatch[best.id][0])})`] : ''),
      h('dt', {}, 'Won from match point down'), h('dd', {}, (() => { const n = mpw.reduce((s2, m) => s2 + dr.byMatch[m.id][1], 0); return `${mpw.length}${n ? ` (${n} match point${n === 1 ? '' : 's'} saved)` : ''}`; })()),
      h('dt', { title: 'Losses after holding a 90%+ chance of winning' }, 'Slipped from 90%+'), h('dd', {}, String(slip.length)));
    const c = dr.clutch && dr.clutch[pid];
    if (c) {
      const [n, won, exp, bn, bw, be, cl] = c;
      formKv.append(h('dt', { title: 'Big points: the point winner gains 10+ points of win probability. Clutch = beat the model on big points minus on all points. Full season; mostly luck over one year (see Insights).' }, 'Big points (season)'),
        h('dd', {}, `won ${fmtPct(bw / bn)} of ${fmtInt(bn)} (model ${fmtPct(be / bn)}) · clutch `, h('span', { class: cl >= 0 ? 'pos' : 'neg' }, `${cl >= 0 ? '+' : '−'}${fmt1(Math.abs(cl) * 100)}`)));
    }
  }).catch(() => {});

  // key stats + recent
  const g3 = h('div', { class: 'grid g-12 mt' });
  g3.appendChild(card('Key numbers', 'Percentile vs players with 10+ matches in view', metricList(a, [
    ['Serve', ['hold', 'spw', 'acePct', 'firstWon', 'secondWon']], ['Return', ['brk', 'rpw', 'r2']], ['Overall', ['dr', 'tpw', 'bpSaved', 'bpConv']],
  ])));
  g3.appendChild(card('Recent matches', null, h('div', {}, dataTable({
    rows: ms.slice().reverse().slice(0, 12), sortKey: 'date', pageSize: 12, sticky: false, compact: true, cols: matchCols(pid).filter(c => !['mins', 'tags'].includes(c.key)),
    onRowClick: m => { location.hash = '#/match/' + m.id; },
  }))));
  body.appendChild(g3);
  const sc = styleCard(pid);
  if (sc) body.appendChild(h('div', { class: 'mt' }, sc));
}

// ---------- playing style and statistically similar players (see style.js) ----------
function styleCard(pid) {
  const { pool, z, pctile } = stylePool();
  const me = pool.find(a => a.pid === pid);
  if (!me || pool.length < 30) return null;
  const zm = z(me);
  const traits = STYLE.map(([k, hi, lo], i) => ({ k, i, z: zm[i], label: zm[i] > 0 ? hi : lo, v: METRICS[k].val(me) }))
    .filter(t => Math.abs(t.z) >= 0.9).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 4);
  const sims = pool.filter(a => a.pid !== pid).map(a => ({ a, like: likeness(z(a), zm) })).sort((x, y) => y.like - x.like).slice(0, 6);
  return card('Style and comparables', `How ${D.players[pid]?.short} wins and loses points compared with ${fmtInt(pool.length)} players with 15+ matches in view, and the most similar statistical profiles`,
    h('div', { class: 'grid g2 style-grid' },
      h('div', {}, h('div', { class: 'mgroup' }, 'Stands out for'),
        traits.length ? h('ul', { class: 'list-plain' }, traits.map(t => h('li', {}, h('span', {}, t.label), h('span', { class: 'muted', style: { fontSize: '12px' } }, ` ${METRICS[t.k].label.toLowerCase()} ${METRICS[t.k].fmt(t.v)}`),
          h('span', { class: 'val' }, `${t.z > 0 ? 'top' : 'bottom'} ${Math.max(1, Math.round(100 * (t.z > 0 ? 1 - pctile(t.i, t.v) : pctile(t.i, t.v))))}%`))))
          : h('p', { class: 'muted' }, 'A balanced profile: no serve, return or pressure number far from the tour norm.')),
      h('div', {}, h('div', { class: 'mgroup' }, 'Most similar profiles'),
        h('ul', { class: 'list-plain' }, sims.map(x => h('li', {}, playerLink(x.a.pid, { short: true }),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, ` ${x.a.w}-${x.a.l}`),
          h('span', { class: 'val' }, h('a', { href: `#/compare?a=${pid}&b=${x.a.pid}`, class: 'muted', style: { fontSize: '12px' } }, `${fmtInt(100 * x.like)}% alike →`))))))));
}

function stats(body, pid, a) {
  const tour = tourAgg(filtered());
  const groups = [
    ['Serve', ['serveRating', 'acePct', 'dfPct', 'firstIn', 'firstWon', 'secondWon', 'spw', 'hold', 'bpFacedPerSg', 'firstPt', 'loveHold']],
    ['Return', ['returnRating', 'rpw', 'r1', 'r2', 'brk', 'bpOppPerRg', 'oppAce']],
    ['Overall', ['tpw', 'dr', 'setsPct', 'gamesPct', 'overExp', 'vsTop100', 'vsHigher', 'minsPerM']],
    ['Pressure', ['pressureRating', 'bpSaved', 'bpConv', 'tbPct', 'decPct', 'bigServe', 'bigReturn', 'clutch', 'comeback', 'closeOut']],
    ['Point endings (umpire-logged)', ['winnersPerM', 'uePerM', 'wUe', 'winnerPct', 'uePct', 'feInduced', 'aggression', 'fhWue', 'bhWue', 'fhShare']],
    ['Rally & speed (Hawk-Eye tracked)', ['rally4', 'rally8', 'rally9', 'avgRally', 'netPct', 'netFreq', 'v1', 'v2', 'vmax']],
  ];
  const g = h('div', { class: 'grid g2' });
  if (!isAdv()) {        // simple mode: the core numbers, with where they rank on tour
    const simple = [['Serve', ['acePct', 'firstIn', 'firstWon', 'secondWon', 'hold']], ['Return', ['rpw', 'brk']],
      ['Results', ['setsPct', 'vsTop100', 'comeback']], ['Pressure', ['bpSaved', 'bpConv', 'tbPct', 'decPct']]];
    g.appendChild(card('Scouting report', 'Each number and its percentile among players with 10+ matches: 90th = better than 90% of them', metricList(a, simple.slice(0, 2))));
    g.appendChild(card('Results and big moments', 'Sets, wins against the top 100, comebacks and the scoreboard pressure points', metricList(a, simple.slice(2), { color: 'var(--series-3)' })));
  } else {
    g.appendChild(card('Scouting report', 'Value · percentile among players with 10+ matches under the current filters', metricList(a, groups.slice(0, 3))));
    g.appendChild(card('Pressure, style & tracking', 'Point-ending data covers matches with ≥80% of points classified; rally & speed only Hawk-Eye matches', metricList(a, groups.slice(3), { color: 'var(--series-3)' })));
  }
  body.appendChild(g);
  // Player vs tour average
  const keys = ['acePct', 'firstIn', 'firstWon', 'secondWon', 'hold', 'rpw', 'brk', 'bpSaved', 'bpConv', 'winnersPerM', 'uePerM'];
  body.appendChild(h('div', { class: 'mt' }, card('Against the tour average', 'Blue = this player, orange = tour average under the same filters', h('div', {},
    h('div', { class: 'cmp-head' }, h('b', {}, D.players[pid].short), h('span', { class: 'muted' }, ''), h('b', { class: 'b' }, 'Tour average')),
    keys.map(k => compareRow(METRICS[k].label, mval(k, a), mval(k, tour), METRICS[k].fmt, { better: METRICS[k].dir }))))));
  // serving at each game score (full season, from the point-by-point record)
  const sgHost = h('div', { class: 'mt' });
  body.appendChild(sgHost);
  if (isAdv()) lazy('data/serve_states.json').then(S => {
    const mine = S.players[pid], tourCells = S.players._tour;
    if (!mine) return;
    const n = mine.reduce((x, c) => x + c[0], 0), w = mine.reduce((x, c) => x + c[1], 0);
    const g2 = h('div', { class: 'grid g2' });
    g2.appendChild(card('Serving by score', `Service points won at each game score, compared with ${D.players[pid].short}'s own average (${fmtPct(w / n)} of ${fmtInt(n)} points). Green = better than usual. Full season, all matches with point data.`,
      scoreGrid({ states: S.states, cells: mine, relative: true, refLabel: 'own average' })));
    g2.appendChild(card('…and against the tour', 'The same grid compared with every server on the tour at that score. Strong servers are green everywhere; the shape of the grid is what tells you about nerves.',
      scoreGrid({ states: S.states, cells: mine, ref: tourCells, refLabel: 'tour' })));
    sgHost.appendChild(g2);
  }).catch(() => {});
}

function matchesTab(body, pid, ms) {
  const st = { res: 'all', surf: 'all' };
  const host = h('div', { class: 'mt' });
  body.append(h('div', { class: 'row' },
    segmented([['all', 'All'], ['w', 'Wins'], ['l', 'Losses']], 'all', v => { st.res = v; draw(); }),
    segmented([['all', 'Any surface'], ...SURFACES.filter(s => ms.some(m => m.surface === s)).map(s => [s, s])], 'all', v => { st.surf = v; draw(); })), host);
  const draw = () => {
    const rows = ms.filter(m => (st.res === 'all' || (st.res === 'w' ? m.w === pid : m.l === pid)) && (st.surf === 'all' || m.surface === st.surf));
    clear(host).appendChild(dataTable({ rows, sortKey: 'date', pageSize: 50, cols: matchCols(pid), csvName: `${pid}-matches.csv`, onRowClick: m => { location.hash = '#/match/' + m.id; } }));
  };
  draw();
}

function opponents(body, pid, ms) {
  const map = new Map();
  for (const m of ms) {
    const o = m.w === pid ? m.l : m.w;
    const r = map.get(o) || { o, w: 0, l: 0, last: null, ms: [] };
    m.w === pid ? r.w++ : r.l++;
    r.ms.push(m); r.last = m;
    map.set(o, r);
  }
  const bands = [[1, 100, 'Top 100'], [101, 200, '101-200'], [201, 350, '201-350'], [351, 600, '351-600'], [601, 99999, '601+'], [null, null, 'Unranked']];
  const bandRows = bands.map(([lo, hi, label]) => {
    const sel = ms.filter(m => { const r = m.w === pid ? m.lRank : m.wRank; return lo == null ? !r : r >= lo && r <= hi; });
    return { label: `${label} (${sel.filter(m => m.w === pid).length}-${sel.filter(m => m.l === pid).length})`, parts: { w: sel.filter(m => m.w === pid).length, l: sel.filter(m => m.l === pid).length } };
  }).filter(r => r.parts.w + r.parts.l);
  const g = h('div', { class: 'grid g-12' });
  g.appendChild(card('Record by opponent ranking', 'Opponent ATP rank at the time of the match', el => stackBars(el, { rows: bandRows, keys: [{ key: 'w', label: 'Won', color: 'var(--series-1)' }, { key: 'l', label: 'Lost', color: 'var(--series-2)' }], labelWidth: 130 })));
  g.appendChild(card('Head-to-head records', `${map.size} different opponents`, h('div', {}, dataTable({
    rows: [...map.values()], sortKey: 'n', pageSize: 25, sticky: false, compact: true, cols: [
      { key: 'o', label: 'Opponent', get: r => D.players[r.o]?.name, render: r => playerLink(r.o), sortDir: 1 },
      { key: 'n', label: 'Played', align: 'r', get: r => r.w + r.l },
      { key: 'rec', label: 'W-L', align: 'r', get: r => r.w - r.l, render: r => `${r.w}-${r.l}` },
      { key: 'last', label: 'Last meeting', get: r => r.last.t, render: r => h('a', { href: '#/match/' + r.last.id }, `${fmtDate(r.last.date)} · ${r.last.e?.city} ${r.last.rd}`) },
      { key: 'cmp', label: '', get: false, render: r => h('a', { href: `#/compare?a=${pid}&b=${r.o}`, class: 'btn-ghost sm' }, 'Compare') },
    ],
  }))));
  body.appendChild(g);
}

function eventsTab(body, pid, ms) {
  const map = new Map();
  for (const m of ms) {
    const r = map.get(m.eid) || { e: m.e, w: 0, l: 0, best: null, lostTo: null, ms: [] };
    m.w === pid ? r.w++ : r.l++;
    r.ms.push(m);
    if (!r.best || (ROUND_ORDER[m.rd] || 0) >= (ROUND_ORDER[r.best.rd] || 0)) r.best = m;
    map.set(m.eid, r);
  }
  const rows = [...map.values()].map(r => {
    const last = r.best, e = r.e;
    const champ = e.champ === pid, runner = e.runner === pid;
    const result = champ ? 'Champion' : runner ? (e.finalWO ? 'Runner-up (walkover)' : 'Runner-up')
      : last.w === pid ? (e.status === 'live' ? `Won ${last.rd} · still in` : `Won ${last.rd}`) : 'Lost ' + last.rd;
    const lostTo = champ ? null : runner && e.finalWO ? e.champ : last.w === pid ? null : last.w;
    return { ...r, result, lostTo, order: (ROUND_ORDER[last.rd] || 0) + (champ ? 3 : runner ? 2 : 0) };
  });
  const runs = rows.slice().sort((x, y) => (x.e.start || '').localeCompare(y.e.start || ''));
  // pre-draw title chance at each event he played in the main draw (Elo + the draw)
  for (const r of runs) {
    if (!r.ms.some(m => !m.q)) continue;
    const tree = drawTree((r.e.matches || []).filter(m => !m.q));
    if (!tree) continue;
    const t = titleOdds(tree, 'pre').title;
    if (t.has(pid)) r.titleP = t.get(pid);
  }
  const withOdds = runs.filter(r => isNum(r.titleP) && r.e.status !== 'live');
  const expTitles = withOdds.reduce((a2, r) => a2 + r.titleP, 0), titles = withOdds.filter(r => r.e.champ === pid).length;
  body.appendChild(card('Tournament runs', `${rows.length} events` + (withOdds.length ? ` · ${titles} title${titles === 1 ? '' : 's'} from ${fmt1(expTitles)} expected by pre-draw odds (${withOdds.length} completed main draws)` : ''), h('div', {}, dataTable({
    rows: runs, sortKey: 'date', sortDir: -1, pageSize: 50, sticky: false, cols: [
      { key: 'date', label: 'Week', get: r => r.e.start, render: r => fmtDate(r.e.start) },
      { key: 'ev', label: 'Tournament', get: r => r.e.city, render: r => h('span', {}, surfaceDot(r.e.surface), eventLink(r.e), h('span', { class: 'muted' }, ` · ${r.e.cat || ''} · ${r.e.surface}`)), sortDir: 1 },
      { key: 'order', label: 'Result', render: r => r.result === 'Champion' ? h('span', { class: 'badge title' }, 'CHAMPION') : r.result },
      { key: 'rec', label: 'W-L', align: 'r', get: r => r.w - r.l, render: r => `${r.w}-${r.l}` },
      { key: 'lostTo', label: 'Lost to', get: r => r.lostTo ? D.players[r.lostTo]?.name : '', render: r => r.lostTo ? playerLink(r.lostTo, { short: true }) : '–' },
      { key: 'titleP', label: 'Title odds', title: 'Chance of winning the title before the main draw (Elo and the draw)', align: 'r', get: r => r.titleP, fmt: v => (isNum(v) ? (v < 0.001 ? '<0.1%' : fmtPct(v)) : '–') },
    ], onRowClick: r => { location.hash = '#/tournament/' + r.e.id; },
  }))));
}

const OUT_COL = { A: 'var(--series-1)', W: 'var(--series-3)', L: 'var(--series-2)', F: 'var(--muted)' };
const OUT_LABEL = { A: 'Ace', W: 'Point won', L: 'Point lost', F: 'Fault' };
async function hawkeye(body, pid, ms) {
  const cvMs = ms.filter(m => m.hasCV);
  if (!cvMs.length) {
    body.appendChild(h('div', { class: 'card' }, h('h3', {}, 'No Hawk-Eye tracked matches'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'CourtVision ball-tracking is only recorded at Challenger events with Hawk-Eye Live installed. This player has no tracked matches under the current filters.')));
    return;
  }
  body.appendChild(h('div', { class: 'empty' }, 'Loading Hawk-Eye data…'));
  let data;
  try { data = await lazy(`data/cvp/${pid}.json`); } catch { clear(body).appendChild(h('div', { class: 'empty' }, 'No tracking file for this player.')); return; }
  const allowed = new Set(cvMs.map(m => m.id));
  const serves = data.serves.filter(r => allowed.has(r[8]));
  const shots = data.shots.filter(r => allowed.has(r[13]));
  clear(body);
  body.appendChild(h('p', { class: 'muted', style: { marginBottom: '12px' } }, `${cvMs.length} tracked matches · ${serves.length} serves · ${shots.length} point-ending shots (winners & errors).`));
  const st = { sn: '1', court: 'all', show: 'in' };
  const g = h('div', { class: 'grid g2' });
  const serveCard = card('Serve placement', 'Where serves bounce in the receiver’s box (seen from behind the server)', null, {
    actions: h('div', { class: 'row', style: { gap: '6px' } },
      segmented([['1', '1st'], ['2', '2nd']], st.sn, v => { st.sn = v; drawServe(); }),
      segmented([['all', 'Both'], ['0', 'Deuce'], ['1', 'Ad']], st.court, v => { st.court = v; drawServe(); }),
      segmented([['in', 'In play'], ['fault', 'Faults']], st.show, v => { st.show = v; drawServe(); })),
  });
  const zoneCard = card('Placement & effectiveness', 'Share of serves in play by target zone, with points won and speed', null);
  g.append(serveCard, zoneCard);
  body.appendChild(g);
  function drawServe() {
    const cb = clear(serveCard.querySelector('.card-body'));
    const sel = serves.filter(r => String(r[2]) === st.sn && (st.court === 'all' || String(r[3]) === st.court) && (st.show === 'fault' ? r[4] === 'F' : r[4] !== 'F'));
    const kinds = st.show === 'fault' ? ['F'] : ['A', 'W', 'L'];
    cb.appendChild(h('div', { class: 'legend' }, kinds.map(k => h('span', { class: 'lg-item' }, h('span', { class: 'lg-dot', style: { background: OUT_COL[k] } }), `${OUT_LABEL[k]} (${sel.filter(r => r[4] === k).length})`))));
    court(cb, {
      mode: 'half', zones: true, maxWidth: 420,
      points: sel.map(r => ({ x: r[0], y: r[1], color: OUT_COL[r[4]], r: 3.6, tip: { title: `${OUT_LABEL[r[4]]} · ${r[2] === 1 ? '1st' : '2nd'} serve`, rows: [{ value: r[5] ? fmtInt(r[5]) + ' km/h' : '–', label: 'speed' }, { value: ZONE_NAMES[r[7]] || '–', label: 'zone' }], note: `vs ${D.players[r[9]]?.name || ''}` } })),
    });
    // zone table
    const zb = clear(zoneCard.querySelector('.card-body'));
    const inPlay = serves.filter(r => String(r[2]) === st.sn && r[4] !== 'F' && (st.court === 'all' || String(r[3]) === st.court));
    const rows = ['W', 'B', 'T'].map(z => {
      const zr = inPlay.filter(r => r[7] === z);
      const won = zr.filter(r => r[4] === 'A' || r[4] === 'W').length;
      const sp = zr.filter(r => r[5]);
      return { z, n: zr.length, share: ratio(zr.length, inPlay.length), won: ratio(won, zr.length), aces: zr.filter(r => r[4] === 'A').length, speed: ratio(sp.reduce((s, r) => s + r[5], 0), sp.length) };
    });
    zb.appendChild(dataTable({ rows, sortKey: 'n', sticky: false, compact: true, pageSize: 5, cols: [
      { key: 'z', label: 'Zone', render: r => ZONE_NAMES[r.z], get: false },
      { key: 'share', label: 'Share', align: 'r', fmt: fmtPct }, { key: 'n', label: 'Serves', align: 'r' },
      { key: 'won', label: 'Pts won', align: 'r', fmt: fmtPct }, { key: 'aces', label: 'Aces', align: 'r' },
      { key: 'speed', label: 'Avg km/h', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
    ] }));
    const att = serves.filter(r => String(r[2]) === st.sn && (st.court === 'all' || String(r[3]) === st.court));
    const faults = att.filter(r => r[4] === 'F');
    const ft = { L: 0, W: 0, N: 0 };
    for (const r of faults) { const x = r[0], y = r[1]; if (Math.abs(x) > 6.4) ft.L++; else if (Math.abs(y) > 4.115) ft.W++; else ft.N++; }
    zb.appendChild(h('div', { class: 'mt' }, h('div', { class: 'mgroup' }, 'Serve outcome mix'),
      h('div', { class: 'kv' },
        h('dt', {}, 'In play'), h('dd', {}, `${fmtPct(ratio(att.length - faults.length, att.length))} of ${att.length} attempts`),
        h('dt', {}, 'Faults'), h('dd', {}, `${faults.length} · long ${ft.L} · wide ${ft.W} · net ${ft.N}`),
        h('dt', {}, 'Aces'), h('dd', {}, String(att.filter(r => r[4] === 'A').length)))));
  }
  drawServe();

  // shot endings
  const st2 = { end: 'W', hand: 'all' };
  const g2 = h('div', { class: 'grid g2 mt' });
  const shotCard = card('Point-ending shots', 'Bounce location of winners and errors (opponent’s half, seen from behind this player)', null, {
    actions: h('div', { class: 'row', style: { gap: '6px' } },
      segmented([['W', 'Winners'], ['U', 'Unforced'], ['E', 'Forced']], st2.end, v => { st2.end = v; drawShots(); }),
      segmented([['all', 'Both'], ['F', 'Forehand'], ['B', 'Backhand']], st2.hand, v => { st2.hand = v; drawShots(); })),
  });
  const mixCard = card('Shot mix', 'Winners and errors by stroke', null);
  g2.append(shotCard, mixCard);
  body.appendChild(g2);
  const END_COL = { W: 'var(--series-1)', U: 'var(--series-2)', E: 'var(--series-3)' };
  const STROKE = { G: 'Groundstroke', V: 'Volley', P: 'Passing shot', O: 'Overhead', D: 'Drop shot', L: 'Lob' };
  function drawShots() {
    const cb = clear(shotCard.querySelector('.card-body'));
    const sel = shots.filter(r => r[5] === st2.end && (st2.hand === 'all' || r[7] === st2.hand));
    cb.appendChild(h('p', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } }, `${sel.length} shots · avg speed ${fmtInt(avg(sel.map(r => r[9])))} km/h · avg net clearance ${fmt2(avg(sel.map(r => r[11]).filter(v => isNum(v) && v > -1)))} m`));
    court(cb, {
      mode: 'half', maxWidth: 420,
      points: sel.map(r => ({ x: r[3], y: r[4], color: END_COL[r[5]], r: 3.6, tip: { title: `${STROKE[r[6]] || 'Shot'} ${r[7] === 'F' ? 'forehand' : r[7] === 'B' ? 'backhand' : ''}`, rows: [{ value: r[9] ? fmtInt(r[9]) + ' km/h' : '–', label: 'speed' }, { value: isNum(r[11]) ? fmt2(r[11]) + ' m' : '–', label: 'over net' }, { value: r[12] ?? '–', label: 'rally shots' }], note: `vs ${D.players[r[14]]?.name || ''}` } })),
    });
  }
  drawShots();
  const mb = mixCard.querySelector('.card-body');
  const strokes = ['G', 'V', 'P', 'O', 'D', 'L'];
  const mixRows = [];
  for (const hand of ['F', 'B']) for (const sk of strokes) {
    const sel = shots.filter(r => r[6] === sk && r[7] === hand);
    if (sel.length < 2) continue;
    mixRows.push({ label: `${hand === 'F' ? 'FH' : 'BH'} ${STROKE[sk].toLowerCase()}`, parts: { W: sel.filter(r => r[5] === 'W').length, E: sel.filter(r => r[5] === 'E').length, U: sel.filter(r => r[5] === 'U').length } });
  }
  stackBars(mb, { rows: mixRows, keys: [{ key: 'W', label: 'Winners', color: END_COL.W }, { key: 'E', label: 'Forced errors', color: END_COL.E, dark: true }, { key: 'U', label: 'Unforced errors', color: END_COL.U }], labelWidth: 150, fmt: (v, tot) => `${v} (${Math.round(100 * v / tot)}%)` });
  const winnersDir = shots.filter(r => r[5] === 'W' && r[8]);
  if (winnersDir.length) mb.appendChild(h('div', { class: 'kv mt' },
    h('dt', {}, 'Winners cross-court'), h('dd', {}, fmtPct(ratio(winnersDir.filter(r => r[8] === 'C').length, winnersDir.length))),
    h('dt', {}, 'Winners down the line'), h('dd', {}, fmtPct(ratio(winnersDir.filter(r => r[8] === 'L').length, winnersDir.length)))));
}
const avg = arr => { const v = arr.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
