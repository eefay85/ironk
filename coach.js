// "Entrenador" de IronK: adapta rutinas a tu nivel, sugiere pesos con progresión,
// elige el entrenamiento del día, calcula recuperación, récords, logros e ideas.
// Usa `db` (definido en app.js) en tiempo de llamada.

const DAY = 864e5;
const LOAD_RATIO = { light: 0.45, medium: 0.65, heavy: 1, max: 1.2 };

const exById = id => EXERCISES.find(e => e.id === id) || { id, name: id, group: '', type: '', load: 'medium', level: 1, muscles: [], desc: '', cues: [], mistakes: [] };
const allRoutines = () => [...PRESET_ROUTINES, ...db.customRoutines];
const routineById = id => allRoutines().find(r => r.id === id);
const level = () => db.profile?.level || 1;

// ---------- Fechas y volumen ----------

function dayKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekStart(d) {
  d = new Date(d); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
  return d;
}
function sessionsBetween(a, b) {
  return db.sessions.filter(s => { const t = new Date(s.date).getTime(); return t >= a && t < b; });
}
function sessionsThisWeek() { return sessionsBetween(weekStart(new Date()).getTime(), Infinity).length; }

// Volumen = peso x repeticiones (x2 si es por lado o con dos pesas).
function setVolume(s) {
  const ex = exById(s.ex);
  return (s.weight || 0) * (s.reps || 0) * (s.side ? 2 : 1) * (ex.double ? 2 : 1);
}
function sessionVolume(sess) { return sess.sets.reduce((a, s) => a + setVolume(s), 0); }
// Fuerza estimada (1RM, fórmula de Epley) para comparar series con distinto peso y reps.
function e1rm(s) { return s.weight && s.reps ? s.weight * (1 + Math.min(s.reps, 15) / 30) : 0; }

function fmtKg(n) { return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')} t` : `${Math.round(n)} kg`; }

// ---------- Rutinas: pasos y duración ----------

function buildSteps(r) {
  const steps = [];
  r.blocks.forEach(b => {
    if (b.circuit) {
      for (let i = 1; i <= b.rounds; i++) {
        b.circuit.forEach((it, j) => steps.push({
          ...it, label: `Ronda ${i}/${b.rounds}`,
          rest: j === b.circuit.length - 1 ? (b.restRound ?? 60) : (it.rest ?? 0),
        }));
      }
    } else {
      for (let i = 1; i <= b.sets; i++) steps.push({ ...b, label: `Serie ${i}/${b.sets}` });
    }
  });
  if (steps.length) steps[steps.length - 1].rest = 0;
  return steps;
}

function estimateMin(r) {
  const sec = buildSteps(r).reduce((a, s) => {
    const work = (s.secs || (s.reps || 0) * 3.5) * (s.side ? 2 : 1);
    return a + work + (s.rest || 0) + 12;
  }, 0);
  return Math.max(5, Math.round(sec / 60));
}

function routineItems(r) {
  const out = [];
  r.blocks.forEach(b => (b.circuit || [b]).forEach(it => out.push({ ...it, sets: b.circuit ? b.rounds : it.sets, circuit: !!b.circuit })));
  return out;
}

function mainMuscles(r, n = 3) {
  const score = {};
  routineItems(r).forEach(it => (exById(it.ex).muscles || []).forEach((m, i) => { score[m] = (score[m] || 0) + (i === 0 ? 2 : 1) * (it.sets || 1); }));
  return Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, n).map(([m]) => m);
}

function routineFits(r) {
  const L = level();
  return (r.minLevel || 1) <= L && L <= (r.maxLevel || 3);
}

// Ajusta series, descansos y ejercicios a tu nivel, edad y tiempo disponible.
function adaptRoutine(r) {
  const p = db.profile, L = level(), notes = [];
  const swap = id => {
    let ex = exById(id), guard = 0;
    while (ex.level > L && ex.easier && guard++ < 3) ex = exById(ex.easier);
    return ex;
  };
  const restBonus = (L === 1 ? 15 : L === 3 ? -10 : 0) + (p.age >= 50 ? 15 : 0);
  const adj = (it, inCircuit) => {
    const out = { ...it };
    const ex = r.custom ? exById(it.ex) : swap(it.ex);
    if (ex.id !== it.ex) {
      notes.push(`${exById(it.ex).name} → ${ex.name}`);
      out.ex = ex.id;
      out.side = !!ex.uni;
    }
    if (!inCircuit && !r.custom) {
      if (L === 1 && out.sets >= 3) out.sets -= 1;
      if (L === 3 && out.sets >= 3 && out.sets < 8) out.sets += 1;
    }
    if (out.rest && !r.custom) out.rest = Math.max(inCircuit ? 10 : 20, out.rest + restBonus);
    return out;
  };
  let blocks = r.blocks.map(b => b.circuit
    ? { ...b, rounds: r.custom ? b.rounds : Math.max(2, b.rounds + (L === 1 ? -1 : L === 3 ? 1 : 0)), restRound: (b.restRound ?? 60) + Math.max(0, restBonus), circuit: b.circuit.map(it => adj(it, true)) }
    : adj(b, false));

  // Recortar para que entre en el tiempo que elegiste.
  const target = p.minutes || 30;
  let trimmed = false;
  for (let guard = 0; guard < 30 && !r.custom; guard++) {
    if (estimateMin({ blocks }) <= target * 1.15) break;
    let best = null;
    blocks.forEach(b => {
      const n = b.circuit ? b.rounds : b.sets;
      if (n > 2 && (!best || n > (best.circuit ? best.rounds : best.sets))) best = b;
    });
    if (!best) break;
    if (best.circuit) best.rounds--; else best.sets--;
    trimmed = true;
  }
  if (trimmed) notes.push(`Ajustada a tus ${target} min`);
  return { ...r, blocks, notes: [...new Set(notes)] };
}

// ---------- Pesas sugeridas y progresión ----------

function bellsFor(ex) {
  const list = ex.double ? db.bells.filter(b => b.qty >= 2) : db.bells;
  const w = [...new Set(list.map(b => b.weight))].sort((a, b) => a - b);
  return w.length ? w : [...new Set(db.bells.map(b => b.weight))].sort((a, b) => a - b);
}

// Peso de swing de referencia según sexo, nivel, peso corporal y edad.
function baseSwingKg(p = db.profile) {
  const table = { h: [16, 22, 28], m: [10, 14, 18], x: [12, 18, 24] };
  let kg = (table[p.sex] || table.x)[(p.level || 1) - 1];
  if (p.weight) {
    const ref = p.sex === 'm' ? 65 : p.sex === 'h' ? 80 : 72;
    kg *= Math.min(1.25, Math.max(0.8, p.weight / ref));
  }
  if (p.age) {
    if (p.age < 18) kg *= 0.75;
    else if (p.age >= 65) kg *= 0.7;
    else if (p.age >= 50) kg *= 0.85;
  }
  return kg;
}
function snapBell(target, list) {
  const ok = list.filter(w => w <= target * 1.08);
  return ok.length ? ok[ok.length - 1] : list[0];
}
function idealBell(load) {
  const kg = baseSwingKg() * (LOAD_RATIO[load] || 1);
  return snapBell(kg, BELL_SIZES);
}

function exHistory(exId) {
  return db.sessions.map(s => ({ date: s.date, effort: s.effort, sets: s.sets.filter(x => x.ex === exId) })).filter(h => h.sets.length);
}

function hitTarget(sets) {
  return sets.every(s => s.secs ? s.secs >= (s.targetSecs || 0) : !s.target || (s.reps || 0) >= s.target);
}

function suggestWeight(ex) {
  if (ex.load === 'none') return { weight: 0, change: 'none' };
  const list = bellsFor(ex);
  if (!list.length) return { weight: 0, reason: 'Agrega tus pesas en Perfil', change: 'none' };
  const hist = exHistory(ex.id);
  if (!hist.length) {
    return { weight: snapBell(baseSwingKg() * (LOAD_RATIO[ex.load] || 1), list), reason: 'Sugerido según tu perfil', change: 'new' };
  }
  const last = hist[hist.length - 1];
  const w = Math.max(...last.sets.map(s => s.weight || 0));
  const atW = last.sets.filter(s => (s.weight || 0) === w);
  const hit = hitTarget(atW);
  const bad = atW.some(s => s.target && (s.reps || 0) < s.target * 0.7);
  const effort = last.effort || 7;
  let idx = list.indexOf(w);
  if (idx < 0) idx = list.indexOf(snapBell(w, list));

  let streak = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i], hw = Math.max(...h.sets.map(s => s.weight || 0));
    if (hw === w && hitTarget(h.sets.filter(s => (s.weight || 0) === w))) streak++; else break;
  }
  const needed = level() === 1 ? 2 : 1;

  if (hit && effort <= 7 && streak >= needed && idx < list.length - 1) {
    return { weight: list[idx + 1], reason: `Subes de ${w} a ${list[idx + 1]} kg: completaste todo con margen`, change: 'up' };
  }
  if (!hit && (bad || effort >= 9) && idx > 0) {
    return { weight: list[idx - 1], reason: 'Bajamos un poco: la última vez costó demasiado', change: 'down' };
  }
  const reason = !hit ? 'Mismo peso: completa todas las reps para subir'
    : effort > 7 ? 'Mismo peso: la última vez fue exigente'
    : streak < needed ? 'Repite este peso una vez más y subimos' : 'Ya usas tu pesa más pesada';
  return { weight: list[idx], reason, change: 'same' };
}

// ---------- Programa y plan del día ----------

function programRoutines() {
  const ids = PROGRAMS[db.profile.goal] || PROGRAMS.fuerza;
  const list = [...new Set(ids)].map(routineById).filter(r => r && routineFits(r));
  return list.length ? list : [routineById('p-fuerza-a')];
}

function recovery() {
  const now = Date.now(), out = {};
  Object.keys(MUSCLES).forEach(m => { out[m] = 100; });
  db.sessions.forEach(s => {
    const hours = (now - new Date(s.date).getTime() - (s.duration || 0) * 1000) / 36e5;
    if (hours > 96 || hours < 0) return;
    const load = {};
    s.sets.forEach(x => (exById(x.ex).muscles || []).forEach((m, i) => { load[m] = (load[m] || 0) + (i === 0 ? 1 : 0.6); }));
    Object.entries(load).forEach(([m, n]) => {
      const need = Math.min(72, 24 + n * 3) * ((s.effort || 7) / 7);
      out[m] = Math.min(out[m], Math.round(Math.max(0, Math.min(100, (hours / need) * 100))));
    });
  });
  return out;
}

function todayPlan() {
  const p = db.profile;
  const today = dayKey(new Date());
  const doneToday = db.sessions.filter(s => dayKey(s.date) === today);
  const mobility = routineById('p-movilidad');
  if (doneToday.length) return { kind: 'done', session: doneToday[doneToday.length - 1], routine: mobility };

  const last = db.sessions[db.sessions.length - 1];
  const yesterday = last && dayKey(last.date) === dayKey(Date.now() - DAY);
  const twoInRow = yesterday && db.sessions.some(s => dayKey(s.date) === dayKey(Date.now() - 2 * DAY));
  if (sessionsThisWeek() >= p.days) {
    return { kind: 'rest', routine: mobility, reason: `Ya cumpliste tus ${p.days} sesiones de esta semana. Descansa o haz movilidad suave.` };
  }
  if (yesterday && ((last.effort || 0) >= 9 || twoInRow)) {
    return { kind: 'recovery', routine: mobility, reason: twoInRow ? 'Entrenaste dos días seguidos: hoy conviene recuperar.' : 'Ayer fue muy intenso: hoy toca algo suave.' };
  }

  const rot = programRoutines();
  const lastProg = [...db.sessions].reverse().find(s => rot.some(r => r.id === s.routineId));
  const start = lastProg ? (rot.findIndex(r => r.id === lastProg.routineId) + 1) % rot.length : 0;
  const rec = recovery();
  const skipped = new Set();
  for (let k = 0; k < rot.length; k++) {
    const r = rot[(start + k) % rot.length];
    const tired = mainMuscles(r, 2).filter(m => rec[m] < 60);
    if (!tired.length) {
      const reason = k > 0
        ? `Cambiamos el orden: ${[...skipped].map(m => MUSCLES[m].toLowerCase()).join(' y ')} todavía se recupera${skipped.size > 1 ? 'n' : ''}.`
        : lastProg ? `Sigue tu programa para ${GOALS[p.goal].toLowerCase()}.` : 'Primera sesión de tu programa. ¡Vamos!';
      return { kind: 'train', routine: r, reason };
    }
    tired.forEach(m => skipped.add(m));
  }
  return { kind: 'train', routine: rot[start], reason: 'Hoy toca, pero algunos músculos siguen cansados: ve con calma.' };
}

// ---------- Récords, ideas y logros ----------

function detectPRs(sets) {
  const prs = [];
  const byEx = {};
  sets.forEach(s => { (byEx[s.ex] ||= []).push(s); });
  Object.entries(byEx).forEach(([ex, list]) => {
    const prev = db.sessions.flatMap(s => s.sets.filter(x => x.ex === ex));
    if (!prev.length) return;
    const curW = Math.max(...list.map(x => x.weight || 0)), prevW = Math.max(...prev.map(x => x.weight || 0));
    const curE = Math.max(...list.map(e1rm)), prevE = Math.max(...prev.map(e1rm));
    const curR = Math.max(...list.map(x => x.reps || 0)), prevR = Math.max(...prev.map(x => x.reps || 0));
    if (curW > prevW) prs.push({ ex, type: 'Peso máximo', value: `${curW} kg` });
    else if (curE > prevE + 0.01) prs.push({ ex, type: 'Fuerza estimada', value: `${Math.round(curE)} kg` });
    else if (exById(ex).load === 'none' && curR > prevR) prs.push({ ex, type: 'Más repeticiones', value: `${curR} reps` });
  });
  return prs;
}

function weeksMeetingGoal() {
  let n = 0;
  const ws = weekStart(new Date()).getTime();
  if (sessionsBetween(ws, Infinity).length >= db.profile.days) n++;
  for (let i = 1; i < 104; i++) {
    const a = ws - i * 7 * DAY;
    if (sessionsBetween(a, a + 7 * DAY).length >= db.profile.days) n++; else break;
  }
  return n;
}

function streakDays() {
  const days = new Set(db.sessions.map(s => dayKey(s.date)));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // la racha sigue viva si entrenaste ayer
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function longestStreak() {
  const days = [...new Set(db.sessions.map(s => dayKey(s.date)))].sort();
  let best = 0, cur = 0, prev = null;
  days.forEach(k => {
    const t = new Date(k + 'T12:00').getTime();
    cur = prev && Math.round((t - prev) / DAY) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur); prev = t;
  });
  return best;
}

function insights() {
  const s = db.sessions, out = [];
  if (!s.length) return [{ icon: 'spark', text: 'Completa tu primera sesión y aquí verás cómo avanzas.' }];
  const ws = weekStart(new Date()).getTime();
  const volThis = sessionsBetween(ws, Infinity).reduce((a, x) => a + sessionVolume(x), 0);
  const volPrev = sessionsBetween(ws - 7 * DAY, ws).reduce((a, x) => a + sessionVolume(x), 0);
  if (volPrev > 0 && volThis > 0) {
    const pct = Math.round((volThis - volPrev) / volPrev * 100);
    out.push(pct >= 0
      ? { icon: 'up', text: `Esta semana ya levantaste ${pct}% más que la semana pasada.` }
      : { icon: 'chart', text: `Llevas ${fmtKg(volThis)} esta semana (${fmtKg(volPrev)} la anterior). ¡Todavía hay tiempo!` });
  }
  const recentPR = [...s].reverse().find(x => x.prs?.length && Date.now() - new Date(x.date) < 14 * DAY);
  if (recentPR) {
    const pr = recentPR.prs[0];
    out.push({ icon: 'trophy', text: `Récord reciente en ${exById(pr.ex).name} (${pr.type.toLowerCase()}): ${pr.value}.` });
  }
  const goalWeeks = weeksMeetingGoal();
  if (goalWeeks >= 2) out.push({ icon: 'flame', text: `Llevas ${goalWeeks} semanas seguidas cumpliendo tu meta.` });

  // Tendencia de fuerza en tu ejercicio más frecuente.
  const counts = {};
  s.forEach(x => new Set(x.sets.map(y => y.ex)).forEach(ex => { counts[ex] = (counts[ex] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) {
    const h = exHistory(top[0]).map(x => Math.max(...x.sets.map(e1rm))).filter(Boolean);
    if (h.length >= 3 && h[h.length - 1] > h[0]) {
      out.push({ icon: 'bolt', text: `Tu fuerza estimada en ${exById(top[0]).name} subió ${Math.round((h[h.length - 1] / h[0] - 1) * 100)}% desde que empezaste.` });
    }
  }
  if (s.length >= 4) {
    const lastHit = {};
    s.forEach(x => x.sets.forEach(y => (exById(y.ex).muscles || []).slice(0, 2).forEach(m => { lastHit[m] = new Date(x.date).getTime(); })));
    const stale = ['piernas', 'gluteos', 'espalda', 'hombros', 'pecho', 'core']
      .map(m => [m, Math.floor((Date.now() - (lastHit[m] || 0)) / DAY)]).filter(([, d]) => d >= 8).sort((a, b) => b[1] - a[1])[0];
    if (stale) out.push({ icon: 'info', text: stale[1] > 60 ? `Todavía no trabajaste ${MUSCLES[stale[0]].toLowerCase()}. Prueba una rutina que lo incluya.` : `Hace ${stale[1]} días que no trabajas ${MUSCLES[stale[0]].toLowerCase()}.` });
  }
  const lu = levelUpSuggestion();
  if (lu) out.push({ icon: 'spark', text: lu, action: 'level-up' });
  return out;
}

function levelUpSuggestion() {
  const L = level();
  if (L >= 3) return null;
  const recent = db.sessions.filter(x => Date.now() - new Date(x.date) < 42 * DAY);
  const efforts = recent.filter(x => x.effort);
  const avg = efforts.length ? efforts.reduce((a, x) => a + x.effort, 0) / efforts.length : 10;
  return recent.length >= 12 && avg <= 7 ? `Llevas ${recent.length} sesiones en 6 semanas y te resultan manejables: ¿probamos nivel ${LEVELS[L + 1].name}?` : null;
}

const ACHIEVEMENTS = [
  { id: 'first', icon: 'play', name: 'Primer paso', desc: 'Completa tu primera sesión', test: st => st.sessions >= 1 },
  { id: 's5', icon: 'kb', name: 'En marcha', desc: '5 sesiones', test: st => st.sessions >= 5 },
  { id: 's10', icon: 'kb', name: 'Constante', desc: '10 sesiones', test: st => st.sessions >= 10 },
  { id: 's25', icon: 'medal', name: 'Hábito', desc: '25 sesiones', test: st => st.sessions >= 25 },
  { id: 's50', icon: 'medal', name: 'Imparable', desc: '50 sesiones', test: st => st.sessions >= 50 },
  { id: 's100', icon: 'trophy', name: 'Centenario', desc: '100 sesiones', test: st => st.sessions >= 100 },
  { id: 'st3', icon: 'flame', name: 'Racha de 3', desc: '3 días seguidos', test: st => st.streak >= 3 },
  { id: 'st7', icon: 'flame', name: 'Racha de 7', desc: '7 días seguidos', test: st => st.streak >= 7 },
  { id: 'w4', icon: 'calendar', name: 'Mes cumplido', desc: '4 semanas seguidas cumpliendo tu meta', test: st => st.goalWeeks >= 4 },
  { id: 't1', icon: 'scale', name: 'Una tonelada', desc: 'Levanta 1.000 kg en total', test: st => st.volume >= 1000 },
  { id: 't10', icon: 'scale', name: 'Diez toneladas', desc: 'Levanta 10.000 kg en total', test: st => st.volume >= 10000 },
  { id: 't50', icon: 'scale', name: 'Cincuenta toneladas', desc: 'Levanta 50.000 kg en total', test: st => st.volume >= 50000 },
  { id: 'pr1', icon: 'trophy', name: 'Récord', desc: 'Consigue tu primer récord personal', test: st => st.prs >= 1 },
  { id: 'pr10', icon: 'trophy', name: 'Máquina de récords', desc: '10 récords personales', test: st => st.prs >= 10 },
  { id: 'ex15', icon: 'layers', name: 'Explorador', desc: 'Prueba 15 ejercicios distintos', test: st => st.exercises >= 15 },
  { id: 'early', icon: 'clock', name: 'Madrugador', desc: 'Entrena antes de las 8 de la mañana', test: st => st.early },
  { id: 'long', icon: 'timer', name: 'Maratón', desc: 'Una sesión de 45 minutos o más', test: st => st.longest >= 45 * 60 },
];

function achievementStats() {
  const s = db.sessions;
  return {
    sessions: s.length,
    streak: longestStreak(),
    goalWeeks: weeksMeetingGoal(),
    volume: s.reduce((a, x) => a + sessionVolume(x), 0),
    prs: s.reduce((a, x) => a + (x.prs?.length || 0), 0),
    exercises: new Set(s.flatMap(x => x.sets.map(y => y.ex))).size,
    early: s.some(x => new Date(x.date).getHours() < 8),
    longest: Math.max(0, ...s.map(x => x.duration || 0)),
  };
}
