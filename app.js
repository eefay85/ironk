// IronK — app personal de entrenamiento con pesas rusas.
// Todo se guarda en este navegador (localStorage). Usa Perfil > Exportar para respaldos.

const STORE_KEY = 'ironk-v1';
// deleted: ids borrados (para que no reaparezcan al sincronizar). meta: marcas de tiempo para combinar.
const EMPTY_DB = { profile: null, bells: [], customRoutines: [], sessions: [], bodyLog: [], tests: [], challenges: [], deleted: [], meta: {} };

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

// Selección de objetivos (hasta 3); el número indica el orden en que los elegiste.
function goalOptions(selected, act, compact = false) {
  if (compact) {
    return `<div class="chips">${Object.entries(GOALS).map(([k, v]) => {
      const n = selected.indexOf(k) + 1;
      return `<button class="chip ${n ? 'on' : ''}" data-act="${act}" data-id="${k}">${n ? `${n} · ` : ''}${v}</button>`;
    }).join('')}</div>`;
  }
  return `<div class="options">${Object.entries(GOALS).map(([k, v]) => {
    const n = selected.indexOf(k) + 1;
    return `<button class="option ${n ? 'on' : ''}" data-act="${act}" data-id="${k}">
      <span class="opt-ico">${icon(GOAL_INFO[k].icon, 22)}</span><span class="grow"><strong>${v}</strong><small>${GOAL_INFO[k].text}</small></span>
      ${n ? `<span class="num">${n}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

function toggleGoal(list, g) {
  if (list.includes(g)) return list.filter(x => x !== g);
  if (list.length >= 3) { toast('Puedes elegir hasta 3 objetivos'); return list; }
  return [...list, g];
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
    level: p.level || 0, goals: p.goal ? goalsOf(p) : [], days: p.days || 3, minutes: p.minutes || 30,
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
    body = `<h2 class="ob-q">¿Qué quieres lograr?</h2><p class="muted">Elige hasta 3 objetivos. Tu programa va a combinar rutinas de todos.</p>
      ${goalOptions(d.goals, 'ob-goal')}
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
        <div class="kv"><span>Objetivo${goalsOf(p).length > 1 ? 's' : ''}</span><strong>${goalsText(p)}</strong></div>
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
  if (step === 4 && !d.goals.length) return toast('Elige al menos un objetivo');
  if (step === 6) {
    if (!d.bells.length) return toast('Marca al menos una pesa');
    const pairs = new Set(db.bells.filter(b => b.qty >= 2).map(b => b.weight));
    db.profile = {
      ...(db.profile || {}), name: d.name.trim(), sex: d.sex, age: num(d.age), weight: num(d.weight), height: num(d.height),
      level: d.level, goal: d.goals[0], goals: [...d.goals], days: d.days, minutes: d.minutes, created: db.profile?.created || new Date().toISOString(),
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
    ${rankCard()}
    <div class="card goal-card">
      ${ring(week / p.days, 74, 8, `<strong>${week}</strong><small>/${p.days}</small>`)}
      <div class="grow"><strong>Meta semanal</strong><div class="muted small">${week >= p.days ? '¡Cumplida! Gran semana.' : `Te faltan ${p.days - week} sesión${p.days - week > 1 ? 'es' : ''}`}</div>
      ${weekStrip()}</div>
    </div>
    ${hero}
    <div class="stats three">
      <div class="stat">${icon('flame', 18, 'accent')}<div class="v">${streakDays()}</div><div class="l">días de racha</div></div>
      <div class="stat">${icon('kb', 18, 'accent')}<div class="v">${db.sessions.length}</div><div class="l">sesiones</div></div>
      <div class="stat">${icon('heart', 18, 'accent')}<div class="v">${db.sessions.reduce((a, s) => a + sessionKcal(s), 0).toLocaleString('es-AR')}</div><div class="l">kcal quemadas</div></div>
    </div>
    ${challengeCards(true)}
    <h2>Para ti</h2>
    <div class="card">${ins.map(insightRow).join('')}</div>
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

const insightRow = i => `<div class="insight">${icon(i.icon, 18, 'accent')}<span class="grow">${esc(i.text)}</span>${i.action ? `<button class="btn small" data-act="${i.action}">${i.label || 'Sí'}</button>` : ''}</div>`;

// Rango y puntos (XP).
function rankCard() {
  const r = rankInfo();
  return `<div class="card rank-card click" data-act="go-logros">
    <div class="rank-badge r${r.idx}">${icon('medal', 22)}</div>
    <div class="grow"><div class="row between"><strong>${r.rank}</strong><span class="muted small">${r.xp.toLocaleString('es-AR')} XP</span></div>
      <div class="bar"><i style="width:${Math.round(r.pct * 100)}%"></i></div>
      <div class="muted small">${r.next ? `${r.toNext.toLocaleString('es-AR')} XP para ${r.next}` : '¡Rango máximo!'}</div></div></div>`;
}

// Desafíos del mes (compact: sólo los que estás haciendo, para Inicio).
function challengeCards(compact = false) {
  const key = monthKey(), joined = joinedChallenges(key);
  const monthName = new Date().toLocaleDateString('es-AR', { month: 'long' });
  const card = ch => {
    const v = challengeProgress(ch, key), done = v >= ch.target, isIn = joined.includes(ch);
    return `<div class="card challenge ${done ? 'done' : ''}">
      <div class="row"><span class="opt-ico">${icon(done ? 'check' : ch.icon, 20)}</span>
        <div class="grow"><strong>${ch.name}</strong><div class="muted small">${isIn ? `${v.toLocaleString('es-AR')} / ${ch.target.toLocaleString('es-AR')} ${ch.unit}` : `en ${monthName}`}</div></div>
        ${isIn ? (done ? '<span class="tag accent">¡Cumplido!</span>' : `<strong class="accent">${Math.floor(Math.min(1, v / ch.target) * 100)}%</strong>`) : `<button class="btn small" data-act="ch-join" data-id="${ch.id}">Unirme</button>`}</div>
      ${isIn ? `<div class="bar" style="margin-top:10px"><i style="width:${Math.min(100, (v / ch.target) * 100)}%"></i></div>` : ''}</div>`;
  };
  if (compact) return joined.length ? `<h2>${icon('target', 18, 'accent')} Desafíos de ${monthName}</h2>${joined.map(card).join('')}` : '';
  return CHALLENGES.map(card).join('');
}

// ---------- Entrenar ----------

function routineCard(r, badge = '') {
  const a = adaptRoutine(r), items = routineItems(a), fits = r.custom || routineFits(r);
  return `<div class="card click rcard ${fits ? '' : 'dim'}" data-act="routine" data-id="${r.id}">
    <div class="thumb">${exerciseThumb(exById(items[0]?.ex))}</div>
    <div class="grow"><div class="row"><h3 class="grow">${esc(r.name)}</h3>${badge}</div>
      <div class="muted small">${r.custom ? 'Mi rutina' : esc(GOALS[r.goal])} · ~${estimateMin(a)} min · ${new Set(items.map(i => i.ex)).size} ejercicios</div>
      <div class="meta">${r.custom ? '' : levelDots(r.minLevel || 1)}${r.format ? `<span class="tag accent">${r.format}</span>` : ''}${fits ? '' : '<span class="tag">No es tu nivel</span>'}</div></div>
    <span class="muted">${icon('right', 18)}</span></div>`;
}

function programCard() {
  const wk = programWeek();
  if (!wk) return `<div class="card program">
    <div class="row"><span class="opt-ico">${icon('calendar', 22)}</span><div class="grow"><strong>Programa de 8 semanas</strong>
      <div class="muted small">Volumen que sube semana a semana, descargas para recuperar y tests en las semanas 4 y 8.</div></div></div>
    <button class="btn primary block" style="margin-top:12px" data-act="prog-start">Empezar programa</button></div>`;
  if (wk.done) return `<div class="card program done">
    <div class="row"><span class="opt-ico">${icon('trophy', 22)}</span><div class="grow"><strong>¡Programa de 8 semanas completado!</strong>
      <div class="muted small">Compara tus tests para ver cuánto mejoraste.</div></div></div>
    <div class="row" style="margin-top:12px"><button class="btn grow" data-act="go-tests">Ver tests</button><button class="btn primary grow" data-act="prog-start">Empezar otro</button></div></div>`;
  return `<div class="card program">
    <div class="row between"><strong>${icon('calendar', 18, 'accent')} Semana ${wk.n} de 8</strong><span class="tag accent">${wk.name}</span></div>
    <div class="weeks">${PROGRAM_WEEKS.map((w, i) => `<i class="${i < wk.n - 1 ? 'past' : i === wk.n - 1 ? 'cur' : ''} ${w.test ? 'test' : ''}"></i>`).join('')}</div>
    <div class="muted small">${wk.test ? 'Semana liviana: aprovecha para hacer tus tests.' : wk.vol > 1 ? `Volumen +${Math.round((wk.vol - 1) * 100)}% respecto de tu rutina base.` : 'Semana para afianzar la técnica.'}</div>
    <div class="row" style="margin-top:10px">${wk.test ? `<button class="btn primary grow" data-act="go-tests">${icon('target', 16)} Hacer tests</button>` : ''}<button class="btn small" data-act="prog-stop">Dejar programa</button></div></div>`;
}

views.train = () => {
  const rot = programRoutines(), plan = todayPlan(), g = ui.goal;
  const list = PRESET_ROUTINES.filter(r => g === 'all' || r.goal === g)
    .sort((a, b) => Number(routineFits(b)) - Number(routineFits(a)));
  return `
    <h1>Entrenar</h1>
    <div class="quick-grid">
      <button class="qbtn" data-act="go-quick">${icon('bolt', 22)}<strong>Rápido</strong><small>A tu medida</small></button>
      <button class="qbtn" data-act="go-timers">${icon('timer', 22)}<strong>Timers</strong><small>EMOM · Tabata · AMRAP</small></button>
      <button class="qbtn" data-act="go-tests">${icon('target', 22)}<strong>Tests</strong><small>Mide tu progreso</small></button>
    </div>
    ${programCard()}
    <h2>${icon('repeat', 18, 'accent')} Tu programa</h2>
    <p class="muted small">${goalsText()} · ${LEVELS[level()].name} · ${db.profile.days} días por semana</p>
    ${goalsOf().length > 1 ? `<div class="note">${icon('repeat', 18)}<span class="small">Cada rutina se mantiene completa y con su propia lógica; lo que se combina es el orden: se alternan rutinas de tus objetivos y se evita repetir músculos que todavía se recuperan.</span></div>` : ''}
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
  const r = adaptRoutine(base), items = routineItems(r), hasCircuit = r.blocks.some(b => b.circuit && b.rounds);
  return `
    ${topbar(r.name)}
    <div class="card hero-lite">
      <div class="demo-wrap"><div class="demo" data-demo="${items[0].ex}"></div></div>
      <p>${esc(r.desc || '')}</p>
      <div class="chips"><span class="tag accent">${r.custom ? 'Mi rutina' : esc(GOALS[r.goal])}</span><span class="tag">${icon('clock', 13)} ~${estimateMin(r)} min</span>
        ${r.format ? `<span class="tag accent">${r.format}</span>` : ''}${mainMuscles(r).map(m => `<span class="tag">${MUSCLES[m]}</span>`).join('')}</div>
    </div>
    ${db.profile.warmup !== false && !isAmrap(r) ? `<div class="note">${icon('flame', 18)}<span class="small">Incluye 2 min de calentamiento al inicio y estiramientos al final (puedes desactivarlo en Perfil).</span></div>` : ''}
    ${r.notes.length ? `<div class="note">${icon('spark', 18)}<div><strong>Adaptada a ti</strong>${r.notes.map(n => `<div class="small">${esc(n)}</div>`).join('')}</div></div>` : ''}
    ${hasCircuit ? `<div class="note">${icon('repeat', 18)}<span class="small">Incluye un circuito: haces los ejercicios seguidos y descansas al final de cada ronda.</span></div>` : ''}
    <div class="card"><div class="row between"><strong>${icon('timer', 18, 'accent')} Descanso entre series</strong><span class="muted small">se aplica a todas las rutinas</span></div>${restSeg()}
      <div class="row between" style="margin-top:10px"><strong>${icon('skip', 16, 'accent')} Avance automático</strong><span class="muted small">sin tocar "Serie hecha"</span></div>${autoSetSeg()}</div>
    <h2>Ejercicios</h2>
    ${items.map(it => {
      const ex = exById(it.ex), sw = suggestWeight(ex);
      const arrow = sw.change === 'up' ? icon('up', 13) : sw.change === 'down' ? icon('down', 13) : '';
      return `<div class="card click excard" data-act="exercise" data-id="${ex.id}">
        <div class="thumb sm">${exerciseThumb(ex)}</div>
        <div class="grow"><h3>${esc(ex.name)}${it.prog ? ` <span class="tag prog">${icon('up', 12)} ${it.baseReps ? `+${it.reps - it.baseReps} reps` : `+${it.secs - it.baseSecs} s`}${it.extraSet ? ' · +1 serie' : ''}</span>` : ''}</h3><div class="muted small">${itemText(it)}${it.rest && !it.circuit && !it.autoStart && !it.emom && !it.ladder && !it.amrap ? ` · ${it.rest} s pausa` : ''}</div>
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
    ${progressionCard(e)}
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

// Escalones de progresión del ejercicio: 3 de reps por pesa, y después la pesa siguiente.
function progressionCard(e) {
  if (e.type === 'Estiramiento') return '';
  const p = progression(e.id);
  if (!p.sessions) return `<div class="card prog-card"><strong>${icon('up', 16, 'accent')} Progresión</strong>
    <div class="muted small">Cada 2 semanas, si completas todo con margen, suma repeticiones; después de 3 aumentos, sube de pesa.</div></div>`;
  const total = e.load === 'none' || !bellsFor(e).some(b => b > p.weight) ? PROG.maxSteps : PROG.stepsPerBell;
  return `<div class="card prog-card">
    <div class="row between"><strong>${icon('up', 16, 'accent')} Tu progresión</strong>${p.weight ? `<span class="tag">${p.weight} kg</span>` : ''}</div>
    <div class="steps-bar">${Array.from({ length: total }, (_, i) => `<i class="${i < p.steps ? 'on' : ''}"></i>`).join('')}${total === PROG.stepsPerBell ? `<b class="${p.pendingUp ? 'on' : ''}">${icon('kb', 14)}</b>` : ''}</div>
    <div class="small">${p.pendingUp ? `<strong class="accent">¡Rango completo! Próxima sesión con ${p.nextWeight} kg.</strong>` : `Escalón ${p.steps} de ${total}${p.steps ? ` · +${p.steps} aumento${p.steps > 1 ? 's' : ''} de reps` : ''}`}</div>
    <div class="muted small">${esc(progressionText(e.id))}</div></div>`;
}

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

// Antes de empezar: "¿Cómo te sientes hoy?" (se puede saltar).
function askCheckin(base) {
  go('checkin', { id: base.id, routine: base.quick ? base : null, c: { energy: 'normal', sleep: 'bien', pains: [] } });
}

views.checkin = () => {
  const c = route.params.c;
  const opt = (field, val, label) => `<button class="${c[field] === val ? 'on' : ''}" data-act="ck-set" data-field="${field}" data-id="${val}">${label}</button>`;
  return `${topbar('Antes de empezar')}
    <h1>¿Cómo te sientes hoy?</h1><p class="muted">Ajustamos la sesión a cómo llegas.</p>
    <div class="card">
      <div class="muted small">Energía</div><div class="seg">${opt('energy', 'baja', 'Baja')}${opt('energy', 'normal', 'Normal')}${opt('energy', 'alta', 'Alta')}</div>
      <div class="muted small" style="margin-top:12px">¿Cómo dormiste?</div><div class="seg">${opt('sleep', 'mal', 'Mal')}${opt('sleep', 'regular', 'Regular')}${opt('sleep', 'bien', 'Bien')}</div>
      <div class="muted small" style="margin-top:12px">¿Alguna molestia?</div>
      <div class="chips">${Object.entries(PAINS).map(([k, v]) => `<button class="chip ${c.pains.includes(k) ? 'on' : ''}" data-act="ck-pain" data-id="${k}">${v}</button>`).join('')}</div>
    </div>
    <button class="btn primary block big" data-act="ck-go">${icon('play', 18)} Empezar</button>
    <button class="btn block" style="margin-top:8px" data-act="ck-skip">Saltar y empezar igual</button>`;
};

function startRun(base, checkin = null) {
  let routine = adaptRoutine(base);
  const ck = applyCheckin(routine, checkin);
  routine = ck.routine;
  const common = {
    routineId: base.quick ? null : base.id, name: routine.name, start: Date.now(), sets: [], weights: {}, reasons: {},
    checkin, weightDown: ck.weightDown, bell: base.bell || null,
  };
  if (isAmrap(routine)) return startAmrap(routine, common, ck.notes);
  let steps = buildSteps(routine);
  if (!steps.length) return toast('La rutina no tiene ejercicios');
  steps = withWarmupCooldown(steps, routine);
  run = { ...common, mode: 'guided', steps, i: 0, phase: 'work', reps: steps[0].reps, timerEnd: null, timerTotal: 0, restEnd: null, restTotal: 0 };
  requestWakeLock();
  route = { name: 'run', params: {} }; stack = [];
  if (ck.notes.length) toast(ck.notes[0]);
  enterWork();
}

// Arranca la serie actual: timers automáticos (Tabata, calentamiento), ventana de EMOM y voz.
function enterWork() {
  const s = run.steps[run.i], ex = exById(s.ex);
  Object.assign(run, { phase: 'work', restEnd: null, timerEnd: null, reps: s.reps, halfSaid: false, autoSet: false, windowEnd: s.emom ? Date.now() + s.emom * 1000 : null });
  tick.lastBeep = null;
  if (s.secs && s.autoStart) { run.timerTotal = s.secs * 1000 * (s.side ? 2 : 1); run.timerEnd = Date.now() + run.timerTotal; }
  const auto = autoSetSecs(s);
  if (auto) { run.timerTotal = auto * 1000; run.timerEnd = Date.now() + run.timerTotal; run.autoSet = true; }
  announce(s, ex);
  render();
}

function announce(s, ex) {
  const prev = run.steps[run.i - 1];
  const [n, m] = (s.label.match(/(\d+)\/(\d+)/) || []).slice(1).map(Number);
  const parts = [];
  if (s.phase === 'warmup' && run.i === 0) parts.push('Empezamos con el calentamiento.');
  if (s.phase === 'cooldown' && prev?.phase !== 'cooldown') parts.push('¡Buen trabajo! Ahora estiramos.');
  if (!s.phase && prev?.phase === 'warmup') parts.push('¡A entrenar!');
  if (s.emom) parts.push(`Minuto ${run.steps.slice(0, run.i + 1).filter(x => x.emom).length}.`);
  else if (s.label.startsWith('Ronda') && n === m && m > 1 && prev?.label !== s.label) parts.push('Última ronda.');
  else if (s.label.startsWith('Serie') && n === m && m > 1) parts.push('Último set.');
  parts.push(`${ex.name}. ${spokenTarget(s)}.`);
  const w = ex.load !== 'none' && !s.noLog && bellsFor(ex).length ? currentWeight(ex.id) : 0;
  if (w) parts.push(`${w} kilos${ex.double ? ' cada una' : ''}.`);
  Voice.say(parts.join(' '), true);
}

function currentWeight(exId) {
  if (!(exId in run.weights)) {
    const ex = exById(exId), list = bellsFor(ex);
    let sw = suggestWeight(ex);
    if (run.bell && list.includes(run.bell)) sw = { weight: run.bell, reason: 'La pesa que elegiste', change: 'same' };
    else if (run.weightDown && list.indexOf(sw.weight) > 0) sw = { weight: list[list.indexOf(sw.weight) - 1], reason: 'Una pesa más liviana por hoy', change: 'down' };
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

function runHead(pct) {
  return `<div class="topbar"><button class="icon-btn" data-act="run-quit" aria-label="Terminar">${icon('close')}</button>
    <div class="title">${esc(run.name)}</div>
    <button class="icon-btn" data-act="voice-toggle" aria-label="Voz del coach">${icon(Voice.on() ? 'volume' : 'mute', 18)}</button>
    <button class="icon-btn" data-act="pause" aria-label="Pausa">${icon('pause', 16)}</button>
    <span class="pill dark" id="elapsed">${fmtTime(((run.paused || Date.now()) - run.start) / 1000)}</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    ${run.paused ? `<div class="pause-overlay"><div class="pause-box">
      <div class="ob-logo">${icon('pause', 40)}</div><h1>En pausa</h1><p class="muted">El tiempo está detenido. Sigue cuando quieras.</p>
      <button class="btn primary block big" data-act="resume">${icon('play', 18)} Continuar</button>
      <button class="btn block" style="margin-top:8px" data-act="run-quit">Terminar sesión</button></div></div>` : ''}`;
}

// Pausa: congela todos los relojes de la sesión y los corre al reanudar.
function pauseRun() {
  if (!run || run.paused) return;
  run.paused = Date.now();
  Voice.stop(); Voice.say('Pausa');
  render();
}
function resumeRun() {
  if (!run?.paused) return;
  const d = Date.now() - run.paused;
  ['timerEnd', 'restEnd', 'windowEnd', 'endAt'].forEach(k => { if (run[k]) run[k] += d; });
  run.start += d;
  run.paused = null; tick.lastBeep = null;
  Voice.say('Seguimos', true);
  render();
}

// Avance automático: tiempo estimado para una serie por repeticiones (0 = desactivado).
function autoSetSecs(s) {
  const mode = db.profile.autoSet ?? 'auto';
  if (mode === 'off' || s.secs) return 0;
  if (mode !== 'auto') return Number(mode);
  const ex = exById(s.ex);
  const perRep = ex.type === 'Balístico' ? 2.2 : ex.type === 'Core' ? 2.5 : 3.5;
  return Math.round(Math.min(90, Math.max(20, s.reps * perRep * (s.side ? 2 : 1) + 10)));
}

const AUTO_SET_MODES = [['off', 'No'], ['auto', 'Según reps'], ['45', '45 s'], ['60', '1 min']];
const autoSetSeg = () => `<div class="seg">${AUTO_SET_MODES.map(([k, l]) =>
  `<button class="${String(db.profile.autoSet ?? 'auto') === k ? 'on' : ''}" data-act="auto-set" data-id="${k}">${l}</button>`).join('')}</div>`;

views.run = () => {
  const s = run.steps[run.i], ex = exById(s.ex);
  const pct = (run.i / run.steps.length) * 100;
  const next = run.steps[run.i + 1];
  const head = runHead(pct);

  if (run.phase === 'rest') {
    const nx = run.steps[run.i], nex = exById(nx.ex);
    const left = (run.restEnd - Date.now()) / 1000;
    const tip = nex.cues[Math.floor(Math.random() * nex.cues.length)];
    const prevStep = run.steps[run.i - 1];
    return `${head}
      <div class="center muted" style="margin-top:8px">${prevStep?.emom ? 'Descansa hasta el próximo minuto' : 'Descanso'}</div>
      <div class="center">${ring(left / (run.restTotal / 1000), 220, 12, `<div class="timer" id="timer">${fmtTime(left)}</div><small class="muted">respira</small>`, 'ring-rest')}</div>
      <div class="row" style="margin-top:14px"><button class="btn grow" data-act="rest-sub">${icon('minus', 16)} 15 s</button><button class="btn grow" data-act="rest-add">${icon('plus', 16)} 15 s</button><button class="btn primary grow" data-act="rest-skip">${icon('skip', 16)} Saltar</button></div>
      <h2>Siguiente</h2>
      <div class="card row"><div class="demo sm" data-demo="${nex.id}"></div><div class="grow"><h3>${esc(nex.name)}</h3>
        <div class="muted small">${nx.label} · ${targetText(nx)}</div>${nex.load !== 'none' && !nx.noLog && bellsFor(nex).length ? `<div class="small">${currentWeight(nex.id)} kg</div>` : ''}</div></div>
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
    const auto = run.autoSet && run.timerEnd;
    action = `${auto ? `<div class="auto-row">${ring((run.timerEnd - Date.now()) / run.timerTotal, 64, 6, `<small id="timer">${fmtTime((run.timerEnd - Date.now()) / 1000)}</small>`, 'ring-work')}
        <div class="grow muted small">Avanza sola al terminar el tiempo.</div>
        <button class="btn small" data-act="work-add">+15 s</button></div>` : ''}
      <div class="muted small center">Repeticiones${s.side ? ' por lado' : ''} · objetivo ${s.reps}</div>
      <div class="stepper"><button data-act="reps" data-d="-1" aria-label="Menos">${icon('minus', 22)}</button><div class="val">${run.reps}</div><button data-act="reps" data-d="1" aria-label="Más">${icon('plus', 22)}</button></div>
      <button class="btn primary block big" data-act="work-done">${icon('check', 20)} ${auto ? 'Listo, siguiente' : 'Serie hecha'}</button>`;
  }

  return `${head}
    <div class="demo-card run"><div class="demo" data-demo="${ex.id}"></div><span class="demo-label" data-demo-label></span></div>
    <div class="run-ex">
      <div class="eyebrow-d ${s.phase || ''}">${s.label}</div>
      <h1>${esc(ex.name)}</h1>
      ${s.emom ? `<div class="center"><span class="pill dark">${icon('timer', 14)} Queda del minuto: <b id="emom">${fmtTime((run.windowEnd - Date.now()) / 1000)}</b></span></div>` : ''}
      ${s.noLog ? '<p class="muted small center">Suave, solo para entrar en calor o soltar el cuerpo.</p>' : weightChips(ex)}
      ${action}
    </div>
    <div class="row" style="margin-top:12px"><button class="btn grow" data-act="exercise" data-id="${ex.id}">${icon('info', 16)} Técnica</button><button class="btn grow" data-act="work-skip">${icon('skip', 16)} Saltar</button></div>
    <p class="muted small center" style="margin-top:16px">${next ? `Luego: ${esc(exById(next.ex).name)} · ${targetText(next)}` : '¡Último ejercicio!'}</p>`;
};

function completeWork(skipped) {
  const s = run.steps[run.i];
  if (!skipped && !s.noLog) {
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
  let rest = s.rest || 0;
  if (s.emom) rest = Math.max(0, (run.windowEnd - Date.now()) / 1000);
  run.i++;
  if (rest > 0.5 && !skipped) {
    Object.assign(run, { phase: 'rest', restTotal: rest * 1000, restEnd: Date.now() + rest * 1000 });
    tick.lastBeep = null;
    const nx = exById(run.steps[run.i].ex);
    if (rest > 6) Voice.say(s.emom ? `Descansa hasta el próximo minuto. Luego, ${nx.name}.` : `Descanso, ${Math.round(rest)} segundos. Luego, ${nx.name}.`, true);
    render();
  } else enterWork();
}

// Cuenta regresiva: la voz dice "tres, dos, uno" de una sola vez (así no se corta) y,
// si la voz está apagada, suena un pitido por segundo.
function countdown(left) {
  const sec = Math.ceil(left);
  if (left <= 3.05 && left > 0 && sec !== tick.lastBeep) {
    if (tick.lastBeep == null && sec === 3 && Voice.on()) Voice.countdown();
    if (!Voice.on()) beep(660, 100);
    tick.lastBeep = sec;
  }
}

function tick() {
  if (!run || run.paused) return;
  const el = document.getElementById('elapsed');
  if (el) el.textContent = fmtTime((Date.now() - run.start) / 1000);
  if (run.mode === 'amrap') return tickAmrap();
  if (run.mode === 'test') return tickTest();
  if (route.name !== 'run') return;
  const s = run.steps[run.i];
  const em = document.getElementById('emom');
  if (em && run.windowEnd) em.textContent = fmtTime((run.windowEnd - Date.now()) / 1000);
  const end = run.phase === 'rest' ? run.restEnd : run.timerEnd;
  if (!end) return;
  const left = (end - Date.now()) / 1000;
  const t = document.getElementById('timer');
  if (t) t.textContent = fmtTime(left);
  if (run.phase === 'rest') setRing('ring-rest', left / (run.restTotal / 1000));
  else {
    setRing('ring-work', left / (run.timerTotal / 1000));
    if (s.secs && s.side && !run.halfSaid && left <= run.timerTotal / 2000) { run.halfSaid = true; beep(880, 150); Voice.say('Cambia de lado', true); }
  }
  countdown(left);
  if (left <= 0) {
    tick.lastBeep = null;
    beep(990, 350);
    if (navigator.vibrate) navigator.vibrate(300);
    if (run.phase === 'rest') enterWork();
    else completeWork(false);
  }
}

// ---------- AMRAP: todas las rondas posibles en X minutos ----------

function startAmrap(routine, common, notes) {
  const b = routine.blocks.find(x => x.amrap);
  run = { ...common, mode: 'amrap', items: b.circuit, minutes: b.amrap, endAt: Date.now() + b.amrap * 60000, rounds: 0, pos: 0, reps: b.circuit[0].reps, lastMin: b.amrap };
  tick.lastBeep = null;
  requestWakeLock();
  route = { name: 'amrap', params: {} }; stack = [];
  if (notes.length) toast(notes[0]);
  Voice.say(`AMRAP de ${b.amrap} minutos. Todas las rondas que puedas, con buena técnica. Empezamos con ${exById(b.circuit[0].ex).name}.`, true);
  render();
}

views.amrap = () => {
  const total = run.minutes * 60, left = (run.endAt - Date.now()) / 1000;
  const it = run.items[run.pos], ex = exById(it.ex);
  return `${runHead(Math.min(100, (1 - left / total) * 100))}
    <div class="row" style="align-items:center;gap:16px">
      ${ring(left / total, 130, 10, `<div class="timer sm" id="timer">${fmtTime(left)}</div>`, 'ring-amrap')}
      <div class="grow"><div class="muted small">Rondas completas</div><div class="target" style="text-align:left">${run.rounds}</div>
        <div class="muted small">AMRAP ${run.minutes} min</div></div>
    </div>
    <div class="demo-card run" style="margin-top:12px"><div class="demo" data-demo="${ex.id}"></div><span class="demo-label" data-demo-label></span></div>
    <div class="run-ex"><div class="eyebrow-d">Ejercicio ${run.pos + 1}/${run.items.length}</div><h1>${esc(ex.name)}</h1>
      <div class="muted center">${targetText(it)}</div>${weightChips(ex)}</div>
    <button class="btn primary block big" data-act="amrap-next">${icon('check', 20)} Hecho</button>
    <div class="card" style="margin-top:12px">${run.items.map((x, i) => `<div class="list-item ${i === run.pos ? 'accent' : 'muted'}">
      <span class="num">${i + 1}</span><span class="grow">${esc(exById(x.ex).name)}</span><span>${targetText(x)}</span></div>`).join('')}</div>
    <button class="btn block" data-act="run-quit">Terminar ahora</button>`;
};

function amrapNext() {
  const it = run.items[run.pos], ex = exById(it.ex);
  run.sets.push({ ex: it.ex, weight: ex.load === 'none' ? 0 : currentWeight(it.ex), reps: it.reps, secs: 0, side: !!it.side, target: it.reps });
  run.pos = (run.pos + 1) % run.items.length;
  if (run.pos === 0) { run.rounds++; beep(880, 120); Voice.say(`Ronda ${run.rounds} completa. ${exById(run.items[0].ex).name}.`, true); }
  else Voice.say(exById(run.items[run.pos].ex).name, true);
  render();
}

function tickAmrap() {
  const left = (run.endAt - Date.now()) / 1000;
  const t = document.getElementById('timer');
  if (t) t.textContent = fmtTime(left);
  setRing('ring-amrap', left / (run.minutes * 60));
  const min = Math.ceil(left / 60);
  if (min < run.lastMin && left > 15) { run.lastMin = min; Voice.say(`Quedan ${min} minuto${min > 1 ? 's' : ''}.`); }
  if (left <= 10.05 && left > 9 && !run.said10) { run.said10 = true; Voice.say('Últimos diez segundos. ¡Con todo!', true); }
  countdown(left);
  if (left <= 0) {
    tick.lastBeep = null; beep(990, 400);
    Voice.say(`¡Tiempo! Hiciste ${run.rounds} rondas.`, true);
    finishRun();
  }
}

// ---------- Tests ----------

function startTest(t) {
  run = { mode: 'test', test: t, name: t.name, start: Date.now(), count: 0, stage: 'ready', endAt: null, sets: [], weights: {}, reasons: {} };
  requestWakeLock();
  route = { name: 'test-run', params: {} }; stack = [{ name: 'tests', params: {} }];
  Voice.say(`${t.name}. ${t.desc}`, true);
  render();
}

views['test-run'] = () => {
  const t = run.test, ex = exById(t.ex);
  const left = run.endAt ? (run.endAt - Date.now()) / 1000 : t.secs;
  if (run.stage === 'done') {
    return `${topbar(t.name)}
      <div class="sum-head"><div class="ob-logo ok">${icon('target', 44)}</div><h1>¡Test terminado!</h1></div>
      <label class="field"><span>Resultado (${t.unit})</span><input type="number" inputmode="numeric" id="test-result" value="${run.count}"></label>
      <button class="btn primary block big" data-act="test-save">Guardar resultado</button>
      <button class="btn block" style="margin-top:8px" data-act="test-discard">Descartar</button>`;
  }
  return `${runHead(t.secs && run.endAt ? (1 - left / t.secs) * 100 : 0)}
    <div class="demo-card run"><div class="demo" data-demo="${ex.id}"></div><span class="demo-label" data-demo-label></span></div>
    <p class="muted center" style="margin-top:10px">${esc(t.desc)}</p>
    ${ex.load !== 'none' ? weightChips(ex) : ''}
    ${run.stage === 'ready' ? `<button class="btn primary block big" data-act="test-start">${icon('play', 18)} Empezar${t.secs ? ` (${fmtTime(t.secs)})` : ''}</button>`
      : run.stage === 'count' ? `<div class="timer center" id="timer">${Math.ceil((run.endAt - Date.now()) / 1000)}</div>`
      : `${t.secs ? `<div class="center">${ring(left / t.secs, 140, 10, `<div class="timer sm" id="timer">${fmtTime(left)}</div>`, 'ring-test')}</div>` : ''}
        <div class="center muted small" style="margin-top:8px">Toca el botón grande en cada repetición</div>
        <button class="tap-btn" data-act="test-tap"><span id="test-count">${run.count}</span><small>${t.unit}</small></button>
        <div class="row"><button class="btn grow" data-act="test-minus">${icon('minus', 16)} Quitar 1</button><button class="btn grow" data-act="test-end">${icon('check', 16)} Terminar</button></div>`}`;
};

function tickTest() {
  if (route.name !== 'test-run') return;
  if (run.stage === 'count') {
    const left = (run.endAt - Date.now()) / 1000;
    const t = document.getElementById('timer');
    if (t) t.textContent = Math.max(1, Math.ceil(left));
    countdown(left);
    if (left <= 0) {
      tick.lastBeep = null;
      Voice.say('¡Ya!', true); beep(990, 300);
      Object.assign(run, { stage: 'go', start: Date.now(), endAt: run.test.secs ? Date.now() + run.test.secs * 1000 : null });
      tick.lastBeep = null;
      render();
    }
  } else if (run.stage === 'go' && run.endAt) {
    const left = (run.endAt - Date.now()) / 1000;
    const t = document.getElementById('timer');
    if (t) t.textContent = fmtTime(left);
    setRing('ring-test', left / run.test.secs);
    if (Math.round(left) === 30 && !run.said30) { run.said30 = true; Voice.say('Treinta segundos.'); }
    countdown(left);
    if (left <= 0) { tick.lastBeep = null; beep(990, 400); Voice.say(`¡Tiempo! ${run.count} ${run.test.unit}.`, true); run.stage = 'done'; run.end = Date.now(); render(); }
  }
}

views.tests = () => `
  ${topbar('Tests')}
  <p class="muted">Repite cada test cada 4 semanas para ver cuánto mejoraste.${programWeek()?.test ? ' <strong class="accent">Esta semana toca test en tu programa.</strong>' : ''}</p>
  ${testsFor().map(t => {
    const h = testHistory(t.id), last = h[h.length - 1], best = h.length ? Math.max(...h.map(x => x.result)) : null;
    return `<div class="card">
      <div class="row"><div class="thumb sm">${exerciseThumb(exById(t.ex))}</div><div class="grow"><h3>${esc(t.name)}</h3>
        <div class="muted small">${last ? `Último: ${last.result} ${t.unit} · ${fmtDate(last.date)}${best > last.result ? ` · mejor: ${best}` : ''}` : 'Todavía no lo hiciste'}</div></div>
        <button class="btn small" data-act="test-go" data-id="${t.id}">${icon('play', 14)} Hacer</button></div>
      ${h.length > 1 ? lineChart(h.map(x => ({ label: fmtDate(x.date, { day: 'numeric', month: 'numeric' }), v: x.result })), v => `${v}`) : ''}
    </div>`;
  }).join('')}`;

// ---------- Entrenamiento rápido ----------

views.quick = () => {
  const q = route.params;
  q.r ||= generateQuick(q);
  const bells = bellWeights();
  const items = routineItems(q.r);
  return `${topbar('Entrenamiento rápido')}
    <div class="card">
      <div class="muted small">¿Cuánto tiempo tienes?</div>
      <div class="seg">${[10, 15, 20, 30].map(n => `<button class="${q.minutes === n ? 'on' : ''}" data-act="q-set" data-field="minutes" data-id="${n}">${n}′</button>`).join('')}</div>
      <div class="muted small" style="margin-top:12px">¿Qué quieres trabajar?</div>
      <div class="chips">${Object.entries(QUICK_FOCUS).map(([k, f]) => `<button class="chip ${q.focus === k ? 'on' : ''}" data-act="q-set" data-field="focus" data-id="${k}">${f.name}</button>`).join('')}</div>
      <div class="muted small" style="margin-top:6px">¿Con qué pesa?</div>
      <div class="chips"><button class="chip ${!q.bell ? 'on' : ''}" data-act="q-set" data-field="bell" data-id="">Las que tengo</button>
        ${bells.map(b => `<button class="chip ${q.bell === b ? 'on' : ''}" data-act="q-set" data-field="bell" data-id="${b}">Solo ${b} kg</button>`).join('')}</div>
    </div>
    <h2>${icon('spark', 18, 'accent')} Tu sesión: ${q.r.blocks[0].rounds} rondas de</h2>
    ${items.map(it => `<div class="card excard click" data-act="exercise" data-id="${it.ex}"><div class="thumb sm">${exerciseThumb(exById(it.ex))}</div>
      <div class="grow"><h3>${esc(exById(it.ex).name)}</h3><div class="muted small">${targetText(it)}</div></div></div>`).join('')}
    <p class="muted small">~${estimateMin(q.r)} min · 15 s entre ejercicios y 45 s entre rondas.</p>
    <div class="row"><button class="btn grow" data-act="q-regen">${icon('shuffle', 16)} Otra opción</button><button class="btn grow" data-act="q-save">${icon('plus', 16)} Guardar</button></div>
    <div class="sticky-cta"><button class="btn primary block big" data-act="q-go">${icon('play', 18)} Empezar</button></div>`;
};

// ---------- Timers: EMOM, Tabata, AMRAP, Escalera ----------

const TIMER_MODES = {
  emom: { name: 'EMOM', text: 'Cada minuto, haz las reps; lo que sobra del minuto es descanso. Si eliges varios ejercicios, se alternan.' },
  tabata: { name: 'Tabata', text: 'Trabajo a tope y pausa corta, 8 veces por ejercicio.' },
  amrap: { name: 'AMRAP', text: 'Todas las rondas posibles del circuito en el tiempo elegido.' },
  escalera: { name: 'Escalera', text: 'Subes 1, 2, 3… reps por escalón con pausas cortas. Mucho volumen sin agotarte.' },
};

function buildTimerRoutine(t) {
  const exs = [t.ex1, t.ex2, t.ex3].filter(Boolean);
  const item = (ex, extra) => ({ ex, side: !!exById(ex).uni, ...extra });
  let blocks;
  if (t.mode === 'emom') blocks = [{ circuit: exs.map(ex => item(ex, { reps: t.reps, emom: 60, fixedRest: true })), rounds: Math.max(1, Math.round(t.minutes / exs.length)), restRound: 0 }];
  if (t.mode === 'tabata') blocks = exs.map(ex => item(ex, { sets: 8, secs: t.work, rest: t.pause, autoStart: true, fixedRest: true }));
  if (t.mode === 'amrap') blocks = [{ amrap: t.minutes, circuit: exs.map(ex => item(ex, { reps: t.reps })) }];
  if (t.mode === 'escalera') blocks = Array.from({ length: t.ladders }, () => ({ ladder: Array.from({ length: t.top }, (_, i) => i + 1), circuit: exs.map(ex => item(ex, {})), rest: 30 }));
  return { id: 'timer', custom: true, quick: true, format: TIMER_MODES[t.mode].name, goal: goalsOf()[0],
    name: `${TIMER_MODES[t.mode].name} · ${exs.map(e => exById(e).name).join(' + ')}`, desc: TIMER_MODES[t.mode].text, blocks };
}

views.timers = () => {
  const t = route.params;
  const exOptions = (field, optional) => `<select data-bind="t.${field}">${optional ? '<option value="">— Ninguno —</option>' : ''}${GROUPS.filter(g => g !== 'Movilidad').map(g => `<optgroup label="${g}">${EXERCISES.filter(e => e.group === g && e.level <= level()).map(e => `<option value="${e.id}" ${t[field] === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const seg = (field, values, fmt = v => v) => `<div class="seg">${values.map(v => `<button class="${t[field] === v ? 'on' : ''}" data-act="t-set" data-field="${field}" data-id="${v}">${fmt(v)}</button>`).join('')}</div>`;
  const r = buildTimerRoutine(t);
  return `${topbar('Timers')}
    <div class="seg wide">${Object.entries(TIMER_MODES).map(([k, m]) => `<button class="${t.mode === k ? 'on' : ''}" data-act="t-set" data-field="mode" data-id="${k}">${m.name}</button>`).join('')}</div>
    <div class="note">${icon('info', 18)}<span class="small">${TIMER_MODES[t.mode].text}</span></div>
    <div class="card">
      <label class="field"><span>Ejercicio 1</span>${exOptions('ex1', false)}</label>
      <label class="field"><span>Ejercicio 2 (opcional)</span>${exOptions('ex2', true)}</label>
      <label class="field"><span>Ejercicio 3 (opcional)</span>${exOptions('ex3', true)}</label>
      ${t.mode === 'emom' || t.mode === 'amrap' ? `<div class="muted small">Minutos</div>${seg('minutes', t.mode === 'emom' ? [8, 10, 12, 16, 20] : [8, 10, 15, 20])}
        <div class="muted small" style="margin-top:12px">Repeticiones por ejercicio</div>${seg('reps', [5, 8, 10, 12, 15, 20])}` : ''}
      ${t.mode === 'tabata' ? `<div class="muted small">Trabajo / pausa</div><div class="seg">${[[20, 10], [30, 15], [40, 20]].map(([w, p]) => `<button class="${t.work === w ? 'on' : ''}" data-act="t-work" data-id="${w}-${p}">${w}/${p} s</button>`).join('')}</div>` : ''}
      ${t.mode === 'escalera' ? `<div class="muted small">Escalón más alto</div>${seg('top', [3, 4, 5, 6, 8, 10], v => `1→${v}`)}
        <div class="muted small" style="margin-top:12px">Cuántas escaleras</div>${seg('ladders', [1, 2, 3, 4, 5])}` : ''}
    </div>
    <p class="muted small">~${estimateMin(r)} min${t.mode !== 'amrap' ? ' más calentamiento y estiramiento' : ''}.</p>
    <div class="sticky-cta"><button class="btn primary block big" data-act="t-go">${icon('play', 18)} Empezar ${TIMER_MODES[t.mode].name}</button></div>`;
};

// ---------- Resumen del mes ----------

views.wrapped = () => {
  const key = route.params.month || monthKey();
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const st = monthStats(key);
  const prev = monthKey(new Date(y, m - 2, 1)), next = monthKey(new Date(y, m, 1));
  const tile = (v, l, cls = '') => `<div class="w-tile ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  return `${topbar('Resumen del mes')}
    <div class="row between" style="margin-bottom:10px"><button class="icon-btn" data-act="wr-month" data-id="${prev}">${icon('left', 18)}</button>
      <strong class="cap">${name}</strong>
      <button class="icon-btn" data-act="wr-month" data-id="${next}" ${next > monthKey() ? 'disabled' : ''}>${icon('right', 18)}</button></div>
    ${st.sessions ? `<div class="wrapped" id="wrapped">
      <div class="w-head"><div class="logo">Iron<b>K</b></div><div class="cap">${name}</div></div>
      <div class="w-big">${st.sessions}<small>entrenamientos</small></div>
      <div class="w-grid">
        ${tile(fmtKg(st.volume), 'levantados')}${tile(st.kcal.toLocaleString('es-AR'), 'kcal quemadas')}
        ${tile(fmtDuration(st.time), 'entrenando')}${tile(st.days, 'días activos')}
        ${tile(st.streak, 'mejor racha')}${tile(st.prs.length, 'récords', st.prs.length ? 'hot' : '')}
      </div>
      ${st.topEx ? `<div class="w-line">${icon('kb', 18)} Tu ejercicio estrella: <strong>${esc(st.topEx)}</strong></div>` : ''}
      ${st.bestWeek ? `<div class="w-line">${icon('chart', 18)} Tu mejor semana: <strong>${fmtKg(st.bestWeek)}</strong></div>` : ''}
      <div class="w-line">${icon('medal', 18)} Ganaste <strong>${st.xp.toLocaleString('es-AR')} XP</strong></div>
    </div>
    <button class="btn primary block big" style="margin-top:14px" data-act="wr-share" data-id="${key}">${icon('upload', 18)} Compartir imagen</button>`
    : '<p class="empty">No hay entrenamientos en este mes.</p>'}`;
};

// Dibuja el resumen como imagen (1080×1350) para compartir o guardar.
async function shareWrapped(key) {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const st = monthStats(key);
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#ff8a2b'); grad.addColorStop(0.55, '#ff4d2e'); grad.addColorStop(1, '#7a1d12');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#fff'; g.font = '800 64px Segoe UI, system-ui, sans-serif'; g.fillText('IronK', 80, 130);
  g.font = '500 44px Segoe UI, system-ui, sans-serif'; g.fillText(name.charAt(0).toUpperCase() + name.slice(1), 80, 200);
  g.font = '800 260px Segoe UI, system-ui, sans-serif'; g.fillText(String(st.sessions), 70, 480);
  g.font = '600 48px Segoe UI, system-ui, sans-serif'; g.fillText('entrenamientos', 90, 550);
  const tiles = [[fmtKg(st.volume), 'levantados'], [st.kcal.toLocaleString('es-AR'), 'kcal'], [fmtDuration(st.time), 'entrenando'], [String(st.days), 'días activos'], [String(st.streak), 'mejor racha'], [String(st.prs.length), 'récords']];
  tiles.forEach(([v, l], i) => {
    const x = 80 + (i % 2) * 470, yy = 640 + Math.floor(i / 2) * 190;
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.roundRect(x, yy, 440, 160, 28); g.fill();
    g.fillStyle = '#fff'; g.font = '800 64px Segoe UI, system-ui, sans-serif'; g.fillText(v, x + 32, yy + 82);
    g.font = '500 34px Segoe UI, system-ui, sans-serif'; g.fillText(l, x + 32, yy + 130);
  });
  if (st.topEx) { g.font = '600 38px Segoe UI, system-ui, sans-serif'; g.fillText(`Ejercicio estrella: ${st.topEx}`, 80, 1250); }
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const file = new File([blob], `ironk-${key}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Mi mes en IronK` }); } catch (e) { /* cancelado */ }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); URL.revokeObjectURL(a.href);
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
  if (run.mode === 'guided') Voice.say(run.prs.length ? '¡Entrenamiento completo, y con récord nuevo! Buen trabajo.' : '¡Entrenamiento completo! Buen trabajo.', true);
  if (run.prs.length) { beep(784, 150); setTimeout(() => beep(1046, 250), 160); }
  route = { name: 'summary', params: { effort: 7 } }; stack = [];
  render();
}

const EFFORT_LABEL = n => n <= 3 ? 'Fácil' : n <= 6 ? 'Moderado' : n <= 8 ? 'Duro' : 'Al límite';

views.summary = () => {
  const dur = (run.end - run.start) / 1000, e = route.params.effort;
  const xp = sessionXp({ duration: dur, sets: run.sets, prs: run.prs });
  const before = rankInfo(), after = rankInfo(before.xp + xp);
  return `
    <div class="sum-head"><div class="ob-logo ok">${icon(run.prs.length ? 'trophy' : 'check', 44)}</div>
      <h1>¡Sesión completa!</h1><p class="muted">${esc(run.name)}${run.mode === 'amrap' ? ` · ${run.rounds} rondas` : ''}</p>
      <span class="pill xp">+${xp} XP</span>${after.idx > before.idx ? ` <span class="pill xp">¡Nuevo rango: ${after.rank}!</span>` : ''}</div>
    <div class="stats">
      <div class="stat"><div class="v">${fmtDuration(dur)}</div><div class="l">duración</div></div>
      <div class="stat"><div class="v" id="sum-kcal">${estimateKcal(run.sets, dur, e)}</div><div class="l">kcal estimadas</div></div>
      <div class="stat"><div class="v">${fmtKg(sessionVolume({ sets: run.sets }))}</div><div class="l">peso levantado</div></div>
      <div class="stat"><div class="v">${run.sets.length}</div><div class="l">series · ${new Set(run.sets.map(s => s.ex)).size} ejercicios</div></div>
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
      <div class="muted small">${fmtDuration(s.duration)} · ${fmtKg(sessionVolume(s))} · ${sessionKcal(s)} kcal</div></div>
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

// metric: 'kg' (peso levantado) o 'kcal' (calorías estimadas).
function weeklyBars(metric = 'kg', weeksBack = 10) {
  const ws = weekStart(new Date()).getTime(), weeks = [];
  const val = s => metric === 'kcal' ? sessionKcal(s) : sessionVolume(s);
  const fmt = v => metric === 'kcal' ? `${Math.round(v)} kcal` : fmtKg(v);
  for (let i = weeksBack - 1; i >= 0; i--) {
    const a = ws - i * 7 * DAY, list = sessionsBetween(a, a + 7 * DAY);
    const d = new Date(a);
    weeks.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, vol: list.reduce((x, s) => x + val(s), 0), n: list.length });
  }
  const max = Math.max(1, ...weeks.map(w => w.vol));
  return `<div class="bars">${weeks.map((w, i) => `<div class="b ${i === weeks.length - 1 ? 'cur' : ''} ${metric}" title="${fmt(w.vol)} · ${w.n} sesiones"><em>${w.n || ''}</em><i style="height:${(w.vol / max) * 100}%"></i><small>${w.label}</small></div>`).join('')}</div>
    <div class="row between muted small" style="margin-top:6px"><span>Esta semana: <strong class="accent">${fmt(weeks[weeks.length - 1].vol)}</strong></span><span>El número arriba = sesiones</span></div>`;
}

views.progress = () => {
  const p = ui.prog;
  const seg = `<div class="seg wide">${[['resumen', 'Resumen'], ['ejercicios', 'Ejercicios'], ['cuerpo', 'Cuerpo'], ['retos', 'Retos'], ['logros', 'Logros']].map(([k, v]) =>
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
        <div class="stat"><div class="v">${s.reduce((a, x) => a + sessionKcal(x), 0).toLocaleString('es-AR')}</div><div class="l">kcal quemadas (estimado)</div></div>
        <div class="stat"><div class="v">${monthSessions(monthKey()).reduce((a, x) => a + sessionKcal(x), 0).toLocaleString('es-AR')}</div><div class="l">kcal este mes</div></div>
      </div>
      <button class="btn block" style="margin-top:10px" data-act="go-wrapped">${icon('spark', 16)} Ver resumen del mes</button>
      <h2>Lo que dicen tus números</h2>
      <div class="card">${insights().map(insightRow).join('')}</div>
      <h2>${ui.bars === 'kcal' ? 'Calorías por semana' : 'Peso levantado por semana'}</h2>
      <div class="seg">${[['kg', 'Peso levantado'], ['kcal', 'Calorías']].map(([k, v]) => `<button class="${(ui.bars || 'kg') === k ? 'on' : ''}" data-act="bars" data-id="${k}">${v}</button>`).join('')}</div>
      <div class="card">${weeklyBars(ui.bars || 'kg')}</div>
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
  retos() {
    const monthName = new Date().toLocaleDateString('es-AR', { month: 'long' });
    return `<p class="muted">Únete a los desafíos de ${monthName}: tus entrenamientos suman solos. Cada desafío cumplido da 200 XP.</p>
      ${challengeCards()}
      <h2>${icon('target', 18, 'accent')} Tests</h2>
      <div class="card click row" data-act="go-tests"><span class="grow">Mide tu progreso real cada 4 semanas</span>${icon('right', 16)}</div>`;
  },
  logros() {
    const st = achievementStats();
    const got = ACHIEVEMENTS.filter(a => a.test(st)).length;
    return `${rankCard()}
      <div class="card"><div class="muted small">Rangos</div><div class="ranks">${RANKS.map((r, i) => `<span class="${i <= rankInfo().idx ? 'on' : ''}">${r.name}<small>${r.xp.toLocaleString('es-AR')}</small></span>`).join('')}</div>
        <div class="muted small">Ganas XP por minutos entrenados, series, récords, tests y desafíos.</div></div>
      <p class="muted">${got} de ${ACHIEVEMENTS.length} logros desbloqueados</p>
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
      <div class="stat"><div class="v">${sessionKcal(s)}</div><div class="l">kcal estimadas</div></div>
      <div class="stat"><div class="v">${s.effort ? `${s.effort}/10` : '—'}</div><div class="l">${s.effort ? EFFORT_LABEL(s.effort) : 'esfuerzo'}</div></div>
      <div class="stat"><div class="v">${s.sets.length}</div><div class="l">series</div></div>
      <div class="stat"><div class="v">+${sessionXp(s)}</div><div class="l">XP ganados</div></div>
    </div>
    ${s.checkin ? `<div class="note">${icon('heart', 18)}<span class="small">Llegaste con energía ${s.checkin.energy}, dormiste ${s.checkin.sleep}${s.checkin.pains?.length ? `, molestia en ${s.checkin.pains.map(p => PAINS[p].toLowerCase()).join(' y ')}` : ''}.</span></div>` : ''}
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
      <div><h1 style="margin:0">${esc(p.name || 'Atleta IronK')}</h1><div class="muted small">${levelDots(p.level)} ${LEVELS[p.level].name} · ${goalsText(p)}</div></div></div>
    <div style="margin-top:14px">${rankCard()}</div>
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
      <div class="muted small" style="margin-top:12px">Objetivos (hasta 3)</div>
      ${goalOptions(goalsOf(p), 'p-goal', true)}
      <div class="muted small">Días por semana</div>
      <div class="seg">${[2, 3, 4, 5, 6].map(n => `<button class="${p.days === n ? 'on' : ''}" data-act="p-set" data-field="days" data-id="${n}">${n}</button>`).join('')}</div>
      <div class="muted small" style="margin-top:12px">Minutos por sesión</div>
      <div class="seg">${[15, 20, 30, 45, 60].map(n => `<button class="${p.minutes === n ? 'on' : ''}" data-act="p-set" data-field="minutes" data-id="${n}">${n}′</button>`).join('')}</div>
      <div class="muted small" style="margin-top:12px">Descanso entre series</div>
      ${restSeg()}
      <div class="muted small">"Recomendado" usa el descanso pensado para cada rutina y tu nivel. Durante el descanso también puedes sumar o restar 15 s.</div>
      <div class="muted small" style="margin-top:12px">Avance automático entre series</div>
      ${autoSetSeg()}
      <div class="muted small">"Según reps" calcula el tiempo de cada serie (por ejemplo, 10 swings ≈ 32 s). Siempre puedes tocar "Listo" antes o sumar 15 s.</div>
      <div class="kv" style="margin-top:12px"><span>${icon('volume', 16)} Voz del coach</span>
        <div class="seg mini">${[[true, 'Sí'], [false, 'No']].map(([v, l]) => `<button class="${(p.voice !== false) === v ? 'on' : ''}" data-act="p-toggle" data-field="voice" data-id="${v}">${l}</button>`).join('')}</div></div>
      <div class="kv"><span>${icon('flame', 16)} Calentamiento y estiramiento</span>
        <div class="seg mini">${[[true, 'Sí'], [false, 'No']].map(([v, l]) => `<button class="${(p.warmup !== false) === v ? 'on' : ''}" data-act="p-toggle" data-field="warmup" data-id="${v}">${l}</button>`).join('')}</div></div>
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

  'run-start': el => askCheckin(routineById(el.dataset.id)),
  'run-weight': el => {
    const ex = { free: run.ex, amrap: run.items?.[run.pos]?.ex, test: run.test?.ex }[run.mode] || run.steps[run.i].ex;
    run.weights[ex] = Number(el.dataset.id); render();
  },
  pause: () => pauseRun(),
  resume: () => resumeRun(),
  'work-add': () => { run.timerEnd += 15000; run.timerTotal += 15000; tick.lastBeep = null; tick(); },
  'auto-set': el => { db.profile.autoSet = el.dataset.id; touchSettings(); saveDb(); render(); },
  'voice-toggle': () => {
    db.profile.voice = db.profile.voice === false; touchSettings(); saveDb();
    if (!Voice.on()) Voice.stop(); else Voice.say('Voz activada');
    render();
  },

  // ¿Cómo te sientes hoy?
  'ck-set': el => { route.params.c[el.dataset.field] = el.dataset.id; render(); },
  'ck-pain': el => {
    const c = route.params.c, k = el.dataset.id;
    c.pains = c.pains.includes(k) ? c.pains.filter(x => x !== k) : [...c.pains, k]; render();
  },
  'ck-go': () => startRun(route.params.routine || routineById(route.params.id), route.params.c),
  'ck-skip': () => startRun(route.params.routine || routineById(route.params.id), null),

  // Rápido, timers, tests, programa, desafíos, resumen del mes
  'go-quick': () => go('quick', { minutes: Math.min(30, db.profile.minutes || 15), focus: 'completo', bell: null }),
  'q-set': el => {
    const f = el.dataset.field, v = el.dataset.id;
    route.params[f] = f === 'minutes' ? Number(v) : f === 'bell' ? (v ? Number(v) : null) : v;
    route.params.r = null; render();
  },
  'q-regen': () => { route.params.r = null; render(); },
  'q-go': () => askCheckin(route.params.r),
  'q-save': () => {
    const r = { ...structuredClone(route.params.r), id: 'c-' + uid(), quick: false, updatedAt: Date.now() };
    db.customRoutines.push(r); saveDb(); toast('Guardada en Mis rutinas');
  },
  'go-timers': () => go('timers', { mode: 'emom', ex1: 'swing2', ex2: '', ex3: '', minutes: 10, reps: 10, work: 20, pause: 10, top: 5, ladders: 3 }),
  't-set': el => {
    const f = el.dataset.field, v = el.dataset.id;
    route.params[f] = f === 'mode' ? v : Number(v);
    if (f === 'mode' && v === 'escalera' && route.params.ex1 === 'swing2') route.params.ex1 = 'press';
    render();
  },
  't-work': el => { const [w, p] = el.dataset.id.split('-').map(Number); Object.assign(route.params, { work: w, pause: p }); render(); },
  't-go': () => askCheckin(buildTimerRoutine(route.params)),
  'go-tests': () => go('tests'),
  'test-go': el => startTest(TESTS.find(t => t.id === el.dataset.id)),
  'test-start': () => { tick.lastBeep = null; Object.assign(run, { stage: 'count', endAt: Date.now() + 3050 }); render(); },
  'test-tap': () => {
    run.count++; if (navigator.vibrate) navigator.vibrate(15);
    const el = document.getElementById('test-count'); if (el) el.textContent = run.count;
  },
  'test-minus': () => { run.count = Math.max(0, run.count - 1); const el = document.getElementById('test-count'); if (el) el.textContent = run.count; },
  'test-end': () => { Voice.say(`Terminado. ${run.count} ${run.test.unit}.`, true); run.stage = 'done'; run.end = Date.now(); render(); },
  'test-save': () => {
    const t = run.test, ex = exById(t.ex), result = Math.max(0, parseInt(document.getElementById('test-result').value, 10) || 0);
    const weight = ex.load === 'none' ? 0 : currentWeight(t.ex);
    const now = new Date().toISOString();
    db.tests = [...(db.tests || []), { id: uid(), test: t.id, date: now, result, weight }];
    const duration = Math.round(((run.end || Date.now()) - run.start) / 1000);
    const sets = [{ ex: t.ex, weight, reps: result, secs: 0, side: false }];
    db.sessions.push({ id: uid(), date: new Date(run.start).toISOString(), name: `Test: ${t.name}`, routineId: null, duration, sets, effort: 9, note: '', prs: detectPRs(sets), kcal: estimateKcal(sets, duration, 9) });
    db.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveDb(); run = null; releaseWakeLock(); toast('Resultado guardado'); stack = []; route = { name: 'train', params: {} }; go('tests');
  },
  'test-discard': () => { if (confirm('¿Descartar el resultado?')) { run = null; releaseWakeLock(); stack = []; route = { name: 'train', params: {} }; go('tests'); } },
  'amrap-next': () => amrapNext(),
  'prog-start': () => {
    db.profile.program = { start: weekStart(new Date()).toISOString() }; db.profile.programDone = false;
    touchSettings(); saveDb(); toast('¡Programa de 8 semanas en marcha!'); render();
  },
  'prog-stop': () => {
    if (!confirm('¿Dejar el programa de 8 semanas? Tus rutinas vuelven a su volumen normal.')) return;
    if (programWeek()?.done) db.profile.programDone = true;
    delete db.profile.program; touchSettings(); saveDb(); render();
  },
  'ch-join': el => {
    db.challenges = [...(db.challenges || []), { id: `${el.dataset.id}:${monthKey()}`, ch: el.dataset.id, month: monthKey() }];
    saveDb(); toast('¡Te uniste al desafío!'); render();
  },
  bars: el => { ui.bars = el.dataset.id; render(); },
  'go-logros': () => { ui.prog = 'logros'; tab('progress'); },
  'go-wrapped': () => go('wrapped', { month: monthKey() }),
  'go-wrapped-prev': () => go('wrapped', { month: monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)) }),
  'wr-month': el => { if (el.dataset.id <= monthKey()) { route.params.month = el.dataset.id; render(); } },
  'wr-share': el => shareWrapped(el.dataset.id),
  'p-toggle': el => { db.profile[el.dataset.field] = el.dataset.id === 'true'; touchSettings(); saveDb(); render(); },
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
    if (run.restEnd <= Date.now() + 500) enterWork(); else tick();
  },
  'ob-goal': el => { route.params.d.goals = toggleGoal(route.params.d.goals, el.dataset.id); render(); },
  'p-goal': el => {
    const goals = goalsOf();
    if (goals.length === 1 && goals[0] === el.dataset.id) return toast('Necesitas al menos un objetivo');
    db.profile.goals = toggleGoal(goals, el.dataset.id);
    db.profile.goal = db.profile.goals[0];
    touchSettings(); saveDb(); render();
  },
  'rest-mode': el => { db.profile.rest = el.dataset.id; touchSettings(); saveDb(); render(); },
  'rest-skip': () => enterWork(),
  'run-quit': () => {
    if (run.mode === 'test') { if (confirm('¿Salir del test sin guardar?')) { Voice.stop(); run = null; releaseWakeLock(); tab('train'); } return; }
    if (!run.sets.length) { if (confirm('¿Salir sin registrar nada?')) { Voice.stop(); run = null; releaseWakeLock(); tab('home'); } return; }
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
    const exIds = [...new Set(run.sets.map(s => s.ex))];
    const before = Object.fromEntries(exIds.map(id => [id, { ...progression(id) }]));
    db.sessions.push({
      id: uid(), date: new Date(run.start).toISOString(), name: run.name, routineId: run.routineId || null,
      duration: Math.round((run.end - run.start) / 1000), sets: run.sets, effort: route.params.effort,
      note: (route.params.note || '').trim(), prs: run.prs,
      kcal: estimateKcal(run.sets, (run.end - run.start) / 1000, route.params.effort),
      ...(run.checkin ? { checkin: run.checkin } : {}), ...(run.mode === 'amrap' ? { rounds: run.rounds } : {}),
    });
    db.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveDb(); run = null;
    // ¿Esta sesión hizo subir algún escalón de progresión?
    const ups = exIds.map(id => {
      const a = before[id], b = progression(id);
      if (b.pendingUp && !a.pendingUp) return `${exById(id).name}: la próxima vez con ${b.nextWeight} kg`;
      if (b.steps > a.steps) return `${exById(id).name}: más repeticiones la próxima vez`;
      return null;
    }).filter(Boolean);
    toast(ups.length ? `📈 ${ups[0]}${ups.length > 1 ? ` (y ${ups.length - 1} más)` : ''}` : 'Guardado en tu historial');
    if (ups.length) Voice.say(`¡Progresaste! ${ups[0]}.`);
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
  if (key?.startsWith('t.')) { route.params[key.slice(2)] = e.target.value; render(); }
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
