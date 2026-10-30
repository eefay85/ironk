// "Entrenador" de IronK: adapta rutinas a tu nivel, sugiere pesos con progresión,
// elige el entrenamiento del día, calcula recuperación, récords, logros e ideas.
// Usa `db` (definido en app.js) en tiempo de llamada.

const DAY = 864e5;
const LOAD_RATIO = { light: 0.45, medium: 0.65, heavy: 1, max: 1.2 };
// Descanso entre series: "auto" usa el de cada rutina (adaptado a tu nivel); el resto es un valor fijo.
const REST_MODES = {
  auto: { name: 'Recomendado', secs: null },
  corto: { name: '15 s', secs: 15 },
  medio: { name: '30 s', secs: 30 },
  largo: { name: '1 min', secs: 60 },
};

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
    if (b.amrap) return; // el AMRAP corre con su propio modo (ver startAmrap)
    if (b.ladder) {
      b.ladder.forEach((rung, k) => b.circuit.forEach((it, j) => steps.push({
        ...it, reps: rung, label: `Escalón ${k + 1}/${b.ladder.length}`,
        rest: j === b.circuit.length - 1 ? (b.rest ?? 30) : 0,
      })));
    } else if (b.circuit) {
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
    if (s.emom) return a + s.emom;
    const work = (s.secs || (s.reps || 0) * 3.5) * (s.side ? 2 : 1);
    return a + work + (s.rest || 0) + (s.autoStart ? 0 : 12);
  }, 0) + r.blocks.reduce((a, b) => a + (b.amrap || 0) * 60, 0);
  return Math.max(5, Math.round(sec / 60));
}

const isAmrap = r => r.blocks.some(b => b.amrap);

function routineItems(r) {
  const out = [];
  r.blocks.forEach(b => (b.circuit || [b]).forEach(it => out.push({
    ...it, sets: b.circuit ? (b.ladder ? b.ladder.length : b.rounds) : it.sets, circuit: !!b.circuit && !b.ladder,
    ladder: b.ladder, amrap: b.amrap, emom: b.emom, autoStart: b.autoStart,
  })));
  return out;
}

// Texto de cada ejercicio en el detalle de rutina ("4 × 6 reps", "Escalera 1→5", "AMRAP 15 min"...).
function itemText(it) {
  const side = it.side ? ' por lado' : '';
  if (it.amrap) return `${it.reps} reps${side} · ronda tras ronda`;
  if (it.ladder) return `Escalera ${it.ladder[0]}→${it.ladder[it.ladder.length - 1]} reps${side}`;
  if (it.emom) return `${it.sets} min · ${it.reps} reps${side} al inicio de cada minuto`;
  if (it.autoStart) return `${it.sets} × ${it.secs} s a tope · ${it.rest} s pausa`;
  return `${it.sets} × ${it.secs ? `${it.secs} s` : `${it.reps} rep${it.reps === 1 ? '' : 's'}`}${side}`;
}

function mainMuscles(r, n = 3) {
  const score = {};
  routineItems(r).forEach(it => (exById(it.ex).muscles || []).forEach((m, i) => { score[m] = (score[m] || 0) + (i === 0 ? 2 : 1) * (it.sets || 1); }));
  return Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, n).map(([m]) => m);
}

// ¿Tiene al menos un par de pesas iguales? (habilita los ejercicios dobles)
const hasPair = () => db.bells.some(b => b.qty >= 2);

function routineFits(r) {
  const L = level();
  return (r.minLevel || 1) <= L && L <= (r.maxLevel || 3) && (!r.needsPair || hasPair());
}

// Cómo se adapta el plan a las pesas que tienes.
function equipmentNote() {
  const n = new Set(db.bells.map(b => b.weight)).size;
  if (hasPair()) return 'Tienes un par de pesas iguales: tu plan incluye ejercicios dobles cuando tu nivel lo permite.';
  if (n === 1) return 'Con una sola pesa progresas sumando repeticiones y series cada 2 semanas. Los ejercicios dobles se hacen con una pesa.';
  return 'Sin un par de pesas iguales, los ejercicios dobles se cambian por su versión con una pesa. Subirás de pesa cuando completes el rango de repeticiones.';
}

// Ajusta series, descansos y ejercicios a tu nivel, edad y tiempo disponible.
function adaptRoutine(r) {
  const p = db.profile, L = level(), notes = [];
  // Baja a la variante más fácil si no es tu nivel, o a la de una pesa si no tienes un par.
  const pair = hasPair();
  const swap = id => {
    let ex = exById(id), guard = 0;
    while ((ex.level > L || (ex.double && !pair)) && ex.easier && guard++ < 3) ex = exById(ex.easier);
    return ex;
  };
  const restBonus = (L === 1 ? 15 : L === 3 ? -10 : 0) + (p.age >= 50 ? 15 : 0);
  // Preferencia de descanso del usuario (Perfil o detalle de rutina): se aplica a todas las rutinas.
  // Los descansos en 0 (ejercicios encadenados de un circuito) se respetan.
  const fixed = REST_MODES[p.rest]?.secs;
  const scaleRest = s => s && fixed ? fixed : s;
  let progressed = 0;
  const adj = (it, inCircuit) => {
    let out = { ...it };
    const ex = r.custom && (!exById(it.ex).double || pair) ? exById(it.ex) : swap(it.ex);
    if (ex.id !== it.ex) {
      notes.push(`${exById(it.ex).name} → ${ex.name}`);
      out.ex = ex.id;
      out.side = !!ex.uni;
    }
    out = progressItem(out);
    if (out.prog) progressed++;
    if (!inCircuit && !r.custom && !it.autoStart) {
      if (L === 1 && out.sets >= 3) out.sets -= 1;
      if (L === 3 && out.sets >= 3 && out.sets < 8) out.sets += 1;
    }
    if (it.fixedRest) return out; // EMOM y Tabata tienen su propio ritmo
    if (out.rest && !r.custom) out.rest = Math.max(inCircuit ? 10 : 20, out.rest + restBonus);
    out.rest = scaleRest(out.rest);
    return out;
  };
  let blocks = r.blocks.map(b => {
    if (b.amrap) return { ...b, amrap: r.custom ? b.amrap : Math.max(8, b.amrap + (L === 1 ? -3 : L === 3 ? 3 : 0)), circuit: b.circuit.map(it => adj(it, true)) };
    if (b.ladder) return { ...b, rest: scaleRest(b.rest), circuit: b.circuit.map(it => adj(it, true)) };
    if (b.circuit) return { ...b, rounds: r.custom ? b.rounds : Math.max(2, b.rounds + (L === 1 ? -1 : L === 3 ? 1 : 0)), restRound: scaleRest((b.restRound ?? 60) + (r.custom ? 0 : Math.max(0, restBonus))), circuit: b.circuit.map(it => adj(it, true)) };
    return adj(b, false);
  });

  if (progressed) notes.unshift(`Progresión: más repeticiones en ${progressed === 1 ? '1 ejercicio' : `${progressed} ejercicios`}`);

  // Programa de 8 semanas: más o menos volumen según la semana.
  const wk = programWeek();
  if (wk && !wk.done && !r.custom && wk.vol !== 1) {
    blocks = blocks.map(b => {
      if (b.amrap) return { ...b, amrap: Math.max(8, Math.round(b.amrap * wk.vol)) };
      if (b.ladder || b.autoStart) return b;
      if (b.circuit) return { ...b, rounds: Math.max(2, Math.round(b.rounds * wk.vol)) };
      return { ...b, sets: Math.max(1, Math.round(b.sets * wk.vol)) };
    });
    notes.push(`Semana ${wk.n} de 8 · ${wk.name}`);
  }

  // Recortar para que entre en el tiempo que elegiste.
  const target = (p.minutes || 30) * Math.max(1, wk && !wk.done ? wk.vol : 1);
  let trimmed = false;
  for (let guard = 0; guard < 30 && !r.custom; guard++) {
    if (estimateMin({ blocks }) <= target * 1.15) break;
    let best = null;
    blocks.forEach(b => {
      if (b.amrap || b.ladder || b.autoStart) return;
      const n = b.circuit ? b.rounds : b.sets;
      if (n > 2 && (!best || n > (best.circuit ? best.rounds : best.sets))) best = b;
    });
    if (!best) break;
    if (best.circuit) best.rounds--; else best.sets--;
    trimmed = true;
  }
  if (trimmed) notes.push(`Ajustada a tus ${p.minutes || 30} min`);
  return { ...r, blocks, notes: [...new Set(notes)] };
}

// ---------- "¿Cómo te sientes hoy?" ----------

// c: { energy: 'baja'|'normal'|'alta', sleep: 'mal'|'regular'|'bien', pains: ['hombro', ...] }
function applyCheckin(r, c) {
  if (!c) return { routine: r, notes: [], weightDown: false };
  const notes = [];
  const tired = c.energy === 'baja' || c.sleep === 'mal';
  const veryTired = c.energy === 'baja' && c.sleep === 'mal';
  const swapFor = id => {
    for (const p of c.pains || []) {
      const map = PAIN_SWAPS[p] || {};
      if (id in map) return { to: map[id], pain: p };
    }
    return null;
  };
  const fixItem = it => {
    const s = swapFor(it.ex);
    if (!s) return it;
    notes.push(s.to ? `${exById(it.ex).name} → ${exById(s.to).name} (${PAINS[s.pain].toLowerCase()})` : `Sin ${exById(it.ex).name.toLowerCase()} (${PAINS[s.pain].toLowerCase()})`);
    return s.to ? { ...it, ex: s.to, side: !!exById(s.to).uni } : null;
  };
  let blocks = r.blocks.map(b => {
    if (b.circuit) {
      const circuit = b.circuit.map(fixItem).filter(Boolean);
      if (!circuit.length) return null;
      const nb = { ...b, circuit };
      if (tired && b.rounds) nb.rounds = Math.max(2, Math.round(b.rounds * 0.75));
      if (tired && b.amrap) nb.amrap = Math.max(8, Math.round(b.amrap * 0.75));
      return nb;
    }
    const nb = fixItem(b);
    if (!nb) return null;
    if (tired && !nb.autoStart) nb.sets = Math.max(Math.min(2, nb.sets), Math.round(nb.sets * 0.75));
    return nb;
  }).filter(Boolean);
  if (tired) notes.unshift(veryTired ? 'Día de poca energía: menos volumen y una pesa más liviana' : 'Menos volumen para que llegues bien');
  if (c.energy === 'alta' && c.sleep === 'bien') notes.unshift('¡Gran día! Buen momento para buscar un récord');
  if ((c.pains || []).length) notes.push('Si el dolor es fuerte o no mejora, consulta a un profesional.');
  return { routine: { ...r, blocks }, notes, weightDown: veryTired };
}

// ---------- Calentamiento y vuelta a la calma ----------

function withWarmupCooldown(steps, r) {
  if (db.profile.warmup === false || !steps.length) return steps;
  const warm = WARMUP.map((w, i) => ({
    ...w, autoStart: true, noLog: true, phase: 'warmup', label: `Calentamiento ${i + 1}/${WARMUP.length}`,
    rest: i === WARMUP.length - 1 ? 20 : 5,
  }));
  const cool = [...new Set(mainMuscles(r, 4).map(m => COOLDOWN_FOR[m]).filter(Boolean))].slice(0, 3);
  if (!cool.includes('st-isquios') && cool.length < 3) cool.push('st-isquios');
  const coolSteps = cool.map((ex, i) => ({
    ex, secs: 30, side: ex === 'st-cadera', autoStart: true, noLog: true, phase: 'cooldown',
    label: `Estiramiento ${i + 1}/${cool.length}`, rest: i === cool.length - 1 ? 0 : 5,
  }));
  const main = steps.map((s, i) => i === steps.length - 1 ? { ...s, rest: 15 } : s);
  return [...warm, ...main, ...coolSteps];
}

// ---------- Entrenamiento rápido ----------

const QUICK_FOCUS = {
  completo: { name: 'Cuerpo completo', test: () => true },
  superior: { name: 'Tren superior', test: e => ['Hombros', 'Pecho', 'Espalda'].includes(e.group) && e.type !== 'Movilidad' },
  inferior: { name: 'Tren inferior', test: e => ['Cadera', 'Piernas'].includes(e.group) },
  core: { name: 'Core', test: e => e.group === 'Core' },
  cardio: { name: 'Cardio', test: e => e.type === 'Balístico' || ['swing2', 'goblet', 'pushup', 'russiantwist'].includes(e.id) },
};

// Arma un circuito con ejercicios de tu nivel y la pesa elegida, para los minutos que tienes.
function generateQuick({ minutes = 15, focus = 'completo', bell = null } = {}) {
  const L = level();
  const pairs = db.bells.some(b => b.qty >= 2);
  const pool = EXERCISES.filter(e => e.type !== 'Estiramiento' && e.level <= L && (!e.double || (pairs && !bell))
    && e.type !== 'Carga' && QUICK_FOCUS[focus].test(e));
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const picked = [];
  for (const e of shuffled) {
    if (picked.length >= 4) break;
    if (picked.some(p => p.group === e.group) && shuffled.length > 6 && focus === 'completo') continue;
    picked.push(e);
  }
  for (const e of shuffled) { if (picked.length >= 4) break; if (!picked.includes(e)) picked.push(e); }
  const circuit = picked.map(e => ({
    ex: e.id, side: !!e.uni, rest: 15,
    ...(e.type === 'Core' && !['russiantwist'].includes(e.id) ? { secs: 30 } : { reps: e.type === 'Balístico' ? 12 : e.uni ? 6 : 10 }),
  }));
  const r = { id: 'quick', custom: true, quick: true, name: `Rápido · ${QUICK_FOCUS[focus].name}`, goal: goalsOf()[0], bell,
    desc: `${minutes} minutos${bell ? ` con una pesa de ${bell} kg` : ''}.`, blocks: [{ circuit, rounds: 1, restRound: 45 }] };
  const perRound = circuit.reduce((a, s) => a + (s.secs || s.reps * 3.5) * (s.side ? 2 : 1) + s.rest + 12, 0) + 45;
  r.blocks[0].rounds = Math.max(2, Math.min(10, Math.round((minutes * 60) / perRound)));
  return r;
}

// ---------- Programa de 8 semanas ----------

function programWeek(p = db.profile) {
  if (!p?.program?.start) return null;
  const idx = Math.floor((Date.now() - new Date(p.program.start).getTime()) / (7 * DAY));
  if (idx >= PROGRAM_WEEKS.length) return { done: true, n: idx + 1 };
  return { n: idx + 1, ...PROGRAM_WEEKS[Math.max(0, idx)] };
}

// ---------- Calorías y puntos ----------

// Calorías ≈ MET × peso corporal × horas, ajustado por el esfuerzo que marcaste.
function estimateKcal(sets, durationSec, effort, bodyKg = db.profile?.weight || 75) {
  const counted = sets.filter(s => !s.noLog);
  const met = counted.length
    ? counted.reduce((a, s) => a + (MET_BY_TYPE[exById(s.ex).type] || 6), 0) / counted.length
    : 6;
  return Math.round(met * bodyKg * (durationSec / 3600) * (0.8 + (effort || 7) * 0.03));
}
const sessionKcal = s => s.kcal ?? estimateKcal(s.sets, s.duration || 0, s.effort);

function sessionXp(s) { return Math.round((s.duration || 0) / 60) + s.sets.length * 2 + (s.prs?.length || 0) * 25; }
function totalXp() {
  return db.sessions.reduce((a, s) => a + sessionXp(s), 0) + (db.tests || []).length * 20 + challengesDone().length * 200;
}
function rankInfo(xp = totalXp()) {
  let i = 0;
  while (i < RANKS.length - 1 && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  return { xp, rank: cur.name, idx: i, next: next?.name, toNext: next ? next.xp - xp : 0, pct: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

// ---------- Tests ----------

function testsFor() { return TESTS.filter(t => (t.minLevel || 1) <= level()); }
function testHistory(id) { return (db.tests || []).filter(t => t.test === id).sort((a, b) => new Date(a.date) - new Date(b.date)); }
function testDue() {
  const all = db.tests || [];
  const last = all.length ? Math.max(...all.map(t => new Date(t.date).getTime())) : 0;
  const wk = programWeek();
  if (wk && wk.test) return true;
  return db.sessions.length >= 4 && Date.now() - last > 28 * DAY;
}

// ---------- Desafíos mensuales ----------

const monthKey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function monthSessions(key) { return db.sessions.filter(s => monthKey(s.date) === key); }

function challengeProgress(ch, key = monthKey()) {
  const list = monthSessions(key);
  switch (ch.measure) {
    case 'reps': return list.reduce((a, s) => a + s.sets.filter(x => ch.exs.includes(x.ex)).reduce((b, x) => b + (x.reps || 0) * (x.side ? 2 : 1), 0), 0);
    case 'sessions': return list.length;
    case 'days': return new Set(list.map(s => dayKey(s.date))).size;
    case 'volume': return Math.round(list.reduce((a, s) => a + sessionVolume(s), 0));
    case 'kcal': return list.reduce((a, s) => a + sessionKcal(s), 0);
    default: return 0;
  }
}
const joinedChallenges = (key = monthKey()) => (db.challenges || []).filter(c => c.month === key).map(c => CHALLENGES.find(x => x.id === c.ch)).filter(Boolean);
function challengesDone() {
  return (db.challenges || []).filter(c => {
    const ch = CHALLENGES.find(x => x.id === c.ch);
    return ch && challengeProgress(ch, c.month) >= ch.target;
  });
}

// ---------- Resumen del mes ----------

function monthStats(key) {
  const list = monthSessions(key);
  const weeks = {};
  list.forEach(s => { const w = weekStart(s.date).getTime(); weeks[w] = (weeks[w] || 0) + sessionVolume(s); });
  const exCount = {};
  list.forEach(s => s.sets.filter(x => !x.noLog).forEach(x => { exCount[x.ex] = (exCount[x.ex] || 0) + 1; }));
  const topEx = Object.entries(exCount).sort((a, b) => b[1] - a[1])[0];
  const days = [...new Set(list.map(s => dayKey(s.date)))].sort();
  let streak = 0, cur = 0, prev = null;
  days.forEach(k => { const t = new Date(k + 'T12:00').getTime(); cur = prev && Math.round((t - prev) / DAY) === 1 ? cur + 1 : 1; streak = Math.max(streak, cur); prev = t; });
  return {
    sessions: list.length, days: days.length, volume: list.reduce((a, s) => a + sessionVolume(s), 0),
    time: list.reduce((a, s) => a + (s.duration || 0), 0), kcal: list.reduce((a, s) => a + sessionKcal(s), 0),
    prs: list.flatMap(s => s.prs || []), bestWeek: Math.max(0, ...Object.values(weeks)), topEx: topEx ? exById(topEx[0]).name : null,
    streak, xp: list.reduce((a, s) => a + sessionXp(s), 0),
  };
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

// ---------- Progresión doble: primero repeticiones, después peso ----------
// Cada ~2 semanas, si en al menos 2 sesiones completaste todo con margen (esfuerzo ≤ 7),
// sube un "escalón": más reps (o +5 s en ejercicios por tiempo). Tras 3 escalones con la
// misma pesa, toca la pesa siguiente y las reps vuelven a la base. Sin pesa más pesada
// (o sin pesa), se sigue sumando reps hasta 6 escalones.

const PROG = { stepDays: 13, sessionsPerStep: 2, stepsPerBell: 3, maxSteps: 6 };
const repInc = base => Math.max(1, Math.round(base * 0.15));

let progCache = { key: '', map: {} };
function progression(exId) {
  const key = `${db.sessions.length}:${db.sessions[db.sessions.length - 1]?.id}:${db.bells.map(b => b.weight + 'x' + b.qty).join()}`;
  if (progCache.key !== key) progCache = { key, map: {} };
  if (progCache.map[exId]) return progCache.map[exId];

  const ex = exById(exId), list = ex.load === 'none' ? [] : bellsFor(ex);
  const st = { steps: 0, weight: null, pendingUp: false, nextWeight: null, good: 0, lastStep: null, sessions: 0 };
  exHistory(exId).forEach(h => {
    const t = new Date(h.date).getTime();
    const hw = Math.max(...h.sets.map(s => s.weight || 0));
    st.sessions++;
    if (st.weight === null) { st.weight = hw; st.lastStep = t; }
    if (hw > st.weight) { Object.assign(st, { weight: hw, steps: 0, good: 0, lastStep: t, pendingUp: false }); return; }
    if (hw < st.weight) { st.weight = hw; st.pendingUp = false; return; } // bajó de pesa: conserva las reps ganadas
    const ok = hitTarget(h.sets) && (h.effort || 7) <= 7;
    if (!ok) { if ((h.effort || 0) >= 9) st.good = 0; return; }
    st.good++;
    if (st.good >= PROG.sessionsPerStep && t - st.lastStep >= PROG.stepDays * DAY && !st.pendingUp) {
      const heavier = list.find(b => b > st.weight);
      if (st.steps >= PROG.stepsPerBell && heavier) { st.pendingUp = true; st.nextWeight = heavier; }
      else if (st.steps < PROG.maxSteps) st.steps++;
      st.lastStep = t; st.good = 0;
    }
  });
  // Escalones que se aplican a la próxima sesión (si toca subir de pesa, las reps vuelven a la base).
  st.active = st.pendingUp ? 0 : st.steps;
  st.nextIn = st.lastStep ? Math.max(0, Math.ceil((st.lastStep + PROG.stepDays * DAY - Date.now()) / DAY)) : PROG.stepDays;
  st.goodNeeded = Math.max(0, PROG.sessionsPerStep - st.good);
  st.maxed = st.steps >= PROG.maxSteps || (st.steps >= PROG.stepsPerBell && !list.some(b => b > st.weight) && st.steps >= PROG.maxSteps);
  return (progCache.map[exId] = st);
}

// Aplica los escalones ganados a una serie: más reps, o más segundos si es por tiempo.
// Con pocas pesas (sin una más pesada) desde el 5.º escalón también suma una serie.
function progressItem(it) {
  if (!it.ex || it.autoStart || it.noLog) return it;
  const p = progression(it.ex);
  if (!p.active) return it;
  const extraSet = p.active > PROG.stepsPerBell + 1 && it.sets && !it.emom ? 1 : 0;
  const base = { ...it, prog: p.active, ...(extraSet ? { sets: it.sets + 1, extraSet } : {}) };
  if (it.reps) return { ...base, reps: it.reps + p.active * repInc(it.reps), baseReps: it.reps };
  if (it.secs) return { ...base, secs: it.secs + p.active * 5, baseSecs: it.secs };
  return it;
}

// Texto corto de qué viene en la progresión de un ejercicio.
function progressionText(exId) {
  const p = progression(exId);
  if (!p.sessions) return '';
  if (p.pendingUp) return `Completaste el rango: toca subir a ${p.nextWeight} kg`;
  if (p.steps >= PROG.maxSteps) return 'Llegaste al máximo de repeticiones: suma una pesa más pesada para seguir';
  const sessions = n => `${n} sesión${n > 1 ? 'es' : ''}`;
  if (p.nextIn === 0 && p.goodNeeded <= 1) return 'Si completas todo en la próxima sesión, suben las repeticiones';
  if (p.nextIn === 0) return `Completa ${sessions(p.goodNeeded)} con margen y suben las repeticiones`;
  return `Próximo aumento en ~${p.nextIn} día${p.nextIn > 1 ? 's' : ''}${p.goodNeeded ? `, si completas ${sessions(p.goodNeeded)} con margen` : ''}`;
}

function suggestWeight(ex) {
  if (ex.load === 'none') return { weight: 0, change: 'none' };
  const list = bellsFor(ex);
  if (!list.length) return { weight: 0, reason: 'Agrega tus pesas en Perfil', change: 'none' };
  const hist = exHistory(ex.id);
  if (!hist.length) {
    return { weight: snapBell(baseSwingKg() * (LOAD_RATIO[ex.load] || 1), list), reason: 'Sugerido según tu perfil', change: 'new' };
  }
  const p = progression(ex.id);
  const last = hist[hist.length - 1];
  const w = p.weight ?? Math.max(...last.sets.map(s => s.weight || 0));
  const atW = last.sets.filter(s => (s.weight || 0) === w);
  const bad = !hitTarget(atW) && (atW.some(s => s.target && (s.reps || 0) < s.target * 0.7) || (last.effort || 7) >= 9);
  let idx = list.indexOf(w);
  if (idx < 0) idx = list.indexOf(snapBell(w, list));

  if (p.pendingUp && p.nextWeight) {
    return { weight: p.nextWeight, reason: `Subes de ${w} a ${p.nextWeight} kg: completaste el rango de repeticiones`, change: 'up' };
  }
  if (bad && idx > 0 && p.steps === 0) {
    return { weight: list[idx - 1], reason: 'Bajamos un poco: la última vez costó demasiado', change: 'down' };
  }
  const reps = p.active ? `Reps +${p.active} escalón${p.active > 1 ? 'es' : ''} · ` : '';
  return { weight: list[idx], reason: reps + (bad ? 'La última vez costó: mismo peso y reps' : progressionText(ex.id)), change: p.active ? 'prog' : 'same' };
}

// ---------- Programa y plan del día ----------

// Objetivos elegidos (hasta 3). `goal` sigue guardando el principal por compatibilidad.
function goalsOf(p = db.profile) {
  const list = (p?.goals?.length ? p.goals : [p?.goal]).filter(g => GOALS[g]);
  return list.length ? list : ['fuerza'];
}
function goalsText(p = db.profile, sep = ' + ') { return goalsOf(p).map(g => GOALS[g]).join(sep); }

// Con varios objetivos, alterna las rutinas de cada uno: A1, B1, A2, B2...
function programRoutines() {
  const lists = goalsOf().map(g => PROGRAMS[g] || []);
  const ids = [];
  for (let i = 0; i < Math.max(...lists.map(l => l.length)); i++) lists.forEach(l => { if (l[i]) ids.push(l[i]); });
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
        : lastProg ? `Sigue tu programa: ${goalsText(p, ' y ').toLowerCase()}.` : 'Primera sesión de tu programa. ¡Vamos!';
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
  if (testDue()) out.push({ icon: 'target', text: 'Es buen momento para un test y medir cuánto mejoraste.', action: 'go-tests', label: 'Ver' });
  const prevKey = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15));
  if (new Date().getDate() <= 7 && monthSessions(prevKey).length) {
    out.push({ icon: 'spark', text: 'Tu resumen del mes pasado está listo.', action: 'go-wrapped-prev', label: 'Ver' });
  }
  joinedChallenges().forEach(ch => {
    const v = challengeProgress(ch);
    if (v < ch.target) out.push({ icon: ch.icon, text: `Desafío ${ch.name}: llevas ${v.toLocaleString('es-AR')} de ${ch.target.toLocaleString('es-AR')}.` });
  });
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
  { id: 'test1', icon: 'target', name: 'A prueba', desc: 'Haz tu primer test', test: st => st.tests >= 1 },
  { id: 'ch1', icon: 'medal', name: 'Desafío cumplido', desc: 'Completa un desafío mensual', test: st => st.challenges >= 1 },
  { id: 'ch3', icon: 'trophy', name: 'Coleccionista', desc: 'Completa 3 desafíos mensuales', test: st => st.challenges >= 3 },
  { id: 'kcal10', icon: 'heart', name: 'Horno', desc: 'Quema 10.000 calorías en total', test: st => st.kcal >= 10000 },
  { id: 'prog8', icon: 'calendar', name: 'Programa completo', desc: 'Termina el programa de 8 semanas', test: st => st.programDone },
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
    tests: (db.tests || []).length,
    challenges: challengesDone().length,
    kcal: s.reduce((a, x) => a + sessionKcal(x), 0),
    programDone: !!programWeek()?.done || !!db.profile?.programDone,
  };
}
