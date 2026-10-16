// The training record as one object: what cloud sync uploads and what a backup file holds.
// Device settings (sync URL and secret, open tab, a session in progress) are never part of it.

import { LIMITS, START, type Pos } from './plan';
import { migrate, SCHEMA, validPos } from './migrate';
import { load, touchRecord, write, type Completion, type GoalTicks, type GtgLog, type TestEntry } from './storage';

export interface TrainingRecord {
  schema: number;
  pos: Pos;
  log: Completion[];
  tests: TestEntry[];
  gtg: GtgLog;
  goals: GoalTicks;
}

export const BACKUP_APP = 'taekwondo-timer';

export function currentRecord(): TrainingRecord {
  return {
    schema: load('schema', SCHEMA),
    pos: load('pos', START),
    log: load('log', []),
    tests: load('tests', []),
    gtg: load('gtg', {}),
    goals: load('goals', {}),
  };
}

export const updatedAt = () => load('updatedAt', 0);

function writeRecord(r: TrainingRecord) {
  write('schema', r.schema);
  write('pos', r.pos);
  write('log', r.log);
  write('tests', r.tests);
  write('gtg', r.gtg);
  write('goals', r.goals);
  migrate();
}

/** Takes a cloud copy as it is, change time included. */
export function applyRecord(r: TrainingRecord, at: number) {
  writeRecord(r);
  write('updatedAt', at);
}

/**
 * Replaces the record with a backup. That is a new change, newer than anything this device has
 * seen even if another device's clock ran ahead, so it is the copy that sync keeps.
 */
export function importRecord(r: TrainingRecord) {
  writeRecord(r);
  touchRecord();
}

export function isEmpty(r: TrainingRecord): boolean {
  return !r.log.length && !r.tests.length
    && !Object.values(r.gtg).some((d) => d.done.length)
    && !Object.values(r.goals).some(Boolean)
    && r.pos.month === START.month && r.pos.week === START.week && r.pos.day === START.day;
}

/** JSON with sorted object keys, so two copies compare equal whatever order they were built in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as { [k: string]: unknown };
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export const sameRecord = (a: TrainingRecord, b: TrainingRecord) => stable(a) === stable(b);

export function describe(r: TrainingRecord): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `Month ${r.pos.month} · Week ${r.pos.week} · Day ${r.pos.day}, ${n(r.log.length, 'completion')}, ${n(r.tests.length, 'test')}`;
}

// ---------- validation ----------

const isObj = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === 'object' && !Array.isArray(v);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const optNumber = (v: unknown) => v === undefined || Number.isFinite(v);
const TEST_FIELDS = ['maxJump', 'highestKick', 'landed540', 'landed720', 'ballHeight'] as const;

function checkCompletion(e: unknown): boolean {
  return isObj(e) && isDate(e.date) && Number.isFinite(e.at) && validPos(e.pos) && typeof e.title === 'string'
    && strings(e.dropped) && strings(e.done)
    && (e.manual === undefined || typeof e.manual === 'boolean') && optNumber(e.minutes);
}

function checkTest(t: unknown): boolean {
  return isObj(t) && typeof t.id === 'string' && isDate(t.date) && isInt(t.month, 1, LIMITS.month) && isInt(t.week, 1, 4)
    && TEST_FIELDS.every((f) => optNumber(t[f]));
}

const checkGtgDay = (d: unknown) =>
  isObj(d) && Array.isArray(d.done) && d.done.every((i) => isInt(i, 0, 99)) && isInt(d.total, 0, 99);

/** Checks a record from a backup file or the cloud. Returns it, or a reason it was rejected. */
export function parseRecord(raw: unknown): TrainingRecord | string {
  if (!isObj(raw)) return 'No training data in it.';
  if (!Number.isInteger(raw.schema) || (raw.schema as number) < 2) return 'Unknown data format.';
  if ((raw.schema as number) > SCHEMA) return 'It was made by a newer version of the app. Update the app first.';
  if (!validPos(raw.pos)) return 'The current day is not valid.';
  if (!Array.isArray(raw.log)) return 'The completions list is missing.';
  const badLog = raw.log.findIndex((e) => !checkCompletion(e));
  if (badLog >= 0) return `Completion ${badLog + 1} is not valid.`;
  if (!Array.isArray(raw.tests)) return 'The test log is missing.';
  const badTest = raw.tests.findIndex((t) => !checkTest(t));
  if (badTest >= 0) return `Test entry ${badTest + 1} is not valid.`;
  if (!isObj(raw.gtg) || !Object.entries(raw.gtg).every(([k, d]) => isDate(k) && checkGtgDay(d))) return 'The GTG checks are not valid.';
  if (!isObj(raw.goals) || !Object.values(raw.goals).every((v) => typeof v === 'boolean')) return 'The goal ticks are not valid.';
  return {
    schema: raw.schema as number,
    pos: raw.pos,
    log: raw.log as Completion[],
    tests: raw.tests as TestEntry[],
    gtg: raw.gtg as GtgLog,
    goals: raw.goals as GoalTicks,
  };
}

// ---------- backup files ----------

export interface Backup {
  app: typeof BACKUP_APP;
  kind: 'backup';
  exportedAt: string;
  updatedAt: number;
  data: TrainingRecord;
}

export function makeBackup(): Backup {
  return { app: BACKUP_APP, kind: 'backup', exportedAt: new Date().toISOString(), updatedAt: updatedAt(), data: currentRecord() };
}

/** Reads a backup file's text. Also accepts a saved copy of the Worker's { data, updatedAt }. */
export function parseBackup(text: string): { record: TrainingRecord; madeAt: number } | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'This file is not JSON.';
  }
  if (!isObj(raw) || !isObj(raw.data) || (raw.app !== undefined && raw.app !== BACKUP_APP)) {
    return 'This file is not a Taekwondo Timer backup.';
  }
  const record = parseRecord(raw.data);
  if (typeof record === 'string') return `This backup cannot be used: ${record}`;
  const exported = typeof raw.exportedAt === 'string' ? Date.parse(raw.exportedAt) : NaN;
  const madeAt = Number.isFinite(exported) ? exported : Number(raw.updatedAt) || 0;
  return { record, madeAt };
}
