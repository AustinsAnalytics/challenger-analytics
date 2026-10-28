// 2D tennis court (metres; net at x = 0, baselines at x = ±11.885, sidelines at y = ±4.115 / ±5.485).
import { s, h, isNum } from './util.js';
import { showTip, hideTip, mount } from './charts.js';

const BL = 11.885, SL = 4.115, DL = 5.485, SV = 6.40;

/**
 * opts: {
 *   mode: 'full' | 'half'   (half = receiving half x < 0, viewed from behind the server)
 *   points: [{x, y, color, r, tip:{title, rows, note}, hl}]
 *   segments: [{x1,y1,x2,y2,color}]
 *   heat: {cells:[[x,y,v]], size, color, max}
 *   zones: true (draw T / Body / Wide guides on the service boxes)
 *   labels: [{x,y,text}]
 * }
 */
export function court(el, o) {
  const wrap = h('div', { class: 'court-wrap' });
  el.appendChild(wrap);
  mount(wrap, W => {
    const half = o.mode === 'half';
    // on narrow screens the full court stands upright (baselines top and bottom) instead of lying across
    const vert = !half && W < 560;
    // world bounds
    const wx0 = half ? -7.2 : vert ? -7.6 : -17, wx1 = half ? 7.2 : vert ? 7.6 : 17;     // screen horizontal
    const wy0 = half ? -16.2 : vert ? -17 : -7.6, wy1 = half ? 0.6 : vert ? 17 : 7.6;   // screen vertical
    const aspect = (wy1 - wy0) / (wx1 - wx0);
    const maxW = o.maxWidth || 640;
    const Wd = Math.min(W, maxW);
    const Hd = Math.round(Wd * aspect);
    const sx = v => (v - wx0) / (wx1 - wx0) * Wd;
    const sy = v => (v - wy0) / (wy1 - wy0) * Hd;
    // world (tennis x,y) -> screen
    // half: seen from behind the server (net at the bottom, deuce box on the left)
    const P = half || vert ? (x, y) => [sx(y), sy(x)] : (x, y) => [sx(x), sy(-y)];
    const svg = s('svg', { width: Wd, height: Hd, viewBox: `0 0 ${Wd} ${Hd}`, class: 'court-svg' });
    const line = (x1, y1, x2, y2, cls = 'cline') => { const a = P(x1, y1), b = P(x2, y2); return s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls }); };
    const rect = (x1, y1, x2, y2, cls) => {
      const a = P(x1, y1), b = P(x2, y2);
      return s('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: cls });
    };
    svg.appendChild(s('rect', { x: 0, y: 0, width: Wd, height: Hd, class: 'court-out', rx: 10 }));
    const xFar = half ? -BL : -BL, xNear = half ? 0 : BL;
    svg.appendChild(rect(xFar, -DL, xNear, DL, 'court-in'));
    // heatmap under the lines
    if (o.heat && o.heat.cells.length) {
      const sz = o.heat.size || 1;
      const mx = o.heat.max || Math.max(...o.heat.cells.map(c => c[2]));
      for (const [cx, cy, v] of o.heat.cells) {
        if (!v || v < mx * 0.004) continue;   // ignore stray single readings
        const r = rect(cx - sz / 2, cy - sz / 2, cx + sz / 2, cy + sz / 2, 'heat-cell');
        r.setAttribute('fill', o.heat.color || 'var(--series-1)');
        r.setAttribute('fill-opacity', (0.06 + 0.86 * Math.pow(v / mx, 0.6)).toFixed(3));
        r.addEventListener('pointermove', ev => showTip(ev, o.heat.title || 'Density', [{ value: String(v), label: o.heat.unit || 'shots' }]));
        r.addEventListener('pointerleave', hideTip);
        svg.appendChild(r);
      }
    }
    // lines
    const g = s('g');
    g.appendChild(line(xFar, -DL, xNear, -DL)); g.appendChild(line(xFar, DL, xNear, DL));
    g.appendChild(line(xFar, -SL, xNear, -SL)); g.appendChild(line(xFar, SL, xNear, SL));
    g.appendChild(line(-BL, -DL, -BL, DL));
    if (!half) g.appendChild(line(BL, -DL, BL, DL));
    g.appendChild(line(-SV, -SL, -SV, SL));
    if (!half) g.appendChild(line(SV, -SL, SV, SL));
    g.appendChild(line(-SV, 0, half ? 0 : SV, 0));
    g.appendChild(line(-BL, 0, -BL + 0.2, 0));
    if (!half) g.appendChild(line(BL, 0, BL - 0.2, 0));
    g.appendChild(line(0, -DL - 0.45, 0, DL + 0.45, 'cnet'));
    if (o.zones) {
      for (const sign of [-1, 1]) for (const f of [1, 2]) g.appendChild(line(-SV, sign * SL * f / 3, 0, sign * SL * f / 3, 'czone'));
      if (half) {
        const lab = (y, t) => { const p = P(-SV - 0.55, y); g.appendChild(s('text', { x: p[0], y: p[1], class: 'zone-label', 'text-anchor': 'middle', text: t })); };
        for (const sign of [-1, 1]) { lab(sign * SL / 6, 'T'); lab(sign * SL / 2, 'Body'); lab(sign * SL * 5 / 6, 'Wide'); }
        const dl = P(-1.2, -SL / 2), al = P(-1.2, SL / 2);
        g.appendChild(s('text', { x: dl[0], y: dl[1], class: 'zone-label strong', 'text-anchor': 'middle', text: o.leftLabel || 'Deuce court' }));
        g.appendChild(s('text', { x: al[0], y: al[1], class: 'zone-label strong', 'text-anchor': 'middle', text: o.rightLabel || 'Ad court' }));
      }
    }
    svg.appendChild(g);
    // segments
    if (o.segments) for (const sg of o.segments) {
      const a = P(sg.x1, sg.y1), b = P(sg.x2, sg.y2);
      svg.appendChild(s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: sg.color, class: 'shot-seg', 'stroke-opacity': sg.opacity ?? 0.35 }));
    }
    // points
    const pts = (o.points || []).filter(p => isNum(p.x) && isNum(p.y));
    const dots = s('g');
    for (const p of pts) {
      const [px, py] = P(p.x, p.y);
      dots.appendChild(s('circle', { cx: px, cy: py, r: p.r || 4, fill: p.color || 'var(--series-1)', class: 'cdot', 'fill-opacity': p.opacity ?? 0.85 }));
    }
    svg.appendChild(dots);
    if (o.labels) for (const l of o.labels) {
      const [px, py] = P(l.x, l.y);
      svg.appendChild(s('text', { x: px, y: py, class: 'court-label ' + (l.cls || ''), 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: l.text }));
    }
    // nearest-point hover
    if (pts.length && pts.some(p => p.tip)) {
      const ring = s('circle', { r: 7, class: 'hover-ring', visibility: 'hidden' });
      svg.appendChild(ring);
      const scr = pts.map(p => P(p.x, p.y));
      const hit = s('rect', { x: 0, y: 0, width: Wd, height: Hd, fill: 'transparent' });
      let cur = null;
      hit.addEventListener('pointermove', ev => {
        const r = svg.getBoundingClientRect();
        const mx = ev.clientX - r.left, my = ev.clientY - r.top;
        let best = -1, bd = 18 * 18;
        for (let i = 0; i < scr.length; i++) { const dx = scr[i][0] - mx, dy = scr[i][1] - my, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
        if (best < 0 || !pts[best].tip) { ring.setAttribute('visibility', 'hidden'); hideTip(); cur = null; hit.style.cursor = 'default'; return; }
        cur = pts[best];
        ring.setAttribute('cx', scr[best][0]); ring.setAttribute('cy', scr[best][1]); ring.setAttribute('visibility', 'visible');
        hit.style.cursor = o.onClick ? 'pointer' : 'default';
        showTip(ev, cur.tip.title, cur.tip.rows || [], cur.tip.note);
      });
      hit.addEventListener('pointerleave', () => { ring.setAttribute('visibility', 'hidden'); hideTip(); });
      if (o.onClick) hit.addEventListener('click', () => cur && o.onClick(cur));
      svg.appendChild(hit);
    }
    wrap.appendChild(svg);
  });
}

/** Serve zone of a bounce: T / Body / Wide by distance from the centre service line. */
export function zoneOf(y) {
  const a = Math.abs(y);
  return a < SL / 3 ? 'T' : a < 2 * SL / 3 ? 'B' : 'W';
}
export const ZONE_NAMES = { T: 'T', B: 'Body', W: 'Wide' };
export const COURT = { BL, SL, DL, SV };
