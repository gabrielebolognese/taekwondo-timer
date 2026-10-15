// Web Audio beeps. iOS only lets audio start inside a user gesture, so the context is
// created and resumed on taps (see installAudioUnlock), then beeps can play from timers.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // A silent buffer played inside the gesture fully unlocks output on older iOS versions.
  const buffer = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx;
}

function unlock() {
  try {
    const c = context();
    if (c && c.state !== 'running') void c.resume();
  } catch {
    // Audio is optional; timers still work without it.
  }
}

export function installAudioUnlock() {
  for (const type of ['touchend', 'click', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

export function beep(kind: 'short' | 'long') {
  const c = ctx;
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  const dur = kind === 'long' ? 0.55 : 0.13;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = kind === 'long' ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.7, t + 0.012);
  gain.gain.setValueAtTime(0.7, t + dur - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
