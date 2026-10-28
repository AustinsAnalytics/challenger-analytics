// App shell: routing, header, global filters, search.
import { h, $, clear, store, REGIONS, countryName, countryChip, debounce } from './util.js';
import { D, F, loadCore, PERIODS, filtered, SEASON, SEASONS, CURRENT_SEASON, seasonHref, lazy, isAdv, setMode } from './data.js';
import { hideTip } from './charts.js';

const ROUTES = {
  '': ['Overview', () => import('./pages/overview.js')],
  rankings: ['Rankings', () => import('./pages/rankings.js')],
  players: ['Players', () => import('./pages/players.js')],
  player: [null, () => import('./pages/player.js')],
  matches: ['Matches', () => import('./pages/matches.js')],
  match: [null, () => import('./pages/match.js')],
  tournaments: ['Tournaments', () => import('./pages/tournaments.js')],
  tournament: [null, () => import('./pages/tournament.js')],
  leaders: ['Leaders', () => import('./pages/leaders.js')],
  compare: ['Head-to-Head', () => import('./pages/compare.js')],
  play: ['Play', () => import('./pages/play.js')],
  betting: ['Betting', () => import('./pages/betting.js')],
  insights: ['Insights', () => import('./pages/insights.js')],
  hawkeye: ['Hawk-Eye Lab', () => import('./pages/hawkeye.js')],
  about: ['About', () => import('./pages/about.js')],
};
// Pages whose content ignores the global filters (they hide the filter bar).
const NO_FILTERS = new Set(['match', 'tournament', 'hawkeye', 'about', 'betting', 'play']);

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { page: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : null, params };
}
export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
export function setQuery(params) {
  const { page, id } = parseHash();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const next = '#/' + page + (id ? '/' + encodeURIComponent(id) : '') + (qs ? '?' + qs : '');
  history.replaceState(null, '', next);
}

// Pages listed in the menu only in advanced mode (still reachable by link)
const ADV_PAGES = new Set(['hawkeye']);
const NAV_HINTS = {
  '': 'Season at a glance: latest results, title races, leaders',
  rankings: 'Power rankings by Elo, a rating built from match results',
  players: 'Every player with sortable serve, return and pressure stats',
  matches: 'Search every match: upsets, comebacks, longest, Hawk-Eye',
  tournaments: 'Calendar, champions, court speed and draws',
  leaders: 'Best and worst on each statistic',
  compare: 'Two players side by side, with a match prediction',
  play: 'Daily mystery-player game, a point-by-point match simulator and the Elo race',
  betting: "Tomorrow's matches: our odds against the sportsbooks",
  insights: 'Season-wide patterns: upsets, comebacks, ages, nations',
  hawkeye: 'Ball-tracking data: serve placement, shot speed, net clearance',
  about: 'Where the data comes from and how each number is worked out',
};
function buildNav() {
  const nav = clear($('#nav'));
  for (const [key, [label]] of Object.entries(ROUTES)) {
    if (!label || (ADV_PAGES.has(key) && !isAdv())) continue;
    nav.appendChild(h('a', { href: '#/' + key, 'data-k': key, title: NAV_HINTS[key] || '' }, label));
  }
}
function markNav(page) {
  const active = { player: 'players', match: 'matches', tournament: 'tournaments' }[page] ?? page;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.k === active);
}

function select(id, label, options, value, onChange) {
  const sel = h('select', { id, 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));
  sel.value = value;
  sel.classList.toggle('on', value !== 'all');
  sel.addEventListener('change', () => { sel.classList.toggle('on', sel.value !== 'all'); onChange(sel.value); });
  return h('div', { class: 'fb-item' }, h('label', { for: id }, label), sel);
}
function buildFilters() {
  const bar = clear($('#filterbar'));
  const inner = h('div', { class: 'filterbar-in' });
  bar.appendChild(inner);
  const surfaces = [...new Set(D.eventList.map(e => e.surface))].filter(Boolean).sort();
  const cats = [...new Set(D.eventList.map(e => e.cat))].filter(Boolean).sort((a, b) => a - b);
  const regions = [...new Set(D.eventList.map(e => e.region))].filter(Boolean);
  const set = (k, v) => { F[k] = v; store.set('ca-filters', F); refreshCount(); route(); };
  const more = (k, el) => (isAdv() || F[k] !== 'all' ? el : null);      // simple mode: period and surface only
  inner.append(
    select('f-period', 'Period', PERIODS(), F.period, v => set('period', v)),
    select('f-surface', 'Surface', [['all', 'All surfaces'], ...surfaces.map(s => [s, s])], F.surface, v => set('surface', v)),
    ...[more('cat', select('f-cat', 'Category', [['all', 'All categories'], ...cats.map(c => [String(c), 'Challenger ' + c])], F.cat, v => set('cat', v))),
      more('draw', select('f-draw', 'Draw', [['all', 'Main + qualifying'], ['main', 'Main draw'], ['qual', 'Qualifying']], F.draw, v => set('draw', v))),
      more('io', select('f-io', 'Venue', [['all', 'Indoor + outdoor'], ['O', 'Outdoor'], ['I', 'Indoor']], F.io, v => set('io', v))),
      more('region', select('f-region', 'Region', [['all', 'All regions'], ...regions.map(r => [r, REGIONS[r] || r])], F.region, v => set('region', v)))].filter(Boolean),
    h('button', { class: 'btn-ghost fb-reset', type: 'button', onclick: () => {
      Object.assign(F, { period: 'all', surface: 'all', cat: 'all', draw: 'all', io: 'all', region: 'all' });
      store.set('ca-filters', F); buildFilters(); route();
    } }, 'Reset'),
    h('span', { class: 'fb-count', id: 'fb-count' }));
  // phones: the filters fold behind one button that says what is active
  const active = [...inner.querySelectorAll('select')].filter(sl => sl.value !== 'all').map(sl => sl.selectedOptions[0]?.textContent);
  const toggle = h('button', { class: 'fb-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'filterbar' },
    h('span', { class: 'fb-toggle-k' }, 'Filters'), h('span', { class: 'fb-toggle-v' + (active.length ? ' on' : '') }, active.length ? active.join(' · ') : 'All matches'));
  toggle.addEventListener('click', () => { const open = bar.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); });
  inner.prepend(toggle);
  refreshCount();
}
function refreshCount() {
  const el = $('#fb-count');
  if (el) el.textContent = `${filtered().length.toLocaleString()} matches in view`;
}

function buildSearch() {
  const box = clear($('#search'));
  const input = h('input', { type: 'search', placeholder: 'Search players, events…', 'aria-label': 'Search players and tournaments', autocomplete: 'off' });
  const icon = h('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' });
  const list = h('div', { class: 'search-results', hidden: true, role: 'listbox' });
  box.append(icon.firstChild, input, list);
  const idx = [
    ...Object.values(D.players).map(p => ({ kind: 'Player', label: p.name, sub: p.c, href: '#/player/' + p.id, key: (p.name + ' ' + (p.c || '')).toLowerCase(), weight: (D.byPlayer[p.id] || []).length })),
    ...D.eventList.map(e => ({ kind: 'Event', label: `${e.city || e.name}`, sub: e.name, cc: e.cc, href: '#/tournament/' + e.id, key: (e.name + ' ' + e.city + ' ' + (e.loc || '')).toLowerCase(), weight: 1000 })),
  ];
  // players who only appear in other seasons (data/seasons.json), loaded on first use and linked to that season
  let otherSeasons = null;
  const addOtherSeasons = () => {
    if (otherSeasons) return;
    otherSeasons = lazy('data/seasons.json').then(S => {
      const C = Object.fromEntries(S.cols.map((c, i) => [c, i]));
      for (const [pid, rec] of Object.entries(S.players)) {
        if (D.players[pid] || !S.names[pid]) continue;
        const ys = Object.keys(rec).map(Number).sort((a, b) => b - a);
        const [name, cc] = S.names[pid];
        idx.push({ kind: `Player · ${ys.join(', ')}`, player: true, label: name, sub: cc, href: seasonHref(ys[0], '#/player/' + pid),
          key: (name + ' ' + (cc || '')).toLowerCase(), weight: (rec[ys[0]][C.w] + rec[ys[0]][C.l]) / 1000 - 1 });
      }
      if (input.value.trim().length >= 2) render();
    }).catch(() => {});
  };
  input.addEventListener('focus', addOtherSeasons);
  let sel = 0, cur = [];
  const go = x => { if (x.href.startsWith('#')) location.hash = x.href; else location.href = x.href; };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { list.hidden = true; return; }
    const terms = q.split(/\s+/);
    cur = idx.filter(x => terms.every(t => x.key.includes(t))).sort((a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || b.weight - a.weight).slice(0, 12);
    clear(list);
    cur.forEach((x, i) => list.appendChild(h('a', { href: x.href, class: i === sel ? 'sel' : '', onclick: () => { list.hidden = true; input.value = ''; } },
      x.kind === 'Player' || x.player ? countryChip(x.sub) : (x.cc ? countryChip(x.cc) : null), h('span', {}, x.label),
      x.kind === 'Event' ? h('span', { class: 'muted' }, x.sub) : null, h('span', { class: 'kind' }, x.kind))));
    if (!cur.length) list.appendChild(h('div', { class: 'empty' }, 'No matches'));
    list.hidden = false;
  };
  input.addEventListener('input', debounce(() => { sel = 0; render(); }, 80));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(cur.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && cur[sel]) { go(cur[sel]); list.hidden = true; input.value = ''; input.blur(); }
    else if (e.key === 'Escape') { list.hidden = true; input.blur(); }
  });
  document.addEventListener('click', e => { if (!box.contains(e.target)) list.hidden = true; });
  // "/" jumps to search from anywhere (unless typing in a field)
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    input.focus();
  });
  if (!input.placeholder.includes('/')) input.title = 'Press / to search';
}

let routeToken = 0;
let lastWhere = null;
export async function route() {
  hideTip();
  const { page, id, params } = parseHash();
  const entry = ROUTES[page] || ROUTES[''];
  markNav(page);
  $('#filterbar').hidden = NO_FILTERS.has(page);
  const token = ++routeToken;
  if (page === 'betting' && SEASON !== CURRENT_SEASON) {
    const app = clear($('#app'));
    app.appendChild(h('div', { class: 'card' }, h('h3', {}, `Betting covers the ${CURRENT_SEASON} season`),
      h('p', { class: 'muted' }, `The slate, model and track record use the season in progress. You are looking at the ${SEASON} archive.`),
      h('a', { class: 'btn', href: seasonHref(CURRENT_SEASON, '#/betting') }, `Open ${CURRENT_SEASON} betting →`)));
    document.title = 'Betting · Challenger Analytics';
    return;
  }
  const mod = await entry[1]();
  if (token !== routeToken) return;
  const app = clear($('#app'));
  const where = page + '/' + (id || '');
  if (where !== lastWhere) { window.scrollTo(0, 0); lastWhere = where; }
  try {
    await mod.render(app, { id, params });
  } catch (e) {
    console.error(e);
    app.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Something went wrong'), h('p', { class: 'muted' }, String(e.message || e))));
  }
  const title = entry[0] || (app.dataset.title || '');
  document.title = (title ? title + ' · ' : '') + 'Challenger Analytics';
}

function seasonSwitch() {
  if (SEASONS.length < 2) return;
  const badge = $('#season-badge');
  if (badge) badge.remove();
  const sel = h('select', { class: 'season-select', 'aria-label': 'Season', title: 'Switch season' },
    SEASONS.map(y => h('option', { value: String(y), selected: y === SEASON ? 'selected' : null }, String(y))));
  sel.addEventListener('change', () => { location.href = seasonHref(+sel.value); });
  const row = $('#brand-row');
  if (row) row.appendChild(sel);
  const lh = document.querySelector('.loading h2');
  if (lh) lh.textContent = `Loading the ${SEASON} season…`;
  if (SEASON !== CURRENT_SEASON) document.body.classList.add('past-season');
}

function modeSwitch() {
  const mk = (adv, label, hint) => h('button', { type: 'button', 'data-adv': adv ? '1' : '0', title: hint }, label);
  const box = h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'View mode' },
    mk(false, 'Simple', 'Key numbers with plain labels (tap to switch on phones)'), mk(true, 'Advanced', 'Every stat, column and technical section (tap to switch on phones)'));
  const paint = () => {
    document.body.classList.toggle('mode-simple', !isAdv());
    document.body.classList.toggle('mode-advanced', isAdv());
    for (const b of box.querySelectorAll('button')) { const on = (b.dataset.adv === '1') === isAdv(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    const compact = window.matchMedia('(max-width: 640px)').matches;      // phones show one button that flips the mode
    const want = compact ? !isAdv() : b.dataset.adv === '1';
    if (want === isAdv()) return;
    setMode(want);
    paint();
    if (D.core) { buildNav(); markNav(parseHash().page); buildFilters(); route(); }
  });
  paint();
  const row = $('#brand-row');
  if (row) row.appendChild(box);
}

async function start() {
  seasonSwitch();
  modeSwitch();
  const saved = store.get('ca-filters', null);
  if (saved) Object.assign(F, saved);
  try {
    await loadCore(p => { const b = $('#load-bar'); if (b) b.style.width = (p * 100).toFixed(0) + '%'; });
  } catch (e) {
    clear($('#app')).appendChild(h('div', { class: 'card' }, h('h3', {}, 'Data failed to load'), h('p', { class: 'muted' }, String(e.message || e))));
    return;
  }
  buildNav(); buildFilters(); buildSearch();
  const upd = updatedLabel();
  if (SEASON === CURRENT_SEASON) $('#updated').append(h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Updated ' + upd);
  else $('#updated').append(h('a', { href: seasonHref(CURRENT_SEASON), title: `Back to the ${CURRENT_SEASON} season` }, `${SEASON} archive · back to ${CURRENT_SEASON} →`));
  $('#footer').append(
    h('span', {}, `Data: ATP Tour, Infosys & Hawk-Eye stats feeds · ${SEASON} season · ${D.matches.length.toLocaleString()} singles matches · ${D.eventList.length} tournaments${SEASON === CURRENT_SEASON ? ` · last updated ${upd}` : ''}. `),
    h('a', { href: '#/about' }, 'Methodology'),
    h('span', {}, ' · Independent fan project, not affiliated with the ATP.'));
  window.addEventListener('hashchange', route);
  route();
}
/** Local, human-friendly "last updated" label from the build timestamp. */
export function updatedLabel() {
  const d = new Date(D.core.generated.replace('Z', ':00Z'));
  if (isNaN(d)) return D.core.generated.slice(0, 10);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
start();
export { countryName };
