// Feedback auditivo del POS via Web Audio API. No requiere assets externos
// y los tonos son instantáneos. AudioContext se inicializa lazy en el
// primer beep — en navegadores modernos puede requerir interacción previa
// del usuario, pero en el flow del POS siempre la hubo (tipear, tocar
// botón, etc), así que no hay problema de autoplay policy.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function tone(freq: number, durationMs: number, startOffsetMs = 0, volume = 0.25) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + startOffsetMs / 1000;
  const dur = durationMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Envelope con ataque/decay rápidos para evitar clicks de inicio/fin
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.setValueAtTime(volume, now + dur - 0.02);
  gain.gain.linearRampToValueAtTime(0, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// Beep agudo y corto, típico de scanner de supermercado al confirmar.
export function beepSuccess() {
  tone(1000, 90);
}

// Dos beeps graves consecutivos para indicar error/no encontrado.
export function beepError() {
  tone(400, 110, 0);
  tone(400, 110, 170);
}
