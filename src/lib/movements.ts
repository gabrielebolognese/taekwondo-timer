// Names the movement behind an exercise, kick or EMOM cue, so the same trick adds up across months
// ("540 to ball", "EMOM: 540" and "Test: 540" are all 540 kicks). Volume keys are "r:<movement>"
// for reps and "s:<movement>" for seconds held.

export type Vol = Record<string, number>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Exercise name without notes: no brackets, nothing after the first comma. */
export const baseName = (name: string) => cap(name.replace(/^GTG \+ /i, '').replace(/\s*\([^)]*\)/g, '').split(',')[0].trim());

const KICKS: Record<string, string> = {
  roundhouse: 'Roundhouse kick',
  'side kick': 'Side kick',
  hook: 'Hook kick',
  'spinning hook': 'Spinning hook kick',
  '360 roundhouse': '360 roundhouse kick',
};

export function movement(name: string): string {
  const n = name.toLowerCase().trim();
  if (KICKS[n]) return KICKS[n];
  if (/leg raise hold/.test(n)) return 'Leg raise hold';
  const spin = /\b(360|540|720)\b/.exec(n)?.[1];
  if (spin && /tuck jump/.test(n)) return `${spin} tuck jump`;
  if (/\b720\b/.test(n)) return /spin drill/.test(n) ? '720 spin drill' : '720 kick';
  if (/\b540\b/.test(n)) return '540 kick';
  if (/\b480\b/.test(n)) return '480 kick';
  if (/tornado/.test(n)) return 'Tornado kick';
  return baseName(name);
}

/** The bracketed list in a name, e.g. "Leg raise holds (front, side, back)" gives 3 items. */
function bracketList(name: string): string[] {
  const m = /\(([^)]*)\)/.exec(name);
  return m ? m[1].split(/,\s*/).map((s) => s.trim().toLowerCase()) : [];
}

/**
 * The kicks a kick exercise is made of. Later months drop the list ("Fast kicks to ball"), so the
 * month 1 lists fill in: chambered and fast kicks are roundhouse, side kick and hook; standing
 * spin kicks are spinning hook and 360 roundhouse.
 */
export function kickList(name: string): string[] {
  const listed = bracketList(name).filter((k) => KICKS[k]);
  if (listed.length) return listed;
  if (/chambered kicks|fast kicks/i.test(name)) return ['roundhouse', 'side kick', 'hook'];
  if (/spin kicks/i.test(name)) return ['spinning hook', '360 roundhouse'];
  return [];
}

/** How many directions a "per direction" prescription covers (front, side, back unless listed). */
export function directionCount(name: string): number {
  const listed = bracketList(name).filter((d) => /^(front|side|back)$/.test(d));
  return listed.length || 3;
}

export const reps = (name: string, n: number): Vol => ({ [`r:${movement(name)}`]: n });
export const secs = (name: string, n: number): Vol => ({ [`s:${movement(name)}`]: n });

export function addVol(into: Vol, v: Vol | undefined) {
  if (!v) return into;
  for (const [k, n] of Object.entries(v)) into[k] = (into[k] ?? 0) + n;
  return into;
}
