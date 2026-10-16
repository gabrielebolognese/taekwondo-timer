import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { shareOrDownload } from '../lib/files';
import { useStored, useSyncStatus, useTwoTap } from '../lib/hooks';
import { currentRecord, describe, importRecord, makeBackup, parseBackup, type TrainingRecord } from '../lib/record';
import { backend, requestPersistence, shortTime, todayKey } from '../lib/storage';
import {
  cleanSecret, normalizeUrl, resolveConflict, sendableSecret, setConfig, syncNow, testConnection,
  type CheckLine, type Conflict, type SyncConfig,
} from '../lib/sync';

const MAX_FILE = 5_000_000;

export function Settings() {
  return (
    <div className="screen">
      <h2 className="day-title">Settings</h2>
      <StorageCard />
      <SyncCard />
      <BackupCard />
      <p className="muted small version">Version {__APP_VERSION__}, built {__BUILD_DATE__}</p>
    </div>
  );
}

function StorageCard() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  useEffect(() => {
    void requestPersistence().then(setPersistent);
  }, []);
  return (
    <section className="pcard">
      <span className="eyebrow">On this phone</span>
      <p className={persistent ? 'ok-text' : persistent === false ? 'warn-text' : undefined}>
        Storage: {persistent === null ? 'checking' : persistent ? 'persistent' : 'may be cleared'}
      </p>
      <p className="muted small">
        {persistent
          ? 'The browser will not delete this data to free up space.'
          : 'The browser may delete this data when space runs low. Turn on cloud sync or export a backup now and then.'}
      </p>
      {backend === 'localstorage' && <p className="muted small">IndexedDB is not available, so data is kept in browser storage.</p>}
    </section>
  );
}

function SyncCard() {
  const status = useSyncStatus();
  const [saved] = useStored<SyncConfig | null>('syncConfig', null);
  const [url, setUrl] = useState(saved?.url ?? '');
  const [secret, setSecret] = useState(saved?.secret ?? '');
  const [reveal, setReveal] = useState(false);
  const [formError, setFormError] = useState('');

  const cleaned = cleanSecret(secret);
  const changed = url.trim() !== (saved?.url ?? '') || cleaned !== (saved?.secret ?? '');
  const turningOff = !!saved && !url.trim() && !cleaned;

  const submit = () => {
    setFormError('');
    if (!url.trim() && !cleaned) return setConfig(null);
    const normalized = normalizeUrl(url);
    if (!normalized) return setFormError('Use the https address that wrangler deploy printed.');
    if (!cleaned) return setFormError('Enter the secret you set with wrangler secret put.');
    if (!sendableSecret(cleaned)) {
      return setFormError('The secret has a character that cannot be sent, like a curly quote. Copy it again from the terminal.');
    }
    setUrl(normalized);
    setSecret(cleaned);
    setConfig({ url: normalized, secret: cleaned });
  };

  const text = status.state === 'off' ? 'Off. Add your Worker URL and secret to keep a copy in the cloud.' : status.message;

  return (
    <section className="pcard">
      <span className="eyebrow">Cloud sync</span>
      <label className="text-field">
        <span>Worker URL</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://tkd-sync.you.workers.dev"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="text-field">
        <span>Secret</span>
        <span className="secret-row">
          <input
            type={reveal ? 'text' : 'password'}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button type="button" className="reveal" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button>
        </span>
      </label>
      {formError && <p className="danger-text small">{formError}</p>}
      <button className="secondary" disabled={!changed} onClick={submit}>{turningOff ? 'Turn off sync' : 'Save and sync'}</button>

      <div className="sync-status">
        <p className="sync-line"><span className={`sync-dot ${status.state}`} aria-hidden="true" />{text}</p>
        <p className="muted small">Last synced: {status.lastSyncedAt ? shortTime(status.lastSyncedAt) : 'never'}</p>
      </div>
      <button className="secondary" disabled={!saved || status.state === 'syncing'} onClick={syncNow}>Sync now</button>
      {status.conflict && <ConflictCard conflict={status.conflict} />}
      {saved && <ConnectionTest />}
    </section>
  );
}

function ConnectionTest() {
  const [lines, setLines] = useState<CheckLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setLines(null);
    setLines(await testConnection());
    setRunning(false);
  };
  return (
    <>
      <button className="link-btn tight" disabled={running} onClick={() => void run()}>
        {running ? 'Testing connection' : 'Test connection'}
      </button>
      {lines && (
        <ul className="checks">
          {lines.map((l) => (
            <li key={l.text} className={l.ok ? 'ok' : 'bad'}>
              <span aria-hidden="true">{l.ok ? '✓' : '✗'}</span>{l.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const [deviceArmed, tapDevice] = useTwoTap(() => resolveConflict('device'));
  const [cloudArmed, tapCloud] = useTwoTap(() => resolveConflict('cloud'));
  const newer = conflict.cloud && conflict.cloudAt > conflict.localAt ? 'cloud' : 'device';
  const changed = (at: number) => (at ? `Changed ${shortTime(at)}` : 'No change time');
  return (
    <div className="card conflict">
      <b>Which copy should be kept?</b>
      <p className="muted small">The copy you keep replaces the other one.</p>
      <div className="choice">
        <span className="eyebrow">This phone{newer === 'device' ? ' · newer' : ''}</span>
        <span className="small">{describe(conflict.local)}</span>
        <span className="muted small">{changed(conflict.localAt)}</span>
      </div>
      <div className="choice">
        <span className="eyebrow">Cloud{newer === 'cloud' ? ' · newer' : ''}</span>
        <span className="small">{conflict.cloud ? describe(conflict.cloud) : 'Cannot be read'}</span>
        {conflict.cloud && <span className="muted small">{changed(conflict.cloudAt)}</span>}
      </div>
      <div className="split">
        <button className={`secondary${deviceArmed ? ' danger' : ''}`} onClick={tapDevice}>
          {deviceArmed ? 'Tap to confirm' : 'Keep this phone'}
        </button>
        {conflict.cloud && (
          <button className={`secondary${cloudArmed ? ' danger' : ''}`} onClick={tapCloud}>
            {cloudArmed ? 'Tap to confirm' : 'Keep cloud'}
          </button>
        )}
      </div>
    </div>
  );
}

function BackupCard() {
  const status = useSyncStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [incoming, setIncoming] = useState<{ record: TrainingRecord; madeAt: number } | null>(null);

  const exportBackup = () => {
    const text = JSON.stringify(makeBackup(), null, 2);
    shareOrDownload(new File([text], `tkd-backup-${todayKey()}.json`, { type: 'application/json' }), 'Taekwondo Timer backup');
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setError('');
    setNotice('');
    if (!file) return;
    if (file.size > MAX_FILE) return setError('This file is too big to be a backup.');
    const result = parseBackup(await file.text());
    if (typeof result === 'string') return setError(result);
    setIncoming(result);
  };

  const replace = () => {
    if (!incoming) return;
    importRecord(incoming.record);
    setIncoming(null);
    setNotice(`Backup imported. Now on ${describe(currentRecord())}.`);
  };

  return (
    <section className="pcard">
      <span className="eyebrow">Backup file</span>
      <p className="muted small">
        A JSON file with your current day, completions, GTG checks, goal ticks and test log. The sync secret is not in it.
      </p>
      <div className="split">
        <button className="secondary" onClick={exportBackup}>Export backup</button>
        <button className="secondary" onClick={() => fileRef.current?.click()}>Import backup</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e)} />
      {error && <p className="danger-text small">{error}</p>}
      {notice && <p className="ok-text small">{notice}</p>}

      {incoming && (
        <div className="sheet-backdrop" onClick={() => setIncoming(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="import-title" className="confirm-title">Replace your data with this backup?</h2>
            <div className="choice">
              <span className="eyebrow">Backup{incoming.madeAt ? ` · ${shortTime(incoming.madeAt)}` : ''}</span>
              <span className="small">{describe(incoming.record)}</span>
            </div>
            <div className="choice">
              <span className="eyebrow">On this phone now</span>
              <span className="small">{describe(currentRecord())}</span>
            </div>
            <p className="small muted">
              Everything on this phone is replaced by the backup{status.state !== 'off' ? ', then the cloud copy is updated to match' : ''}.
            </p>
            <div className="split">
              <button className="secondary" onClick={() => setIncoming(null)}>Cancel</button>
              <button className="primary small-primary" onClick={replace}>Replace</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
