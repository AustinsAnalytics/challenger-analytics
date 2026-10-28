// Shared page components.
import { h, clear, fmtDate, fmtPct, fmtInt, isNum, ROUND_NAMES, countryName, countryChip, debounce, ageOn, fmt1 } from './util.js';
import { D, METRICS, mval, surfaceColorVar, aggregateFiltered, F, SEASON } from './data.js';
import { pctBar } from './charts.js';

export function playerLink(pid, { short = false, cc = true, tag = null, rank = null } = {}) {
  const p = D.players[pid];
  const name = p ? (short ? p.short : p.name) : pid;
  return h('span', { class: 'plink' },
    cc && p && p.c ? countryChip(p.c) : null,
    h('a', { class: 'pl', href: '#/player/' + pid, title: p ? p.name : pid }, name),
    tag ? h('span', { class: 'seed' }, '(' + tag + ')') : null,
    rank ? h('span', { class: 'seed' }, '#' + rank) : null);
}
export function eventLink(e, { city = true } = {}) {
  if (!e) return '–';
  return h('a', { href: '#/tournament/' + e.id, class: 'pl', title: e.name }, city ? (e.city || e.name) : e.name);
}
export function surfaceDot(surf) {
  return h('span', { class: 'sdot', style: { background: surfaceColorVar(surf) }, title: surf });
}
export function surfaceLabel(surf) { return h('span', {}, surfaceDot(surf), surf); }
export function roundLabel(rd) { return h('span', { title: ROUND_NAMES[rd] || rd }, rd); }
export function matchHref(m) { return '#/match/' + m.id; }
export function badges(m) {
  return h('span', { class: 'row', style: { gap: '4px', display: 'inline-flex' } },
    m.hasCV ? h('span', { class: 'badge he', title: 'Hawk-Eye CourtVision tracking available' }, 'HAWK-EYE') : null,
    m.flag ? h('span', { class: 'badge ret' }, m.flag) : null);
}
export function upsetProb(m) { return m.pWin; }

export function tiles(items) {
  return h('div', { class: 'tiles' + (items.length >= 4 && items.length <= 6 ? ' n' + items.length : '') }, items.map(it => h('div', { class: 'tile', title: it.title || '' },
    h('div', { class: 'label' }, it.label), h('div', { class: 'value' }, it.value), it.delta ? h('div', { class: 'delta' }, it.delta) : null)));
}

export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  const draw = v => {
    clear(el);
    for (const [k, label] of options) {
      el.appendChild(h('button', { type: 'button', class: k === v ? 'on' : '', 'aria-pressed': k === v ? 'true' : 'false', onclick: () => { draw(k); onChange(k); } }, label));
    }
  };
  draw(value);
  return el;
}

/** On narrow screens the tab strip scrolls sideways: keep the selected tab in view. */
export function keepTabVisible(tabsEl) {
  requestAnimationFrame(() => {
    const on = tabsEl.querySelector('.on');
    if (on && tabsEl.scrollWidth > tabsEl.clientWidth) tabsEl.scrollLeft = Math.max(0, on.offsetLeft - tabsEl.offsetLeft - 24);
  });
}

export function selectEl(options, value, onChange, attrs = {}) {
  const sel = h('select', attrs, options.map(([v, t]) => h('option', { value: v }, t)));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function pageHead(eyebrow, title, desc, right) {
  return h('div', { class: 'page-head' },
    h('div', {}, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h1', {}, title), desc ? h('p', {}, desc) : null),
    right || null);
}

/** Percentile of value among values (direction-aware). */
export function percentile(v, values, dir = 1) {
  if (!isNum(v) || !values.length) return null;
  let below = 0, eq = 0;
  for (const x of values) { if (x < v) below++; else if (x === v) eq++; }
  const p = (below + eq / 2) / values.length;
  return dir < 0 ? 1 - p : p;
}

/** Reference distribution of each metric among qualified players (>= minM matches) under current filters. */
export function metricDistributions(keys, minM = 10) {
  const agg = aggregateFiltered();
  const out = {};
  for (const k of keys) {
    const arr = [];
    for (const a of agg.values()) {
      if (a.m < minM) continue;
      const m = METRICS[k];
      if (m.n && m.n(a) < minM * 0.5) continue;
      const v = mval(k, a);
      if (isNum(v)) arr.push(v);
    }
    out[k] = arr;
  }
  return out;
}

/** Grouped metric rows with value, percentile bar and percentile number. */
export function metricList(a, groups, { minM = 10, color = 'var(--series-1)' } = {}) {
  const keys = groups.flatMap(g => g[1]);
  const dist = metricDistributions(keys, minM);
  const wrap = h('div', { class: 'mlist' });
  for (const [gname, gkeys] of groups) {
    wrap.appendChild(h('div', { class: 'mgroup' }, gname));
    for (const k of gkeys) {
      const m = METRICS[k];
      const v = mval(k, a);
      const ok = isNum(v) && (!m.n || m.n(a) > 0);
      const p = ok && m.dir !== 0 ? percentile(v, dist[k], m.dir) : null;
      wrap.appendChild(h('div', { class: 'mrow', title: m.desc || m.label },
        h('span', {}, m.label), h('span', { class: 'mv' }, ok ? m.fmt(v) : '–'),
        m.dir !== 0 ? pctBar(p, { color }) : h('span', { class: 'muted', style: { fontSize: '11.5px' } }, 'style metric'),
        h('span', { class: 'mp' }, p != null ? ordinal(Math.round(p * 100)) : '')));
    }
  }
  return wrap;
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Player search picker. */
export function playerPicker(value, onPick, { placeholder = 'Search a player…', minMatches = 1 } = {}) {
  const wrap = h('div', { class: 'picker' });
  const input = h('input', { type: 'search', placeholder, value: value ? D.players[value]?.name || '' : '', 'aria-label': placeholder });
  const list = h('div', { class: 'picker-list', hidden: true });
  wrap.append(input, list);
  const pool = Object.values(D.players).filter(p => (D.byPlayer[p.id] || []).length >= minMatches)
    .map(p => ({ p, key: p.name.toLowerCase(), n: D.byPlayer[p.id].length }));
  const render = () => {
    const q = input.value.trim().toLowerCase();
    clear(list);
    if (q.length < 2) { list.hidden = true; return; }
    const res = pool.filter(x => q.split(/\s+/).every(t => x.key.includes(t))).sort((a, b) => b.n - a.n).slice(0, 10);
    for (const x of res) list.appendChild(h('button', { type: 'button', onclick: () => { input.value = x.p.name; list.hidden = true; onPick(x.p.id); } },
      countryChip(x.p.c), x.p.name, h('span', { class: 'muted', style: { marginLeft: 'auto' } }, x.n + ' matches')));
    list.hidden = !res.length;
  };
  input.addEventListener('input', debounce(render, 60));
  input.addEventListener('focus', render);
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) list.hidden = true; });
  return wrap;
}

/** Standard match table columns. perspective: optional pid to show result from that player's side. */
export function matchCols(perspective = null) {
  const cols = [
    { key: 'date', label: 'Date', get: m => m.t, render: m => fmtDate(m.date), sortDir: -1 },
    { key: 'event', label: 'Tournament', get: m => m.e ? m.e.city : '', render: m => h('span', {}, surfaceDot(m.surface), eventLink(m.e)), sortDir: 1 },
    { key: 'rd', label: 'Rd', title: 'Round: Q1-Q3 qualifying, then round of 32 (R32), round of 16, quarterfinal, semifinal, final', get: m => m.rd, render: m => roundLabel(m.rd), sortDir: 1 },
  ];
  if (perspective) {
    cols.push(
      { key: 'res', label: 'W/L', get: m => m.w === perspective ? 1 : 0, render: m => m.w === perspective ? h('span', { class: 'win-mark' }, 'W') : h('span', { class: 'muted' }, 'L') },
      { key: 'opp', label: 'Opponent', get: m => D.players[m.w === perspective ? m.l : m.w]?.name, render: m => { const o = m.w === perspective ? m.l : m.w; return playerLink(o, { tag: m.w === perspective ? m.lTag : m.wTag }); }, sortDir: 1 },
      { key: 'orank', label: 'Opp rank', title: "Opponent's ATP singles ranking in the week of the match (NR = unranked)", align: 'r', get: m => m.w === perspective ? m.lRank : m.wRank, fmt: v => v ? '#' + v : 'NR', sortDir: 1 },
      { key: 'score', label: 'Score', get: false, render: m => m.w === perspective ? m.score : flipScore(m) },
    );
  } else {
    cols.push(
      { key: 'w', label: 'Winner', get: m => D.players[m.w]?.name, render: m => playerLink(m.w, { tag: m.wTag }), sortDir: 1 },
      { key: 'wr', label: 'Rank', title: "Winner's ATP singles ranking in the week of the match (NR = unranked)", align: 'r', get: m => m.wRank, fmt: v => v ? '#' + v : 'NR', sortDir: 1 },
      { key: 'l', label: 'Loser', get: m => D.players[m.l]?.name, render: m => playerLink(m.l, { tag: m.lTag }), sortDir: 1 },
      { key: 'lr', label: 'Rank', title: "Loser's ATP singles ranking in the week of the match", align: 'r', get: m => m.lRank, fmt: v => v ? '#' + v : 'NR', sortDir: 1 },
      { key: 'score', label: 'Score', get: false, render: m => m.score },
    );
  }
  cols.push(
    { key: 'mins', label: 'Time', title: 'Match length in hours:minutes', align: 'r', get: m => m.mins, fmt: v => isNum(v) ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : '–' },
    { key: 'pwin', label: 'Win prob.', align: 'r', title: perspective ? "This player's chance of winning before the match, from Elo ratings" : "The winner's chance before the match, from Elo ratings. Under 50% means an upset", get: m => perspective ? (m.w === perspective ? m.pWin : (m.pWin != null ? 1 - m.pWin : null)) : m.pWin, fmt: fmtPct },
    { key: 'tags', label: '', get: false, render: m => badges(m) },
  );
  return cols;
}
export function flipScore(m) {
  const s = m.sets.map(([a, b, tb]) => tb != null ? `${b}-${a}(${tb})` : `${b}-${a}`).join(' ');
  return s + (m.flag === 'RET' ? ' ret.' : '');
}
export function ageStr(pid) {
  const p = D.players[pid];
  if (!p || !p.dob) return null;
  return Math.floor(ageOn(p.dob));
}
export function handStr(p) {
  if (!p) return '–';
  const hand = p.h === 'L' ? 'Left-handed' : p.h === 'R' ? 'Right-handed' : null;
  const bh = p.bh === '1' ? 'one-handed BH' : p.bh === '2' ? 'two-handed BH' : null;
  return [hand, bh].filter(Boolean).join(', ') || '–';
}
export function minMatchesControl(value, onChange, opts = [2, 3, 5, 10, 15, 20, 30]) {
  return h('label', { class: 'fb-item' }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 550 } }, 'Min. matches'),
    selectEl(opts.map(v => [String(v), String(v)]), String(value), v => onChange(+v)));
}
export function filterSummary() {
  const parts = [];
  if (F.surface !== 'all') parts.push(F.surface);
  if (F.cat !== 'all') parts.push('Challenger ' + F.cat);
  if (F.draw !== 'all') parts.push(F.draw === 'main' ? 'main draw' : 'qualifying');
  if (F.io !== 'all') parts.push(F.io === 'I' ? 'indoor' : 'outdoor');
  if (F.period !== 'all') parts.push(document.querySelector('#f-period option:checked')?.textContent || F.period);
  if (F.region !== 'all') parts.push(document.querySelector('#f-region option:checked')?.textContent || F.region);
  return parts.length ? parts.join(' · ') : `Full ${SEASON} season, all events`;
}
export { fmtPct, fmtInt, fmt1 };
