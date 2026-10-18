// Spoken coaching through the browser's speech synthesis. Settings stay on this device:
// "voiceOn" (default on) and "voiceName" (null = the system's English voice).

import { load } from './storage';

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

export const voiceSupported = () => !!synth();
export const voiceOn = () => load<boolean>('voiceOn', true);

let primed = false;

/** iOS only lets speech start inside a tap; one silent utterance there unlocks it for timers. */
export function primeSpeech() {
  const s = synth();
  if (primed || !s) return;
  primed = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  s.speak(u);
}

export function englishVoices(): SpeechSynthesisVoice[] {
  return (synth()?.getVoices() ?? []).filter((v) => /^en(-|_|$)/i.test(v.lang));
}

/** Calls back when the voice list arrives (it loads late in some browsers). */
export function onVoicesChanged(fn: () => void): () => void {
  const s = synth();
  if (!s) return () => {};
  s.addEventListener('voiceschanged', fn);
  return () => s.removeEventListener('voiceschanged', fn);
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = englishVoices();
  const name = load<string | null>('voiceName', null);
  return (name && voices.find((v) => v.name === name)) || voices.find((v) => v.default) || undefined;
}

let pendingTimer = 0;

/** Says `text`, cutting off anything still being said. `delayMs` leaves room for a whistle or beep. */
export function say(text: string, delayMs = 0, force = false) {
  const s = synth();
  if (!s || !text || (!force && !voiceOn())) return;
  window.clearTimeout(pendingTimer);
  const go = () => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = 1.02;
    // Safari can drop an utterance queued in the same moment as cancel(), so give it a beat.
    if (s.speaking || s.pending) {
      s.cancel();
      pendingTimer = window.setTimeout(() => s.speak(u), 80);
    } else {
      s.speak(u);
    }
  };
  if (delayMs > 0) pendingTimer = window.setTimeout(go, delayMs);
  else go();
}

export function hush() {
  window.clearTimeout(pendingTimer);
  synth()?.cancel();
}

if (typeof document !== 'undefined') {
  // Leaving the app mid-sentence can leave iOS speech stuck; start clean when coming back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hush();
  });
}
