// Match explorer.
import { h, clear, fmtInt, fmtPct, isNum, ROUND_NAMES, ROUND_ORDER, debounce, fmtMin, ratio } from '../util.js';
import { D, filtered, lazy } from '../data.js';
import { pageHead, matchCols, selectEl, filterSummary, tiles, segmented } from '../components.js';
import { dataTable } from '../table.js';
import { card, columnChart } from '../charts.js';
import { parseHash, setQuery } from '../main.js';

export function render(root) {
  const q = parseHash().params;
  const st = {
    text: q.q || '', round: q.round || 'all', type: q.type || 'all', minMins: +(q.mins || 0), cv: q.cv === '1', sort: q.sort || 'date',
  };
  root.appendChild(pageHead('Matches', 'Match explorer', `Search and slice every singles match (${filterSummary()}). Click any row for the full match centre: set-by-set stats, momentum, point-by-point and Hawk-Eye views.`));
  const base = filtered();
  const rounds = [...new Set(base.map(m => m.rd))].sort((a, b) => (ROUND_ORDER[a] || 0) - (ROUND_ORDER[b] || 0));
  const text = h('input', { type: 'search', placeholder: 'Player or tournament…', value: st.text, style: { width: '220px' } });
  const mins = h('input', { type: 'number', min: 0, step: 15, value: st.minMins || '', placeholder: 'min', style: { width: '80px' } });
  const statsHost = h('div', { class: 'mt' });
  const host = h('div', { class: 'mt' });
  root.append(
    h('div', { class: 'row' },
      text,
      h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Round'),
        selectEl([['all', 'All rounds'], ...rounds.map(r => [r, ROUND_NAMES[r] || r])], st.round, v => { st.round = v; sync(); })),
      h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Type'),
        selectEl([['all', 'All matches'], ['upset', 'Elo upsets'], ['bigupset', 'Big upsets (<25%)'], ['rankupset', 'Ranking upsets (100+ places)'], ['three', 'Three-setters'], ['straight', 'Straight sets'], ['tb', 'Contains a tiebreak'], ['comeback', 'Comeback from a set down'], ['escape', 'Great escapes (winner fell below 10%)'], ['mpsaved', 'Won from match point down'], ['thriller', 'Thrillers (most dramatic 5%)'], ['bagel', 'Contains a 6-0 set'], ['ret', 'Retirements']], st.type, v => { st.type = v; sync(); })),
      h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Min. minutes'), mins),
      segmented([['0', 'All'], ['1', 'Hawk-Eye only']], st.cv ? '1' : '0', v => { st.cv = v === '1'; sync(); })),
    statsHost, host);
  text.addEventListener('input', debounce(() => { st.text = text.value.trim(); sync(); }, 150));
  mins.addEventListener('input', debounce(() => { st.minMins = +mins.value || 0; sync(); }, 200));
  function sync() { setQuery({ q: st.text || null, round: st.round !== 'all' ? st.round : null, type: st.type !== 'all' ? st.type : null, mins: st.minMins || null, cv: st.cv ? '1' : null }); draw(); }

  // win probability per match (pipeline/drama.py): [lowest chance of the winner, match points saved, drama]
  let DR = null, thrill = Infinity;
  const WP_TYPES = ['escape', 'mpsaved', 'thriller'];
  lazy('data/drama.json').then(d => {
    DR = d;
    const sw = Object.values(d.byMatch).map(x => x[2]).sort((a, b) => a - b);
    thrill = sw[Math.floor(sw.length * 0.95)] ?? Infinity;
    if (WP_TYPES.includes(st.type)) draw();
  }).catch(() => {});
  function test(m) {
    if (st.round !== 'all' && m.rd !== st.round) return false;
    if (st.cv && !m.hasCV) return false;
    if (st.minMins && !(m.mins >= st.minMins)) return false;
    switch (st.type) {
      case 'upset': if (!(m.pWin != null && m.pWin < 0.5)) return false; break;
      case 'bigupset': if (!(m.pWin != null && m.pWin < 0.25)) return false; break;
      case 'rankupset': if (!((m.wRank || 3000) - (m.lRank || 3000) >= 100)) return false; break;
      case 'three': if (m.sets.length !== 3) return false; break;
      case 'straight': if (m.sets.length !== 2 || m.flag) return false; break;
      case 'tb': if (!m.sets.some(([a, b]) => Math.max(a, b) === 7 && Math.min(a, b) === 6)) return false; break;
      case 'comeback': if (!(m.sets.length === 3 && m.sets[0][0] < m.sets[0][1])) return false; break;
      case 'bagel': if (!m.sets.some(([a, b]) => (a === 6 && b === 0) || (a === 0 && b === 6))) return false; break;
      case 'ret': if (!m.flag) return false; break;
      case 'escape': { const x = DR && DR.byMatch[m.id]; if (!(x && x[0] < 0.1)) return false; break; }
      case 'mpsaved': { const x = DR && DR.byMatch[m.id]; if (!(x && x[1] > 0)) return false; break; }
      case 'thriller': { const x = DR && DR.byMatch[m.id]; if (!(x && x[2] >= thrill)) return false; break; }
    }
    if (st.text) {
      const t = st.text.toLowerCase();
      const hay = ((D.players[m.w]?.name || '') + ' ' + (D.players[m.l]?.name || '') + ' ' + (m.e?.name || '') + ' ' + (m.e?.city || '')).toLowerCase();
      if (!t.split(/\s+/).every(x => hay.includes(x))) return false;
    }
    return true;
  }
  function draw() {
    const rows = base.filter(test);
    const timed = rows.filter(m => isNum(m.mins) && !m.flag && m.mins > 20);
    clear(statsHost).appendChild(tiles([
      { label: 'Matches', value: fmtInt(rows.length) },
      { label: 'Average length', value: fmtMin(ratio(timed.reduce((a, m) => a + m.mins, 0), timed.length)) },
      { label: 'Three-setters', value: fmtPct(ratio(rows.filter(m => m.sets.length === 3).length, rows.length)) },
      { label: 'Elo favourite won', value: fmtPct(ratio(rows.filter(m => m.pWin != null && m.pWin > 0.5).length, rows.filter(m => m.pWin != null).length)) },
      { label: 'Retirements', value: fmtInt(rows.filter(m => m.flag).length) },
    ]));
    const wpCols = WP_TYPES.includes(st.type) && DR ? [
      { key: 'wpmin', label: 'Winner\'s low', title: 'Lowest chance the winner had during the match', align: 'r', get: m => DR.byMatch[m.id]?.[0], fmt: v => (!isNum(v) ? '–' : v >= 0.01 ? fmtPct(v) : `1 in ${fmtInt(Math.round(1 / v))}`), sortDir: 1 },
      { key: 'wpmp', label: 'MPs saved', title: 'Match points the winner saved before winning', align: 'r', get: m => DR.byMatch[m.id]?.[1] },
    ] : [];
    const goTab = WP_TYPES.includes(st.type) ? '?tab=flow' : '';
    clear(host).appendChild(dataTable({ rows, sortKey: st.type === 'escape' && DR ? 'wpmin' : st.type === 'mpsaved' && DR ? 'wpmp' : 'date', sortDir: st.type === 'escape' ? 1 : -1, pageSize: 50,
      cols: wpCols.length ? matchCols().filter(c => c.key !== 'tags').flatMap(c => (c.key === 'score' ? [c, ...wpCols] : [c])) : matchCols(),
      csvName: 'challenger-matches.csv', onRowClick: m => { location.hash = '#/match/' + m.id + goTab; } }));
    if (WP_TYPES.includes(st.type) && !DR) host.prepend(h('div', { class: 'empty' }, 'Loading win-probability data…'));
    // length distribution
    if (timed.length > 20) {
      const bins = new Map();
      for (const m of timed) { const b = Math.min(240, Math.floor(m.mins / 15) * 15); bins.set(b, (bins.get(b) || 0) + 1); }
      const data = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => ({ label: b >= 240 ? '4h+' : `${Math.floor(b / 60)}:${String(b % 60).padStart(2, '0')}`, value: n, tipTitle: b >= 240 ? '4 hours or more' : `${b}–${b + 14} min` }));
      host.appendChild(h('div', { class: 'mt' }, card('Match length distribution', '15-minute bins, completed matches in the current selection', el => columnChart(el, { data, fmt: fmtInt, height: 200, valueLabel: 'matches' }),
        { table: () => ({ cols: ['Length', 'Matches'], rows: data.map(d => [d.tipTitle, d.value]) }) })));
    }
  }
  draw();
}
