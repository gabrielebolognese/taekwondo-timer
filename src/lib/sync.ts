// Optional cloud copy of the training record on the user's own Cloudflare Worker (see /worker).
// The whole record moves as one piece and the copy with the newer updatedAt wins. The one case
// that is not decided automatically is the first sync of a device that already has data when
// the cloud has different data: the user picks which copy to keep.

import { applyRecord, currentRecord, isEmpty, parseRecord, sameRecord, updatedAt, type TrainingRecord } from './record';
import { load, onRecordChange, write } from './storage';

export interface SyncConfig {
  url: string;
  secret: string;
}

interface SyncMeta {
  /** updatedAt both sides agreed on at the last sync. null = this device has not synced with this cloud yet. */
  base: number | null;
  lastSyncedAt: number | null;
}

export type SyncState = 'off' | 'idle' | 'pending' | 'syncing' | 'offline' | 'error' | 'conflict';

export interface Conflict {
  local: TrainingRecord;
  localAt: number;
  /** null when the cloud copy could not be read. */
  cloud: TrainingRecord | null;
  cloudAt: number;
}

export interface SyncStatus {
  state: SyncState;
  message: string;
  lastSyncedAt: number | null;
  conflict: Conflict | null;
}

const PUSH_DELAY = 2000;
const TIMEOUT = 20_000;
const RETRY = [5, 15, 30, 60, 120, 300].map((s) => s * 1000);

class HttpError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}`);
  }
}

// ---------- settings ----------

export const getConfig = (): SyncConfig | null => load<SyncConfig | null>('syncConfig', null);
const getMeta = (): SyncMeta => load<SyncMeta>('syncMeta', { base: null, lastSyncedAt: null });
const setMeta = (m: Partial<SyncMeta>) => write('syncMeta', { ...getMeta(), ...m });

/** Accepts the URL wrangler prints, with or without https:// or a trailing /state. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim().replace(/\/+$/, '').replace(/\/state$/i, '');
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Saves the Worker URL and secret. Empty both to turn sync off. */
export function setConfig(cfg: SyncConfig | null) {
  const prev = getConfig();
  write('syncConfig', cfg);
  if (!cfg) {
    write('syncMeta', null);
    clearTimers();
    setStatus({ state: 'off', message: '', conflict: null, lastSyncedAt: null });
    return;
  }
  // A different Worker or secret is a new link: decide again which copy is current.
  if (!prev || prev.url !== cfg.url || prev.secret !== cfg.secret) write('syncMeta', { base: null, lastSyncedAt: null });
  setStatus({ conflict: null });
  syncNow();
}

// ---------- status ----------

let status: SyncStatus = { state: 'off', message: '', lastSyncedAt: null, conflict: null };
const statusListeners = new Set<() => void>();

function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, lastSyncedAt: getMeta().lastSyncedAt, ...s };
  for (const l of statusListeners) l();
}

export const getSyncStatus = () => status;
export function subscribeSync(l: () => void) {
  statusListeners.add(l);
  return () => void statusListeners.delete(l);
}

const hasUnpushed = () => {
  const { base } = getMeta();
  return base !== null && updatedAt() > base;
};

function settle() {
  setStatus(hasUnpushed() ? { state: 'pending', message: 'Changes waiting to upload.' } : { state: 'idle', message: 'Up to date.' });
}

// ---------- network ----------

function endpoint(cfg: SyncConfig) {
  return `${cfg.url}/state`;
}

async function call(cfg: SyncConfig, method: 'GET' | 'PUT', body?: string, keepalive = false): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(endpoint(cfg), {
      method,
      body,
      keepalive,
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cfg.secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new HttpError(res.status, json);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- driver ----------

let pushTimer = 0;
let retryTimer = 0;
let retries = 0;
let busy = false;
let wanted: 'push' | 'reconcile' | null = null;
let leaving = false;
let lastAttempt = 0;

function clearTimers() {
  window.clearTimeout(pushTimer);
  window.clearTimeout(retryTimer);
  pushTimer = retryTimer = 0;
}

/** Runs one sync job at a time. A full sync covers a pending push. */
function request(kind: 'push' | 'reconcile') {
  wanted = wanted === 'reconcile' || kind === 'reconcile' ? 'reconcile' : 'push';
  if (busy) return;
  busy = true;
  void (async () => {
    try {
      while (wanted) {
        const job = wanted;
        wanted = null;
        await (job === 'reconcile' ? reconcile(false) : push(false));
      }
    } finally {
      busy = false;
    }
  })();
}

/** Compares this device with the cloud and moves the newer copy across. Launch, Sync now, retries. */
export function syncNow() {
  if (getConfig()) request('reconcile');
}

function ok() {
  retries = 0;
  window.clearTimeout(retryTimer);
  retryTimer = 0;
}

function failed(e: unknown) {
  if (e instanceof HttpError && e.status < 500 && e.status !== 429) {
    const detail = (e.body as { error?: unknown } | null)?.error;
    const message = e.status === 401 ? 'Wrong secret. Check it matches SYNC_SECRET on the Worker.'
      : e.status === 404 ? 'No sync endpoint at this URL. Check the Worker URL.'
      : typeof detail === 'string' ? `Worker said: ${detail}`
      : `Worker answered ${e.status}.`;
    setStatus({ state: 'error', message });
    return;
  }
  const message = e instanceof HttpError ? `Worker error ${e.status}. Will retry.`
    : navigator.onLine ? 'Could not reach the Worker. Will retry.' : 'Offline. Will sync when back online.';
  setStatus({ state: 'offline', message });
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => request('reconcile'), RETRY[Math.min(retries++, RETRY.length - 1)]);
}

async function upload(cfg: SyncConfig, afterConflict: boolean): Promise<void> {
  const at = updatedAt();
  const body = JSON.stringify({ data: currentRecord(), updatedAt: at });
  try {
    // keepalive lets the upload finish after the app goes to the background (64 KB browser limit).
    await call(cfg, 'PUT', body, leaving && body.length < 60_000);
  } catch (e) {
    // 409: the cloud has a newer copy than ours. Look again; the newer copy wins.
    if (e instanceof HttpError && e.status === 409 && !afterConflict) return reconcile(true);
    throw e;
  }
  setMeta({ base: at, lastSyncedAt: Date.now() });
  ok();
  settle();
}

async function push(afterConflict: boolean): Promise<void> {
  const cfg = getConfig();
  if (!cfg || status.state === 'conflict') return;
  if (getMeta().base === null) return reconcile(false);
  if (!hasUnpushed()) return settle();
  lastAttempt = Date.now();
  setStatus({ state: 'syncing', message: 'Uploading.' });
  try {
    await upload(cfg, afterConflict);
  } catch (e) {
    failed(e);
  }
}

async function reconcile(afterConflict: boolean): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  window.clearTimeout(pushTimer);
  pushTimer = 0;
  lastAttempt = Date.now();
  setStatus({ state: 'syncing', message: 'Syncing.' });
  try {
    const doc = (await call(cfg, 'GET')) as { data?: unknown; updatedAt?: unknown } | null;
    // Read the local side after the request, so changes made while it ran are included.
    const local = currentRecord();
    const localAt = updatedAt();
    const { base } = getMeta();

    if (!doc || doc.data === null || doc.data === undefined) {
      // Empty cloud: upload whatever this device has.
      if (isEmpty(local) && !localAt) {
        setMeta({ base: 0, lastSyncedAt: Date.now() });
        ok();
        return settle();
      }
      if (!localAt) write('updatedAt', Date.now());
      return await upload(cfg, afterConflict);
    }

    const cloud = parseRecord(doc.data);
    const cloudAt = Number(doc.updatedAt) || 0;
    if (typeof cloud === 'string') {
      ok();
      return setStatus({ state: 'conflict', message: `The cloud copy cannot be read. ${cloud}`, conflict: { local, localAt, cloud: null, cloudAt } });
    }

    const pull = () => {
      applyRecord(cloud, cloudAt);
      setMeta({ base: cloudAt, lastSyncedAt: Date.now() });
      ok();
      settle();
    };

    if (base === null) {
      // First sync with this cloud.
      if (isEmpty(local) || sameRecord(local, cloud)) return pull();
      ok();
      return setStatus({ state: 'conflict', message: 'This phone and the cloud have different data.', conflict: { local, localAt, cloud, cloudAt } });
    }

    const localChanged = localAt > base;
    const cloudChanged = cloudAt > base;
    if (localChanged && (!cloudChanged || localAt >= cloudAt)) return await upload(cfg, afterConflict);
    if (cloudChanged || isEmpty(local)) return pull();
    setMeta({ lastSyncedAt: Date.now() });
    ok();
    settle();
  } catch (e) {
    failed(e);
  }
}

/** Settles a first-sync conflict with the copy the user picked. */
export function resolveConflict(keep: 'device' | 'cloud') {
  const c = status.conflict;
  if (!c) return;
  if (keep === 'cloud' && c.cloud) {
    applyRecord(c.cloud, c.cloudAt);
    setMeta({ base: c.cloudAt, lastSyncedAt: Date.now() });
    setStatus({ conflict: null });
    settle();
    return;
  }
  // Keeping this device is a fresh change, so it is newer than the cloud copy it replaces.
  write('updatedAt', Math.max(Date.now(), c.cloudAt + 1));
  setMeta({ base: c.cloudAt });
  setStatus({ state: 'pending', message: 'Uploading.', conflict: null });
  request('push');
}

// ---------- lifecycle ----------

/** Wires up pushing after changes and syncs once. Call after the first render. */
export function startSync() {
  onRecordChange(() => {
    if (!getConfig()) return;
    if (status.state !== 'conflict') setStatus({ state: 'pending', message: 'Changes waiting to upload.' });
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushTimer = 0;
      request('push');
    }, PUSH_DELAY);
  });
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (!getConfig()) return;
    if (document.visibilityState === 'hidden') {
      // iOS may freeze the app soon after it leaves the screen: send a waiting push now.
      if (pushTimer) {
        window.clearTimeout(pushTimer);
        pushTimer = 0;
        leaving = true;
        request('push');
        window.setTimeout(() => (leaving = false), 1000);
      }
    } else if (hasUnpushed() || Date.now() - lastAttempt > 60_000) {
      syncNow();
    }
  });
  if (getConfig()) {
    setStatus({ state: 'syncing', message: 'Syncing.' });
    syncNow();
  }
}
