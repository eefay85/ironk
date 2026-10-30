// Sincronización con Supabase: tu historial se guarda en la nube y se combina entre dispositivos.
// Cada dispositivo conserva su copia local (funciona sin internet) y al sincronizar se unen ambas:
// sesiones y registros de peso se suman, lo borrado se recuerda para no reaparecer, y para el
// perfil y las pesas gana el cambio más reciente.

function mergeDb(local, remote) {
  if (!remote) return local;
  const norm = d => {
    const x = Object.assign(structuredClone(EMPTY_DB), d);
    x.meta = x.meta || {}; x.deleted = x.deleted || [];
    return x;
  };
  const L = norm(local), R = norm(remote);
  const resetAt = Math.max(L.meta.resetAt || 0, R.meta.resetAt || 0);
  const alive = t => !resetAt || t > resetAt;
  const deleted = [...new Set([...L.deleted, ...R.deleted])];
  const gone = new Set(deleted);

  const byId = (a, b, stamp = () => 0) => {
    const m = new Map();
    [...a, ...b].forEach(x => { const prev = m.get(x.id); if (!prev || stamp(x) > stamp(prev)) m.set(x.id, x); });
    return [...m.values()];
  };
  const time = d => new Date(d).getTime();

  const sessions = byId(L.sessions, R.sessions)
    .filter(s => !gone.has(s.id) && alive(time(s.date)))
    .sort((a, b) => time(a.date) - time(b.date));
  const customRoutines = byId(L.customRoutines, R.customRoutines, r => r.updatedAt || 0)
    .filter(r => !gone.has(r.id) && alive(r.updatedAt || 0));

  const body = new Map();
  [...L.bodyLog, ...R.bodyLog].forEach(b => {
    const k = dayKey(b.date), prev = body.get(k);
    if (!prev || time(b.date) > time(prev.date)) body.set(k, b);
  });
  const bodyLog = [...body.values()].filter(b => alive(time(b.date))).sort((a, b) => time(a.date) - time(b.date));

  const ls = L.meta.settingsAt || 0, rs = R.meta.settingsAt || 0;
  let src = ls >= rs ? L : R;
  if (!src.profile) src = src === L ? R : L;
  const settingsAt = Math.max(ls, rs);
  const wiped = resetAt && settingsAt < resetAt;

  return {
    profile: wiped ? null : src.profile, bells: wiped ? [] : src.bells,
    customRoutines, sessions, bodyLog, deleted, meta: { settingsAt, resetAt },
  };
}

const AUTH_ERRORS = {
  'Invalid login credentials': 'Email o contraseña incorrectos.',
  'Email not confirmed': 'Confirma tu email (revisa tu correo) y vuelve a entrar.',
  'User already registered': 'Ya existe una cuenta con ese email. Usa "Entrar".',
  'Password should be at least 6 characters.': 'La contraseña debe tener al menos 6 caracteres.',
};
const authError = e => AUTH_ERRORS[e?.message] || e?.message || 'Algo salió mal.';

window.Sync = {
  client: null, user: null, state: 'out', lastSync: null, message: '',
  timer: null, running: false, again: false,

  configured() { return !!(window.IRONK_CONFIG?.supabaseUrl && window.IRONK_CONFIG?.supabaseKey && window.supabase); },

  async init() {
    if (!this.configured()) return;
    this.client = window.supabase.createClient(IRONK_CONFIG.supabaseUrl, IRONK_CONFIG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ironk-auth' },
    });
    const { data } = await this.client.auth.getSession();
    this.user = data.session?.user || null;
    this.client.auth.onAuthStateChange((_e, session) => { this.user = session?.user || null; });
    this.state = this.user ? 'idle' : 'out';
    window.addEventListener('online', () => this.sync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync(); });
    if (['profile', 'login', 'onboarding'].includes(route.name)) render();
    if (this.user) this.sync();
  },

  schedule() {
    if (!this.user) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 1500);
  },

  async sync() {
    if (!this.user || !navigator.onLine) return;
    if (this.running) { this.again = true; return; }
    this.running = true; this.state = 'syncing'; this.refresh();
    try {
      const { data: row, error } = await this.client.from('ironk_state').select('data').eq('user_id', this.user.id).maybeSingle();
      if (error) throw error;
      const merged = mergeDb(db, row?.data || null);
      const { error: upErr } = await this.client.from('ironk_state')
        .upsert({ user_id: this.user.id, data: merged, updated_at: new Date().toISOString() });
      if (upErr) throw upErr;
      const before = JSON.stringify(db);
      db = mergeDb(db, merged); // incluye lo que haya cambiado aquí mientras tanto
      saveDb({ silent: true });
      this.state = 'ok'; this.lastSync = new Date(); this.message = '';
      if (JSON.stringify(db) !== before) this.rerender();
    } catch (e) {
      this.state = 'error'; this.message = e.message || String(e);
    }
    this.running = false; this.refresh();
    if (this.again) { this.again = false; this.sync(); }
  },

  // Redibuja con los datos nuevos, salvo que estés escribiendo o en medio de un entrenamiento.
  rerender() {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (route.name === 'login' && profileComplete()) return tab('home');
    if (!typing && !['run', 'free', 'summary', 'builder', 'onboarding'].includes(route.name)) render();
  },

  async signIn(email, password) {
    this.state = 'busy'; this.message = ''; this.refresh();
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) { this.state = 'out'; this.message = authError(error); return this.refresh(); }
    this.user = data.user;
    await this.sync();
    if (route.name === 'login' && profileComplete()) tab('home'); else render();
    toast('Sesión iniciada');
  },

  async signUp(email, password) {
    this.state = 'busy'; this.message = ''; this.refresh();
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) { this.state = 'out'; this.message = authError(error); return this.refresh(); }
    if (!data.session) {
      this.state = 'out';
      this.message = 'Te enviamos un email para confirmar la cuenta. Confírmala y después toca "Entrar".';
      return this.refresh();
    }
    this.user = data.user;
    await this.sync();
    render(); toast('Cuenta creada');
  },

  async signOut() {
    await this.client.auth.signOut();
    this.user = null; this.state = 'out'; this.message = '';
    render(); toast('Sesión cerrada. Tus datos siguen en este dispositivo.');
  },

  statusHtml() {
    const t = this.lastSync ? this.lastSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
    if (this.state === 'busy') return '<span class="muted">Conectando…</span>';
    if (this.state === 'syncing') return `<span class="muted">${icon('refresh', 15)} Sincronizando…</span>`;
    if (this.state === 'ok') return `<span class="ok-text">${icon('check', 15)} Sincronizado a las ${t}</span>`;
    if (this.state === 'error') return `<span class="err-text">No se pudo sincronizar: ${esc(this.message)}</span>`;
    if (this.user && !navigator.onLine) return '<span class="muted">Sin conexión: se sincroniza al volver internet</span>';
    return this.message ? `<span class="err-text">${esc(this.message)}</span>` : '';
  },

  refresh() {
    const el = document.getElementById('sync-status');
    if (el) el.innerHTML = this.statusHtml();
    document.querySelectorAll('[data-act^="sync-"]').forEach(b => { b.disabled = this.state === 'busy'; });
  },
};

Sync.init();
