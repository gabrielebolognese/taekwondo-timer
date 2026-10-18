// Web Audio beeps and the start whistle. iOS only lets audio start inside a user gesture, so the
// context is created and resumed on taps (see installAudioUnlock), then sounds can play from timers.

import { primeSpeech } from './voice';

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
  primeSpeech();
}

export function installAudioUnlock() {
  for (const type of ['touchend', 'click', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/** Plays now, or right after the context wakes up (the first tap resumes it asynchronously). */
function play(fn: (c: AudioContext) => void) {
  const c = ctx;
  if (!c) return;
  if (c.state === 'running') fn(c);
  else void c.resume().then(() => fn(c)).catch(() => {});
}

export function beep(kind: 'short' | 'long') {
  play((c) => tone(c, kind));
}

function tone(c: AudioContext, kind: 'short' | 'long') {
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

/** A referee's pea whistle: two close tones with a fast trill and a little breath noise. */
export function whistle() {
  play(blow);
}

function blow(c: AudioContext) {
  const t = c.currentTime;
  const dur = 0.55;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
  out.gain.setValueAtTime(0.55, t + dur - 0.09);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(c.destination);

  // The pea rattling: wobble both pitch and loudness about 28 times a second.
  const trill = c.createOscillator();
  trill.frequency.value = 28;
  const pitchWobble = c.createGain();
  pitchWobble.gain.value = 160;
  const levelWobble = c.createGain();
  levelWobble.gain.value = 0.35;
  const level = c.createGain();
  level.gain.value = 0.65;
  trill.connect(pitchWobble);
  trill.connect(levelWobble).connect(level.gain);
  level.connect(out);

  for (const [freq, gain] of [[2950, 1], [3180, 0.45]] as const) {
    const osc = c.createOscillator();
    osc.frequency.value = freq;
    pitchWobble.connect(osc.frequency);
    const g = c.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(level);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const noise = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const breath = c.createBufferSource();
  breath.buffer = noise;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3000;
  band.Q.value = 1.5;
  const bg = c.createGain();
  bg.gain.value = 0.12;
  breath.connect(band).connect(bg).connect(out);
  breath.start(t);
  trill.start(t);
  trill.stop(t + dur + 0.02);
}
