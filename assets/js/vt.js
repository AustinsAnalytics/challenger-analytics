// "Ball tracking" tab: shot-by-shot data measured from the broadcast video (tennis-vision) for matches without
// Hawk-Eye, lined up with ATP's official point-by-point record (pipeline/vision.py writes data/vt/<match>.json).
import { h, clear, fmtInt, fmtPct, fmt1, isNum, csvDownload } from './util.js';
import { D } from './data.js';
import { card, compareRow, columnChart, stackBars, lineChart, scatter } from './charts.js';
import { court } from './court.js';
import { dataTable } from './table.js';
import { segmented, tiles } from './components.js';

const CA = 'var(--series-1)', CB = 'var(--series-2)';
const COLS = [CA, CB];
const BL = 11.885;
const STROKE = { S: 'Serve', F: 'Forehand', B: 'Backhand', FS: 'Forehand slice', BS: 'Backhand slice', FV: 'Forehand volley', BV: 'Backhand volley',
  FD: 'Forehand drop shot', BD: 'Backhand drop shot', O: 'Overhead', FL: 'Forehand lob', BL: 'Backhand lob', L: 'Lob', G: 'Drive', SL: 'Slice', V: 'Volley', D: 'Drop shot', U: 'Unclassified' };
const ENDING = { A: 'Ace', D: 'Double fault', W: 'Winner', U: 'Unforced error', F: 'Forced error', N: '–' };
const LAST = { G: 'groundstroke', V: 'volley', P: 'passing shot', D: 'drop shot', L: 'lob', O: 'overhead', A: 'approach' };
const SPIN = { T: 'Topspin', F: 'Flat', S: 'Slice' };
const LAND = { I: 'In', O: 'Out', N: 'Net', X: 'Fault' };
const DIR = { C: 'Crosscourt', M: 'Middle', D: 'Down the line' };
const SDIR = { W: 'Wide', B: 'Body', T: 'T' };

const kmh = v => (isNum(v) ? fmtInt(v) + ' km/h' : '–');
const metres = v => (isNum(v) ? fmt1(v) + ' m' : '–');
const cm = v => (isNum(v) ? fmtInt(v * 100) + ' cm' : '–');
const pc = v => (isNum(v) ? fmtPct(v) : '–');
const isFh = st => ['F', 'FS', 'FV', 'FD', 'FL'].includes(st);
const isBh = st => ['B', 'BS', 'BV', 'BD', 'BL'].includes(st);

export function trackingTab(body, m, VT) {
  const names = VT.players.map((p, i) => (p.pid && D.players[p.pid]?.short) || p.name.split(' ').slice(-1)[0] || ['A', 'B'][i]);
  const shots = VT.shots.map(r => Object.fromEntries(VT.shotCols.map((k, i) => [k, r[i]])));
  const pts = VT.points;
  const A = VT.stats.all[0], B = VT.stats.all[1];
  const v = VT.validation || {};
  const head = (title, sub) => h('div', { class: 'cmp-head' }, h('b', {}, names[0]), h('span', { class: 'muted' }, sub || ''), h('b', { class: 'b' }, names[1]));

  // ---------- intro, coverage and downloads
  const withSpeed = shots.filter(s => isNum(s.spd)).length, withBounce = shots.filter(s => isNum(s.bx)).length;
  body.appendChild(h('div', { class: 'notice vt-intro' },
    h('b', {}, 'Measured from the broadcast video. '),
    `There was no Hawk-Eye at this event, so every shot below was tracked from the Challenger TV broadcast with computer vision (ball and court detection, a 3D fit of each ball flight, and both players' positions in every frame). `,
    `The score, server, winner, first or second serve and how each point ended come from ATP's official point-by-point record; the video lines up with it on ${fmtInt(v.matched || 0)} of ${fmtInt(v.atp_points || pts.length)} points `,
    `(server agrees on ${fmtInt(v.server_ok || 0)}, point winner on ${fmtInt(v.winner_ok || 0)}). The rest happened during replays or camera cuts. `,
    `${fmtInt(v.complete || 0)} points were followed from the serve to the final shot (the shot count fits how ATP says the point ended); rally lengths and running use only those. Speeds, spin, placement and positions use every tracked shot.`,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm', type: 'button', onclick: () => downloadPoints() }, 'Download point-by-point (CSV)'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => downloadShots() }, 'Download shot-by-shot (CSV)'))));

  body.appendChild(h('div', { class: 'mt' }, tiles([
    { label: 'Points seen on video', value: `${fmtInt(v.matched || pts.filter(p => p.seen).length)} / ${fmtInt(pts.length)}`, delta: 'lined up with ATP\'s record' },
    { label: 'Shots tracked', value: fmtInt(shots.length), delta: `${fmtInt(withBounce)} with a measured bounce` },
    { label: 'Ball speed measured', value: fmtInt(withSpeed), delta: 'shots with a clean 3D flight fit' },
    { label: 'Running measured', value: fmtInt(pts.filter(p => isNum(p.run[0]) && isNum(p.run[1])).length), delta: 'points with both players tracked' },
  ])));

  if (VT.findings && VT.findings.length) {
    body.appendChild(h('div', { class: 'mt' }, card('What the tracking shows', 'Automatically picked out: the biggest differences between the players, and what changed during the match',
      h('ul', { class: 'vt-findings' }, VT.findings.map(f => h('li', {}, f))))));
  }

  // ---------- serve
  const g1 = h('div', { class: 'grid g2 mt' });
  g1.appendChild(card('Serve', 'First-serve %, points won, aces and double faults from ATP; speeds, placement and unreturned serves from the video', h('div', {},
    head(),
    compareRow('First serves in', A.firstIn, B.firstIn, pc),
    compareRow('Points won on 1st serve', A.firstWon, B.firstWon, pc),
    compareRow('Points won on 2nd serve', A.secondWon, B.secondWon, pc),
    compareRow('Aces / double faults', A.aces, B.aces, fmtInt, { raw: [`${A.aces} / ${A.dfs}`, `${B.aces} / ${B.dfs}`] }),
    compareRow('Unreturned serves (incl. aces)', A.unreturned, B.unreturned, pc),
    compareRow('1st-serve speed, median', A.serve1Speed, B.serve1Speed, kmh, { raw: [`${kmh(A.serve1Speed)}`, `${kmh(B.serve1Speed)}`] }),
    compareRow('1st-serve speed, top 10%', A.serve1Top, B.serve1Top, kmh),
    compareRow('2nd-serve speed, median', A.serve2Speed, B.serve2Speed, kmh),
    plus1Row('Serve +1: first shot after the return was a forehand', p1 => pct1(p1.F, p1.B)),
    plus1Row('Points won when the serve +1 was a forehand', p1 => (p1.F && p1.F[0] ? p1.F[1] / p1.F[0] : null), p1 => (p1.F ? `of ${p1.F[0]}` : '')),
    plus1Row('Points won when the serve +1 was a backhand', p1 => (p1.B && p1.B[0] ? p1.B[1] / p1.B[0] : null), p1 => (p1.B ? `of ${p1.B[0]}` : '')),
    h('p', { class: 'muted vt-note' }, `Speeds off the racket from the 3D fit of each serve (${A.serve1N + B.serve1N} first and ${A.serve2N + B.serve2N} second serves had a clean fit). Checked against stadium radar on other broadcasts: median error about 3-5%.`))));
  g1.appendChild(card('Where the serves landed', 'First and second serves that went in, seen from behind the server. Green: server won the point; orange: lost it.', el => {
    const st = { who: 0, sn: '1' };
    const ctl = h('div', { class: 'row', style: { marginBottom: '8px' } });
    const host = h('div'), tbl = h('div');
    el.append(ctl, host, tbl);
    const draw = () => {
      clear(ctl); clear(host); clear(tbl);
      ctl.append(segmented([['0', names[0]], ['1', names[1]]], String(st.who), x => { st.who = +x; draw(); }),
        segmented([['1', '1st serves'], ['2', '2nd serves'], ['all', 'All']], st.sn, x => { st.sn = x; draw(); }));
      const sel = shots.filter(s => s.h === st.who && s.sv > 0 && s.land === 'I' && isNum(s.bx) && (st.sn === 'all' || String(s.sv) === st.sn));
      court(host, { mode: 'half', zones: true, maxWidth: 520, points: sel.map(s => {
        const p = pts[s.p], won = p.winner === st.who;
        return { x: s.by, y: s.bx, r: 5, color: won ? 'var(--good)' : 'var(--series-2)', opacity: s.sv === 2 ? 0.55 : 0.9,
          tip: { title: `${s.side === 'D' ? 'Deuce' : 'Ad'} court · ${SDIR[s.sdir] || ''} · ${s.sv === 1 ? '1st' : '2nd'} serve`, rows: [{ value: kmh(s.spd), label: 'speed' }, { value: won ? 'won' : 'lost', label: 'point' }, { value: p.score, label: 'score before' }] } };
      }) });
      const pl = VT.stats.all[st.who].placement || {};
      const rows = [];
      for (const side of ['D', 'A']) for (const dir of ['W', 'B', 'T']) {
        const keys = st.sn === 'all' ? [`${side}${dir}1`, `${side}${dir}2`] : [`${side}${dir}${st.sn}`];
        const n = keys.reduce((a, k) => a + (pl[k] ? pl[k][0] : 0), 0), w = keys.reduce((a, k) => a + (pl[k] ? pl[k][1] : 0), 0);
        rows.push([side === 'D' ? 'Deuce' : 'Ad', SDIR[dir], n, n ? fmtPct(w / n) : '–']);
      }
      tbl.appendChild(h('table', { class: 'tbl compact' }, h('thead', {}, h('tr', {}, ['Court', 'Direction', 'Serves in', 'Points won'].map((t, i) => h('th', { class: i > 1 ? 'r' : '' }, t)))),
        h('tbody', {}, rows.map(r => h('tr', {}, r.map((c, i) => h('td', { class: i > 1 ? 'r num' : '' }, String(c))))))));
    };
    draw();
  }));
  body.appendChild(g1);

  // ---------- return
  const g2 = h('div', { class: 'grid g2 mt' });
  g2.appendChild(card('Return of serve', 'Where each player stood to return, and how deep the return landed (from the video); points won from ATP', h('div', {},
    head(),
    compareRow('Return position vs 1st serve', A.returnPos1, B.returnPos1, metres, { better: 0, raw: [behind(A.returnPos1), behind(B.returnPos1)] }),
    compareRow('Return position vs 2nd serve', A.returnPos2, B.returnPos2, metres, { better: 0, raw: [behind(A.returnPos2), behind(B.returnPos2)] }),
    compareRow('Returns in play', A.returnInPlay, B.returnInPlay, pc),
    compareRow('Returns landing within 3 m of the baseline', A.returnDeep, B.returnDeep, pc),
    compareRow('Return depth, median distance from baseline', A.returnDepth, B.returnDepth, metres, { better: -1 }),
    compareRow('Return speed, median', A.returnSpeed, B.returnSpeed, kmh),
    compareRow('Points won returning 1st serves', A.returnWon1, B.returnWon1, pc),
    compareRow('Points won returning 2nd serves', A.returnWon2, B.returnWon2, pc))));
  g2.appendChild(card('Where the returns landed', 'Returns that went in, seen from behind the returner. Green: returner won the point. The line marks 3 m inside the baseline.', el => mapByPlayer(el, s => s.k === 2 && s.land === 'I' && isNum(s.bx), s => pts[s.p].winner === s.h)));
  body.appendChild(g2);

  // ---------- baseline game
  const g3 = h('div', { class: 'grid g2 mt' });
  g3.appendChild(card('From the baseline', 'Rally shots after the return. Speeds and net clearance from flights with a clean 3D fit (sample sizes in the table view).', h('div', {},
    head(),
    compareRow('Forehand speed, median', A.fhSpeed, B.fhSpeed, kmh),
    compareRow('Forehand speed, top 10%', A.fhSpeed90, B.fhSpeed90, kmh),
    compareRow('Backhand speed, median', A.bhSpeed, B.bhSpeed, kmh),
    compareRow('Backhand speed, top 10%', A.bhSpeed90, B.bhSpeed90, kmh),
    compareRow('Forehand height over the net, median', A.fhNetClear, B.fhNetClear, cm, { better: 0 }),
    compareRow('Backhand height over the net, median', A.bhNetClear, B.bhNetClear, cm, { better: 0 }),
    compareRow('Forehands landing within 3 m of the baseline', A.fhDeep, B.fhDeep, pc),
    compareRow('Backhands landing within 3 m of the baseline', A.bhDeep, B.bhDeep, pc),
    compareRow('Share of rally shots that were forehands', A.fhShare, B.fhShare, pc, { better: 0 }),
    compareRow('Forehands struck from the backhand side', A.insideFh, B.insideFh, pc, { better: 0 }),
    compareRow('Forehands missed (net or out)', A.fhErrRate, B.fhErrRate, pc, { better: -1 }),
    compareRow('Backhands missed (net or out)', A.bhErrRate, B.bhErrRate, pc, { better: -1 })), {
    table: () => ({ cols: ['', names[0], names[1]], rows: [
      ['Forehands with a measured speed', A.fhSpeedN, B.fhSpeedN], ['Backhands with a measured speed', A.bhSpeedN, B.bhSpeedN],
      ['Rally shots tracked', A.rallyShots, B.rallyShots], ['Forehand median depth (m inside baseline)', A.fhDepth, B.fhDepth], ['Backhand median depth', A.bhDepth, B.bhDepth],
      ['Forehand slices', pc(A.fhSlice), pc(B.fhSlice)], ['Backhand slices', pc(A.bhSlice), pc(B.bhSlice)]] }),
  }));
  g3.appendChild(card('Spin and direction', 'Share of each player\'s rally shots, from the fitted ball flight and where it landed', el => {
    const rows = [];
    for (const [i, P] of [[0, A], [1, B]]) for (const [tag, lab] of [['fh', 'forehand'], ['bh', 'backhand']]) if (P[tag + 'Spin']) rows.push({ label: `${names[i]} ${lab}`, parts: P[tag + 'Spin'] });
    stackBars(el, { rows, keys: [{ key: 'T', label: 'Topspin', color: 'var(--series-1)', dark: true }, { key: 'F', label: 'Flat', color: 'var(--series-3)' }, { key: 'S', label: 'Slice', color: 'var(--series-2)', dark: true }], labelWidth: 150 });
    const rows2 = [];
    for (const [i, P] of [[0, A], [1, B]]) for (const [tag, lab] of [['fh', 'forehand'], ['bh', 'backhand']]) if (P[tag + 'Dir']) rows2.push({ label: `${names[i]} ${lab}`, parts: P[tag + 'Dir'] });
    const d2 = h('div', { class: 'mt' });
    el.appendChild(d2);
    stackBars(d2, { rows: rows2, keys: [{ key: 'C', label: 'Crosscourt', color: 'var(--series-4)', dark: true }, { key: 'M', label: 'Middle', color: 'var(--series-5)' }, { key: 'D', label: 'Down the line', color: 'var(--series-7)', dark: true }], labelWidth: 150 });
  }));
  body.appendChild(g3);

  const g4 = h('div', { class: 'grid g2 mt' });
  g4.appendChild(card('Where the rally shots landed', 'Each player\'s rally shots that went in, seen from behind the hitter. Green: hitter won the point. The line marks 3 m inside the baseline.', el => mapByPlayer(el, s => s.k >= 3 && s.sv === 0 && s.land === 'I' && isNum(s.bx), s => pts[s.p].winner === s.h)));
  g4.appendChild(card('Where they struck the ball from', 'Contact points of rally shots, seen from across the net (the hitter\'s baseline at the top). Blue: forehand, orange: backhand.', el => {
    const st = { who: 0 };
    const ctl = h('div', { class: 'row', style: { marginBottom: '8px' } }), host = h('div');
    el.append(ctl, host);
    const draw = () => {
      clear(ctl); clear(host);
      ctl.appendChild(segmented([['0', names[0]], ['1', names[1]]], String(st.who), x => { st.who = +x; draw(); }));
      const sel = shots.filter(s => s.h === st.who && s.k >= 2 && s.sv === 0 && isNum(s.cx) && s.cy > 0 && (isFh(s.st) || isBh(s.st)));
      // own half seen from across the net: rotate the hitter's view by 180 degrees
      court(host, { mode: 'half', maxWidth: 520, points: sel.map(s => ({ x: -s.cy, y: -s.cx, r: 4, color: isFh(s.st) ? 'var(--series-1)' : 'var(--series-2)', opacity: 0.75,
        tip: { title: STROKE[s.st] || s.st, rows: [{ value: behind(s.cy - BL), label: 'from the baseline' }, { value: kmh(s.spd), label: 'speed' }] } })),
        leftLabel: ' ', rightLabel: ' ' });
      const P = VT.stats.all[st.who];
      host.appendChild(h('p', { class: 'muted vt-note' }, `Median contact ${behind(P.contactBehind)}; ${pc(P.insideBaseline)} of rally balls taken inside the baseline (${fmtInt(P.contactBehindN)} shots).`));
    };
    draw();
  }));
  body.appendChild(g4);

  // ---------- risk profile and depth
  const g45 = h('div', { class: 'grid g2 mt' });
  g45.appendChild(card('Speed against margin', 'Every rally drive with a clean 3D fit: how fast it left the racket and how high it crossed the net. Low and fast is the risky corner.', el => {
    const drives = shots.filter(s => s.k >= 2 && s.sv === 0 && ['F', 'B'].includes(s.st) && isNum(s.spd) && isNum(s.nc));
    scatter(el, { points: drives.map(s => ({ x: s.nc * 100, y: s.spd, color: COLS[s.h], r: 4, label: `${names[s.h]} ${STROKE[s.st].toLowerCase()}`, sub: `${LAND[s.land] || ''}${s.land === 'I' && isNum(s.dep) ? ', ' + fmt1(s.dep) + ' m inside the baseline' : ''}` })),
      xLabel: 'Height over the net (cm)', yLabel: 'Speed (km/h)', xFmt: x => fmtInt(x), yFmt: x => fmtInt(x), height: 300,
      legend: [{ label: names[0], color: CA }, { label: names[1], color: CB }] });
  }));
  g45.appendChild(card('Depth pays', 'How often the hitter went on to win the point, by where the rally shot landed (shots that went in)', el => {
    const bins = [['Within 3 m of the baseline', d => d <= 3], ['3 m to the service line', d => d > 3 && d <= 5.485], ['Inside the service line', d => d > 5.485]];
    const rows = bins.map(([lab, f]) => {
      const cells = [0, 1].map(who => {
        const sel = shots.filter(s => s.h === who && s.k >= 2 && s.sv === 0 && s.land === 'I' && isNum(s.dep) && f(s.dep));
        const won = sel.filter(s => pts[s.p].winner === who).length;
        return sel.length ? `${fmtPct(won / sel.length)} of ${sel.length}` : '–';
      });
      return h('tr', {}, h('td', {}, lab), h('td', { class: 'r num' }, cells[0]), h('td', { class: 'r num' }, cells[1]));
    });
    el.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Landed'), h('th', { class: 'r' }, names[0] + ' won'), h('th', { class: 'r' }, names[1] + ' won'))), h('tbody', {}, rows))));
    el.appendChild(h('p', { class: 'muted vt-note' }, 'Includes returns. A short ball is not always a bad ball (drop shots, angles), but across a match the pattern shows who was pushed back.'));
  }));
  body.appendChild(g45);

  // ---------- movement, rally length, endings
  const g5 = h('div', { class: 'grid g3 mt' });
  g5.appendChild(card('Running', 'Metres covered during points, from both players\' positions in every frame', h('div', {},
    head(),
    compareRow('Per point, median', A.runPerPoint, B.runPerPoint, metres, { better: 0 }),
    compareRow('Per shot in the rally', A.runPerShot, B.runPerShot, metres, { better: 0 }),
    compareRow('Total in the fully tracked points', A.runTotal, B.runTotal, v2 => (isNum(v2) ? fmtInt(v2) + ' m' : '–'), { better: 0 }),
    compareRow('In points won', A.runWon, B.runWon, metres, { better: 0 }),
    compareRow('In points lost', A.runLost, B.runLost, metres, { better: 0 }),
    compareRow('In rallies of 7+ shots', A.runLongRally, B.runLongRally, metres, { better: 0 }),
    h('p', { class: 'muted vt-note' }, `From ${fmtInt(Math.min(A.runN || 0, B.runN || 0))} points followed from serve to final shot. Walking between points is not counted.`))));
  g5.appendChild(card('Rally length', `Shots per point, incl. the serve, in the ${fmtInt(A.rallyN || 0)} points followed from serve to final shot; and who won them`, el => columnChart(el, {
    data: Object.keys(A.rallyBins).map(k => ({ label: k + ' shots', parts: { a: A.rallyBins[k][1], b: B.rallyBins[k][1] } })),
    stacked: [{ key: 'a', label: names[0] + ' won', color: CA }, { key: 'b', label: names[1] + ' won', color: CB }], height: 220, fmt: fmtInt,
  })));
  g5.appendChild(card('How points ended', 'Winners and errors by the last shot, from ATP\'s record; where errors went, from the video', h('div', {},
    head(),
    compareRow('Winners: forehand / backhand', A.winners, B.winners, fmtInt, { raw: [`${A.winners} (${A.winnersFh} / ${A.winnersBh})`, `${B.winners} (${B.winnersFh} / ${B.winnersBh})`] }),
    compareRow('Unforced errors: forehand / backhand', A.ue, B.ue, fmtInt, { better: -1, raw: [`${A.ue} (${A.ueFh} / ${A.ueBh})`, `${B.ue} (${B.ueFh} / ${B.ueBh})`] }),
    compareRow('Forced errors', A.forcedErrors, B.forcedErrors, fmtInt, { better: -1 }),
    compareRow('Errors into the net', (A.errorKinds || {}).net || 0, (B.errorKinds || {}).net || 0, fmtInt, { better: -1 }),
    compareRow('Errors long', (A.errorKinds || {}).long || 0, (B.errorKinds || {}).long || 0, fmtInt, { better: -1 }),
    compareRow('Errors wide', (A.errorKinds || {}).wide || 0, (B.errorKinds || {}).wide || 0, fmtInt, { better: -1 }),
    compareRow('Net points won', A.netWon, B.netWon, pc, { raw: [`${pc(A.netWon)} of ${A.netPoints}`, `${pc(B.netWon)} of ${B.netPoints}`] }))));
  body.appendChild(g5);

  // ---------- pressure and the course of the match
  const g6 = h('div', { class: 'grid g2 mt' });
  g6.appendChild(card('Under pressure', 'Break points: from ATP. Rally speed on break points vs other points: from the video.', h('div', {},
    head(),
    compareRow('Break points saved', A.bpSaved, B.bpSaved, fmtInt, { raw: [`${A.bpSaved} of ${A.bpFaced}`, `${B.bpSaved} of ${B.bpFaced}`] }),
    compareRow('Break points converted', A.bpWon, B.bpWon, fmtInt, { raw: [`${A.bpWon} of ${A.bpChances}`, `${B.bpWon} of ${B.bpChances}`] }),
    compareRow('First serves in on break points', A.bpFirstIn, B.bpFirstIn, pc),
    isNum(A.rallySpeedBp) || isNum(B.rallySpeedBp) ? compareRow('Drive speed on break points', A.rallySpeedBp, B.rallySpeedBp, kmh, { raw: [`${kmh(A.rallySpeedBp)} (${A.rallySpeedBpN})`, `${kmh(B.rallySpeedBp)} (${B.rallySpeedBpN})`] }) : null,
    isNum(A.rallySpeedBp) || isNum(B.rallySpeedBp) ? compareRow('Drive speed on other points', A.rallySpeedOther, B.rallySpeedOther, kmh) : null,
    h('p', { class: 'muted vt-note' }, 'Drive speed on break points is shown when at least 4 drives on break points have a measured speed.'))));
  g6.appendChild(card('Rally speed through the match', 'Average groundstroke speed (returns and rally drives with a clean 3D fit) per block of 20 points', el => lineChart(el, {
    series: VT.stats.speedTimeline.map((ser, i) => ({ name: names[i], color: COLS[i], values: ser.filter(x => isNum(x[1])).map(x => ({ x: x[0], y: x[1] })) })),
    xType: 'num', xFmt: v2 => 'pt ' + fmtInt(v2), yFmt: v2 => fmtInt(v2), height: 240, markers: true, endLabels: false,
  })));
  body.appendChild(g6);

  // set by set
  const setKeys = Object.keys(VT.stats.bySet).sort();
  const METRICS = [['First serves in', 'firstIn', pc], ['Points won on 1st serve', 'firstWon', pc], ['1st-serve speed', 'serve1Speed', kmh], ['Return position vs 1st serve', 'returnPos1', behind],
    ['Forehand speed', 'fhSpeed', kmh], ['Backhand speed', 'bhSpeed', kmh], ['Forehands within 3 m of baseline', 'fhDeep', pc], ['Contact behind the baseline', 'contactBehind', behind],
    ['Winners', 'winners', fmtInt], ['Unforced errors', 'ue', fmtInt], ['Metres per point', 'runPerPoint', metres], ['Average rally length', 'rallyAvg', v2 => (isNum(v2) ? fmt1(v2) : '–')]];
  const setHead = h('thead', {}, h('tr', {}, h('th', {}, ''), ...setKeys.flatMap(k => [h('th', { class: 'r' }, `Set ${k} · ${names[0]}`), h('th', { class: 'r' }, names[1])])));
  const setBody = h('tbody', {}, METRICS.map(([lab, key, f]) => h('tr', {}, h('td', {}, lab),
    ...setKeys.flatMap(k => VT.stats.bySet[k].map((P, i) => h('td', { class: 'r num' + (i === 0 ? ' vt-a' : '') }, f(P[key])))))));
  body.appendChild(h('div', { class: 'mt' }, card('Set by set', 'How each player\'s numbers moved during the match',
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact vt-sets' }, setHead, setBody)))));

  // ---------- point explorer
  const exp = h('div', { class: 'mt' });
  body.appendChild(exp);
  const replay = h('div');
  const seenPts = pts.filter(p => p.seen);
  let current = seenPts.filter(p => p.complete).reduce((best, p) => (p.shots.length > (best ? best.shots.length : 0) ? p : best), null) || seenPts[0] || null;
  const drawReplay = () => {
    clear(replay);
    if (!current) return;
    const p = current, sh = p.shots.map(i => shots[i]);
    const raw = (x, y, end) => (end === 'far' ? [-x, -y] : [x, y]);
    const segs = [], dots = [], labels = [];
    sh.forEach((s, j) => {
      const col = COLS[s.h];
      if (isNum(s.bx)) {
        const [bx, by] = raw(s.bx, s.by, s.end);
        if (isNum(s.cx)) { const [cx, cy] = raw(s.cx, s.cy, s.end); segs.push({ x1: cy, y1: cx, x2: by, y2: bx, color: col, opacity: 0.8 }); dots.push({ x: cy, y: cx, r: 3, color: col, opacity: 0.5 }); }
        dots.push({ x: by, y: bx, r: 6, color: col, tip: { title: `Shot ${s.k}: ${names[s.h]} ${STROKE[s.st] || ''}`, rows: [{ value: kmh(s.spd), label: 'speed' }, { value: SPIN[s.spin] || '–', label: 'spin' }, { value: cm(s.nc), label: 'over the net' }, { value: LAND[s.land] || '–', label: 'landed' }] } });
        labels.push({ x: by, y: bx - 0.55, text: String(s.k) });
      }
    });
    const nearP = sh.find(s => s.end === 'near'), farP = sh.find(s => s.end === 'far');
    replay.append(
      h('div', { class: 'vt-pt-head' }, h('b', {}, `Point ${p.n}: set ${p.set}, game ${p.game}${p.tb ? ' (tiebreak)' : ''}, ${p.score} (${names[0]} first)`),
        h('span', { class: 'muted' }, ` · ${names[p.server]} serving · ${p.sn === 2 ? 'second serve' : 'first serve'} · ${names[p.winner]} won · ${ENDING[p.end] || ''}${p.lastHand ? ` (${p.lastHand === 'F' ? 'forehand' : 'backhand'} ${LAST[p.lastStroke] || ''})` : ''}`)),
      h('div', { class: 'muted vt-note' }, `${nearP ? names[nearP.h] + ' at the right-hand end' : ''}${nearP && farP ? ', ' : ''}${farP ? names[farP.h] + ' at the left' : ''}. Lines run from contact to bounce; numbers are shot order.`),
      p.complete ? null : h('div', { class: 'vt-note vt-warn' }, `The video lost part of this point (camera cut or a shot the tracker missed): ${fmtInt(p.shots.length)} shots were tracked, and ATP's record says it ended with ${ENDING[p.end] ? ENDING[p.end].toLowerCase() : 'an unknown shot'}${p.lastHand ? ` (${p.lastHand === 'F' ? 'forehand' : 'backhand'})` : ''}.`));
    const host = h('div');
    replay.appendChild(host);
    court(host, { mode: 'full', maxWidth: 760, points: dots, segments: segs, labels });
    replay.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, ['#', 'Player', 'Shot', 'Speed', 'Spin', 'Over net', 'Landed', 'From baseline', 'Direction'].map((t, i) => h('th', { class: i >= 3 && i !== 4 && i !== 6 && i !== 8 ? 'r' : '' }, t)))),
      h('tbody', {}, sh.map(s => h('tr', {}, h('td', {}, String(s.k)), h('td', {}, h('span', { class: 'sdot', style: { background: COLS[s.h] } }), names[s.h]),
        h('td', {}, (STROKE[s.st] || s.st) + (s.sv ? ` (${s.sv === 1 ? '1st' : '2nd'}${s.sdir ? ', ' + SDIR[s.sdir] : ''})` : '')), h('td', { class: 'r num' }, kmh(s.spd)), h('td', {}, SPIN[s.spin] || '–'),
        h('td', { class: 'r num' }, cm(s.nc)), h('td', {}, LAND[s.land] || '–'), h('td', { class: 'r num' }, isNum(s.dep) && s.land === 'I' ? fmt1(s.dep) + ' m' : '–'), h('td', {}, DIR[s.dir] || '–')))))));
    if (p.run && (isNum(p.run[0]) || isNum(p.run[1]))) replay.appendChild(h('p', { class: 'muted vt-note' }, `Running in this point: ${names[0]} ${metres(p.run[0])}, ${names[1]} ${metres(p.run[1])}. Duration ${isNum(p.dur) ? fmt1(p.dur) + ' s' : '–'}.`));
  };
  exp.appendChild(card('Every point, shot by shot', 'Click a point to replay it on the court. Points not seen on video still list ATP\'s record.', h('div', {}, replay, h('div', { class: 'mt' }, dataTable({
    rows: pts, sortKey: 'n', sortDir: 1, pageSize: 15, compact: true, csvName: `${m.id}-points.csv`,
    onRowClick: p => { if (p.seen) { current = p; drawReplay(); replay.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    rowClass: p => (current && p.n === current.n ? 'tr-hl' : '') + (p.seen ? ' clickable' : ' muted'),
    cols: [
      { key: 'n', label: '#', align: 'r' },
      { key: 'set', label: 'Set', align: 'r' }, { key: 'game', label: 'Game', align: 'r' },
      { key: 'score', label: `Score (${names[0]} first)` },
      { key: 'server', label: 'Server', get: p => names[p.server] },
      { key: 'sn', label: 'Serve', get: p => (p.sn === 2 ? '2nd' : '1st') },
      { key: 'winner', label: 'Won by', get: p => names[p.winner], render: p => h('span', {}, h('span', { class: 'sdot', style: { background: COLS[p.winner] } }), names[p.winner]) },
      { key: 'end', label: 'Ending', get: p => ENDING[p.end] + (p.lastHand ? ` (${p.lastHand === 'F' ? 'FH' : 'BH'})` : '') },
      { key: 'bp', label: 'BP', get: p => (p.bp ? 'BP' : '') },
      { key: 'rally', label: 'Shots', align: 'r', get: p => p.rally, render: p => (isNum(p.rally) ? (p.complete ? String(p.rally) : h('span', { class: 'muted', title: 'The video lost part of this point' }, p.rally + ' (partial)')) : '–'), csv: p => p.rally ?? '' },
      { key: 'runA', label: `${names[0]} ran`, align: 'r', get: p => p.run[0], fmt: metres },
      { key: 'runB', label: `${names[1]} ran`, align: 'r', get: p => p.run[1], fmt: metres },
      { key: 'seen', label: 'Video', get: p => (p.seen ? 'yes' : 'no') },
    ],
  })))));
  drawReplay();

  // ---------- compared with other tracked matches
  if (VT.bench && VT.bench.length > 2) {
    const rows = VT.bench.slice().sort((x, y) => (x.match === VT.id ? -1 : y.match === VT.id ? 1 : x.label.localeCompare(y.label)));
    body.appendChild(h('div', { class: 'mt' }, card('Compared with other tracked matches', 'Same tracking software on other broadcasts, including Grand Slam matches. Cameras and courts differ, so treat small gaps with caution.',
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, ['Player', 'Match', '1st serve', '2nd serve', 'Forehand', 'Backhand', 'FH over net', 'FH deep', 'Contact behind BL', 'Return pos. (1st)', 'Run / point', 'Rally length'].map((t, i) => h('th', { class: i > 1 ? 'r' : '' }, t)))),
        h('tbody', {}, rows.map(r => h('tr', { class: r.match === VT.id ? 'tr-hl' : '' },
          h('td', {}, r.pid && D.players[r.pid] ? h('a', { href: '#/player/' + r.pid }, D.players[r.pid].short) : r.player), h('td', { class: 'muted' }, r.label),
          ...[kmh(r.serve1Speed), kmh(r.serve2Speed), kmh(r.fhSpeed), kmh(r.bhSpeed), cm(r.fhNetClear), pc(r.fhDeep), behind(r.contactBehind), behind(r.returnPos1), metres(r.runPerPoint), isNum(r.rallyAvg) ? fmt1(r.rallyAvg) : '–'].map(x => h('td', { class: 'r num' }, x))))))))));
  }

  // ---------- helpers that need the data
  function pct1(f, b2) { const nf = f ? f[0] : 0, nb = b2 ? b2[0] : 0; return nf + nb ? nf / (nf + nb) : null; }
  function plus1Row(label, val, sub) {
    const a = val(A.plus1 || {}), b2 = val(B.plus1 || {});
    if (!isNum(a) && !isNum(b2)) return null;
    return compareRow(label, a, b2, pc, sub ? { raw: [`${pc(a)} ${sub(A.plus1 || {})}`.trim(), `${pc(b2)} ${sub(B.plus1 || {})}`.trim()] } : {});
  }
  function mapByPlayer(el, filter, wonFn) {
    const st = { who: 0 };
    const ctl = h('div', { class: 'row', style: { marginBottom: '8px' } }), host = h('div');
    el.append(ctl, host);
    const draw = () => {
      clear(ctl); clear(host);
      ctl.appendChild(segmented([['0', names[0]], ['1', names[1]]], String(st.who), x => { st.who = +x; draw(); }));
      const sel = shots.filter(s => s.h === st.who && filter(s));
      court(host, { mode: 'half', maxWidth: 520, points: sel.map(s => ({ x: s.by, y: s.bx, r: 4, color: wonFn(s) ? 'var(--good)' : 'var(--series-2)', opacity: 0.8,
        tip: { title: STROKE[s.st] || s.st, rows: [{ value: isNum(s.dep) ? fmt1(s.dep) + ' m' : '–', label: 'inside the baseline' }, { value: kmh(s.spd), label: 'speed' }, { value: DIR[s.dir] || '–', label: 'direction' }] } })),
        segments: [{ x1: -BL + 3, y1: -4.115, x2: -BL + 3, y2: 4.115, color: 'var(--muted)', opacity: 0.7 }], leftLabel: ' ', rightLabel: ' ' });
      host.appendChild(h('p', { class: 'muted vt-note' }, `${fmtInt(sel.length)} shots.`));
    };
    draw();
  }

  function downloadPoints() {
    const rows = [['point', 'set', 'game', 'tiebreak', `score_before (${VT.players[0].name} first)`, 'server', 'winner', 'serve', 'ending', 'last_shot', 'break_point', 'shots_tracked', 'fully_tracked', 'seen_on_video', 'duration_s', `${VT.players[0].name}_metres_run`, `${VT.players[1].name}_metres_run`]];
    for (const p of pts) rows.push([p.n, p.set, p.game, p.tb ? 1 : 0, p.score, VT.players[p.server].name, VT.players[p.winner].name, p.sn === 2 ? 2 : 1, ENDING[p.end],
      p.lastHand ? `${p.lastHand === 'F' ? 'forehand' : 'backhand'} ${LAST[p.lastStroke] || ''}`.trim() : '', p.bp ? 1 : 0, p.rally ?? '', p.complete ? 1 : 0, p.seen ? 1 : 0, p.dur ?? '', p.run[0] ?? '', p.run[1] ?? '']);
    csvDownload(`${m.id}-point-by-point.csv`, rows);
  }
  function downloadShots() {
    const rows = [['point', 'shot', 'player', 'stroke', 'serve_number', 'speed_kmh', 'spin', 'net_clearance_m', 'contact_height_m', 'contact_x_m', 'contact_y_m', 'bounce_x_m', 'bounce_y_m', 'landed', 'depth_inside_baseline_m', 'direction', 'serve_direction', 'serve_side']];
    for (const s of shots) rows.push([pts[s.p].n, s.k, VT.players[s.h].name, STROKE[s.st] || s.st, s.sv || '', s.spd ?? '', SPIN[s.spin] || '', s.nc ?? '', s.ch ?? '', s.cx ?? '', s.cy ?? '', s.bx ?? '', s.by ?? '',
      LAND[s.land] || '', s.dep ?? '', DIR[s.dir] || '', SDIR[s.sdir] || '', s.side === 'D' ? 'deuce' : s.side === 'A' ? 'ad' : '']);
    rows.push([]);
    rows.push(['# coordinates in metres from the hitter\'s view: hitter at y > 0 hitting toward y < 0, x > 0 = hitter\'s right; baselines at y = +-11.885, singles sidelines at x = +-4.115']);
    csvDownload(`${m.id}-shot-by-shot.csv`, rows);
  }
}

function behind(v) {
  if (!isNum(v)) return '–';
  return v >= 0 ? `${fmt1(v)} m behind` : `${fmt1(-v)} m inside`;
}
