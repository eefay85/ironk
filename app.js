// IronK — app personal de entrenamiento con pesas rusas.
// Todo se guarda en este navegador (localStorage). Usa Perfil > Exportar para respaldos.

const STORE_KEY = 'ironk-v1';
// deleted: ids borrados (para que no reaparezcan al sincronizar). meta: marcas de tiempo para combinar.
const EMPTY_DB = { profile: null, bells: [], customRoutines: [], sessions: [], bodyLog: [], deleted: [], meta: {} };

let db = loadDb();
let route = { name: 'home', params: {} };
let stack = [];
let ui = { goal: 'all', exGroup: 'all', exQuery: '', calMonth: null, prog: 'resumen' };
let run = null; // sesión en curso (guiada o libre)

// ---------- Persistencia ----------

function loadDb() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(structuredClone(EMPTY_DB), JSON.parse(raw));
  } catch (e) { /* datos dañados o sin acceso: empezamos vacío */ }
  return structuredClone(EMPTY_DB);
}

function saveDb({ silent = false } = {}) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('No se pudo guardar en este navegador'); }
  if (!silent) window.Sync?.schedule();
}

// Marca que cambiaron el perfil o las pesas (al sincronizar gana el cambio más reciente).
function touchSettings() { db.meta = { ...(db.meta || {}), settingsAt: Date.now() }; }
function markDeleted(id) { db.deleted = [...(db.deleted || []), id]; }

const profileComplete = () => !!(db.profile && db.profile.level && db.profile.days);

// ---------- Utilidades ----------

const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const bellWeights = () => [...new Set(db.bells.map(b => b.weight))].sort((a, b) => a - b);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(iso).toLocaleDateString('es-AR', opts);
}
function targetText(s) {
  const base = s.secs ? `${s.secs} s` : `${s.reps} rep${s.reps === 1 ? '' : 's'}`;
  return base + (s.side ? ' por lado' : '');
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function beep(freq = 880, ms = 180) {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + ms / 1000);
  } catch (e) { /* sin audio */ }
}

// ---------- Componentes ----------

function ring(pct, size, sw, inner = '', id = '') {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}"/>
    <circle class="ring-fg" ${id ? `id="${id}"` : ''} cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.min(1, Math.max(0, pct)))).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
    <div class="ring-in">${inner}</div></div>`;
}
function setRing(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = parseFloat(el.getAttribute('stroke-dasharray'));
  el.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, Math.max(0, pct)))).toFixed(1));
}

const restSeg = () => `<div class="seg">${Object.entries(REST_MODES).map(([k, m]) =>
  `<button class="${(REST_MODES[db.profile.rest] ? db.profile.rest : 'auto') === k ? 'on' : ''}" data-act="rest-mode" data-id="${k}">${m.name}</button>`).join('')}</div>`;

const levelDots = n => `<span class="lvl" title="${LEVELS[n]?.name || ''}">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const muscleChips = list => list.map(m => `<span class="tag">${MUSCLES[m] || m}</span>`).join('');

let chartSeq = 0;
function lineChart(points, fmt = v => v) {
  if (points.length < 2) return '<p class="muted small">Necesitas al menos dos registros para ver la tendencia.</p>';
  const W = 320, H = 150, px = 16, top = 24, bottom = 24;
  const vs = points.map(p => p.v), min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const x = i => px + i * (W - 2 * px) / (points.length - 1);
  const y = v => H - bottom - ((v - min) / span) * (H - top - bottom);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const id = 'cg' + (++chartSeq), iMax = vs.lastIndexOf(max);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>
    <polygon points="${px},${H - bottom} ${line} ${x(points.length - 1).toFixed(1)},${H - bottom}" fill="url(#${id})"/>
    <polyline class="cl" points="${line}"/>
    ${points.map((p, i) => `<circle class="cd" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5"><title>${esc(p.label)}: ${fmt(p.v)}</title></circle>`).join('')}
    <text class="ct" x="${Math.min(W - 30, Math.max(30, x(iMax)))}" y="${(y(max) - 9).toFixed(1)}" text-anchor="middle">${fmt(max)}</text>
    <text class="ct muted" x="${px}" y="${H - 6}">${esc(points[0].label)}</text>
    <text class="ct muted" x="${W - px}" y="${H - 6}" text-anchor="end">${esc(points[points.length - 1].label)}</text>
  </svg>`;
}

function weekStrip() {
  const ws = weekStart(new Date()), days = new Set(db.sessions.map(s => dayKey(s.date))), today = dayKey(new Date());
  return `<div class="week">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const k = dayKey(d), done = days.has(k);
    return `<div class="wd ${done ? 'done' : ''} ${k === today ? 'today' : ''}"><span>${l}</span><b>${done ? icon('check', 14) : d.getDate()}</b></div>`;
  }).join('')}</div>`;
}

// ---------- Navegación ----------

function go(name, params = {}) { stack.push(route); route = { name, params }; render(); window.scrollTo(0, 0); }
function back() { route = stack.pop() || { name: 'home', params: {} }; render(); window.scrollTo(0, 0); }
function tab(name) { stack = []; route = { name, params: {} }; render(); window.scrollTo(0, 0); }

const TABS = [
  ['home', 'home', 'Hoy'],
  ['train', 'dumbbell', 'Entrenar'],
  ['exercises', 'kb', 'Ejercicios'],
  ['progress', 'chart', 'Progreso'],
  ['profile', 'user', 'Perfil'],
];

function tabbar() {
  return `<nav class="tabbar"><div class="inner">${TABS.map(([id, ico, label]) =>
    `<button class="${route.name === id ? 'on' : ''}" data-act="tab" data-id="${id}">${icon(ico, 22)}<span>${label}</span></button>`
  ).join('')}</div></nav>`;
}

function topbar(title, extra = '') {
  return `<div class="topbar"><button class="icon-btn" data-act="back" aria-label="Volver">${icon('left')}</button><div class="title">${esc(title)}</div>${extra}</div>`;
}

const views = {};

// ---------- Bienvenida / perfil inicial ----------

function startOnboarding(fromStep = 0) {
  const p = db.profile || {};
  const d = {
    name: p.name || '', sex: p.sex || '', age: p.age || '', weight: p.weight || '', height: p.height || '',
    level: p.level || 0, goal: p.goal || '', days: p.days || 3, minutes: p.minutes || 30,
    bells: db.bells.length ? db.bells.map(b => b.weight) : [],
  };
  stack = [];
  route = { name: 'onboarding', params: { d, step: fromStep } };
  render();
}

const OB_STEPS = 8;

views.onboarding = () => {
  const { d, step } = route.params;
  const bar = `<div class="ob-bar"><i style="width:${((step + 1) / OB_STEPS) * 100}%"></i></div>`;
  const nav = (label = 'Continuar') => `<div class="ob-nav">${step > 0 ? `<button class="icon-btn big" data-act="ob-back" aria-label="Atrás">${icon('left')}</button>` : ''}
    <button class="btn primary grow big" data-act="ob-next">${label}</button></div>`;
  const choice = (field, value, title, sub = '', ico = '') => `<button class="option ${d[field] === value ? 'on' : ''}" data-act="ob-set" data-field="${field}" data-id="${value}">
    ${ico ? `<span class="opt-ico">${icon(ico, 22)}</span>` : ''}<span class="grow"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ''}</span>${d[field] === value ? icon('check', 20) : ''}</button>`;

  let body = '';
  if (step === 0) {
    body = `<div class="ob-hero"><div class="ob-logo">${icon('kb', 56)}</div><h1 class="logo">Iron<b>K</b></h1>
      <p class="muted">Tu entrenador personal de pesas rusas. Unas preguntas rápidas y armamos un plan para ti.</p></div>
      <label class="field"><span>¿Cómo te llamas?</span><input data-bind="ob.name" value="${esc(d.name)}" placeholder="Tu nombre" autocomplete="off"></label>
      ${window.Sync?.configured() ? `<button class="btn block" data-act="go-login">${icon('refresh', 16)} Ya uso IronK en otro dispositivo</button>` : ''}
      ${nav('Comenzar')}`;
  } else if (step === 1) {
    body = `<h2 class="ob-q">Cuéntanos sobre ti</h2><p class="muted">Lo usamos para sugerir pesos y tiempos de descanso.</p>
      <div class="options">${choice('sex', 'h', 'Hombre')}${choice('sex', 'm', 'Mujer')}${choice('sex', 'x', 'Prefiero no decir')}</div>
      <label class="field"><span>Edad</span><input type="number" inputmode="numeric" min="10" max="100" data-bind="ob.age" value="${esc(d.age)}" placeholder="Ej: 35"></label>
      ${nav()}`;
  } else if (step === 2) {
    body = `<h2 class="ob-q">Tu cuerpo</h2><p class="muted">Podrás registrar tu peso y ver cómo cambia en Progreso.</p>
      <div class="row"><label class="field grow"><span>Peso (kg)</span><input type="number" inputmode="decimal" step="0.1" data-bind="ob.weight" value="${esc(d.weight)}" placeholder="Ej: 75"></label>
      <label class="field grow"><span>Altura (cm) · opcional</span><input type="number" inputmode="numeric" data-bind="ob.height" value="${esc(d.height)}" placeholder="Ej: 175"></label></div>
      ${nav()}`;
  } else if (step === 3) {
    body = `<h2 class="ob-q">¿Cuánta experiencia tienes?</h2><p class="muted">Ajusta ejercicios, series y descansos.</p>
      <div class="options">${[1, 2, 3].map(n => choice('level', n, `${levelDots(n)} ${LEVELS[n].name}`, LEVELS[n].text)).join('')}</div>
      ${nav()}`;
  } else if (step === 4) {
    body = `<h2 class="ob-q">¿Cuál es tu objetivo principal?</h2>
      <div class="options">${Object.entries(GOALS).map(([k, v]) => choice('goal', k, v, GOAL_INFO[k].text, GOAL_INFO[k].icon)).join('')}</div>
      ${nav()}`;
  } else if (step === 5) {
    body = `<h2 class="ob-q">Tu semana</h2><p class="muted">¿Cuántos días quieres entrenar?</p>
      <div class="seg">${[2, 3, 4, 5, 6].map(n => `<button class="${d.days === n ? 'on' : ''}" data-act="ob-set" data-field="days" data-id="${n}">${n}</button>`).join('')}</div>
      <p class="muted" style="margin-top:22px">¿Cuánto tiempo por sesión?</p>
      <div class="seg">${[15, 20, 30, 45, 60].map(n => `<button class="${d.minutes === n ? 'on' : ''}" data-act="ob-set" data-field="minutes" data-id="${n}">${n}′</button>`).join('')}</div>
      ${nav()}`;
  } else if (step === 6) {
    const ideal = snapBell(baseSwingKg({ ...d, level: d.level || 1 }), BELL_SIZES);
    body = `<h2 class="ob-q">¿Qué pesas rusas tienes?</h2><p class="muted">Toca las que tengas. Para tu perfil, una buena pesa de swing es de <strong class="accent">${ideal} kg</strong>.</p>
      <div class="chips">${BELL_SIZES.map(w => `<button class="chip ${d.bells.includes(w) ? 'on' : ''}" data-act="ob-bell" data-id="${w}">${w} kg</button>`).join('')}</div>
      <p class="muted small">Si tienes dos iguales podrás marcarlo en Perfil.</p>
      ${nav('Ver mi plan')}`;
  } else {
    const p = db.profile, rot = programRoutines();
    const ideal = idealBell('heavy'), owned = bellWeights();
    const missing = owned.length && Math.abs(snapBell(ideal, owned) - ideal) >= 4;
    body = `<div class="ob-hero"><div class="ob-logo ok">${icon('check', 48)}</div><h1>Tu plan está listo${p.name ? ', ' + esc(p.name) : ''}</h1></div>
      <div class="card">
        <div class="kv"><span>Objetivo</span><strong>${GOALS[p.goal]}</strong></div>
        <div class="kv"><span>Nivel</span><strong>${levelDots(p.level)} ${LEVELS[p.level].name}</strong></div>
        <div class="kv"><span>Meta semanal</span><strong>${p.days} sesiones de ~${p.minutes} min</strong></div>
        <div class="kv"><span>Pesa de swing sugerida</span><strong>${ideal} kg</strong></div>
      </div>
      ${missing ? `<div class="note">${icon('bulb', 18)}<span>Con tus pesas actuales vamos a ajustar. Más adelante te conviene sumar una de ~${ideal} kg.</span></div>` : ''}
      <h2>Tu rotación</h2>
      ${rot.map((r, i) => `<div class="list-item"><span class="num">${i + 1}</span><div class="grow">${esc(r.name)}<div class="muted small">~${estimateMin(adaptRoutine(r))} min</div></div></div>`).join('')}
      <p class="muted small" style="margin-top:12px">IronK elige cada día la rutina que toca, según tu descanso y cómo te fue. Los pesos suben solos cuando completas todo con margen.</p>
      ${nav('Empezar')}`;
  }
  return `<div class="ob">${bar}${body}</div>`;
};

function obNext() {
  const { d, step } = route.params;
  if (step === 1 && (!d.sex || !num(d.age))) return toast('Completa sexo y edad');
  if (step === 2 && !num(d.weight)) return toast('Ingresa tu peso');
  if (step === 3 && !d.level) return toast('Elige tu nivel');
  if (step === 4 && !d.goal) return toast('Elige un objetivo');
  if (step === 6) {
    if (!d.bells.length) return toast('Marca al menos una pesa');
    const pairs = new Set(db.bells.filter(b => b.qty >= 2).map(b => b.weight));
    db.profile = {
      ...(db.profile || {}), name: d.name.trim(), sex: d.sex, age: num(d.age), weight: num(d.weight), height: num(d.height),
      level: d.level, goal: d.goal, days: d.days, minutes: d.minutes, created: db.profile?.created || new Date().toISOString(),
    };
    db.bells = d.bells.sort((a, b) => a - b).map(w => ({ weight: w, qty: pairs.has(w) ? 2 : 1 }));
    if (num(d.weight) && !db.bodyLog.some(b => dayKey(b.date) === dayKey(new Date()))) db.bodyLog.push({ date: new Date().toISOString(), weight: num(d.weight) });
    touchSettings(); saveDb();
  }
  if (step === OB_STEPS - 1) return tab('home');
  route.params.step++;
  render(); window.scrollTo(0, 0);
}

// ---------- Hoy ----------

views.home = () => {
  const p = db.profile, plan = todayPlan(), week = sessionsThisWeek();
  const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const rec = recovery();
  const ins = insights().slice(0, 3);
  const last = db.sessions[db.sessions.length - 1];

  let hero;
  if (plan.kind === 'done') {
    const s = plan.session;
    hero = `<div class="hero done"><div class="eyebrow">${icon('check', 16)} Hecho por hoy</div>
      <h2>${esc(s.name)}</h2><p>${fmtDuration(s.duration)} · ${s.sets.length} series · ${fmtKg(sessionVolume(s))}</p>
      <div class="row wrap"><button class="btn light" data-act="session" data-id="${s.id}">Ver resumen</button>
      <button class="btn ghost-light" data-act="routine" data-id="p-movilidad">Movilidad extra</button></div></div>`;
  } else {
    const r = adaptRoutine(plan.routine), first = routineItems(r)[0];
    const eyebrow = { train: 'Hoy toca', recovery: 'Hoy: recuperación', rest: 'Día de descanso' }[plan.kind];
    hero = `<div class="hero ${plan.kind}">
      <div class="row between"><span class="eyebrow">${icon(plan.kind === 'train' ? 'bolt' : 'moon', 16)} ${eyebrow}</span><span class="pill">${icon('clock', 14)} ~${estimateMin(r)} min</span></div>
      <div class="hero-body"><div class="grow"><h2>${esc(r.name)}</h2><p>${esc(plan.reason)}</p>
        <div class="chips">${mainMuscles(r).map(m => `<span class="tag light">${MUSCLES[m]}</span>`).join('')}</div></div>
        <div class="hero-fig" data-demo="${first.ex}"></div></div>
      <div class="row"><button class="btn light grow" data-act="run-start" data-id="${r.id}">${icon('play', 16)} Empezar</button>
        <button class="btn ghost-light" data-act="routine" data-id="${r.id}">Detalle</button></div></div>`;
  }

  const shown = ['gluteos', 'piernas', 'isquios', 'espalda', 'hombros', 'pecho', 'core'];
  return `
    <header class="home-head"><div><div class="muted small cap">${date}</div><h1>Hola${p.name ? ', ' + esc(p.name) : ''}</h1></div>
      <button class="avatar" data-act="tab" data-id="profile">${esc((p.name || 'K')[0].toUpperCase())}</button></header>
    <div class="card goal-card">
      ${ring(week / p.days, 74, 8, `<strong>${week}</strong><small>/${p.days}</small>`)}
      <div class="grow"><strong>Meta semanal</strong><div class="muted small">${week >= p.days ? '¡Cumplida! Gran semana.' : `Te faltan ${p.days - week} sesión${p.days - week > 1 ? 'es' : ''}`}</div>
      ${weekStrip()}</div>
    </div>
    ${hero}
    <div class="stats three">
      <div class="stat">${icon('flame', 18, 'accent')}<div class="v">${streakDays()}</div><div class="l">días de racha</div></div>
      <div class="stat">${icon('kb', 18, 'accent')}<div class="v">${db.sessions.length}</div><div class="l">sesiones</div></div>
      <div class="stat">${icon('scale', 18, 'accent')}<div class="v">${fmtKg(db.sessions.reduce((a, s) => a + sessionVolume(s), 0))}</div><div class="l">levantado</div></div>
    </div>
    <h2>Para ti</h2>
    <div class="card">${ins.map(i => `<div class="insight">${icon(i.icon, 18, 'accent')}<span class="grow">${esc(i.text)}</span>${i.action ? `<button class="btn small" data-act="${i.action}">Sí</button>` : ''}</div>`).join('')}</div>
    <h2>Músculos listos para entrenar</h2>
    <div class="card recovery">${shown.map(m => {
      const v = rec[m], st = v >= 85 ? ['', 'Listo'] : v >= 50 ? ['mid', 'Recuperando'] : ['low', 'Cansado'];
      return `<div class="rec"><span>${MUSCLES[m]}</span><div class="bar"><i class="${st[0]}" style="width:${v}%"></i></div><small class="${st[0] || 'ok'}">${st[1]}</small></div>`;
    }).join('')}<p class="muted small" style="margin:8px 0 0">Barra llena = descansado. Baja cuando entrenas ese músculo y se vuelve a llenar con las horas de descanso.</p></div>
    <div class="row quick">
      <button class="btn grow" data-act="free-start">${icon('bolt', 18)} Sesión libre</button>
      <button class="btn grow" data-act="body-quick">${icon('scale', 18)} Registrar peso</button>
    </div>
    ${last ? `<h2>Última actividad</h2>${sessionCard(last)}` : ''}
    ${tabbar()}`;
};

// ---------- Entrenar ----------

function routineCard(r, badge = '') {
  const a = adaptRoutine(r), items = routineItems(a), fits = r.custom || routineFits(r);
  return `<div class="card click rcard ${fits ? '' : 'dim'}" data-act="routine" data-id="${r.id}">
    <div class="thumb">${exerciseThumb(exById(items[0]?.ex))}</div>
    <div class="grow"><div class="row"><h3 class="grow">${esc(r.name)}</h3>${badge}</div>
      <div class="muted small">${r.custom ? 'Mi rutina' : esc(GOALS[r.goal])} · ~${estimateMin(a)} min · ${items.length} ejercicios</div>
      <div class="meta">${r.custom ? '' : levelDots(r.minLevel || 1)}${fits ? '' : '<span class="tag">No es tu nivel</span>'}</div></div>
    <span class="muted">${icon('right', 18)}</span></div>`;
}

views.train = () => {
  const rot = programRoutines(), plan = todayPlan(), g = ui.goal;
  const list = PRESET_ROUTINES.filter(r => g === 'all' || r.goal === g)
    .sort((a, b) => Number(routineFits(b)) - Number(routineFits(a)));
  return `
    <h1>Entrenar</h1>
    <h2>${icon('repeat', 18, 'accent')} Tu programa</h2>
    <p class="muted small">${GOALS[db.profile.goal]} · ${LEVELS[level()].name} · ${db.profile.days} días por semana</p>
    ${rot.map(r => routineCard(r, plan.routine?.id === r.id && plan.kind === 'train' ? '<span class="tag accent">Hoy</span>' : '')).join('')}
    <h2>Mis rutinas</h2>
    ${db.customRoutines.map(r => routineCard(r)).join('') || '<p class="muted small">Crea rutinas con tus ejercicios, series y descansos.</p>'}
    <div class="row"><button class="btn grow" data-act="builder-new">${icon('plus', 18)} Crear rutina</button>
      <button class="btn grow" data-act="free-start">${icon('bolt', 18)} Sesión libre</button></div>
    <h2>Todas las rutinas</h2>
    <div class="chips scroll">
      <button class="chip ${g === 'all' ? 'on' : ''}" data-act="rgoal" data-id="all">Todas</button>
      ${Object.entries(GOALS).map(([k, v]) => `<button class="chip ${g === k ? 'on' : ''}" data-act="rgoal" data-id="${k}">${v}</button>`).join('')}
    </div>
    ${list.map(r => routineCard(r)).join('') || '<p class="muted">Nada con este filtro.</p>'}
    ${tabbar()}`;
};

views.routine = () => {
  const base = routineById(route.params.id);
  if (!base) return topbar('Rutina') + '<p class="empty">Rutina no encontrada.</p>';
  const r = adaptRoutine(base), items = routineItems(r), hasCircuit = r.blocks.some(b => b.circuit);
  return `
    ${topbar(r.name)}
    <div class="card hero-lite">
      <div class="demo-wrap"><div class="demo" data-demo="${items[0].ex}"></div></div>
      <p>${esc(r.desc || '')}</p>
      <div class="chips"><span class="tag accent">${r.custom ? 'Mi rutina' : esc(GOALS[r.goal])}</span><span class="tag">${icon('clock', 13)} ~${estimateMin(r)} min</span>
        <span class="tag">${items.length} ejercicios</span>${mainMuscles(r).map(m => `<span class="tag">${MUSCLES[m]}</span>`).join('')}</div>
    </div>
    ${r.notes.length ? `<div class="note">${icon('spark', 18)}<div><strong>Adaptada a ti</strong>${r.notes.map(n => `<div class="small">${esc(n)}</div>`).join('')}</div></div>` : ''}
    ${hasCircuit ? `<div class="note">${icon('repeat', 18)}<span class="small">Incluye un circuito: haces los ejercicios seguidos y descansas al final de cada ronda.</span></div>` : ''}
    <div class="card"><div class="row between"><strong>${icon('timer', 18, 'accent')} Descanso entre series</strong><span class="muted small">se aplica a todas las rutinas</span></div>${restSeg()}</div>
    <h2>Ejercicios</h2>
    ${items.map(it => {
      const ex = exById(it.ex), sw = suggestWeight(ex);
      const arrow = sw.change === 'up' ? icon('up', 13) : sw.change === 'down' ? icon('down', 13) : '';
      return `<div class="card click excard" data-act="exercise" data-id="${ex.id}">
        <div class="thumb sm">${exerciseThumb(ex)}</div>
        <div class="grow"><h3>${esc(ex.name)}</h3><div class="muted small">${it.sets} × ${targetText(it)}${it.rest && !it.circuit ? ` · ${it.rest} s pausa` : ''}</div>
          ${sw.reason ? `<div class="small reason ${sw.change}">${esc(sw.reason)}</div>` : ''}</div>
        ${sw.weight ? `<span class="wtag ${sw.change}">${arrow}${sw.weight} kg${ex.double ? ' ×2' : ''}</span>` : ''}</div>`;
    }).join('')}
    <div class="sticky-cta"><button class="btn primary block big" data-act="run-start" data-id="${r.id}">${icon('play', 18)} Empezar entrenamiento</button></div>
    <div class="row" style="margin-top:10px">
      ${r.custom
        ? `<button class="btn grow" data-act="builder-edit" data-id="${r.id}">${icon('edit', 16)} Editar</button><button class="btn grow danger" data-act="routine-del" data-id="${r.id}">${icon('trash', 16)} Eliminar</button>`
        : `<button class="btn grow" data-act="builder-copy" data-id="${r.id}">${icon('edit', 16)} Duplicar y editar</button>`}
    </div>`;
};

// ---------- Ejercicios ----------

views.exercises = () => `
  <h1>Ejercicios</h1>
  <div class="search">${icon('search', 18)}<input data-bind="exQuery" value="${esc(ui.exQuery)}" placeholder="Buscar ejercicio…"></div>
  <div class="chips scroll">
    <button class="chip ${ui.exGroup === 'all' ? 'on' : ''}" data-act="exgroup" data-id="all">Todos</button>
    ${GROUPS.map(g => `<button class="chip ${ui.exGroup === g ? 'on' : ''}" data-act="exgroup" data-id="${g}">${g}</button>`).join('')}
  </div>
  <div id="exlist">${exerciseList()}</div>
  ${tabbar()}`;

function exerciseList() {
  const q = ui.exQuery.trim().toLowerCase();
  const list = EXERCISES.filter(e => (ui.exGroup === 'all' || e.group === ui.exGroup) && (!q || e.name.toLowerCase().includes(q)));
  if (!list.length) return '<p class="empty">Sin resultados.</p>';
  return `<div class="grid2">${list.map(e => `<div class="excell click" data-act="exercise" data-id="${e.id}">
    <div class="thumb">${exerciseThumb(e)}</div>
    <div class="exname">${esc(e.name)}</div>
    <div class="row between"><span class="muted small">${e.group}</span>${levelDots(e.level)}</div></div>`).join('')}</div>`;
}

views.exercise = () => {
  const e = exById(route.params.id);
  const hist = exHistory(e.id);
  const all = hist.flatMap(h => h.sets);
  const best = all.reduce((m, x) => Math.max(m, x.weight || 0), 0);
  const bestE = all.reduce((m, x) => Math.max(m, e1rm(x)), 0);
  const sw = suggestWeight(e);
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(e.en + ' tutorial')}`;
  const chartPts = hist.slice(-12).map(h => ({ label: fmtDate(h.date, { day: 'numeric', month: 'numeric' }),
    v: e.load === 'none' ? Math.max(...h.sets.map(s => s.reps || 0)) : Math.round(Math.max(...h.sets.map(s => e1rm(s) || s.weight || 0))) }));
  const easier = e.easier ? exById(e.easier) : null;
  const harder = EXERCISES.filter(x => x.easier === e.id);
  return `
    ${topbar(e.name)}
    <div class="card demo-card">
      <div class="demo big" data-demo="${e.id}"></div>
      <div class="demo-bar"><span class="demo-label" data-demo-label></span>
        <button class="icon-btn" data-act="demo-speed" aria-label="Velocidad"><span class="small" id="speed">1×</span></button>
        <button class="icon-btn" data-act="demo-toggle" aria-label="Pausa">${icon('pause', 18)}</button></div>
    </div>
    <div class="chips"><span class="tag accent">${e.group}</span><span class="tag">${e.type}</span><span class="tag">${levelDots(e.level)} ${LEVELS[e.level].name}</span>${e.uni ? '<span class="tag">Por lado</span>' : ''}${e.double ? '<span class="tag">Dos pesas</span>' : ''}</div>
    <p>${esc(e.desc)}</p>
    <div class="card"><div class="muted small">Músculos</div><div class="chips">${muscleChips(e.muscles)}</div>
      ${sw.weight ? `<div class="kv"><span>Peso sugerido para ti</span><strong>${sw.weight} kg${e.double ? ' ×2' : ''}</strong></div><div class="muted small">${esc(sw.reason || '')}</div>` : ''}</div>
    <h2>Cómo hacerlo</h2>
    <div class="card steps">${e.cues.map((c, i) => `<div class="list-item"><span class="num">${i + 1}</span><span class="grow">${esc(c)}</span></div>`).join('')}</div>
    ${e.mistakes?.length ? `<h2>Errores comunes</h2><div class="card">${e.mistakes.map(m => `<div class="list-item"><span class="bad">${icon('close', 14)}</span><span class="grow">${esc(m)}</span></div>`).join('')}</div>` : ''}
    <a class="btn block" href="${yt}" target="_blank" rel="noopener">${icon('video', 18)} Ver videos en YouTube</a>
    ${easier || harder.length ? `<h2>Variantes</h2>${easier ? `<div class="card click row" data-act="exercise" data-id="${easier.id}">${icon('down', 18, 'muted')}<span class="grow">Más fácil: ${esc(easier.name)}</span>${icon('right', 16)}</div>` : ''}
      ${harder.map(h => `<div class="card click row" data-act="exercise" data-id="${h.id}">${icon('up', 18, 'accent')}<span class="grow">Más difícil: ${esc(h.name)}</span>${icon('right', 16)}</div>`).join('')}` : ''}
    <h2>Tu progreso</h2>
    ${all.length ? `
      <div class="stats"><div class="stat"><div class="v">${hist.length}</div><div class="l">sesiones</div></div>
      <div class="stat"><div class="v">${e.load === 'none' ? Math.max(...all.map(s => s.reps || 0)) + ' reps' : best ? best + ' kg' : '—'}</div><div class="l">${e.load === 'none' ? 'máximo de reps' : 'peso máximo'}</div></div>
      ${bestE ? `<div class="stat"><div class="v">${Math.round(bestE)} kg</div><div class="l">fuerza estimada (1RM)</div></div>` : ''}
      <div class="stat"><div class="v">${all.length}</div><div class="l">series totales</div></div></div>
      <div class="card" style="margin-top:10px"><div class="muted small">${e.load === 'none' ? 'Repeticiones máximas' : 'Fuerza estimada por sesión'}</div>${lineChart(chartPts, v => e.load === 'none' ? v : v + ' kg')}</div>
      <div class="card">${all.slice(-6).reverse().map(x => `<div class="list-item"><div class="grow muted">${x.weight ? x.weight + ' kg' : 'Sin peso'}</div><div>${x.secs ? x.secs + ' s' : x.reps + ' reps'}${x.side ? ' /lado' : ''}</div></div>`).join('')}</div>`
      : '<p class="muted">Todavía no lo registraste. Aparecerá aquí cuando lo hagas.</p>'}`;
};

// ---------- Creador de rutinas ----------

function newDraft(from) {
  const blocks = from ? routineItems(adaptRoutine(from)).map(it => ({
    ex: it.ex, sets: it.sets, reps: it.reps || 0, secs: it.secs || 0, side: !!it.side, rest: it.rest || 60,
  })) : [];
  return { name: from ? (from.custom ? from.name : from.name + ' (mía)') : '', goal: from ? from.goal : db.profile.goal, desc: from?.desc || '', blocks };
}

views.builder = () => {
  const d = route.params.draft;
  return `
    ${topbar(route.params.editId ? 'Editar rutina' : 'Nueva rutina')}
    <label class="field"><span>Nombre</span><input data-bind="d.name" value="${esc(d.name)}" placeholder="Ej: Lunes fuerza"></label>
    <label class="field"><span>Objetivo</span><select data-bind="d.goal">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${d.goal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <h2>Ejercicios</h2>
    ${d.blocks.map((b, i) => `
      <div class="card">
        <div class="row"><div class="thumb sm">${exerciseThumb(exById(b.ex))}</div><h3 class="grow">${i + 1}. ${esc(exById(b.ex).name)}</h3>
          <button class="icon-btn" data-act="b-up" data-i="${i}" aria-label="Subir">${icon('up', 16)}</button><button class="icon-btn" data-act="b-del" data-i="${i}" aria-label="Quitar">${icon('trash', 16)}</button></div>
        <div class="row" style="margin-top:10px">
          <label class="field grow"><span>Series</span><input type="number" min="1" data-bind="b.${i}.sets" value="${b.sets}"></label>
          <label class="field grow"><span>${b.secs ? 'Segundos' : 'Reps'}</span><input type="number" min="1" data-bind="b.${i}.${b.secs ? 'secs' : 'reps'}" value="${b.secs || b.reps}"></label>
          <label class="field grow"><span>Pausa (s)</span><input type="number" min="0" step="5" data-bind="b.${i}.rest" value="${b.rest}"></label>
        </div>
        <div class="chips">
          <button class="chip ${b.side ? 'on' : ''}" data-act="b-side" data-i="${i}">Por lado</button>
          <button class="chip ${b.secs ? 'on' : ''}" data-act="b-timed" data-i="${i}">Por tiempo</button>
        </div>
      </div>`).join('') || '<p class="muted">Agrega ejercicios abajo.</p>'}
    <label class="field"><span>Agregar ejercicio</span>
      <select data-act-change="b-add"><option value="">Elegir…</option>${GROUPS.map(g => `<optgroup label="${g}">${EXERCISES.filter(e => e.group === g).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    ${d.blocks.length ? `<p class="muted small">Duración estimada: ~${estimateMin({ blocks: d.blocks })} min</p>` : ''}
    <button class="btn primary block big" data-act="builder-save">Guardar rutina</button>`;
};

// ---------- Sesión guiada ----------

function startRun(base) {
  const routine = adaptRoutine(base);
  const steps = buildSteps(routine);
  if (!steps.length) return toast('La rutina no tiene ejercicios');
  run = {
    mode: 'guided', routineId: base.id, name: routine.name, steps,
    i: 0, phase: 'work', start: Date.now(), sets: [], weights: {}, reasons: {}, reps: steps[0].reps,
    timerEnd: null, timerTotal: 0, restEnd: null, restTotal: 0,
  };
  requestWakeLock();
  route = { name: 'run', params: {} }; stack = [];
  render();
}

function currentWeight(exId) {
  if (!(exId in run.weights)) {
    const sw = suggestWeight(exById(exId));
    run.weights[exId] = sw.weight;
    run.reasons[exId] = sw;
  }
  return run.weights[exId];
}

function weightChips(ex) {
  const bells = bellsFor(ex);
  if (ex.load === 'none' || !bells.length) return '';
  const w = currentWeight(ex.id), sw = run.reasons[ex.id] || {};
  return `<div class="muted small center">Peso${ex.double ? ' (cada pesa)' : ''}</div>
    <div class="chips center">${bells.map(b => `<button class="chip ${b === w ? 'on' : ''}" data-act="run-weight" data-id="${b}">${b === sw.weight ? '★ ' : ''}${b} kg</button>`).join('')}</div>
    ${sw.reason ? `<div class="small center reason ${sw.change}">${esc(sw.reason)}</div>` : ''}`;
}

views.run = () => {
  const s = run.steps[run.i], ex = exById(s.ex);
  const pct = (run.i / run.steps.length) * 100;
  const next = run.steps[run.i + 1];
  const head = `<div class="topbar"><button class="icon-btn" data-act="run-quit" aria-label="Terminar">${icon('close')}</button>
    <div class="title">${esc(run.name)}</div><span class="pill dark" id="elapsed">${fmtTime((Date.now() - run.start) / 1000)}</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>`;

  if (run.phase === 'rest') {
    const nx = run.steps[run.i], nex = exById(nx.ex);
    const left = (run.restEnd - Date.now()) / 1000;
    const tip = nex.cues[Math.floor(Math.random() * nex.cues.length)];
    return `${head}
      <div class="center muted" style="margin-top:8px">Descanso</div>
      <div class="center">${ring(left / (run.restTotal / 1000), 220, 12, `<div class="timer" id="timer">${fmtTime(left)}</div><small class="muted">respira</small>`, 'ring-rest')}</div>
      <div class="row" style="margin-top:14px"><button class="btn grow" data-act="rest-sub">${icon('minus', 16)} 15 s</button><button class="btn grow" data-act="rest-add">${icon('plus', 16)} 15 s</button><button class="btn primary grow" data-act="rest-skip">${icon('skip', 16)} Saltar</button></div>
      <h2>Siguiente</h2>
      <div class="card row"><div class="demo sm" data-demo="${nex.id}"></div><div class="grow"><h3>${esc(nex.name)}</h3>
        <div class="muted small">${nx.label} · ${targetText(nx)}</div>${nex.load !== 'none' && bellsFor(nex).length ? `<div class="small">${currentWeight(nex.id)} kg</div>` : ''}</div></div>
      ${tip ? `<div class="note">${icon('bulb', 18)}<span>${esc(tip)}</span></div>` : ''}`;
  }

  let action;
  if (s.secs) {
    const total = s.secs * (s.side ? 2 : 1);
    action = run.timerEnd
      ? `<div class="center">${ring((run.timerEnd - Date.now()) / run.timerTotal, 170, 10, `<div class="timer sm" id="timer">${fmtTime((run.timerEnd - Date.now()) / 1000)}</div>`, 'ring-work')}</div>
         <button class="btn block" data-act="work-done">${icon('check', 16)} Terminar antes</button>`
      : `<div class="target">${total} s</div>${s.side ? '<p class="muted center">cambia de lado a la mitad</p>' : ''}
         <button class="btn primary block big" data-act="timer-start">${icon('play', 18)} Iniciar</button>`;
  } else {
    action = `<div class="muted small center">Repeticiones${s.side ? ' por lado' : ''} · objetivo ${s.reps}</div>
      <div class="stepper"><button data-act="reps" data-d="-1" aria-label="Menos">${icon('minus', 22)}</button><div class="val">${run.reps}</div><button data-act="reps" data-d="1" aria-label="Más">${icon('plus', 22)}</button></div>
      <button class="btn primary block big" data-act="work-done">${icon('check', 20)} Serie hecha</button>`;
  }

  return `${head}
    <div class="demo-card run"><div class="demo" data-demo="${ex.id}"></div><span class="demo-label" data-demo-label></span></div>
    <div class="run-ex">
      <div class="eyebrow-d">${s.label}</div>
      <h1>${esc(ex.name)}</h1>
      ${weightChips(ex)}
      ${action}
    </div>
    <div class="row" style="margin-top:12px"><button class="btn grow" data-act="exercise" data-id="${ex.id}">${icon('info', 16)} Técnica</button><button class="btn grow" data-act="work-skip">${icon('skip', 16)} Saltar</button></div>
    <p class="muted small center" style="margin-top:16px">${next ? `Luego: ${esc(exById(next.ex).name)} · ${targetText(next)}` : '¡Último ejercicio!'}</p>`;
};

function completeWork(skipped) {
  const s = run.steps[run.i];
  if (!skipped) {
    const sides = s.side ? 2 : 1;
    const secs = s.secs ? Math.round((run.timerEnd ? run.timerTotal / 1000 - Math.max(0, (run.timerEnd - Date.now()) / 1000) : s.secs * sides) / sides) : 0;
    const ex = exById(s.ex);
    run.sets.push({
      ex: s.ex, weight: ex.load === 'none' ? 0 : currentWeight(s.ex), reps: s.secs ? 0 : run.reps, secs, side: !!s.side,
      ...(s.secs ? { targetSecs: s.secs } : { target: s.reps }),
    });
    if (!s.secs && run.reps >= s.reps + 4 && ex.load !== 'none') toast('¡Muy fácil! La próxima vez subimos de pesa');
  }
  run.timerEnd = null;
  if (run.i >= run.steps.length - 1) return finishRun();
  const rest = s.rest || 0;
  run.i++;
  run.reps = run.steps[run.i].reps;
  if (rest > 0 && !skipped) { run.phase = 'rest'; run.restTotal = rest * 1000; run.restEnd = Date.now() + run.restTotal; }
  else run.phase = 'work';
  render();
}

function tick() {
  if (!run) return;
  const el = document.getElementById('elapsed');
  if (el) el.textContent = fmtTime((Date.now() - run.start) / 1000);
  if (route.name !== 'run') return;
  const end = run.phase === 'rest' ? run.restEnd : run.timerEnd;
  if (!end) return;
  const left = (end - Date.now()) / 1000;
  const t = document.getElementById('timer');
  if (t) t.textContent = fmtTime(left);
  if (run.phase === 'rest') setRing('ring-rest', left / (run.restTotal / 1000));
  else setRing('ring-work', left / (run.timerTotal / 1000));
  if (left <= 3.05 && left > 0 && Math.ceil(left) !== tick.lastBeep) { tick.lastBeep = Math.ceil(left); beep(660, 100); }
  if (left <= 0) {
    tick.lastBeep = null;
    beep(990, 350);
    if (navigator.vibrate) navigator.vibrate(300);
    if (run.phase === 'rest') { run.phase = 'work'; run.restEnd = null; render(); }
    else completeWork(false);
  }
}

// ---------- Sesión libre ----------

function startFree() {
  run = { mode: 'free', name: 'Sesión libre', start: Date.now(), sets: [], weights: {}, reasons: {}, ex: null, reps: 10 };
  requestWakeLock();
  route = { name: 'free', params: {} }; stack = [];
  render();
}

views.free = () => {
  const ex = run.ex ? exById(run.ex) : null;
  const grouped = [];
  run.sets.forEach(s => {
    const g = grouped[grouped.length - 1];
    if (g && g.ex === s.ex) g.sets.push(s); else grouped.push({ ex: s.ex, sets: [s] });
  });
  return `
    <div class="topbar"><button class="icon-btn" data-act="run-quit" aria-label="Terminar">${icon('close')}</button>
      <div class="title">Sesión libre</div><span class="pill dark" id="elapsed">${fmtTime((Date.now() - run.start) / 1000)}</span></div>
    <label class="field"><span>Ejercicio</span>
      <select data-act-change="free-ex"><option value="">Elegir…</option>${GROUPS.map(g => `<optgroup label="${g}">${EXERCISES.filter(e => e.group === g).map(e => `<option value="${e.id}" ${run.ex === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    ${ex ? `
      <div class="card">
        <div class="demo-card run flat"><div class="demo" data-demo="${ex.id}"></div></div>
        <h3 class="center">${esc(ex.name)}</h3>
        ${weightChips(ex)}
        <div class="stepper"><button data-act="reps" data-d="-1" aria-label="Menos">${icon('minus', 22)}</button><div class="val">${run.reps}</div><button data-act="reps" data-d="1" aria-label="Más">${icon('plus', 22)}</button></div>
        <button class="btn primary block big" data-act="free-log">${icon('plus', 18)} Registrar serie</button>
      </div>` : '<p class="muted">Elige un ejercicio para empezar a registrar.</p>'}
    <h2>Registrado</h2>
    ${grouped.length ? grouped.map(g => `<div class="card"><h3>${esc(exById(g.ex).name)}</h3>${g.sets.map((s, i) =>
      `<div class="list-item"><div class="grow muted">Serie ${i + 1}</div><div>${s.weight ? s.weight + ' kg × ' : ''}${s.reps} reps</div></div>`).join('')}</div>`).join('')
      : '<p class="muted small">Aún nada.</p>'}
    <div class="row"><button class="btn grow" data-act="free-undo" ${run.sets.length ? '' : 'disabled'}>Deshacer</button>
    <button class="btn primary grow" data-act="finish" ${run.sets.length ? '' : 'disabled'}>Terminar sesión</button></div>`;
};

// ---------- Resumen y guardado ----------

function finishRun() {
  run.end = Date.now();
  run.prs = detectPRs(run.sets);
  releaseWakeLock();
  if (run.prs.length) { beep(784, 150); setTimeout(() => beep(1046, 250), 160); }
  route = { name: 'summary', params: { effort: 7 } }; stack = [];
  render();
}

const EFFORT_LABEL = n => n <= 3 ? 'Fácil' : n <= 6 ? 'Moderado' : n <= 8 ? 'Duro' : 'Al límite';

views.summary = () => {
  const dur = (run.end - run.start) / 1000, e = route.params.effort;
  return `
    <div class="sum-head"><div class="ob-logo ok">${icon(run.prs.length ? 'trophy' : 'check', 44)}</div>
      <h1>¡Sesión completa!</h1><p class="muted">${esc(run.name)}</p></div>
    <div class="stats">
      <div class="stat"><div class="v">${fmtDuration(dur)}</div><div class="l">duración</div></div>
      <div class="stat"><div class="v">${run.sets.length}</div><div class="l">series</div></div>
      <div class="stat"><div class="v">${fmtKg(sessionVolume({ sets: run.sets }))}</div><div class="l">peso levantado</div></div>
      <div class="stat"><div class="v">${new Set(run.sets.map(s => s.ex)).size}</div><div class="l">ejercicios</div></div>
    </div>
    ${run.prs.length ? `<h2>${icon('trophy', 18, 'accent')} Nuevos récords</h2><div class="card pr">${run.prs.map(p => `<div class="list-item"><div class="grow"><strong>${esc(exById(p.ex).name)}</strong><div class="muted small">${p.type}</div></div><strong class="accent">${p.value}</strong></div>`).join('')}</div>` : ''}
    <h2>¿Qué tan duro fue?</h2>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button class="chip ${n === e ? 'on' : ''}" data-act="effort" data-id="${n}">${n}</button>`).join('')}</div>
    <p class="center muted small">${e} · ${EFFORT_LABEL(e)} — esto ajusta tus próximos pesos y tu recuperación.</p>
    <label class="field" style="margin-top:14px"><span>Notas (opcional)</span><textarea data-bind="note" rows="2" placeholder="¿Cómo te sentiste?">${esc(route.params.note || '')}</textarea></label>
    <button class="btn primary block big" data-act="save-session">Guardar en historial</button>
    <div style="height:8px"></div>
    <button class="btn block danger" data-act="discard-session">Descartar</button>`;
};

// ---------- Progreso ----------

function sessionCard(s) {
  return `<div class="card click scard" data-act="session" data-id="${s.id}">
    <div class="date-badge"><b>${new Date(s.date).getDate()}</b><span>${fmtDate(s.date, { month: 'short' }).replace('.', '')}</span></div>
    <div class="grow"><h3>${esc(s.name)}${s.prs?.length ? ` <span class="accent">${icon('trophy', 14)}</span>` : ''}</h3>
      <div class="muted small">${fmtDuration(s.duration)} · ${s.sets.length} series · ${fmtKg(sessionVolume(s))}</div></div>
    ${s.effort ? `<span class="tag">${s.effort}/10</span>` : ''}${icon('right', 16)}</div>`;
}

function calendar() {
  const base = ui.calMonth ? new Date(ui.calMonth) : new Date();
  const y = base.getFullYear(), m = base.getMonth();
  const days = new Set(db.sessions.map(s => dayKey(s.date)));
  const first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7;
  const count = new Date(y, m + 1, 0).getDate(), today = dayKey(new Date());
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div></div>';
  for (let d = 1; d <= count; d++) {
    const k = dayKey(new Date(y, m, d));
    cells += `<div class="cd-day ${days.has(k) ? 'on' : ''} ${k === today ? 'today' : ''}">${d}</div>`;
  }
  const title = first.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return `<div class="card">
    <div class="row between"><button class="icon-btn" data-act="cal" data-d="-1" aria-label="Mes anterior">${icon('left', 18)}</button><strong class="cap">${title}</strong><button class="icon-btn" data-act="cal" data-d="1" aria-label="Mes siguiente">${icon('right', 18)}</button></div>
    <div class="cal head">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<div>${x}</div>`).join('')}</div>
    <div class="cal">${cells}</div></div>`;
}

function weeklyBars(weeksBack = 10) {
  const ws = weekStart(new Date()).getTime(), weeks = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const a = ws - i * 7 * DAY, list = sessionsBetween(a, a + 7 * DAY);
    const d = new Date(a);
    weeks.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, vol: list.reduce((x, s) => x + sessionVolume(s), 0), n: list.length });
  }
  const max = Math.max(1, ...weeks.map(w => w.vol));
  return `<div class="bars">${weeks.map((w, i) => `<div class="b ${i === weeks.length - 1 ? 'cur' : ''}" title="${fmtKg(w.vol)} · ${w.n} sesiones"><em>${w.n || ''}</em><i style="height:${(w.vol / max) * 100}%"></i><small>${w.label}</small></div>`).join('')}</div>`;
}

views.progress = () => {
  const p = ui.prog;
  const seg = `<div class="seg wide">${[['resumen', 'Resumen'], ['ejercicios', 'Ejercicios'], ['cuerpo', 'Cuerpo'], ['logros', 'Logros']].map(([k, v]) =>
    `<button class="${p === k ? 'on' : ''}" data-act="prog" data-id="${k}">${v}</button>`).join('')}</div>`;
  return `<h1>Progreso</h1>${seg}${progressViews[p]()}${tabbar()}`;
};

const progressViews = {
  resumen() {
    const s = db.sessions, week = sessionsThisWeek(), days = db.profile.days;
    const totalVol = s.reduce((a, x) => a + sessionVolume(x), 0);
    const totalTime = s.reduce((a, x) => a + (x.duration || 0), 0);
    const efforts = s.filter(x => x.effort);
    const avgEffort = efforts.length ? (efforts.reduce((a, x) => a + x.effort, 0) / efforts.length).toFixed(1) : '—';
    return `
      <div class="card goal-card">${ring(week / days, 84, 9, `<strong>${week}</strong><small>/${days}</small>`)}
        <div class="grow"><strong>Esta semana</strong><div class="muted small">${(() => {
          const n = weeksMeetingGoal();
          return n ? `${n} semana${n > 1 ? 's' : ''} seguida${n > 1 ? 's' : ''} cumpliendo la meta` : week >= days ? '¡Meta cumplida!' : `Te faltan ${days - week} para cumplir la meta`;
        })()}</div>${weekStrip()}</div></div>
      <div class="stats">
        <div class="stat"><div class="v">${s.length}</div><div class="l">sesiones</div></div>
        <div class="stat"><div class="v">${fmtKg(totalVol)}</div><div class="l">peso total levantado</div></div>
        <div class="stat"><div class="v">${fmtDuration(totalTime)}</div><div class="l">tiempo entrenado</div></div>
        <div class="stat"><div class="v">${streakDays()} <small class="muted">/ ${longestStreak()}</small></div><div class="l">racha actual / mejor</div></div>
        <div class="stat"><div class="v">${avgEffort}</div><div class="l">esfuerzo promedio</div></div>
        <div class="stat"><div class="v">${s.reduce((a, x) => a + (x.prs?.length || 0), 0)}</div><div class="l">récords personales</div></div>
      </div>
      <h2>Lo que dicen tus números</h2>
      <div class="card">${insights().map(i => `<div class="insight">${icon(i.icon, 18, 'accent')}<span class="grow">${esc(i.text)}</span>${i.action ? `<button class="btn small" data-act="${i.action}">Sí</button>` : ''}</div>`).join('')}</div>
      <h2>Peso levantado por semana</h2>
      <div class="card">${weeklyBars()}<p class="muted small" style="margin:6px 0 0">El número arriba de cada barra son las sesiones de esa semana.</p></div>
      <h2>Calendario</h2>
      ${calendar()}
      <h2>Actividades</h2>
      ${s.length ? [...s].reverse().map(sessionCard).join('') : '<p class="empty">Aún no hay sesiones. ¡Termina tu primer entrenamiento y aparecerá aquí!</p>'}`;
  },
  ejercicios() {
    const ids = [...new Set(db.sessions.flatMap(s => s.sets.map(x => x.ex)))];
    if (!ids.length) return '<p class="empty">Cuando registres ejercicios verás aquí su evolución.</p>';
    return ids.map(id => {
      const ex = exById(id), h = exHistory(id);
      const vals = h.map(x => ex.load === 'none' ? Math.max(...x.sets.map(s => s.reps || 0)) : Math.max(...x.sets.map(s => e1rm(s) || s.weight || 0)));
      const first = vals[0], lastV = vals[vals.length - 1];
      const pct = first ? Math.round((lastV / first - 1) * 100) : 0;
      const best = Math.max(...h.flatMap(x => x.sets.map(s => s.weight || 0)));
      return `<div class="card click excard" data-act="exercise" data-id="${id}"><div class="thumb sm">${exerciseThumb(ex)}</div>
        <div class="grow"><h3>${esc(ex.name)}</h3><div class="muted small">${h.length} sesiones${best ? ` · máx ${best} kg` : ''}</div></div>
        ${h.length > 1 ? `<span class="wtag ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}">${pct > 0 ? icon('up', 13) : pct < 0 ? icon('down', 13) : ''}${pct > 0 ? '+' : ''}${pct}%</span>` : ''}</div>`;
    }).join('');
  },
  cuerpo() {
    const p = db.profile, log = [...db.bodyLog].sort((a, b) => new Date(a.date) - new Date(b.date));
    const cur = log.length ? log[log.length - 1].weight : p.weight;
    const bmi = cur && p.height ? cur / Math.pow(p.height / 100, 2) : null;
    const diff = log.length > 1 ? (log[log.length - 1].weight - log[0].weight) : null;
    return `
      <div class="stats">
        <div class="stat"><div class="v">${cur ? cur + ' kg' : '—'}</div><div class="l">peso actual</div></div>
        <div class="stat"><div class="v">${diff === null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1) + ' kg'}</div><div class="l">desde el primer registro</div></div>
        ${bmi ? `<div class="stat"><div class="v">${bmi.toFixed(1)}</div><div class="l">IMC (orientativo)</div></div>` : ''}
        <div class="stat"><div class="v">${p.age || '—'}</div><div class="l">edad</div></div>
      </div>
      <div class="card" style="margin-top:10px"><div class="muted small">Peso corporal</div>${lineChart(log.slice(-20).map(b => ({ label: fmtDate(b.date, { day: 'numeric', month: 'numeric' }), v: b.weight })), v => v + ' kg')}</div>
      <div class="card"><div class="row"><input type="number" step="0.1" inputmode="decimal" id="bodyw" placeholder="Peso de hoy (kg)" value="${cur || ''}">
        <button class="btn primary" data-act="body-log">Registrar</button></div></div>
      ${log.length ? `<div class="card">${[...log].reverse().slice(0, 8).map(b => `<div class="list-item"><div class="grow muted">${fmtDate(b.date)}</div><strong>${b.weight} kg</strong></div>`).join('')}</div>` : ''}`;
  },
  logros() {
    const st = achievementStats();
    const got = ACHIEVEMENTS.filter(a => a.test(st)).length;
    return `<p class="muted">${got} de ${ACHIEVEMENTS.length} desbloqueados</p>
      <div class="grid3">${ACHIEVEMENTS.map(a => {
        const ok = a.test(st);
        return `<div class="badge ${ok ? 'on' : ''}"><div class="medal">${icon(a.icon, 24)}</div><strong>${a.name}</strong><small>${a.desc}</small></div>`;
      }).join('')}</div>`;
  },
};

views.session = () => {
  const s = db.sessions.find(x => x.id === route.params.id);
  if (!s) return topbar('Sesión') + '<p class="empty">No encontrada.</p>';
  const byEx = [];
  s.sets.forEach(x => { const g = byEx.find(b => b.ex === x.ex); g ? g.sets.push(x) : byEx.push({ ex: x.ex, sets: [x] }); });
  return `
    ${topbar(s.name)}
    <p class="muted cap">${fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    <div class="stats">
      <div class="stat"><div class="v">${fmtDuration(s.duration)}</div><div class="l">duración</div></div>
      <div class="stat"><div class="v">${fmtKg(sessionVolume(s))}</div><div class="l">peso levantado</div></div>
      <div class="stat"><div class="v">${s.sets.length}</div><div class="l">series</div></div>
      <div class="stat"><div class="v">${s.effort ? `${s.effort}/10` : '—'}</div><div class="l">${s.effort ? EFFORT_LABEL(s.effort) : 'esfuerzo'}</div></div>
    </div>
    ${s.note ? `<div class="note">${icon('edit', 18)}<span>${esc(s.note)}</span></div>` : ''}
    ${s.prs?.length ? `<h2>${icon('trophy', 18, 'accent')} Récords</h2><div class="card pr">${s.prs.map(p => `<div class="list-item"><div class="grow">${esc(exById(p.ex).name)} <span class="muted small">· ${p.type}</span></div><strong class="accent">${p.value}</strong></div>`).join('')}</div>` : ''}
    <h2>Detalle</h2>
    ${byEx.map(g => `<div class="card"><div class="row"><div class="thumb sm">${exerciseThumb(exById(g.ex))}</div><h3 class="grow">${esc(exById(g.ex).name)}</h3></div>${g.sets.map((x, i) => `<div class="list-item"><div class="grow muted">Serie ${i + 1}</div><div>${x.weight ? x.weight + ' kg × ' : ''}${x.secs ? x.secs + ' s' : x.reps + ' reps'}${x.side ? ' /lado' : ''}</div></div>`).join('')}</div>`).join('')}
    <button class="btn block danger" data-act="session-del" data-id="${s.id}">${icon('trash', 16)} Eliminar del historial</button>`;
};

// ---------- Perfil ----------

views.profile = () => {
  const p = db.profile;
  const ideal = idealBell('heavy');
  return `
    <div class="prof-head"><div class="avatar big">${esc((p.name || 'K')[0].toUpperCase())}</div>
      <div><h1 style="margin:0">${esc(p.name || 'Atleta IronK')}</h1><div class="muted small">${levelDots(p.level)} ${LEVELS[p.level].name} · ${GOALS[p.goal]}</div></div></div>
    <h2>Datos personales</h2>
    <div class="card">
      <label class="field"><span>Nombre</span><input data-bind="p.name" value="${esc(p.name || '')}"></label>
      <div class="row">
        <label class="field grow"><span>Edad</span><input type="number" data-bind="p.age" value="${p.age || ''}"></label>
        <label class="field grow"><span>Peso (kg)</span><input type="number" step="0.1" data-bind="p.weight" value="${p.weight || ''}"></label>
        <label class="field grow"><span>Altura (cm)</span><input type="number" data-bind="p.height" value="${p.height || ''}"></label>
      </div>
      <div class="muted small">Sexo</div>
      <div class="seg">${[['h', 'Hombre'], ['m', 'Mujer'], ['x', 'Otro']].map(([k, v]) => `<button class="${p.sex === k ? 'on' : ''}" data-act="p-set" data-field="sex" data-id="${k}">${v}</button>`).join('')}</div>
    </div>
    <h2>Entrenamiento</h2>
    <div class="card">
      <div class="muted small">Nivel</div>
      <div class="seg">${[1, 2, 3].map(n => `<button class="${p.level === n ? 'on' : ''}" data-act="p-set" data-field="level" data-id="${n}">${LEVELS[n].name}</button>`).join('')}</div>
      <label class="field" style="margin-top:12px"><span>Objetivo</span><select data-bind="p.goal">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${p.goal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="muted small">Días por semana</div>
      <div class="seg">${[2, 3, 4, 5, 6].map(n => `<button class="${p.days === n ? 'on' : ''}" data-act="p-set" data-field="days" data-id="${n}">${n}</button>`).join('')}</div>
      <div class="muted small" style="margin-top:12px">Minutos por sesión</div>
      <div class="seg">${[15, 20, 30, 45, 60].map(n => `<button class="${p.minutes === n ? 'on' : ''}" data-act="p-set" data-field="minutes" data-id="${n}">${n}′</button>`).join('')}</div>
      <div class="muted small" style="margin-top:12px">Descanso entre series</div>
      ${restSeg()}
      <div class="muted small">"Recomendado" usa el descanso pensado para cada rutina y tu nivel. Durante el descanso también puedes sumar o restar 15 s.</div>
    </div>
    <h2>Mis pesas rusas</h2>
    <div class="note">${icon('bulb', 18)}<span>Para tu perfil, la pesa ideal de swing es de <strong>${ideal} kg</strong>. Marca "×2" si tienes un par (para ejercicios dobles).</span></div>
    <div class="card">${db.bells.length ? db.bells.slice().sort((a, b) => a.weight - b.weight).map(b => `
      <div class="list-item"><span class="bell">${icon('kb', 20)}</span><div class="grow"><strong>${b.weight} kg</strong></div>
        <button class="chip ${b.qty >= 2 ? 'on' : ''}" data-act="bell-pair" data-id="${b.weight}">×2</button>
        <button class="icon-btn" data-act="bell-del" data-id="${b.weight}" aria-label="Quitar">${icon('trash', 16)}</button></div>`).join('') : '<p class="muted">No cargaste pesas.</p>'}
      <div class="row" style="margin-top:10px"><select id="newbell">${BELL_SIZES.filter(w => !db.bells.some(b => b.weight === w)).map(w => `<option value="${w}" ${w === ideal ? 'selected' : ''}>${w} kg</option>`).join('')}</select>
        <button class="btn" data-act="bell-add">${icon('plus', 16)} Agregar</button></div>
    </div>
    <h2>${icon('refresh', 18, 'accent')} Sincronización</h2>
    ${syncCard()}
    <h2>Datos y respaldo</h2>
    <p class="muted small">${window.Sync?.user ? 'Tu historial está en la nube y en este dispositivo. También puedes exportar una copia.' : 'Tu historial se guarda en este dispositivo. Exporta un respaldo de vez en cuando.'}</p>
    <div class="row"><button class="btn grow" data-act="export">${icon('download', 16)} Exportar</button>
      <label class="btn grow" style="cursor:pointer">${icon('upload', 16)} Importar<input type="file" accept=".json" id="importfile" hidden></label></div>
    <div style="height:10px"></div>
    <button class="btn block" data-act="redo-onboarding">${icon('refresh', 16)} Repetir configuración inicial</button>
    <div style="height:10px"></div>
    <button class="btn block danger" data-act="reset">${icon('trash', 16)} Borrar todos los datos</button>
    <p class="muted small center" style="margin-top:20px">IronK · uso personal</p>
    ${tabbar()}`;
};

// ---------- Cuenta y sincronización ----------

function syncCard() {
  const S = window.Sync;
  if (!S?.configured()) return '<div class="card"><p class="muted small" style="margin:0">La sincronización no está configurada en esta copia de la app (falta config.js).</p></div>';
  if (!S.user) return `<div class="card">
    <p class="small muted">Inicia sesión para guardar tu historial en la nube y tenerlo igual en la computadora y en el iPhone.</p>
    <label class="field"><span>Email</span><input type="email" id="sync-email" autocomplete="username" inputmode="email" autocapitalize="off"></label>
    <label class="field"><span>Contraseña</span><input type="password" id="sync-pass" autocomplete="current-password"></label>
    <div class="row"><button class="btn primary grow" data-act="sync-login">Entrar</button><button class="btn grow" data-act="sync-signup">Crear cuenta</button></div>
    <div id="sync-status" class="small" style="margin-top:10px">${S.statusHtml()}</div></div>`;
  return `<div class="card">
    <div class="kv"><span>Cuenta</span><strong>${esc(S.user.email)}</strong></div>
    <div class="kv small" id="sync-status">${S.statusHtml() || '<span class="muted">Lista para sincronizar</span>'}</div>
    <div class="row" style="margin-top:10px"><button class="btn grow" data-act="sync-now">${icon('refresh', 16)} Sincronizar</button><button class="btn grow" data-act="sync-logout">Cerrar sesión</button></div></div>`;
}

views.login = () => `
  ${topbar('Iniciar sesión')}
  <p class="muted">Entra con la misma cuenta que usas en tu otro dispositivo y traemos tu perfil, rutinas e historial.</p>
  ${syncCard()}`;

function syncCredentials() {
  const email = document.getElementById('sync-email')?.value.trim();
  const pass = document.getElementById('sync-pass')?.value;
  if (!email || !pass) { toast('Completa email y contraseña'); return null; }
  return [email, pass];
}

// ---------- Render y eventos ----------

function render() {
  if (!profileComplete() && !['onboarding', 'login'].includes(route.name)) { startOnboarding(db.profile ? 1 : 0); return; }
  $app.innerHTML = (views[route.name] || views.home)();
  $app.classList.remove('fade'); void $app.offsetWidth; $app.classList.add('fade');
  $app.querySelectorAll('[data-demo]').forEach(el => mountExerciseDemo(el, exById(el.dataset.demo)));
}

const actions = {
  tab: el => tab(el.dataset.id),
  back: () => back(),
  routine: el => go('routine', { id: el.dataset.id }),
  exercise: el => go('exercise', { id: el.dataset.id }),
  session: el => go('session', { id: el.dataset.id }),
  rgoal: el => { ui.goal = el.dataset.id; render(); },
  exgroup: el => { ui.exGroup = el.dataset.id; render(); },
  prog: el => { ui.prog = el.dataset.id; render(); },
  cal: el => {
    const b = ui.calMonth ? new Date(ui.calMonth) : new Date();
    ui.calMonth = new Date(b.getFullYear(), b.getMonth() + Number(el.dataset.d), 1).toISOString(); render();
  },
  'demo-toggle': el => {
    const paused = toggleDemo(document.querySelector('.demo.big'));
    el.innerHTML = icon(paused ? 'play' : 'pause', 18);
  },
  'demo-speed': () => {
    const d = document.querySelector('.demo.big')?._demo;
    if (!d) return;
    d.speed = d.speed === 1 ? 0.5 : d.speed === 0.5 ? 0.25 : 1;
    document.getElementById('speed').textContent = d.speed === 1 ? '1×' : d.speed === 0.5 ? '½×' : '¼×';
  },

  'ob-set': el => {
    const f = el.dataset.field, v = el.dataset.id;
    route.params.d[f] = ['level', 'days', 'minutes'].includes(f) ? Number(v) : v; render();
  },
  'ob-bell': el => {
    const w = Number(el.dataset.id), d = route.params.d;
    d.bells = d.bells.includes(w) ? d.bells.filter(x => x !== w) : [...d.bells, w]; render();
  },
  'ob-next': () => obNext(),
  'ob-back': () => { route.params.step = Math.max(0, route.params.step - 1); render(); },
  'redo-onboarding': () => startOnboarding(0),
  'go-login': () => go('login'),
  'sync-login': () => { const c = syncCredentials(); if (c) Sync.signIn(...c); },
  'sync-signup': () => { const c = syncCredentials(); if (c) Sync.signUp(...c); },
  'sync-now': () => Sync.sync(),
  'sync-logout': () => { if (confirm('¿Cerrar sesión? Tus datos quedan en este dispositivo y en la nube.')) Sync.signOut(); },
  'level-up': () => {
    db.profile.level = Math.min(3, level() + 1); touchSettings(); saveDb();
    toast(`¡Nivel ${LEVELS[level()].name}! Tus rutinas se adaptaron`); render();
  },

  'run-start': el => startRun(routineById(el.dataset.id)),
  'run-weight': el => { run.weights[run.mode === 'free' ? run.ex : run.steps[run.i].ex] = Number(el.dataset.id); render(); },
  reps: el => { run.reps = Math.max(0, (run.reps || 0) + Number(el.dataset.d)); render(); },
  'work-done': () => completeWork(false),
  'work-skip': () => completeWork(true),
  'timer-start': () => {
    const s = run.steps[run.i];
    run.timerTotal = s.secs * 1000 * (s.side ? 2 : 1);
    run.timerEnd = Date.now() + run.timerTotal; render();
  },
  'rest-add': () => { run.restEnd += 15000; run.restTotal += 15000; tick(); },
  'rest-sub': () => {
    run.restEnd -= 15000; run.restTotal = Math.max(1000, run.restTotal - 15000);
    if (run.restEnd <= Date.now() + 500) { run.phase = 'work'; run.restEnd = null; render(); } else tick();
  },
  'rest-mode': el => { db.profile.rest = el.dataset.id; touchSettings(); saveDb(); render(); },
  'rest-skip': () => { run.phase = 'work'; run.restEnd = null; render(); },
  'run-quit': () => {
    if (!run.sets.length) { if (confirm('¿Salir sin registrar nada?')) { run = null; releaseWakeLock(); tab('home'); } return; }
    if (confirm('¿Terminar la sesión ahora? Se guardará lo que hiciste hasta acá.')) finishRun();
  },

  'free-start': () => startFree(),
  'free-log': () => {
    const ex = exById(run.ex);
    run.sets.push({ ex: ex.id, weight: ex.load === 'none' ? 0 : currentWeight(ex.id), reps: run.reps, secs: 0, side: false });
    render(); toast('Serie registrada');
  },
  'free-undo': () => { run.sets.pop(); render(); },
  finish: () => finishRun(),

  effort: el => { route.params.effort = Number(el.dataset.id); render(); },
  'save-session': () => {
    db.sessions.push({
      id: uid(), date: new Date(run.start).toISOString(), name: run.name, routineId: run.routineId || null,
      duration: Math.round((run.end - run.start) / 1000), sets: run.sets, effort: route.params.effort,
      note: (route.params.note || '').trim(), prs: run.prs,
    });
    db.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveDb(); run = null; toast('Guardado en tu historial');
    ui.prog = 'resumen'; tab('progress');
  },
  'discard-session': () => { if (confirm('¿Descartar esta sesión?')) { run = null; tab('home'); } },
  'session-del': el => {
    if (!confirm('¿Eliminar esta sesión del historial?')) return;
    db.sessions = db.sessions.filter(s => s.id !== el.dataset.id); markDeleted(el.dataset.id); saveDb(); back();
  },

  'builder-new': () => go('builder', { draft: newDraft() }),
  'builder-copy': el => go('builder', { draft: newDraft(routineById(el.dataset.id)) }),
  'builder-edit': el => go('builder', { draft: newDraft(routineById(el.dataset.id)), editId: el.dataset.id }),
  'b-del': el => { route.params.draft.blocks.splice(Number(el.dataset.i), 1); render(); },
  'b-up': el => {
    const i = Number(el.dataset.i), b = route.params.draft.blocks;
    if (i > 0) [b[i - 1], b[i]] = [b[i], b[i - 1]]; render();
  },
  'b-side': el => { const b = route.params.draft.blocks[el.dataset.i]; b.side = !b.side; render(); },
  'b-timed': el => {
    const b = route.params.draft.blocks[el.dataset.i];
    if (b.secs) { b.reps = 10; b.secs = 0; } else { b.secs = 30; b.reps = 0; } render();
  },
  'builder-save': () => {
    const d = route.params.draft;
    if (!d.name.trim()) return toast('Ponle un nombre');
    if (!d.blocks.length) return toast('Agrega al menos un ejercicio');
    const r = {
      id: route.params.editId || 'c-' + uid(), custom: true, name: d.name.trim(), goal: d.goal, desc: d.desc, updatedAt: Date.now(),
      blocks: d.blocks.map(b => ({ ex: b.ex, sets: Math.max(1, b.sets), ...(b.secs ? { secs: b.secs } : { reps: Math.max(1, b.reps) }), side: b.side, rest: b.rest })),
    };
    const i = db.customRoutines.findIndex(x => x.id === r.id);
    if (i >= 0) db.customRoutines[i] = r; else db.customRoutines.push(r);
    saveDb(); toast('Rutina guardada');
    stack = [{ name: 'train', params: {} }]; route = { name: 'routine', params: { id: r.id } }; render();
  },
  'routine-del': el => {
    if (!confirm('¿Eliminar esta rutina?')) return;
    db.customRoutines = db.customRoutines.filter(r => r.id !== el.dataset.id); markDeleted(el.dataset.id); saveDb(); tab('train');
  },

  'p-set': el => {
    const f = el.dataset.field;
    db.profile[f] = f === 'sex' ? el.dataset.id : Number(el.dataset.id); touchSettings(); saveDb(); render();
  },
  'body-quick': () => { ui.prog = 'cuerpo'; tab('progress'); setTimeout(() => document.getElementById('bodyw')?.focus(), 50); },
  'body-log': () => {
    const w = num(document.getElementById('bodyw').value);
    if (!w || w < 20 || w > 400) return toast('Ingresa un peso válido');
    const today = dayKey(new Date());
    db.bodyLog = db.bodyLog.filter(b => dayKey(b.date) !== today);
    db.bodyLog.push({ date: new Date().toISOString(), weight: w });
    db.profile.weight = w; touchSettings(); saveDb(); toast('Peso registrado'); render();
  },
  'bell-add': () => {
    const w = Number(document.getElementById('newbell').value);
    if (w && !db.bells.some(b => b.weight === w)) { db.bells.push({ weight: w, qty: 1 }); touchSettings(); saveDb(); render(); }
  },
  'bell-del': el => { db.bells = db.bells.filter(b => b.weight !== Number(el.dataset.id)); touchSettings(); saveDb(); render(); },
  'bell-pair': el => { const b = db.bells.find(x => x.weight === Number(el.dataset.id)); b.qty = b.qty >= 2 ? 1 : 2; touchSettings(); saveDb(); render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ironk-respaldo-${dayKey(new Date())}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  },
  reset: () => {
    const cloud = window.Sync?.user ? ' También se borra de la nube y de tus otros dispositivos.' : '';
    if (!confirm(`Esto borra tu perfil, rutinas e historial.${cloud} ¿Seguro?`)) return;
    db = structuredClone(EMPTY_DB); db.meta.resetAt = Date.now(); saveDb(); startOnboarding(0);
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});

document.addEventListener('input', e => {
  const key = e.target.dataset.bind;
  if (!key) return;
  const v = e.target.value;
  if (key === 'exQuery') { ui.exQuery = v; document.getElementById('exlist').innerHTML = exerciseList(); return; }
  if (key.startsWith('ob.')) route.params.d[key.slice(3)] = v;
  if (key === 'note') route.params.note = v;
  if (key === 'd.name') route.params.draft.name = v;
  if (key.startsWith('b.')) {
    const [, i, field] = key.split('.');
    route.params.draft.blocks[i][field] = Math.max(0, parseInt(v, 10) || 0);
  }
  if (key === 'p.name') { db.profile.name = v.trim(); touchSettings(); saveDb(); }
  if (['p.age', 'p.weight', 'p.height'].includes(key)) { db.profile[key.slice(2)] = num(v); touchSettings(); saveDb(); }
});

document.addEventListener('change', e => {
  const key = e.target.dataset.bind, act = e.target.dataset.actChange;
  if (key === 'd.goal') route.params.draft.goal = e.target.value;
  if (key === 'p.goal') { db.profile.goal = e.target.value; touchSettings(); saveDb(); }
  if (act === 'b-add' && e.target.value) {
    const ex = exById(e.target.value), timed = ex.type === 'Carga';
    route.params.draft.blocks.push({ ex: ex.id, sets: 3, reps: timed ? 0 : 10, secs: timed ? 30 : 0, side: !!ex.uni, rest: 60 });
    render();
  }
  if (act === 'free-ex' && e.target.value) { run.ex = e.target.value; render(); }
  if (e.target.id === 'importfile' && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.sessions)) throw new Error('formato');
        if (!confirm(`¿Importar ${data.sessions.length} sesiones? Reemplaza los datos actuales.`)) return;
        db = Object.assign(structuredClone(EMPTY_DB), data); saveDb(); toast('Datos importados'); tab('home');
      } catch (err) { toast('Archivo no válido'); }
    };
    reader.readAsText(e.target.files[0]);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && route.name === 'onboarding' && e.target.tagName === 'INPUT') obNext();
});

window.addEventListener('beforeunload', e => { if (run) { e.preventDefault(); e.returnValue = ''; } });

// Mantener la pantalla encendida durante la sesión (si el navegador lo permite).
let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { wakeLock = null; } }
function releaseWakeLock() { try { wakeLock?.release(); } catch (e) { /* ignorar */ } wakeLock = null; }

setInterval(tick, 200);
render();
