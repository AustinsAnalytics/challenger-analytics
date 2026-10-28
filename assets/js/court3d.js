// 3D CourtVision: reconstructs each tracked ball flight from Hawk-Eye hit / net / bounce / next-contact points.
import * as THREE from '../../lib/three.module.min.js';
import { OrbitControls } from '../../lib/OrbitControls.js';
import { h } from './util.js';

const BL = 11.885, SL = 4.115, DL = 5.485, SV = 6.40;

function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

/**
 * shots: [{hit:[x,y,z], net:[y,z]|null, bounce:[x,y]|null, last:[x,y,z]|null, peak:[x,y,z]|null, color, id, info}]
 * Returns {el, setShots(shots), dispose()}
 */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export function court3d(container, { onPick } = {}) {
  const el = h('div', { class: 'c3d' });
  container.appendChild(el);
  let renderer = null;
  try { renderer = webglAvailable() ? new THREE.WebGLRenderer({ antialias: true, alpha: true }) : null; } catch { renderer = null; }
  if (!renderer) {
    // e.g. hardware acceleration switched off: explain instead of failing
    el.appendChild(h('div', { class: 'empty' }, 'The 3D view needs WebGL, which is not available in this browser (hardware acceleration may be turned off). The 2D court shows the same shots.'));
    return { el, views: {}, setShots() {}, dispose() { el.remove(); } };
  }
  const w = () => Math.max(300, el.clientWidth), hgt = () => Math.round(Math.min(560, Math.max(320, el.clientWidth * 0.58)));
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w(), hgt());
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, w() / hgt(), 0.1, 200);
  camera.position.set(19, 11, 15);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 6; controls.maxDistance = 70;
  // Wheel-zoom only after the viewer is clicked, so scrolling the page over it still scrolls the page.
  controls.enableZoom = false;
  renderer.domElement.addEventListener('pointerdown', () => { controls.enableZoom = true; });
  renderer.domElement.addEventListener('pointerleave', () => { controls.enableZoom = false; });

  // tennis (x along length, y lateral, z up) -> three (x, y up, z)
  const V = (x, y, z) => new THREE.Vector3(x, z, -y);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(5, 20, 10); scene.add(dl);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), new THREE.MeshLambertMaterial({ color: 0x1d3a52 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; scene.add(ground);
  const courtMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * BL, 2 * DL), new THREE.MeshLambertMaterial({ color: 0x2f6094 }));
  courtMesh.rotation.x = -Math.PI / 2; scene.add(courtMesh);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const L = (a, b) => { const g = new THREE.BufferGeometry().setFromPoints([V(a[0], a[1], 0.01), V(b[0], b[1], 0.01)]); scene.add(new THREE.Line(g, lineMat)); };
  for (const y of [-DL, DL, -SL, SL]) L([-BL, y], [BL, y]);
  for (const x of [-BL, BL]) L([x, -DL], [x, DL]);
  for (const x of [-SV, SV]) L([x, -SL], [x, SL]);
  L([-SV, 0], [SV, 0]);
  // net
  const netGeo = new THREE.PlaneGeometry(2 * DL + 0.9, 0.95);
  const net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ color: 0xcfd6dd, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
  net.rotation.y = Math.PI / 2; net.position.set(0, 0.475, 0); scene.add(net);
  const tape = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, -DL - 0.45, 1.07), V(0, 0, 0.914), V(0, DL + 0.45, 1.07)]), new THREE.LineBasicMaterial({ color: 0xffffff }));
  scene.add(tape);

  const group = new THREE.Group(); scene.add(group);
  let pickables = [];

  function arc(points, color, opacity, radius = 0.028) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: opacity < 1, opacity });
    return new THREE.Mesh(geo, mat);
  }
  const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  /** Build a plausible flight path: hit -> (peak) -> net crossing -> bounce, then bounce -> next contact. */
  function flight(sh) {
    const pts = [V(...sh.hit)];
    const toBounce = sh.bounce ? [sh.bounce[0], sh.bounce[1], 0.03] : null;
    if (sh.net && Math.sign(sh.hit[0]) !== Math.sign((toBounce || sh.last || [0])[0])) pts.push(V(0, sh.net[0], Math.max(0.93, sh.net[1])));
    if (toBounce) pts.push(V(...toBounce));
    const segs = [];
    if (pts.length >= 2) {
      // add a gentle apex between the last two points when the path is a straight line
      if (pts.length === 2) { const m = pts[0].clone().lerp(pts[1], 0.5); m.y = Math.max(m.y, Math.max(pts[0].y, pts[1].y) + 0.8); pts.splice(1, 0, m); }
      segs.push(pts);
    }
    // After the bounce, only winners get a continuation (the ball passing the opponent).
    if (sh.after && toBounce && sh.last && (sh.last[0] || sh.last[1]) && Math.abs(sh.last[0]) < 18) {
      const a = V(...toBounce), b = V(...sh.last);
      const m = a.clone().lerp(b, 0.5); m.y = Math.max(a.y, b.y) + Math.min(1.6, a.distanceTo(b) * 0.18);
      segs.push([a, m, b]);
    }
    return segs;
  }

  function setShots(shots) {
    for (const c of [...group.children]) { group.remove(c); c.geometry && c.geometry.dispose(); if (c.material && c.material !== pickMat) c.material.dispose(); }
    pickables = [];
    const dim = shots.length > 120 ? 0.55 : 0.9;
    for (const sh of shots) {
      if (!sh.hit) continue;
      const vis = [];
      flight(sh).forEach((pts, i) => {
        const mesh = arc(pts, sh.color, i === 0 ? dim : dim * 0.45);
        mesh.userData = { shot: sh, base: i === 0 ? dim : dim * 0.45 };
        group.add(mesh); vis.push(mesh);
        // invisible, fatter tube so a path is easy to click
        const fat = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 24, 0.22, 5, false), pickMat);
        fat.userData = { shot: sh, pick: true };
        group.add(fat); pickables.push(fat);
      });
      if (sh.bounce) {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(sh.color) }));
        dot.rotation.x = -Math.PI / 2; dot.position.copy(V(sh.bounce[0], sh.bounce[1], 0.02)); dot.userData = { shot: sh, base: 1 };
        group.add(dot); pickables.push(dot);
      }
    }
  }

  const ray = new THREE.Raycaster(); ray.params.Line = { threshold: 0.2 };
  const mouse = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !onPick) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    const picked = hit ? hit.object.userData.shot : null;
    group.children.forEach(c => {
      if (!c.material || c.material === pickMat) return;
      c.material.transparent = true;
      c.material.opacity = !picked ? c.userData.base : (c.userData.shot === picked ? 1 : 0.1);
    });
    onPick(picked);
  });

  let raf = 0, alive = true;
  const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();
  const ro = new ResizeObserver(() => { renderer.setSize(w(), hgt()); camera.aspect = w() / hgt(); camera.updateProjectionMatrix(); });
  ro.observe(el);
  const views = {
    corner: () => { camera.position.set(19, 11, 15); controls.target.set(0, 0, 0); },
    broadcast: () => { camera.position.set(25, 10, 0); controls.target.set(0, 0, 0); },
    side: () => { camera.position.set(0, 9, 22); controls.target.set(0, 0.5, 0); },
    top: () => { camera.position.set(0.01, 34, 0); controls.target.set(0, 0, 0); },
    receiver: () => { camera.position.set(-20, 6, 0); controls.target.set(0, 1, 0); },
  };
  return {
    el, setShots, views,
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.remove(); },
    isAlive: () => el.isConnected,
  };
}
export { cssVar };
