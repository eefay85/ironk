// Voz del coach: anuncia ejercicios, descansos y cuentas regresivas con la voz del sistema
// (funciona sin internet en iPhone y Windows). Se activa o desactiva en Perfil o durante la sesión.

const Voice = {
  voice: null,
  protectUntil: 0, // mientras dura la cuenta regresiva, nada la interrumpe

  on() { return !!window.speechSynthesis && db.profile?.voice !== false; },

  pickVoice() {
    const all = speechSynthesis.getVoices();
    this.voice = all.find(v => v.lang === 'es-AR') || all.find(v => v.lang === 'es-MX') || all.find(v => v.lang === 'es-US')
      || all.find(v => v.lang?.startsWith('es')) || null;
  },

  // urgent: corta lo que esté diciendo (para cuentas regresivas y cambios de fase).
  say(text, urgent = false, rate = 1.05) {
    if (!this.on() || !text) return;
    try {
      if (!this.voice) this.pickVoice();
      if (urgent && Date.now() >= this.protectUntil) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice?.lang || 'es-ES';
      if (this.voice) u.voice = this.voice;
      u.rate = rate;
      speechSynthesis.speak(u);
    } catch (e) { /* sin voz disponible */ }
  },

  // Una sola frase, con pausas, para que se escuchen los tres números aunque la voz tarde en arrancar.
  countdown() {
    this.protectUntil = 0;
    this.say('Tres... dos... uno...', true, 0.9);
    this.protectUntil = Date.now() + 3500;
  },

  stop() { this.protectUntil = 0; try { speechSynthesis.cancel(); } catch (e) { /* nada */ } },
};

if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => Voice.pickVoice();

// Números en palabras para que la voz no los lea raro ("15 s" → "15 segundos").
function spokenTarget(s) {
  if (s.secs) return `${s.secs * (s.side ? 2 : 1)} segundos${s.side ? ', cambia de lado a la mitad' : ''}`;
  return `${s.reps} repeticiones${s.side ? ' por lado' : ''}`;
}
