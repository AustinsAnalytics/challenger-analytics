// Hawk-Eye Lab: CourtVision aggregates across all tracked Challenger matches.
import { h, clear, fmtInt, fmtPct, fmt1, fmt2, isNum, ratio, fmtDate } from '../util.js';
import { D, lazy, filtered, surfaceColorVar } from '../data.js';
import { card, lineChart, stackBars, barChart } from '../charts.js';
import { pageHead, tiles, segmented, playerLink, eventLink, surfaceDot, matchCols, minMatchesControl } from '../components.js';
import { dataTable } from '../table.js';
import { court, ZONE_NAMES } from '../court.js';

export async function render(root) {
  root.appendChild(pageHead('Hawk-Eye Lab', 'CourtVision analytics',
    'Ball-tracking from Challenger events with Hawk-Eye Live: where serves land, how points end, how high balls cross the net. Data covers every tracked match of the season; open any tracked match for its 2D court map and 3D flight paths.'));
  const loading = h('div', { class: 'empty' }, 'Loading tracking data…');
  root.appendChild(loading);
  let summary, players;
  try { [summary, players] = await Promise.all([lazy('data/cv_summary.json'), lazy('data/cv_players.json')]); }
  catch { clear(loading).append('Hawk-Eye data unavailable.'); return; }
  loading.remove();
  const cvMatches = D.matches.filter(m => m.hasCV);
  const cvEvents = D.eventList.filter(e => e.cv);
  if (!cvEvents.length || !Object.keys(summary).length) { root.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, `No Challenger event had Hawk-Eye CourtVision tracking in ${D.season}.`))); return; }
  const surfaces = Object.keys(summary).filter(s => s !== 'Unknown');
  const totServes = Object.values(players).reduce((a, p) => a + (p.att['1'] || 0) + (p.att['2'] || 0), 0);
  const totShots = Object.values(players).reduce((a, p) => a + Object.values(p.shots).reduce((x, v) => x + v[0] + v[1] + v[2], 0), 0);
  root.appendChild(tiles([
    { label: 'Tracked events', value: fmtInt(cvEvents.length), delta: surfaces.join(' · ') },
    { label: 'Tracked matches', value: fmtInt(cvMatches.length), delta: fmtPct(cvMatches.length / D.matches.length) + ' of all matches' },
    { label: 'Tracked players', value: fmtInt(Object.keys(players).length) },
    { label: 'Serves tracked', value: fmtInt(totServes) },
    { label: 'Point-ending shots', value: fmtInt(totShots) },
  ]));

  // ---------- matches tracked from the broadcast video (no Hawk-Eye at the event) ----------
  lazy('data/vt/index.json').then(vt => {
    const list = (vt.matches || []).map(x => ({ ...x, m: D.matches.find(mm => mm.id === x.id) })).filter(x => x.m);
    if (!list.length) return;
    vtHost.appendChild(h('div', { class: 'mt' }, card('Tracked from the broadcast video', 'Matches at events without Hawk-Eye, tracked shot by shot from the Challenger TV broadcast with computer vision: serve placement and speed, spin, net clearance, depth, court position and running. Open one for its Ball tracking tab.',
      h('div', {}, dataTable({ rows: list, sortKey: 'date', sortDir: -1, pageSize: 10, compact: true, sticky: false,
        onRowClick: x => { location.hash = '#/match/' + x.id + '?tab=tracking'; },
        cols: [
          { key: 'date', label: 'Date', get: x => x.m.date, render: x => fmtDate(x.m.date) },
          { key: 'ev', label: 'Event', get: x => x.m.e?.city || '', render: x => h('span', {}, surfaceDot(x.m.surface), ' ', x.m.e?.city || '') },
          { key: 'rd', label: 'Round', get: x => x.m.rd },
          { key: 'w', label: 'Winner', get: x => D.players[x.m.w]?.name, render: x => playerLink(x.m.w, { short: true }) },
          { key: 'l', label: 'Opponent', get: x => D.players[x.m.l]?.name, render: x => playerLink(x.m.l, { short: true }) },
          { key: 'seen', label: 'Points on video', align: 'r', get: x => x.seen, render: x => `${fmtInt(x.seen || 0)} / ${fmtInt(x.points)}` },
          { key: 'shots', label: 'Shots', align: 'r', fmt: fmtInt },
        ] })))));
  }).catch(() => {});
  const vtHost = h('div');
  root.appendChild(vtHost);

  // ---------- serve placement ----------
  let surf = surfaces.includes('Hard') ? 'Hard' : surfaces[0];
  let sn = '1';
  const serveHost = h('div', { class: 'grid g2 mt' });
  root.appendChild(h('div', { class: 'row mt2' }, h('h2', {}, 'Serve placement'), h('span', { class: 'spacer' }),
    segmented(surfaces.map(s => [s, s]), surf, v => { surf = v; drawServe(); drawShots(); }),
    segmented([['1', '1st serve'], ['2', '2nd serve']], sn, v => { sn = v; drawServe(); })));
  root.appendChild(serveHost);
  function drawServe() {
    clear(serveHost);
    const S = summary[surf];
    const cells = (S.serveGrid[sn] || []).map(([d, y, v]) => [-d, y, v]);
    serveHost.appendChild(card('Where serves land', `${surf} · ${sn === '1' ? 'first' : 'second'} serves in play · stronger colour = more serves (0.5 m cells)`, el => court(el, {
      mode: 'half', zones: true, maxWidth: 440, heat: { cells, size: 0.5, color: 'var(--series-1)', title: 'Serves landing here', unit: 'serves' },
    })));
    const rows = [];
    for (const [ck, cname] of [['0', 'Deuce court'], ['1', 'Ad court']]) {
      const z = ['W', 'B', 'T'].map(zz => S.zones[`${sn}|${ck}|${zz}`] || [0, 0, 0, 0]);
      const tot = z.reduce((a, v) => a + v[0], 0);
      ['W', 'B', 'T'].forEach((zz, i) => rows.push({ court: cname, zone: ZONE_NAMES[zz], n: z[i][0], share: ratio(z[i][0], tot), won: ratio(z[i][1], z[i][0]), speed: ratio(z[i][2], z[i][3]) }));
    }
    serveHost.appendChild(card('Target zones', 'Share of serves to each zone, points won by the server, average speed', h('div', {},
      dataTable({ rows, sortKey: 'court', sortDir: 1, sticky: false, compact: true, pageSize: 6, cols: [
        { key: 'court', label: 'Court', sortDir: 1 }, { key: 'zone', label: 'Zone', get: false },
        { key: 'share', label: 'Share', align: 'r', fmt: fmtPct }, { key: 'n', label: 'Serves', align: 'r', fmt: fmtInt },
        { key: 'won', label: 'Server won', align: 'r', fmt: fmtPct }, { key: 'speed', label: 'Avg km/h', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
      ] }),
      h('p', { class: 'muted mt', style: { fontSize: '12.5px' } }, 'Zones split each service box into thirds by distance from the centre line: T (closest), Body, Wide.'))));
  }
  drawServe();

  // ---------- point-ending shots ----------
  let end = 'W';
  const shotHost = h('div', { class: 'grid g2 mt' });
  root.appendChild(h('div', { class: 'row mt2' }, h('h2', {}, 'How points end'), h('span', { class: 'spacer' }),
    segmented([['W', 'Winners'], ['U', 'Unforced errors'], ['E', 'Forced errors']], end, v => { end = v; drawShots(); })));
  root.appendChild(shotHost);
  const END_LABEL = { W: 'Winners', U: 'Unforced errors', E: 'Forced errors' };
  function drawShots() {
    clear(shotHost);
    const S = summary[surf];
    const cells = (S.grid[end] || []).map(([d, y, v]) => [-d, y, v]);
    shotHost.appendChild(card(`${END_LABEL[end]}: bounce location`, `${surf} · where the final ball landed, seen from behind the hitter (1 m cells)`, el => court(el, {
      mode: 'half', maxWidth: 440, heat: { cells, size: 1, color: end === 'W' ? 'var(--series-1)' : end === 'U' ? 'var(--series-2)' : 'var(--series-3)', title: END_LABEL[end], unit: 'shots' },
    })));
    const side = h('div', { class: 'stack' });
    // Some installations do not record net crossings for errors; only plot series with a real sample.
    const netAll = ['W', 'U', 'E'].map(k => {
      const arr = S.net[k] || []; const tot = arr.reduce((a, v) => a + v[1], 0);
      return { k, tot, name: `${END_LABEL[k]} (${fmtInt(tot)})`, color: k === 'W' ? 'var(--series-1)' : k === 'U' ? 'var(--series-2)' : 'var(--series-3)', values: arr.filter(([c]) => c <= 2.5).map(([c, n]) => ({ x: c, y: n / (tot || 1) })) };
    });
    const netSeries = netAll.filter(x => x.tot >= 200);
    const missing = netAll.filter(x => x.tot < 200).map(x => END_LABEL[x.k].toLowerCase());
    side.appendChild(card('Net clearance', 'Height of the final ball over the net cord (metres), share of shots' + (missing.length ? ` · ${missing.join(' and ')} not tracked over the net on ${surf.toLowerCase()} courts` : ''), el => lineChart(el, {
      series: netSeries, xType: 'num', xFmt: v => fmt1(v) + ' m', yFmt: v => (v * 100).toFixed(1) + '%', height: 220, yZero: true, endLabels: false, tipTitle: p => `${fmt1(p.x)} m over the net`,
    })));
    const strokes = { G: 'Groundstroke', V: 'Volley', P: 'Passing shot', O: 'Overhead', D: 'Drop shot', L: 'Lob' };
    const rows = [];
    for (const hand of ['F', 'B']) for (const [sk, sname] of Object.entries(strokes)) {
      const w = S.stroke['W' + sk + hand] || 0, u = S.stroke['U' + sk + hand] || 0, e = S.stroke['E' + sk + hand] || 0;
      if (w + u + e >= 30) rows.push({ label: `${hand === 'F' ? 'Forehand' : 'Backhand'} ${sname.toLowerCase()}`, parts: { W: w, E: e, U: u } });
    }
    side.appendChild(card('Point endings by stroke', `${surf} · winners vs errors`, el => stackBars(el, {
      rows, keys: [{ key: 'W', label: 'Winners', color: 'var(--series-1)' }, { key: 'E', label: 'Forced errors', color: 'var(--series-3)', dark: true }, { key: 'U', label: 'Unforced errors', color: 'var(--series-2)' }], labelWidth: 170,
      fmt: (v, t) => `${fmtInt(v)} (${Math.round(100 * v / t)}%)`,
    })));
    shotHost.appendChild(side);
  }
  drawShots();

  // ---------- player leaderboard ----------
  root.appendChild(h('h2', { class: 'mt2' }, 'Tracked-player leaderboard'));
  let minM = 3;
  const lbHost = h('div', { class: 'mt' });
  root.append(h('div', { class: 'row mt' }, minMatchesControl(minM, v => { minM = v; drawLb(); }, [1, 2, 3, 5, 8, 10])), lbHost);
  const prow = Object.entries(players).map(([pid, p]) => {
    const z = (key) => p.zones[key] || [0, 0, 0, 0, 0];
    const sum = pred => Object.entries(p.zones).filter(([k]) => pred(k)).reduce((a, [, v]) => [a[0] + v[0], a[1] + v[1], a[2] + v[2], a[3] + v[3], a[4] + v[4]], [0, 0, 0, 0, 0]);
    const f1 = sum(k => k.startsWith('1|')), s2 = sum(k => k.startsWith('2|'));
    const t1 = sum(k => k.startsWith('1|') && k.endsWith('|T')), w1 = sum(k => k.startsWith('1|') && k.endsWith('|W'));
    const sh = Object.values(p.shots).reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0, 0, 0, 0, 0]);
    const winNet = Object.values(p.shots).reduce((a, v) => [a[0] + v[3] * (v[0] / Math.max(1, v[0] + v[1] + v[2])), a[1]], [0, 0]);
    return {
      pid, m: p.m, v1: ratio(f1[2], f1[3]), v2: ratio(s2[2], s2[3]), in1: ratio(f1[0], p.att['1']), won1: ratio(f1[1], f1[0]), won2: ratio(s2[1], s2[0]),
      tShare: ratio(t1[0], f1[0]), wideShare: ratio(w1[0], f1[0]), aceRate: ratio(f1[4] + s2[4], (p.att['1'] || 0)),
      winnersPerM: ratio(sh[0], p.m), uePerM: ratio(sh[1], p.m), net: ratio(sh[3], sh[4]), shotSpeed: ratio(sh[5], sh[6]),
    };
  });
  function drawLb() {
    clear(lbHost).appendChild(dataTable({
      rows: prow.filter(r => r.m >= minM), sortKey: 'v1', pageSize: 40, csvName: 'hawkeye-players.csv', onRowClick: r => { location.hash = '#/player/' + r.pid + '?tab=hawkeye'; },
      cols: [
        { key: 'name', label: 'Player', get: r => D.players[r.pid]?.name, render: r => playerLink(r.pid), sortDir: 1 },
        { key: 'm', label: 'Tracked', align: 'r', title: 'Tracked matches' },
        { key: 'v1', label: '1st km/h', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
        { key: 'v2', label: '2nd km/h', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
        { key: 'in1', label: '1st in', align: 'r', fmt: fmtPct },
        { key: 'won1', label: '1st won', align: 'r', fmt: fmtPct },
        { key: 'won2', label: '2nd won', align: 'r', fmt: fmtPct },
        { key: 'tShare', label: '1st to T', align: 'r', fmt: fmtPct, title: 'Share of first serves in play aimed at the T' },
        { key: 'wideShare', label: '1st wide', align: 'r', fmt: fmtPct },
        { key: 'aceRate', label: 'Aces/1st att.', align: 'r', fmt: fmtPct },
        { key: 'winnersPerM', label: 'Winners/M', align: 'r', fmt: fmt1, title: 'Rally winners per tracked match (excludes aces)' },
        { key: 'uePerM', label: 'UE/M', align: 'r', fmt: fmt1, sortDir: 1 },
        { key: 'shotSpeed', label: 'Final-shot km/h', align: 'r', fmt: v => isNum(v) ? fmtInt(v) : '–' },
        { key: 'net', label: 'Net clear. (m)', align: 'r', fmt: fmt2, title: 'Average height over the net of point-ending shots' },
      ],
    }));
  }
  drawLb();

  // ---------- tracked matches ----------
  root.appendChild(h('h2', { class: 'mt2' }, 'Tracked matches'));
  root.appendChild(h('p', { class: 'muted', style: { margin: '6px 0 12px' } }, 'Open a match and choose the Hawk-Eye tab for the 2D court map and 3D flight paths.'));
  root.appendChild(dataTable({ rows: cvMatches, sortKey: 'date', pageSize: 25, cols: matchCols(), onRowClick: m => { location.hash = '#/match/' + m.id + '?tab=hawkeye'; } }));
}
