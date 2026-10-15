// Parses training-plan.md and gtg-plan.md into src/plan.json.
// Run once with `npm run parse` after editing either markdown file, then commit the JSON.
// Throws on anything it does not understand, so nothing in the plan is silently dropped.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CircuitItem, Day, Exercise, Gtg, GtgPart, GtgSet, Month, Plan, PnfPhase, RestCat,
  TestEx, TestKey, Warmup, WarmupItem,
} from '../src/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

const WEEKDAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function fail(msg: string): never {
  throw new Error(msg);
}

// ---------- markdown helpers ----------

interface Section {
  heading: string;
  lines: string[];
}

function sections(md: string): Section[] {
  const out: Section[] = [];
  let cur: Section = { heading: '', lines: [] };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      out.push(cur);
      cur = { heading: h[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  out.push(cur);
  return out;
}

function section(all: Section[], heading: string): Section {
  return all.find((s) => s.heading.toLowerCase() === heading.toLowerCase()) ?? fail(`Missing section "## ${heading}"`);
}

/** Tables in a block of lines. Row 0 of each table is the header. */
function tables(lines: string[]): string[][][] {
  const out: string[][][] = [];
  let cur: string[][] | null = null;
  for (const l of lines) {
    if (l.startsWith('|')) {
      const cells = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      if (!cur) cur = [];
      cur.push(cells);
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const isBullet = (l: string) => /^[-*]\s+/.test(l);
const unbullet = (l: string) => l.replace(/^[-*]\s+/, '');
const unbold = (s: string) => s.replace(/\*\*/g, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const paragraphs = (lines: string[]) => lines.filter((l) => l && !l.startsWith('|') && !isBullet(l) && !l.startsWith('#'));

/** Splits on commas that are not inside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** "Mon, Thu" or "Tue, Wed, Fri" or "Day 1" -> [1, 4]. */
function parseDays(s: string): number[] {
  const days: number[] = [];
  for (const tok of s.split(/,|\band\b/)) {
    const t = tok.trim().toLowerCase();
    if (!t) continue;
    const num = /^(?:day\s*)?(\d)$/.exec(t);
    const d = num ? Number(num[1]) : WEEKDAYS[t.slice(0, 3)];
    if (!d || d < 1 || d > 7) fail(`Unknown day "${tok}" in "${s}"`);
    days.push(d);
  }
  return days;
}

/** Rewrites weekday names in display text as plan day numbers ("Mon and Thu" -> "Day 1 and Day 4"). */
function dayify(text: string): string {
  return text.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (d) => `Day ${WEEKDAYS[d.toLowerCase()]}`);
}

// ---------- training plan ----------

function parseRest(text: string): Record<RestCat, number> {
  const rest: Partial<Record<RestCat, number>> = {};
  for (const part of text.replace(/\.$/, '').split(/,\s*/)) {
    const m = /^(.+?)\s+(?:(\d+)(?:\s+to\s+(\d+))?\s*(min|s)|none)$/.exec(part.trim()) ?? fail(`Bad rest rule "${part}"`);
    const sec = m[2] ? Number(m[3] ?? m[2]) * (m[4] === 'min' ? 60 : 1) : 0;
    const what = m[1].toLowerCase();
    if (/jump/.test(what)) rest.jump = sec;
    if (/strength/.test(what)) rest.strength = sec;
    if (/contrast/.test(what)) rest.contrast = sec;
    if (/trick/.test(what)) rest.trick = sec;
    if (/flex/.test(what)) rest.flex = sec;
  }
  for (const k of ['jump', 'strength', 'contrast', 'trick', 'flex'] as RestCat[]) {
    if (rest[k] === undefined) fail(`Rest rule is missing "${k}"`);
  }
  return rest as Record<RestCat, number>;
}

function parseWarmupItem(raw: string): WarmupItem {
  const s = raw.replace(/\.$/, '');
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) min (.+)$/.exec(s))) return { name: cap(m[2]), sec: Number(m[1]) * 60, perSide: false };
  if ((m = /^(.+?) (\d+)×(\d+)$/.exec(s))) return { name: cap(m[1]), sets: Number(m[2]), reps: Number(m[3]), perSide: false };
  if ((m = /^(.+?) (\d+) per direction( per (?:leg|side))?$/.exec(s))) {
    return { name: cap(m[1]), reps: Number(m[2]), unit: 'per direction', perSide: !!m[3] };
  }
  if ((m = /^(\d+) (.+?)( per (?:leg|side))?$/.exec(s))) return { name: cap(m[2]), reps: Number(m[1]), perSide: !!m[3] };
  fail(`Cannot parse warm-up item "${raw}"`);
}

function categorize(name: string, day: number, kind: Exercise['kind']): RestCat {
  if (kind === 'contrast') return 'contrast';
  if (day === 7) return 'flex';
  if (day === 2 || day === 5) return /fast kicks/i.test(name) ? 'trick' : 'flex';
  if (/leg raise holds/i.test(name)) return 'flex';
  if (/\b(360|480|540|720)\b|tornado|spin|kick|moving ball/i.test(name)) return 'trick';
  if (/jump|hop|bound|sprint/i.test(name)) return 'jump';
  return 'strength';
}

function testKey(s: string): TestKey {
  if (/jump/i.test(s)) return 'jump';
  if (/kick/i.test(s)) return 'kick';
  if (/720/.test(s)) return '720';
  if (/540/.test(s)) return '540';
  fail(`Cannot tell which test "${s}" is`);
}

/** The part of a name before any parenthesis or comma, used to carry lists forward between months. */
const baseKey = (name: string) => name.split(/[(,]/)[0].trim().toLowerCase();
const parenList = (name: string) => {
  const m = /\(([^)]+)\)/.exec(name);
  return m ? splitTop(m[1]).map((x) => x.trim()) : null;
};

type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DOmit<Exercise, 'cat' | 'restSec' | 'name' | 'do'>;

interface Ctx {
  day: number;
  rest: Record<RestCat, number>;
  hipDescs: string[];
  /** Exercises of the current month by day, filled as rows are read. */
  monthDays: Map<number, Exercise[]>;
  /** Saturday tests of finished months, already resolved. */
  monthTests: TestEx[][];
  /** Parenthetical lists seen so far, keyed by baseKey(name). */
  lists: Map<string, string[]>;
  lastPhases: PnfPhase[] | null;
  lastPushSec: number;
}

function parseExercises(name: string, raw: string, ctx: Ctx): Exercise[] {
  const d = raw.trim().replace(/(\d)\s*[x×]\s*(\d)/g, '$1×$2');
  const key = baseKey(name);
  const own = parenList(name);
  let list = own;
  if (/same kicks/i.test(name)) {
    const prev = ctx.monthDays.get(ctx.day)?.at(-1);
    list = prev ? ctx.lists.get(baseKey(prev.name)) ?? null : null;
  }
  if (!list) list = ctx.lists.get(key) ?? null;
  if (list) ctx.lists.set(key, list);
  const carried = own || !list ? undefined : cap(list.join(', '));

  const make = (ex: Draft): Exercise => {
    const cat = categorize(name, ctx.day, ex.kind);
    return { name, do: d, cat, restSec: ctx.rest[cat], ...ex } as Exercise;
  };
  let m: RegExpExecArray | null;

  if ((m = /^Same as (Mon|Tue|Wed|Thu|Fri|Sat|Sun|Day \d)$/i.exec(d))) {
    const src = ctx.monthDays.get(parseDays(m[1])[0])?.find((e) => e.name === name);
    if (!src) fail(`"${name}: ${d}" but that day has no "${name}"`);
    const copy = structuredClone(src);
    copy.cat = categorize(name, ctx.day, copy.kind);
    copy.restSec = ctx.rest[copy.cat];
    return [copy];
  }

  if ((m = /^Same as Month (\d+)$/i.exec(d))) {
    const tests = ctx.monthTests[Number(m[1]) - 1] ?? fail(`"${d}" refers to a month that is not parsed yet`);
    return name.replace(/^Test:\s*/i, '').split(/,\s*/).map((t) => {
      const k = testKey(t);
      return structuredClone(tests.find((x) => x.test === k) ?? fail(`Month ${m![1]} has no "${t}" test`));
    });
  }

  if ((m = /^(\d+) rounds of 1 push \+ (\d+) jumps$/.exec(d))) {
    const push = /(\d+) s max push/.exec(name) ?? /(\d+) s max push/.exec(carried ?? '');
    if (push) ctx.lastPushSec = Number(push[1]);
    return [make({ kind: 'contrast', rounds: Number(m[1]), jumps: Number(m[2]), pushSec: ctx.lastPushSec, note: carried })];
  }

  if ((m = /^(\d+) rounds: (.+)$/.exec(d))) {
    const phases = m[2].split(/,\s*/).map((p) => {
      const pm = /^(\d+) s (.+)$/.exec(p) ?? fail(`Bad PNF phase "${p}"`);
      return { sec: Number(pm[1]), label: cap(pm[2]) };
    });
    ctx.lastPhases = phases;
    return [make({ kind: 'pnf', rounds: Number(m[1]), perSide: false, phases })];
  }

  if ((m = /^(\d+) rounds per side(?:, same timing)?$/.exec(d))) {
    const phases = ctx.lastPhases ?? fail(`"${d}" has no earlier PNF timing to copy`);
    return [make({ kind: 'pnf', rounds: Number(m[1]), perSide: true, phases: structuredClone(phases) })];
  }

  if ((m = /^(\d+) rounds$/.exec(d))) {
    return [make({ kind: 'rounds', rounds: Number(m[1]), options: (list ?? fail(`"${name}" needs a (list) of options`)).map(cap) })];
  }

  if ((m = /^(\d+) min, (.+?)(?: per minute)?$/.exec(d)) && /^EMOM:/i.test(name)) {
    const what = name.replace(/^EMOM:\s*/i, '');
    const alt = /^alternate (.+) and (.+)$/i.exec(what);
    return [make({ kind: 'emom', minutes: Number(m[1]), perMinute: m[2], cues: alt ? [alt[1], alt[2]] : [what] })];
  }

  if ((m = /^(\d+) min$/.exec(d))) return [make({ kind: 'timed', sec: Number(m[1]) * 60 })];

  if ((m = /^(\d+) sets: (.+)$/.exec(d))) {
    const items = splitTop(m[2]).map((raw): CircuitItem => {
      const im = /^(\d+)( s)? (.+?)( per (?:side|leg))?(?: \((.+)\))?$/.exec(raw) ?? fail(`Bad circuit item "${raw}"`);
      const short = im[3];
      const stem = short.replace(/s$/, '').toLowerCase();
      const desc = ctx.hipDescs.find((h) => h.toLowerCase().includes(stem));
      return {
        name: short,
        ...(desc ? { desc } : {}),
        ...(im[2] ? { sec: Number(im[1]) } : { reps: Number(im[1]) }),
        perSide: !!im[4],
        ...(im[5] ? { note: im[5] } : {}),
      };
    });
    return [make({ kind: 'circuit', sets: Number(m[1]), items })];
  }

  if ((m = /^(\d+) attempts, log (best|landed|full rotations)$/.exec(d))) {
    const log = m[2] === 'full rotations' ? 'rotations' : (m[2] as 'best' | 'landed');
    return [make({ kind: 'test', test: testKey(name), attempts: Number(m[1]), perSide: false, log })];
  }

  if ((m = /^(\d+) per side, log best$/.exec(d))) {
    return [make({ kind: 'test', test: testKey(name), attempts: Number(m[1]), perSide: true, log: 'best' })];
  }

  if ((m = /^(\d+) reps$/.exec(d))) {
    const dist = /(\d+ m)$/.exec(name);
    return [make({
      kind: 'sets', sets: Number(m[1]), reps: 1, perSide: false, setWord: 'Rep',
      unit: /sprint/i.test(name) ? 'sprint' : 'rep', ...(dist ? { target: dist[1] } : {}),
    })];
  }

  if ((m = /^(\d+)×(\d+) s per side$/.exec(d))) {
    return [make({ kind: 'hold', sets: Number(m[1]), sec: Number(m[2]), perSide: true })];
  }

  if ((m = /^(\d+)×(\d+)(.*)$/.exec(d))) {
    let perSide = false;
    let unit = 'reps';
    let parts: string[] | undefined;
    let finalHoldSec: number | undefined;
    const notes: string[] = carried ? [carried] : [];
    for (const mod of m[3].split(',').map((x) => x.trim()).filter(Boolean)) {
      let mm: RegExpExecArray | null;
      if (/^per (leg|side)$/.test(mod)) perSide = true;
      else if (mod === 'per kick per side') { perSide = true; unit = 'per kick'; }
      else if (mod === 'per direction per leg') { perSide = true; unit = 'per direction'; }
      else if (mod === 'each') parts = name.split(/,\s*/).map(cap);
      else if ((mm = /^then (\d+) s hold$/.exec(mod))) finalHoldSec = Number(mm[1]);
      else notes.push(cap(mod));
    }
    return [make({
      kind: 'sets', sets: Number(m[1]), reps: Number(m[2]), perSide, unit, setWord: 'Set',
      ...(parts ? { parts } : {}),
      ...(finalHoldSec ? { finalHoldSec } : {}),
      ...(notes.length ? { note: notes.join(' · ') } : {}),
    })];
  }

  fail(`Cannot parse "${raw}" for "${name}"`);
}

function deload(ex: Exercise): Exercise {
  const half = (n: number) => Math.ceil(n / 2);
  const e = structuredClone(ex);
  let n: number | null = null;
  switch (e.kind) {
    case 'sets': case 'hold': case 'circuit': n = e.sets = half(e.sets); break;
    case 'pnf': case 'contrast': case 'rounds': n = e.rounds = half(e.rounds); break;
    case 'emom': n = e.minutes = half(e.minutes); break;
    case 'timed': case 'test': break;
  }
  if (n !== null) e.do = e.do.replace(/^\d+/, String(n));
  return e;
}

function parseTraining(md: string) {
  const all = sections(md);
  const rulesSec = section(all, 'Rules');

  const dayTable = tables(rulesSec.lines)[0] ?? fail('Rules has no day table');
  const titles = new Map<number, string>();
  for (const [dayCell, title] of dayTable.slice(1)) for (const d of parseDays(dayCell)) titles.set(d, title);

  // Rule bullets come before the "**Warm-ups**" line, warm-up bullets after it.
  const warmIdx = rulesSec.lines.findIndex((l) => /^\*\*Warm-ups\*\*$/i.test(l));
  if (warmIdx < 0) fail('Rules has no **Warm-ups** line');
  const rules = rulesSec.lines.slice(0, warmIdx).filter(isBullet).map((l) => {
    const m = /^\*\*(.+?):?\*\*:?\s*(.*)$/.exec(unbullet(l)) ?? fail(`Bad rule "${l}"`);
    return { label: m[1].replace(/:$/, ''), text: m[2] };
  });
  const rest = parseRest(rules.find((r) => /^rest$/i.test(r.label))?.text ?? fail('No **Rest:** rule'));

  const warmups = new Map<number, Warmup>();
  for (const l of rulesSec.lines.slice(warmIdx + 1).filter(isBullet)) {
    const m = /^\*\*(.+?) \((.+?)\):\*\*\s*(.+)$/.exec(unbullet(l)) ?? fail(`Bad warm-up "${l}"`);
    const wu: Warmup = { name: m[1], items: splitTop(m[3]).map(parseWarmupItem) };
    for (const d of parseDays(m[2])) warmups.set(d, wu);
  }

  const hipLine = paragraphs(rulesSec.lines).find((l) => /^\*\*Hip block/i.test(l)) ?? fail('No **Hip block** line');
  const hipDescs = splitTop(unbold(hipLine).replace(/^Hip block \(.+?\):\s*/i, '').replace(/\.?\s*Sets and load.*$/i, ''))
    .map(cap);

  const film = rules.find((r) => /^film$/i.test(r.label));
  const filmDays = film ? parseDays(/on (.+?)\.?$/.exec(film.text)?.[1] ?? '') : [];

  const lists = new Map<string, string[]>();
  const monthTests: TestEx[][] = [];
  let lastPhases: PnfPhase[] | null = null;
  let lastPushSec = 5;
  const months: Month[] = [];

  for (const sec of all.filter((s) => /^Month \d+$/i.test(s.heading))) {
    const month = Number(sec.heading.replace(/\D/g, ''));
    const target = paragraphs(sec.lines).find((l) => /^Target:/i.test(l))?.replace(/^Target:\s*/i, '') ?? '';
    const table = tables(sec.lines)[0] ?? fail(`Month ${month} has no table`);
    const monthDays = new Map<number, Exercise[]>();
    for (const [dayCell, name, doCell] of table.slice(1)) {
      if (!doCell) fail(`Month ${month}: row "${name}" has no Do column`);
      for (const day of parseDays(dayCell)) {
        const ctx: Ctx = { day, rest, hipDescs, monthDays, monthTests, lists, lastPhases, lastPushSec };
        const exs = parseExercises(name, doCell, ctx);
        lastPhases = ctx.lastPhases;
        lastPushSec = ctx.lastPushSec;
        monthDays.set(day, [...(monthDays.get(day) ?? []), ...exs]);
      }
    }
    monthTests[month - 1] = (monthDays.get(6) ?? []).filter((e): e is TestEx => e.kind === 'test');

    const weeks = [1, 2, 3, 4].map((week) => {
      const isDeload = week === 4;
      const days: Day[] = [1, 2, 3, 4, 5, 6, 7].map((day) => {
        const exercises = monthDays.get(day) ?? fail(`Month ${month} has nothing on day ${day}`);
        return {
          day,
          title: titles.get(day) ?? fail(`No title for day ${day}`),
          warmup: warmups.get(day) ?? null,
          exercises: isDeload ? exercises.map(deload) : exercises,
          notes: filmDays.includes(day) ? [`Film every trick set.`] : [],
        };
      });
      return { week, deload: isDeload, days };
    });
    months.push({ month, target, weeks });
  }
  if (months.length !== 6) fail(`Expected 6 months, found ${months.length}`);

  const displayRules = rules.map((r) => ({ label: dayify(r.label), text: dayify(r.text) }));
  return { rules: displayRules, rest, months };
}

// ---------- GTG plan ----------

function parseGtgPart(raw: string, prevName: string | undefined): GtgPart {
  let m: RegExpExecArray | null;
  if ((m = /^(.+?) (\d+) s( per (?:side|leg))?$/.exec(raw))) {
    return { name: cap(m[1]), sec: Number(m[2]), perSide: !!m[3] };
  }
  if ((m = /^(\d+) (.+?) per (?:leg|side) \((\d+) s\)$/.exec(raw))) {
    return { name: cap(m[2]), reps: Number(m[1]), perSide: true, note: `${m[3]} s hold each` };
  }
  if ((m = /^(\d+) (?:(.+?) )?per side to (.+?), (\d+) s freeze$/.exec(raw))) {
    const name = m[2] ? cap(m[2]) : prevName ?? fail(`"${raw}" has no exercise name to inherit`);
    return { name, reps: Number(m[1]), perSide: true, note: `To ${m[3]}, ${m[4]} s freeze` };
  }
  if ((m = /^(\d+) (.+?) at (\d+%), (.+)$/.exec(raw))) {
    return { name: cap(m[2]), reps: Number(m[1]), perSide: false, note: `At ${m[3]}, ${m[4]}` };
  }
  fail(`Cannot parse GTG part "${raw}"`);
}

function parseGtg(md: string): Gtg {
  const all = sections(md);
  const rulesSec = section(all, 'Rules');
  const rules = [...paragraphs(rulesSec.lines), ...rulesSec.lines.filter(isBullet).map(unbullet)].map((r) => dayify(unbold(r)));
  const deloadRule = rules.find((r) => /week 4/i.test(r)) ?? fail('GTG rules have no week 4 rule');
  const deloadSlots = Number((/(\d+) sets a day/.exec(deloadRule) ?? fail(`Bad GTG deload rule "${deloadRule}"`))[1]);

  const setsTable = tables(section(all, 'Sets').lines)[0] ?? fail('GTG Sets has no table');
  const monthRanges = setsTable[0].slice(1).map((h) => {
    const m = /(\d+)\s+to\s+(\d+)/.exec(h) ?? fail(`Bad month header "${h}"`);
    const out: number[] = [];
    for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    return out;
  });
  const sets: GtgSet[] = setsTable.slice(1).map(([head, ...cells]) => {
    const hm = /^([A-Z]):\s*(.+)$/.exec(head) ?? fail(`Bad GTG set "${head}"`);
    const prevNames: string[] = [];
    const versions = cells.map((text, i) => {
      const parts = text.split(/,\s*then\s+/).map((p, j) => {
        const part = parseGtgPart(p.trim(), prevNames[j]);
        prevNames[j] = part.name;
        return part;
      });
      return { months: monthRanges[i], text, parts };
    });
    return { letter: hm[1], label: cap(hm[2]), versions };
  });

  const timing = tables(section(all, 'Daily timing').lines)[0] ?? fail('GTG Daily timing has no table');
  const columns = timing[0].slice(1).map((h, i) => ({ days: parseDays(h), letters: timing.slice(1).map((r) => r[i + 1]) }));
  const times = timing.slice(1).map((r) => r[0]);
  const covered = columns.flatMap((c) => c.days).sort();
  if (covered.join() !== '1,2,3,4,5,6,7') fail(`GTG columns cover days ${covered.join()}, expected 1 to 7`);
  for (const c of columns) for (const l of c.letters) if (!sets.some((s) => s.letter === l)) fail(`GTG slot uses unknown set "${l}"`);

  return { rules, deloadSlots, sets, times, columns };
}

// ---------- main ----------

const plan: Plan = { ...parseTraining(read('training-plan.md')), gtg: parseGtg(read('gtg-plan.md')) };
const json = JSON.stringify(plan, null, 1);
if (/[–—]/.test(json)) fail('plan.json contains an en or em dash');
writeFileSync(join(root, 'src/plan.json'), json + '\n');

const days = plan.months.flatMap((m) => m.weeks.flatMap((w) => w.days));
console.log(`plan.json: ${plan.months.length} months, ${days.length} days, ${days.reduce((n, d) => n + d.exercises.length, 0)} exercises, ${(json.length / 1024).toFixed(0)} KB`);
