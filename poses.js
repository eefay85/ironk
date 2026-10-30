// Demostraciones animadas: una figura en vista lateral (mirando a la derecha)
// que pasa por las poses clave de cada ejercicio. Brazos y piernas se resuelven
// con cinemática inversa, así que cada pose sólo indica cadera, inclinación del
// torso y dónde van manos y pies.

const FIG = { torso: 50, neck: 17, head: 10, upper: 28, fore: 27, thigh: 42, shin: 43 };

// Posición de la pesa respecto de la mano según cómo se sostiene.
const KB_OFFSET = {
  hang: [0, 12], back: [-7, 10], float: [12, 1], over: [-8, 3],
  rack: [6, 3], goblet: [5, 5], top: [0, -11],
};

// hip: cadera, t: inclinación del torso (0 vertical, + hacia adelante, -90 acostado),
// hand/hand2: manos, foot/foot2: tobillos, elbow/knee: hacia dónde se doblan (f, b, u, d).
const POSES = {
  stand: { hip: [100, 104], t: 0, hand: [102, 106] },
  standKb: { hip: [100, 104], t: 0, hand: [103, 104] },
  hinge: { hip: [76, 124], t: 62, hand: [92, 150], kb: 'back' },
  swingTop: { hip: [100, 104], t: -4, hand: [150, 62], kb: 'float' },
  snatchMid: { hip: [100, 104], t: -2, hand: [128, 24], elbow: 'd', kb: 'float' },
  overhead: { hip: [100, 104], t: 0, hand: [104, 4], kb: 'over' },
  rack: { hip: [100, 104], t: 0, hand: [109, 58], kb: 'rack' },
  dip: { hip: [97, 116], t: 2, hand: [107, 70], kb: 'rack' },
  gobletUp: { hip: [100, 104], t: 0, hand: [113, 68], kb: 'goblet' },
  gobletDown: { hip: [80, 146], t: 25, hand: [114, 108], kb: 'goblet' },
  frontDown: { hip: [80, 146], t: 22, hand: [108, 102], kb: 'rack' },
  dlDown: { hip: [78, 138], t: 55, hand: [104, 162] },
  rdlDown: { hip: [74, 112], t: 78, hand: [120, 154] },
  sldlDown: { hip: [92, 108], t: 80, hand: [138, 152], foot2: [14, 100], knee2: 'd' },
  rowDown: { hip: [78, 120], t: 72, hand: [124, 156] },
  rowUp: { hip: [78, 120], t: 72, hand: [106, 118], elbow: 'u' },
  lungeUp: { hip: [100, 104], t: 0, hand: [109, 58], kb: 'rack' },
  lungeDown: { hip: [92, 144], t: 0, hand: [101, 98], kb: 'rack', foot: [124, 186], foot2: [50, 186], knee2: 'd' },
  highPull: { hip: [100, 104], t: -3, hand: [126, 60], elbow: 'u', kb: 'float' },
  fpDown: { hip: [128, 180], t: -90, hand: [94, 158], elbow: 'd', kb: 'top', foot: [160, 186], foot2: [160, 186], knee: 'u', knee2: 'u' },
  fpUp: { hip: [128, 180], t: -90, hand: [80, 128], kb: 'top', foot: [160, 186], foot2: [160, 186], knee: 'u', knee2: 'u' },
  pushUp: { hip: [102, 151], t: 64, hand: [148, 186], hand2: [148, 186], foot: [30, 186], foot2: [30, 186], knee: 'u', knee2: 'u', toe: 'down', kb: null },
  pushDown: { hip: [108, 168], t: 79, hand: [146, 186], hand2: [146, 186], elbow: 'u', elbow2: 'u', foot: [30, 186], foot2: [30, 186], knee: 'u', knee2: 'u', toe: 'down', kb: null },
  haloA: { hip: [100, 104], t: 0, hand: [117, 46], elbow: 'd', kb: 'goblet' },
  haloB: { hip: [100, 104], t: 0, hand: [102, 24], elbow: 'f', kb: 'top' },
  haloC: { hip: [100, 104], t: 0, hand: [84, 42], elbow: 'd', kb: 'goblet' },
  haloD: { hip: [100, 104], t: 0, hand: [110, 60], elbow: 'd', kb: 'goblet' },
  tgu1: { hip: [128, 180], t: -90, hand: [78, 126], hand2: [44, 186], kb: 'top', foot: [160, 186], knee: 'u', foot2: [208, 186] },
  tgu2: { hip: [128, 180], t: -55, hand: [88, 98], hand2: [66, 184], kb: 'top', foot: [160, 186], knee: 'u', foot2: [208, 186] },
  tgu3: { hip: [126, 176], t: -25, hand: [106, 80], hand2: [72, 186], kb: 'top', foot: [160, 186], knee: 'u', foot2: [206, 186] },
  tgu4: { hip: [104, 140], t: 0, hand: [106, 38], kb: 'over', foot: [140, 186], foot2: [64, 186], knee2: 'd' },
  wmDown: { hip: [80, 112], t: 70, hand: [127, 40], hand2: [116, 180], kb: 'over', foot: [96, 186] },
  walkA: { hip: [100, 106], t: 0, hand: [102, 108], foot: [86, 186], foot2: [116, 186] },
  walkB: { hip: [100, 106], t: 0, hand: [102, 108], foot: [116, 186], foot2: [86, 186] },
  rackWalkA: { hip: [100, 106], t: 0, hand: [109, 60], kb: 'rack', foot: [86, 186], foot2: [116, 186] },
  rackWalkB: { hip: [100, 106], t: 0, hand: [109, 60], kb: 'rack', foot: [116, 186], foot2: [86, 186] },
  twistA: { hip: [100, 180], t: -30, hand: [112, 130], kb: 'goblet', foot: [146, 172], foot2: [146, 172], knee: 'u', knee2: 'u' },
  twistB: { hip: [100, 180], t: -30, hand: [96, 152], kb: 'goblet', foot: [146, 172], foot2: [146, 172], knee: 'u', knee2: 'u' },
  aroundA: { hip: [100, 104], t: 0, hand: [122, 104] },
  aroundB: { hip: [100, 104], t: 0, hand: [80, 104] },
  f8A: { hip: [86, 120], t: 40, hand: [104, 152], kb: 'back' },
  f8B: { hip: [86, 120], t: 40, hand: [128, 140] },
  dragA: { hip: [102, 151], t: 64, hand: [122, 180], hand2: [148, 186], foot: [30, 186], foot2: [30, 186], knee: 'u', knee2: 'u', toe: 'down', kb: 'hang' },
  dragB: { hip: [102, 151], t: 64, hand: [152, 180], hand2: [148, 186], foot: [30, 186], foot2: [30, 186], knee: 'u', knee2: 'u', toe: 'down', kb: 'hang' },
};

function gripOf(ex) {
  if (ex.double) return 'double';
  if (ex.load === 'none') return 'none';
  return ex.uni || ex.id === 'swingalt' ? 'one' : 'two';
}

// Convierte una pose declarada en objetivos numéricos interpolables.
function poseTargets(name, grip) {
  const p = POSES[name] || POSES.stand;
  const t = p.t * Math.PI / 180;
  const sh = [p.hip[0] + FIG.torso * Math.sin(t), p.hip[1] - FIG.torso * Math.cos(t)];
  const foot = p.foot || [100, 186];
  const hang = [sh[0] - 1, sh[1] + 53];
  const hand2 = p.hand2 || (grip === 'two' || grip === 'double' ? [p.hand[0] - 3, p.hand[1] + 1] : hang);
  const mode = p.kb === undefined ? 'hang' : p.kb;
  return {
    hip: p.hip, t: p.t, hand: p.hand, hand2, foot, foot2: p.foot2 || [foot[0] - 4, foot[1]],
    kbOff: grip === 'none' || !mode ? null : KB_OFFSET[mode],
    elbow: p.elbow || 'd', elbow2: p.elbow2 || 'd', knee: p.knee || 'f', knee2: p.knee2 || 'f', toe: p.toe || 'flat',
  };
}

// Cinemática inversa de dos segmentos: devuelve [articulación media, extremo].
function ik(a, c, l1, l2, dir) {
  let dx = c[0] - a[0], dy = c[1] - a[1], d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.5, min = Math.abs(l1 - l2) + 0.5;
  if (d > max || d < min) {
    const nd = Math.min(max, Math.max(min, d));
    c = [a[0] + dx / d * nd, a[1] + dy / d * nd];
    dx = c[0] - a[0]; dy = c[1] - a[1]; d = nd;
  }
  const ang = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx);
  const m1 = [a[0] + l1 * Math.cos(base + ang), a[1] + l1 * Math.sin(base + ang)];
  const m2 = [a[0] + l1 * Math.cos(base - ang), a[1] + l1 * Math.sin(base - ang)];
  const pick = { f: m1[0] > m2[0], b: m1[0] < m2[0], u: m1[1] < m2[1], d: m1[1] > m2[1] }[dir];
  return [pick ? m1 : m2, c];
}

function solvePose(T, grip) {
  const t = T.t * Math.PI / 180;
  const hip = T.hip;
  const sh = [hip[0] + FIG.torso * Math.sin(t), hip[1] - FIG.torso * Math.cos(t)];
  const head = [hip[0] + (FIG.torso + FIG.neck) * Math.sin(t), hip[1] - (FIG.torso + FIG.neck) * Math.cos(t)];
  const [knee, ank] = ik(hip, T.foot, FIG.thigh, FIG.shin, T.knee);
  const [knee2, ank2] = ik(hip, T.foot2, FIG.thigh, FIG.shin, T.knee2);
  const [elb, hand] = ik(sh, T.hand, FIG.upper, FIG.fore, T.elbow);
  const [elb2, hand2] = ik(sh, T.hand2, FIG.upper, FIG.fore, T.elbow2);
  const toe = (a) => T.toe === 'down' ? [a[0] + 3, a[1] + 6] : [a[0] + 12, a[1] + 3];
  const kb = T.kbOff ? [hand[0] + T.kbOff[0], hand[1] + T.kbOff[1]] : null;
  const kb2 = T.kbOff && grip === 'double' ? [hand2[0] + T.kbOff[0] - 4, hand2[1] + T.kbOff[1] + 1] : null;
  return { hip, sh, head, knee, ank, toe: toe(ank), knee2, ank2, toe2: toe(ank2), elb, hand, elb2, hand2, kb, kb2 };
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

function blend(A, B, k) {
  const near = k < 0.5 ? A : B;
  return {
    hip: lerp2(A.hip, B.hip, k), t: lerp(A.t, B.t, k), hand: lerp2(A.hand, B.hand, k), hand2: lerp2(A.hand2, B.hand2, k),
    foot: lerp2(A.foot, B.foot, k), foot2: lerp2(A.foot2, B.foot2, k),
    kbOff: A.kbOff && B.kbOff ? lerp2(A.kbOff, B.kbOff, k) : near.kbOff,
    elbow: near.elbow, elbow2: near.elbow2, knee: near.knee, knee2: near.knee2, toe: near.toe,
  };
}

// ---------- Dibujo ----------

const pts = (...p) => p.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
const kbPath = c => `M${(c[0] - 6).toFixed(1)} ${(c[1] - 6).toFixed(1)} Q${c[0].toFixed(1)} ${(c[1] - 19).toFixed(1)} ${(c[0] + 6).toFixed(1)} ${(c[1] - 6).toFixed(1)}`;

function figureSvg(J, cls = '') {
  const kb = c => c ? `<g class="kb"><path d="${kbPath(c)}"/><circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="9"/></g>` : '';
  return `<svg class="fig ${cls}" viewBox="0 -14 220 214" aria-hidden="true">
    <line class="ground" x1="0" y1="193" x2="220" y2="193"/>
    <g class="far"><polyline data-j="leg2" points="${pts(J.hip, J.knee2, J.ank2, J.toe2)}"/><polyline data-j="arm2" points="${pts(J.sh, J.elb2, J.hand2)}"/></g>
    <g data-j="kb2">${kb(J.kb2)}</g>
    <g class="near">
      <line class="torso" data-j="torso" x1="${J.hip[0]}" y1="${J.hip[1]}" x2="${J.sh[0]}" y2="${J.sh[1]}"/>
      <polyline data-j="leg" points="${pts(J.hip, J.knee, J.ank, J.toe)}"/>
      <circle class="head" data-j="head" cx="${J.head[0]}" cy="${J.head[1]}" r="${FIG.head}"/>
      <polyline data-j="arm" points="${pts(J.sh, J.elb, J.hand)}"/>
    </g>
    <g data-j="kb">${kb(J.kb)}</g>
  </svg>`;
}

function updateSvg(svg, J) {
  const q = s => svg.querySelector(`[data-j="${s}"]`);
  q('leg2').setAttribute('points', pts(J.hip, J.knee2, J.ank2, J.toe2));
  q('arm2').setAttribute('points', pts(J.sh, J.elb2, J.hand2));
  q('leg').setAttribute('points', pts(J.hip, J.knee, J.ank, J.toe));
  q('arm').setAttribute('points', pts(J.sh, J.elb, J.hand));
  const torso = q('torso');
  torso.setAttribute('x1', J.hip[0]); torso.setAttribute('y1', J.hip[1]);
  torso.setAttribute('x2', J.sh[0]); torso.setAttribute('y2', J.sh[1]);
  const head = q('head');
  head.setAttribute('cx', J.head[0]); head.setAttribute('cy', J.head[1]);
  for (const [key, c] of [['kb', J.kb], ['kb2', J.kb2]]) {
    const g = q(key);
    if (!c) { g.innerHTML = ''; continue; }
    if (!g.firstChild) g.innerHTML = '<g class="kb"><path/><circle r="9"/></g>';
    g.querySelector('path').setAttribute('d', kbPath(c));
    const circ = g.querySelector('circle');
    circ.setAttribute('cx', c[0]); circ.setAttribute('cy', c[1]);
  }
}

// Imagen fija (para listas): la foto o la pose más representativa del ejercicio.
function exerciseThumb(ex) {
  if (ex.photos?.length) return `<img class="thumb-img" src="${ex.photos[ex.photos.length - 1]}" alt="" loading="lazy" draggable="false">`;
  const frames = ex.anim || [['stand']];
  const name = frames[Math.min(1, frames.length - 1)][0];
  return figureSvg(solvePose(poseTargets(name, gripOf(ex)), gripOf(ex)), 'thumb');
}

// ---------- Animación ----------

const demos = new Set();
let demoRaf = null;

function mountDemo(host, ex, { speed = 1 } = {}) {
  const grip = gripOf(ex);
  const frames = (ex.anim || [['stand', '']]).map(([pose, label]) => ({ T: poseTargets(pose, grip), label }));
  host.innerHTML = figureSvg(solvePose(frames[0].T, grip));
  const d = {
    host, svg: host.querySelector('svg'), frames, grip, speed, start: performance.now(), paused: false, pausedAt: 0,
    hold: 380, move: ex.type === 'Balístico' ? 480 : 820, label: host.parentElement?.querySelector('[data-demo-label]'),
    lastLabel: null,
  };
  if (d.label) d.label.textContent = frames[0].label;
  host._demo = d;
  demos.add(d);
  if (!demoRaf) demoRaf = requestAnimationFrame(demoLoop);
  return d;
}

function demoLoop(now) {
  for (const d of demos) {
    if (!d.host.isConnected) { demos.delete(d); continue; }
    if (d.paused) continue;
    const seg = d.hold + d.move, n = d.frames.length;
    const time = (Math.max(0, now - d.start) * d.speed) % (seg * n);
    const i = Math.floor(time / seg), within = time - i * seg;
    const A = d.frames[i], B = d.frames[(i + 1) % n];
    const k = within < d.hold ? 0 : ease((within - d.hold) / d.move);
    updateSvg(d.svg, solvePose(blend(A.T, B.T, k), d.grip));
    const label = k < 0.5 ? A.label : B.label;
    if (d.label && label !== d.lastLabel) { d.label.textContent = label; d.lastLabel = label; }
  }
  demoRaf = demos.size ? requestAnimationFrame(demoLoop) : null;
}

// ---------- Fotos alternadas ----------

const photoDemos = new Set();
let photoTimer = null;
const PHOTO_MS = 1300;

function mountPhotos(host, ex) {
  host.classList.add('photos');
  host.innerHTML = ex.photos.map((src, i) => `<img src="${src}" alt="${ex.photoLabels[i] || ''}" class="${i ? '' : 'on'}" draggable="false">`).join('');
  const d = {
    host, photo: true, i: 0, n: ex.photos.length, labels: ex.photoLabels, speed: 1, paused: false,
    next: performance.now() + PHOTO_MS, label: host.parentElement?.querySelector('[data-demo-label]'),
  };
  if (d.label) d.label.textContent = d.labels[0] || '';
  host._demo = d;
  photoDemos.add(d);
  if (!photoTimer) photoTimer = setInterval(photoTick, 100);
}

function photoTick() {
  const now = performance.now();
  for (const d of photoDemos) {
    if (!d.host.isConnected) { photoDemos.delete(d); continue; }
    if (d.paused || now < d.next) continue;
    d.i = (d.i + 1) % d.n;
    d.host.querySelectorAll('img').forEach((im, k) => im.classList.toggle('on', k === d.i));
    if (d.label) d.label.textContent = d.labels[d.i] || '';
    d.next = now + PHOTO_MS / d.speed;
  }
  if (!photoDemos.size) { clearInterval(photoTimer); photoTimer = null; }
}

// Muestra fotos si el ejercicio las tiene; si no, la figura animada.
function mountExerciseDemo(host, ex) {
  return ex.photos?.length ? mountPhotos(host, ex) : mountDemo(host, ex);
}

function toggleDemo(host) {
  const d = host?._demo;
  if (!d) return;
  if (d.photo) { d.paused = !d.paused; d.next = performance.now() + PHOTO_MS / d.speed; return d.paused; }
  if (d.paused) { d.start += performance.now() - d.pausedAt; d.paused = false; }
  else { d.paused = true; d.pausedAt = performance.now(); }
  return d.paused;
}
