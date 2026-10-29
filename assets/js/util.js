// Shared helpers: DOM, formatting, countries.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an element. Text content is always set via textContent (never innerHTML). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v; // only used for trusted static markup
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c) el.appendChild(c);
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------- formatting ----------
export const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const isNum = v => typeof v === 'number' && isFinite(v);
export const fmtInt = v => isNum(v) ? nf0.format(v) : '–';
export const fmt1 = v => isNum(v) ? nf1.format(v) : '–';
export const fmt2 = v => isNum(v) ? nf2.format(v) : '–';
export const fmtPct = v => isNum(v) ? nf1.format(v * 100) + '%' : '–';
export const fmtPct0 = v => isNum(v) ? nf0.format(v * 100) + '%' : '–';
export function fmtCompact(v) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return nf0.format(v);
}
export const fmtMin = m => isNum(m) ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : '–';
export const fmtSigned = (v, f = fmt1) => isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v)) : '–';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS = MON;
export function fmtDate(iso, withYear = false) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MON[m - 1]}${withYear ? ' ' + y : ''}`;
}
export const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0) ? a / b : null;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function ageOn(dob, iso) {
  if (!dob) return null;
  const a = new Date(dob), b = iso ? new Date(iso) : new Date();
  return (b - a) / (365.2425 * 864e5);
}
export function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function csvDownload(name, rows) {
  const esc = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- countries (IOC code -> name, region, ISO flag code) ----------
const C = `ALG Algeria AF dz|ANT Antigua & Barbuda NA ag|ARG Argentina SA ar|AUS Australia OC au|AUT Austria EU at|
BAH Bahamas NA bs|BAR Barbados NA bb|BDI Burundi AF bi|BEL Belgium EU be|BER Bermuda NA bm|BIH Bosnia & Herzegovina EU ba|
BLR Belarus EU -|BOL Bolivia SA bo|BOT Botswana AF bw|BRA Brazil SA br|BRN Bahrain AS bh|BUL Bulgaria EU bg|
CAL New Caledonia OC nc|CAN Canada NA ca|CGO Congo AF cg|CHI Chile SA cl|CHN China AS cn|CIV Côte d'Ivoire AF ci|
COD DR Congo AF cd|COL Colombia SA co|CRC Costa Rica NA cr|CRO Croatia EU hr|CYP Cyprus EU cy|CZE Czechia EU cz|
DEN Denmark EU dk|DOM Dominican Republic NA do|ECU Ecuador SA ec|EGY Egypt AF eg|ESP Spain EU es|EST Estonia EU ee|
FIN Finland EU fi|FRA France EU fr|GBR Great Britain EU gb|GEO Georgia EU ge|GER Germany EU de|GRE Greece EU gr|
HKG Hong Kong AS hk|HUN Hungary EU hu|INA Indonesia AS id|IND India AS in|IRI Iran AS ir|IRL Ireland EU ie|
ISR Israel AS il|ITA Italy EU it|JAM Jamaica NA jm|JOR Jordan AS jo|JPN Japan AS jp|KAZ Kazakhstan AS kz|
KOR South Korea AS kr|LAT Latvia EU lv|LBN Lebanon AS lb|LTU Lithuania EU lt|LUX Luxembourg EU lu|MAR Morocco AF ma|
MAS Malaysia AS my|MDA Moldova EU md|MEX Mexico NA mx|MKD North Macedonia EU mk|MLT Malta EU mt|MON Monaco EU mc|
NAM Namibia AF na|NED Netherlands EU nl|NEP Nepal AS np|NGR Nigeria AF ng|NMI Northern Mariana Islands OC mp|
NOR Norway EU no|NZL New Zealand OC nz|PAK Pakistan AS pk|PAR Paraguay SA py|PER Peru SA pe|PHI Philippines AS ph|
POC Pacific Oceania OC -|POL Poland EU pl|POR Portugal EU pt|ROU Romania EU ro|RSA South Africa AF za|RUS Russia EU -|
RWA Rwanda AF rw|SLO Slovenia EU si|SMR San Marino EU sm|SRB Serbia EU rs|SUI Switzerland EU ch|SVK Slovakia EU sk|
SWE Sweden EU se|SYR Syria AS sy|THA Thailand AS th|TOG Togo AF tg|TPE Chinese Taipei AS tw|TUN Tunisia AF tn|
TUR Türkiye EU tr|UAE United Arab Emirates AS ae|UKR Ukraine EU ua|URU Uruguay SA uy|USA United States NA us|
UZB Uzbekistan AS uz|VEN Venezuela SA ve|VIE Vietnam AS vn|ZIM Zimbabwe AF zw|PYF French Polynesia OC pf|
REU Réunion AF re|KOS Kosovo EU xk|ALB Albania EU al|ARM Armenia EU am|AZE Azerbaijan EU az`;
export const COUNTRIES = {};
for (const row of C.replace(/\n/g, '').split('|')) {
  const m = row.trim().match(/^([A-Z]{3}) (.+) ([A-Z]{2}) ([a-z]{2}|-)$/);
  if (m) COUNTRIES[m[1]] = { name: m[2], region: m[3], iso: m[4] === '-' ? null : m[4] };
}
export const REGIONS = { EU: 'Europe', NA: 'North & Central America', SA: 'South America', AS: 'Asia', OC: 'Oceania', AF: 'Africa' };
export const countryName = cc => (COUNTRIES[cc] && COUNTRIES[cc].name) || cc || '–';
export const regionOf = cc => (COUNTRIES[cc] && COUNTRIES[cc].region) || null;

/** Small flag image (self-hosted SVG) for an IOC code; neutral athletes get no flag. */
export function flag(cc, cls = 'flag') {
  const c = COUNTRIES[cc];
  if (!c || !c.iso) return null;
  return h('img', { class: cls, src: `lib/flags/${c.iso}.svg`, alt: '', width: 16, height: 12, loading: 'lazy', decoding: 'async' });
}
export function countryChip(cc) {
  return h('span', { class: 'cc', title: countryName(cc) }, flag(cc), cc || '—');
}

export const ROUND_NAMES = {
  Q1: 'Qualifying R1', Q2: 'Qualifying R2', Q3: 'Qualifying R3', Q: 'Qualifying', R64: 'Round of 64', R48: 'Round of 48',
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final',
};
export const ROUND_ORDER = { Q1: 1, Q2: 2, Q3: 3, Q: 3, R64: 5, R48: 5, R32: 6, R16: 7, QF: 8, SF: 9, F: 10 };
export const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
