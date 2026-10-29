// Minimal SVG chart kit: line, bars, columns, stacked bars, scatter, sparkline, heat strip.
// Marks follow one spec: 2px lines, <=24px bars with 4px rounded data-ends, hairline solid grids,
// 8px markers with a 2px surface ring, one tooltip, legends for >= 2 series.
import { h, s, clear, isNum, fmt1, MONTHS, debounce } from './util.js';

// ---------- tooltip ----------
let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = h('div', { class: 'tooltip', role: 'status' }); document.body.appendChild(tipEl); }
  return tipEl;
}
/** rows: [{value, label, color, line:true}] ; title optional */
export function showTip(ev, title, rows = [], note) {
  const t = clear(tip());
  if (title) t.appendChild(h('div', { class: 'tt-title' }, title));
  for (const r of rows) {
    t.appendChild(h('div', { class: 'tt-row' },
      r.color ? h('span', { class: r.line === false ? 'tt-key tt-dot' : 'tt-key', style: { background: r.color } }) : null,
      h('span', { class: 'tt-val' }, r.value), h('span', { class: 'tt-lab' }, r.label || '')));
  }
  if (note) t.appendChild(h('div', { class: 'tt-note' }, note));
  t.style.display = 'block';
  const pad = 14, W = window.innerWidth, H = window.innerHeight;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > W - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > H - 8) y = ev.clientY - r.height - pad;
  t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---------- scales ----------
export function linear(d0, d1, r0, r1) {
  const f = v => d1 === d0 ? (r0 + r1) / 2 : r0 + (v - d0) * (r1 - r0) / (d1 - d0);
  f.inv = p => d0 + (p - r0) * (d1 - d0) / (r1 - r0);
  return f;
}
export function niceTicks(min, max, count = 5, integer = false) {
  if (!isNum(min) || !isNum(max)) return [];
  if (min === max) { max = min + 1; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map(x => x * mag).find(x => span / x <= count + 0.5) || mag * 10;
  if (integer) step = Math.max(1, Math.round(step));
  const t0 = Math.ceil(min / step - 1e-9) * step;
  const out = [];
  for (let v = t0; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}
export function niceDomain(min, max, count = 5, zero = false, integer = false) {
  if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { min -= 1; max += 1; }
  const t = niceTicks(min, max, count, integer);
  const step = t.length > 1 ? t[1] - t[0] : 1;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** Mount a responsive chart: re-renders on width change. */
export function mount(el, render) {
  let lastW = 0;
  const draw = () => {
    const w = Math.max(240, Math.floor(el.clientWidth));
    if (w === lastW) return;
    lastW = w; clear(el); render(w);
  };
  draw();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(debounce(() => { if (!el.isConnected) { ro.disconnect(); return; } draw(); }, 80));
    ro.observe(el);
  }
}

function legend(items) {
  return h('div', { class: 'legend' }, items.map(it => h('span', { class: 'lg-item' },
    h('span', { class: it.kind === 'line' ? 'lg-line' : it.kind === 'dot' ? 'lg-dot' : 'lg-rect', style: { background: it.color } }),
    it.label)));
}

// Axis ticks drop a trailing ".0" (60.0% -> 60%) to stay compact.
const tickText = t => String(t).replace(/\.0(?=%|$| )/, '');
function axisLeft(g, ticks, y, x0, x1, fmt) {
  for (const t of ticks) {
    g.appendChild(s('line', { x1: x0, x2: x1, y1: y(t), y2: y(t), class: 'grid' }));
    g.appendChild(s('text', { x: x0 - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle', text: tickText(fmt(t)) }));
  }
}

// ---------- line chart ----------
/**
 * opts: { series:[{name,color,values:[{x,y,meta}]}], height, xType:'time'|'num', xFmt, yFmt, yMin, yMax, yZero,
 *         endLabels, markers, refY:[{y,label}], tipTitle(x), onClick(point,series) }
 */
export function lineChart(el, o) {
  const wrap = h('div', { class: 'chart' });
  el.appendChild(wrap);
  const series = o.series.filter(sr => sr.values.length);
  if (series.length > 1 && o.legend !== false) el.insertBefore(legend(series.map(sr => ({ label: sr.name, color: sr.color, kind: 'line' }))), wrap);
  mount(wrap, W => {
    const H = o.height || 260;
    const m = { t: 12, r: o.endLabels && series.length <= 4 ? 96 : 16, b: 28, l: o.yAxisWidth || 44 };
    const all = series.flatMap(sr => sr.values);
    if (!all.length) { wrap.appendChild(h('div', { class: 'empty' }, 'No data for this selection')); return; }
    let xMin = Math.min(...all.map(p => p.x)), xMax = Math.max(...all.map(p => p.x));
    if (o.xMin != null) xMin = o.xMin; if (o.xMax != null) xMax = o.xMax;
    let yMin = o.yMin ?? Math.min(...all.map(p => p.y)), yMax = o.yMax ?? Math.max(...all.map(p => p.y));
    if (o.refY) for (const r of o.refY) { yMin = Math.min(yMin, r.y); yMax = Math.max(yMax, r.y); }
    [yMin, yMax] = o.yFixed ? [yMin, yMax] : niceDomain(yMin, yMax, 5, o.yZero);
    const x = linear(xMin, xMax, m.l, W - m.r), y = linear(yMin, yMax, H - m.b, m.t);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'svg' });
    const g = s('g');
    svg.appendChild(g);
    axisLeft(g, niceTicks(yMin, yMax, 5), y, m.l, W - m.r, o.yFmt || fmt1);
    // x ticks
    if (o.xType === 'time') {
      const d0 = new Date(xMin), d1 = new Date(xMax);
      const months = [];
      for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + (d0.getUTCDate() > 1 ? 1 : 0), 1)); d <= d1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(+d);
      const every = Math.ceil(months.length / Math.max(2, Math.floor((W - m.l - m.r) / 60)));
      months.forEach((t, i) => { if (i % every) return; g.appendChild(s('text', { x: x(t), y: H - 8, class: 'tick', 'text-anchor': 'middle', text: MONTHS[new Date(t).getUTCMonth()] })); });
    } else {
      for (const t of niceTicks(xMin, xMax, Math.max(2, Math.floor((W - m.l - m.r) / 70)))) {
        g.appendChild(s('text', { x: x(t), y: H - 8, class: 'tick', 'text-anchor': 'middle', text: (o.xFmt || fmt1)(t) }));
      }
    }
    g.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }));
    if (o.refY) for (const r of o.refY) {
      g.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(r.y), y2: y(r.y), class: 'ref' }));
      if (r.label) g.appendChild(s('text', { x: m.l + 4, y: y(r.y) - 5, class: 'ref-label', text: r.label }));
    }
    if (o.bands) for (const b of o.bands) {
      g.appendChild(s('rect', { x: x(b.x0), width: Math.max(1, x(b.x1) - x(b.x0)), y: m.t, height: H - m.b - m.t, class: 'band' }));
    }
    for (const sr of series) {
      const pts = sr.values;
      if (sr.area) {
        const d = `M${x(pts[0].x)},${y(yMin)} ` + pts.map(p => `L${x(p.x)},${y(p.y)}`).join(' ') + ` L${x(pts[pts.length - 1].x)},${y(yMin)} Z`;
        g.appendChild(s('path', { d, fill: sr.color, 'fill-opacity': 0.1, stroke: 'none' }));
      }
      const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p.x).toFixed(1) + ',' + y(p.y).toFixed(1)).join('');
      g.appendChild(s('path', { d, class: 'line', stroke: sr.color, 'stroke-dasharray': sr.dash || null }));
      if (o.markers && pts.length < 60) for (const p of pts) g.appendChild(s('circle', { cx: x(p.x), cy: y(p.y), r: 4, fill: sr.color, class: 'marker' }));
      const last = pts[pts.length - 1];
      g.appendChild(s('circle', { cx: x(last.x), cy: y(last.y), r: 4, fill: sr.color, class: 'marker' }));
      if (o.endLabels && series.length <= 4) {
        g.appendChild(s('text', { x: x(last.x) + 8, y: y(last.y), class: 'end-label', 'dominant-baseline': 'middle', text: (o.endFmt ? o.endFmt(last.y, sr) : sr.name) }));
      }
    }
    // crosshair layer
    const cross = s('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' });
    const dots = series.map(sr => s('circle', { r: 5, fill: sr.color, class: 'marker', visibility: 'hidden' }));
    g.appendChild(cross); dots.forEach(d => g.appendChild(d));
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', tabindex: 0 });
    let current = null;
    const nearest = (sr, xv) => {
      let best = null, bd = Infinity;
      for (const p of sr.values) { const dd = Math.abs(p.x - xv); if (dd < bd) { bd = dd; best = p; } }
      return best;
    };
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const xv = x.inv(ev.clientX - r.left);
      const ref = nearest(series[0], xv);
      if (!ref) return;
      current = series.map(sr => nearest(sr, xv));
      cross.setAttribute('x1', x(ref.x)); cross.setAttribute('x2', x(ref.x)); cross.setAttribute('visibility', 'visible');
      current.forEach((p, i) => { if (!p) return; dots[i].setAttribute('cx', x(p.x)); dots[i].setAttribute('cy', y(p.y)); dots[i].setAttribute('visibility', 'visible'); });
      const title = o.tipTitle ? o.tipTitle(ref) : (o.xType === 'time' ? new Date(ref.x).toISOString().slice(0, 10) : (o.xFmt || fmt1)(ref.x));
      showTip(ev, title, current.map((p, i) => p && ({ value: (o.yFmt || fmt1)(p.y), label: series[i].name, color: series[i].color })).filter(Boolean),
        o.tipNote ? o.tipNote(ref) : null);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTip(); });
    if (o.onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => current && o.onClick(current[0], series[0])); }
    g.appendChild(hit);
    wrap.appendChild(svg);
  });
}

// ---------- horizontal bars ----------
/** opts: {data:[{label, value, color, note, onClick, sub}], fmt, max, labelWidth, barH} */
export function barChart(el, o) {
  const wrap = h('div', { class: 'chart' });
  el.appendChild(wrap);
  mount(wrap, W => {
    const data = o.data.filter(d => isNum(d.value));
    if (!data.length) { wrap.appendChild(h('div', { class: 'empty' }, 'No data for this selection')); return; }
    const bh = Math.min(24, o.barH || 18), gap = o.gap ?? 10;
    const lw = o.labelWidth || Math.min(200, Math.max(90, W * 0.32));
    const vw = 64;
    const H = data.length * (bh + gap) + 8;
    const mn = Math.min(0, ...data.map(d => d.value));
    const mx = o.max ?? Math.max(...data.map(d => d.value), 0);
    const x = linear(mn, mx || 1, lw, W - vw);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'svg' });
    if (o.ref != null) svg.appendChild(s('line', { x1: x(o.ref), x2: x(o.ref), y1: 0, y2: H, class: 'ref' }));
    data.forEach((d, i) => {
      const yy = 4 + i * (bh + gap);
      const x0 = x(Math.min(0, d.value)), x1 = x(Math.max(0, d.value));
      const g = s('g', { class: 'bar-row' + (d.onClick ? ' clickable' : ''), tabindex: 0 });
      g.appendChild(s('rect', { x: 0, y: yy - gap / 2, width: W, height: bh + gap, fill: 'transparent' }));
      const lab = s('text', { x: lw - 10, y: yy + bh / 2, class: 'bar-label', 'text-anchor': 'end', 'dominant-baseline': 'middle', text: truncate(d.label, Math.floor((lw - 14) / 6.6)) });
      g.appendChild(lab);
      g.appendChild(s('path', { d: roundedH(x0, yy, Math.max(1, x1 - x0), bh, d.value >= 0), fill: d.color || 'var(--series-1)', class: 'bar' }));
      g.appendChild(s('text', { x: x1 + 6, y: yy + bh / 2, class: 'bar-value', 'dominant-baseline': 'middle', text: (o.fmt || fmt1)(d.value) }));
      g.addEventListener('pointermove', ev => showTip(ev, d.label, [{ value: (o.fmt || fmt1)(d.value), label: o.valueLabel || '', color: d.color || 'var(--series-1)', line: false }], d.note));
      g.addEventListener('pointerleave', hideTip);
      if (d.onClick) g.addEventListener('click', d.onClick);
      svg.appendChild(g);
    });
    svg.appendChild(s('line', { x1: x(0), x2: x(0), y1: 0, y2: H, class: 'axis' }));
    wrap.appendChild(svg);
  });
}
function truncate(t, n) { t = String(t ?? ''); return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t; }
function roundedH(x, y, w, hgt, positive) {
  const r = Math.min(4, w / 2, hgt / 2);
  if (positive) return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt - r} Q${x + w},${y + hgt} ${x + w - r},${y + hgt} H${x} Z`;
  return `M${x + w},${y} H${x + r} Q${x},${y} ${x},${y + r} V${y + hgt - r} Q${x},${y + hgt} ${x + r},${y + hgt} H${x + w} Z`;
}
function roundedV(x, y, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  if (hgt <= 0) return '';
  return `M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt} Z`;
}

// ---------- columns (vertical bars, also histograms) ----------
/** opts: {data:[{label, value, color, tip, sub}], fmt, height, yFmt, labelEvery, stacked:[{key,label,color}]} */
export function columnChart(el, o) {
  const wrap = h('div', { class: 'chart' });
  el.appendChild(wrap);
  if (o.stacked && o.legend !== false) el.insertBefore(legend(o.stacked.map(k => ({ label: k.label, color: k.color }))), wrap);
  mount(wrap, W => {
    const H = o.height || 220;
    const m = { t: 14, r: 10, b: o.rotate ? 52 : 28, l: 44 };
    const data = o.data;
    if (!data.length) { wrap.appendChild(h('div', { class: 'empty' }, 'No data for this selection')); return; }
    const totals = data.map(d => o.stacked ? o.stacked.reduce((acc, k) => acc + (d.parts[k.key] || 0), 0) : d.value);
    const integer = totals.every(v => Number.isInteger(v));
    const [y0, y1] = niceDomain(0, Math.max(...totals, o.yMax || 0), 4, true, integer);
    const y = linear(y0, o.yMaxFixed || y1, H - m.b, m.t);
    const band = (W - m.l - m.r) / data.length;
    const bw = Math.min(24, Math.max(2, band - Math.max(2, band * 0.3)));
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'svg' });
    axisLeft(svg, niceTicks(y0, o.yMaxFixed || y1, 4, integer), y, m.l, W - m.r, o.yFmt || (v => fmt1(v).replace(/\.0$/, '')));
    const every = o.labelEvery || Math.max(1, Math.ceil(data.length / Math.floor((W - m.l - m.r) / (o.rotate ? 18 : 46))));
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const g = s('g', { class: 'col' + (d.onClick ? ' clickable' : ''), tabindex: 0 });
      g.appendChild(s('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.b - m.t, fill: 'transparent' }));
      if (o.stacked) {
        let acc = 0;
        const n = o.stacked.length;
        o.stacked.forEach((k, ki) => {
          const v = d.parts[k.key] || 0;
          if (v <= 0) return;
          const top = y(acc + v), bot = y(acc);
          const isTop = !o.stacked.slice(ki + 1).some(kk => (d.parts[kk.key] || 0) > 0);
          const hh = Math.max(0, bot - top - (acc > 0 ? 2 : 0));
          g.appendChild(isTop ? s('path', { d: roundedV(cx - bw / 2, top, bw, hh), fill: k.color, class: 'bar' })
            : s('rect', { x: cx - bw / 2, y: top, width: bw, height: hh, fill: k.color, class: 'bar' }));
          acc += v;
        });
        g.addEventListener('pointermove', ev => showTip(ev, d.tipTitle || d.label, o.stacked.map(k => ({ value: (o.fmt || fmt1)(d.parts[k.key] || 0), label: k.label, color: k.color, line: false })), d.note));
      } else {
        const top = y(Math.max(0, d.value));
        g.appendChild(s('path', { d: roundedV(cx - bw / 2, top, bw, y(0) - top), fill: d.color || 'var(--series-1)', class: 'bar' }));
        g.addEventListener('pointermove', ev => showTip(ev, d.tipTitle || d.label, [{ value: (o.fmt || fmt1)(d.value), label: o.valueLabel || '', color: d.color || 'var(--series-1)', line: false }].concat(d.extra || []), d.note));
      }
      g.addEventListener('pointerleave', hideTip);
      if (d.onClick) g.addEventListener('click', d.onClick);
      if (i % every === 0) {
        const t = s('text', { x: cx, y: H - m.b + 16, class: 'tick', 'text-anchor': o.rotate ? 'end' : 'middle', text: d.label });
        if (o.rotate) t.setAttribute('transform', `rotate(-40 ${cx} ${H - m.b + 12})`);
        svg.appendChild(t);
      }
      svg.appendChild(g);
    });
    svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: 'axis' }));
    wrap.appendChild(svg);
  });
}

// ---------- 100% stacked horizontal bars ----------
/** opts: {rows:[{label, parts:{key:value}}], keys:[{key,label,color}], fmt} */
export function stackBars(el, o) {
  const wrap = h('div', { class: 'chart' });
  el.appendChild(legend(o.keys.map(k => ({ label: k.label, color: k.color }))));
  el.appendChild(wrap);
  mount(wrap, W => {
    const bh = 20, gap = 14, lw = o.labelWidth || Math.min(170, W * 0.3);
    const H = o.rows.length * (bh + gap) + 4;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'svg' });
    o.rows.forEach((row, i) => {
      const yy = 2 + i * (bh + gap);
      const tot = o.keys.reduce((a, k) => a + (row.parts[k.key] || 0), 0) || 1;
      svg.appendChild(s('text', { x: lw - 10, y: yy + bh / 2, class: 'bar-label', 'text-anchor': 'end', 'dominant-baseline': 'middle', text: row.label }));
      let acc = 0;
      const span = W - lw - 8;
      o.keys.forEach((k, ki) => {
        const v = row.parts[k.key] || 0;
        if (!v) return;
        const x0 = lw + span * acc / tot + (acc > 0 ? 1 : 0), w = Math.max(0, span * v / tot - (acc > 0 ? 2 : 0));
        const r = s('rect', { x: x0, y: yy, width: w, height: bh, rx: 3, fill: k.color, class: 'bar' });
        r.addEventListener('pointermove', ev => showTip(ev, row.label, o.keys.map(kk => ({ value: (o.fmt || (vv => (100 * vv / tot).toFixed(1) + '%'))(row.parts[kk.key] || 0, tot), label: kk.label, color: kk.color, line: false }))));
        r.addEventListener('pointerleave', hideTip);
        svg.appendChild(r);
        const pct = v / tot;
        if (w > 38) svg.appendChild(s('text', { x: x0 + w / 2, y: yy + bh / 2, class: 'in-label ' + (k.dark ? 'on-dark' : 'on-light'), 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: Math.round(pct * 100) + '%' }));
        acc += v;
      });
    });
    wrap.appendChild(svg);
  });
}

// ---------- scatter ----------
/** opts: {points:[{x,y,label,color,id,r,sub}], xLabel,yLabel,xFmt,yFmt, height, onClick, refX, refY, labelIds:Set, legend:[...]} */
export function scatter(el, o) {
  const wrap = h('div', { class: 'chart' });
  if (o.legend) el.appendChild(legend(o.legend.map(l => ({ ...l, kind: 'dot' }))));
  el.appendChild(wrap);
  mount(wrap, W => {
    const H = o.height || 340;
    const m = { t: 14, r: 18, b: 42, l: 62 };
    const pts = o.points.filter(p => isNum(p.x) && isNum(p.y));
    if (!pts.length) { wrap.appendChild(h('div', { class: 'empty' }, 'No data for this selection')); return; }
    const [x0, x1] = o.xDomain || niceDomain(Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x)), 5);
    const [y0, y1] = o.yDomain || niceDomain(Math.min(...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)), 5);
    const x = linear(x0, x1, m.l, W - m.r), y = linear(y0, y1, H - m.b, m.t);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'svg' });
    axisLeft(svg, niceTicks(y0, y1, 5), y, m.l, W - m.r, o.yFmt || fmt1);
    for (const t of niceTicks(x0, x1, Math.max(3, Math.floor((W - m.l - m.r) / 80)))) {
      svg.appendChild(s('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, class: 'grid' }));
      svg.appendChild(s('text', { x: x(t), y: H - m.b + 16, class: 'tick', 'text-anchor': 'middle', text: tickText((o.xFmt || fmt1)(t)) }));
    }
    svg.appendChild(s('text', { x: (m.l + W - m.r) / 2, y: H - 6, class: 'axis-title', 'text-anchor': 'middle', text: o.xLabel || '' }));
    const yt = s('text', { x: 10, y: (m.t + H - m.b) / 2, class: 'axis-title', 'text-anchor': 'middle', text: o.yLabel || '' });
    yt.setAttribute('transform', `rotate(-90 10 ${(m.t + H - m.b) / 2})`);
    svg.appendChild(yt);
    if (isNum(o.refX)) svg.appendChild(s('line', { x1: x(o.refX), x2: x(o.refX), y1: m.t, y2: H - m.b, class: 'ref' }));
    if (isNum(o.refY)) svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(o.refY), y2: y(o.refY), class: 'ref' }));
    if (o.diag) svg.appendChild(s('line', { x1: x(Math.max(x0, y0)), y1: y(Math.max(x0, y0)), x2: x(Math.min(x1, y1)), y2: y(Math.min(x1, y1)), class: 'ref' }));
    const g = s('g');
    const sorted = pts.slice().sort((a, b) => (a.hl ? 1 : 0) - (b.hl ? 1 : 0));
    for (const p of sorted) {
      g.appendChild(s('circle', { cx: x(p.x), cy: y(p.y), r: p.r || 4, fill: p.color || 'var(--series-1)', class: 'dot' + (p.hl ? ' hl' : ''), 'fill-opacity': p.hl || !o.dim ? 1 : 0.55 }));
    }
    svg.appendChild(g);
    if (o.labelIds) {
      // Greedy placement: try four offsets per label, skip it if every spot collides (tooltip still has it).
      const placed = pts.filter(p => o.labelIds.has(p.id)).map(p => ({ x: x(p.x), y: y(p.y), r: 6 })).map(c => [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r]);
      const hit = (b) => placed.some(q => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]));
      for (const p of pts.filter(pp => o.labelIds.has(pp.id)).sort((a, b) => b.y - a.y)) {
        const px = x(p.x), py = y(p.y), w = String(p.label).length * 6.1, hh = 12;
        const spots = [[px + 7, py - 7, 'start'], [px + 7, py + 14, 'start'], [px - 7, py - 7, 'end'], [px - 7, py + 14, 'end']];
        for (const [tx, ty, anchor] of spots) {
          const box = anchor === 'start' ? [tx, ty - hh + 2, tx + w, ty + 2] : [tx - w, ty - hh + 2, tx, ty + 2];
          if (box[0] < m.l || box[2] > W - 4 || box[1] < 2 || box[3] > H - m.b || hit(box)) continue;
          placed.push(box);
          svg.appendChild(s('text', { x: tx, y: ty, class: 'pt-label', 'text-anchor': anchor, text: p.label }));
          break;
        }
      }
    }
    const ring = s('circle', { r: 7, class: 'hover-ring', visibility: 'hidden' });
    svg.appendChild(ring);
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    let cur = null;
    hit.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      let best = null, bd = 24 * 24;
      for (const p of pts) { const dx = x(p.x) - px, dy = y(p.y) - py, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = p; } }
      cur = best;
      if (!best) { ring.setAttribute('visibility', 'hidden'); hideTip(); hit.style.cursor = 'default'; return; }
      ring.setAttribute('cx', x(best.x)); ring.setAttribute('cy', y(best.y)); ring.setAttribute('visibility', 'visible');
      hit.style.cursor = o.onClick ? 'pointer' : 'default';
      showTip(ev, best.label, [
        { value: (o.xFmt || fmt1)(best.x), label: o.xLabel, color: best.color, line: false },
        { value: (o.yFmt || fmt1)(best.y), label: o.yLabel },
      ].concat(best.extra || []), best.sub);
    });
    hit.addEventListener('pointerleave', () => { ring.setAttribute('visibility', 'hidden'); hideTip(); });
    if (o.onClick) hit.addEventListener('click', () => cur && o.onClick(cur));
    svg.appendChild(hit);
    wrap.appendChild(svg);
  });
}

// ---------- sparkline ----------
export function sparkline(values, { w = 84, h: hh = 22, color = 'var(--series-1)', min, max } = {}) {
  const vals = values.filter(isNum);
  const svg = s('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, class: 'spark' });
  if (vals.length < 2) return svg;
  const mn = min ?? Math.min(...vals), mx = max ?? Math.max(...vals);
  const x = linear(0, vals.length - 1, 2, w - 4), y = linear(mn, mx === mn ? mn + 1 : mx, hh - 3, 3);
  svg.appendChild(s('path', { d: vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(''), class: 'spark-line', stroke: 'var(--muted)' }));
  svg.appendChild(s('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 2.5, fill: color }));
  return svg;
}

/** Form strip: last N results as small squares (W filled / L hollow). */
export function formStrip(results) {
  return h('span', { class: 'form' }, results.map(r => h('span', { class: 'f ' + (r.won ? 'fw' : 'fl'), title: r.title }, r.won ? 'W' : 'L')));
}

/** Percentile bar (0..1) with label. */
export function pctBar(p, { color = 'var(--series-1)' } = {}) {
  const v = isNum(p) ? p : 0;
  return h('span', { class: 'pbar' }, h('span', { class: 'pbar-fill', style: { width: (v * 100).toFixed(1) + '%', background: color } }));
}

/** Two-sided comparison row (values a vs b, bars proportional). */
export function compareRow(label, a, b, fmt, { better = 1, ca = 'var(--series-1)', cb = 'var(--series-2)', raw } = {}) {
  const va = isNum(a) ? a : 0, vb = isNum(b) ? b : 0;
  const tot = Math.abs(va) + Math.abs(vb) || 1;
  const aWins = better === 0 ? false : (better > 0 ? va > vb : va < vb);
  const bWins = better === 0 ? false : (better > 0 ? vb > va : vb < va);
  return h('div', { class: 'cmp-row' },
    h('div', { class: 'cmp-val a' + (aWins ? ' win' : '') }, raw ? raw[0] : fmt(a)),
    h('div', { class: 'cmp-mid' },
      h('div', { class: 'cmp-label' }, label),
      h('div', { class: 'cmp-bars' },
        h('div', { class: 'cmp-side left' }, h('span', { style: { width: (100 * Math.abs(va) / tot) + '%', background: ca } })),
        h('div', { class: 'cmp-side right' }, h('span', { style: { width: (100 * Math.abs(vb) / tot) + '%', background: cb } })))),
    h('div', { class: 'cmp-val b' + (bWins ? ' win' : '') }, raw ? raw[1] : fmt(b)));
}

/** Card with title, optional subtitle, and a chart/table toggle. */
export function card(title, sub, body, { table, actions, cls } = {}) {
  const bodyEl = h('div', { class: 'card-body' });
  const tableEl = h('div', { class: 'card-table', hidden: true });
  const head = h('div', { class: 'card-head' },
    h('div', {}, h('h3', {}, title), sub ? h('p', { class: 'card-sub' }, sub) : null),
    h('div', { class: 'card-actions' }, actions || null,
      table ? h('button', { class: 'btn-ghost sm', type: 'button', onclick: e => {
        const show = tableEl.hidden; tableEl.hidden = !show; bodyEl.hidden = show;
        if (show && !tableEl.firstChild) tableEl.appendChild(simpleTable(table()));
        e.currentTarget.textContent = show ? 'Chart' : 'Table';
      } }, 'Table') : null));
  const c = h('section', { class: 'card ' + (cls || '') }, head, bodyEl, tableEl);
  if (typeof body === 'function') requestAnimationFrame(() => body(bodyEl)); else if (body) bodyEl.appendChild(body);
  return c;
}
export function simpleTable({ cols, rows }) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, cols.map(c => h('th', {}, c)))),
    h('tbody', {}, rows.map(r => h('tr', {}, r.map(v => h('td', {}, v)))))));
}
