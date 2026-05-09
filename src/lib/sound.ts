// Feedback auditivo del POS via Web Audio API. No requiere assets externos
// y los tonos son instantáneos.
//
// AudioContext arranca en estado 'suspended' por la autoplay policy del
// browser y solo lo desbloquea un user gesture directo. Si el primer beep
// se dispara desde un callback async (ej. el callback del scanner ZXing),
// el browser NO lo cuenta como gesture y el sonido no sale.
// Por eso exportamos primeAudio() — se llama en handlers de click/submit
// directos del usuario (ej. al abrir el scanner o tipear el barcode) para
// que el context quede 'running' antes de necesitar el beep.

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

// Llamar desde un user gesture (click, submit) para desbloquear el context.
// Idempotente: si ya está running, no hace nada.
export function primeAudio() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      /* el browser puede rechazar si no es gesture; ignorar silenciosamente */
    });
  }
}

function tone(freq: number, durationMs: number, startOffsetMs = 0, volume = 0.25) {
  const ctx = getCtx();
  if (!ctx) return;
  // Si seguimos suspended (no hubo gesture todavía), intentar resume y
  // tirar el tono igual: en algunos navegadores el resume tarda un tick
  // pero el oscillator se reproduce cuando termina.
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
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
