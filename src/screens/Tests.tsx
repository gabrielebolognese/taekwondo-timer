import { useState } from 'react';
import { LIMITS, planWeek, plan } from '../lib/plan';
import { shortDate, todayKey, type TestEntry } from '../lib/storage';

const FIELDS: { key: keyof TestEntry; label: string; suffix: string; csv: string; max?: number }[] = [
  { key: 'maxJump', label: 'Max jump', suffix: 'cm', csv: 'max_jump_cm' },
  { key: 'highestKick', label: 'Highest kick', suffix: 'cm', csv: 'highest_kick_cm' },
  { key: 'landed540', label: '540 landed', suffix: '/10', csv: 'landed_540_of_10', max: 10 },
  { key: 'landed720', label: '720 landed', suffix: '/10', csv: 'landed_720_of_10', max: 10 },
  { key: 'ballHeight', label: 'Ball height', suffix: 'cm', csv: 'ball_height_cm' },
];

// crypto.randomUUID needs a secure context, which a phone testing over LAN http is not.
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const sortEntries = (list: TestEntry[]) =>
  [...list].sort((a, b) => planWeek(b) - planWeek(a) || b.date.localeCompare(a.date));

export function toCsv(entries: TestEntry[]): string {
  const header = ['date', 'plan_week', 'month', 'week', ...FIELDS.map((f) => f.csv)];
  const rows = sortEntries(entries).reverse().map((e) => [
    e.date, planWeek(e), e.month, e.week, ...FIELDS.map((f) => e[f.key] ?? ''),
  ]);
  return [header, ...rows].map((r) => r.join(',')).join('\n') + '\n';
}

function exportCsv(entries: TestEntry[]) {
  const file = new File([toCsv(entries)], `tkd-test-log-${todayKey()}.csv`, { type: 'text/csv' });
  // On the phone the share sheet is the reliable way out of a home screen app; desktop just downloads.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Test log' }).catch((e: Error) => {
      if (e.name !== 'AbortError') download(file);
    });
    return;
  }
  download(file);
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface Props {
  entries: TestEntry[];
  isTestDay: boolean;
  onAdd: () => void;
  onEdit: (e: TestEntry) => void;
}

export function Tests({ entries, isTestDay, onAdd, onEdit }: Props) {
  const sorted = sortEntries(entries);
  return (
    <div className="screen">
      <h2 className="day-title">Test log</h2>
      <p className="muted small">One entry per Day 6. Plan weeks run 1 to 24.</p>
      <div className="split">
        <button className={isTestDay ? 'primary small-primary' : 'secondary'} onClick={onAdd}>Log test</button>
        <button className="secondary" onClick={() => exportCsv(entries)} disabled={!entries.length}>Export CSV</button>
      </div>
      {!sorted.length && <p className="muted empty">No tests logged yet.</p>}
      <ul className="tests">
        {sorted.map((e) => (
          <li key={e.id}>
            <button className="test-row" onClick={() => onEdit(e)}>
              <span className="test-head">
                <b>Plan week {planWeek(e)}</b>
                <span className="muted">Month {e.month} · Week {e.week} · {shortDate(e.date)}</span>
              </span>
              <span className="test-values">
                {FIELDS.map((f) => (
                  <span key={f.key}>
                    <span className="muted">{f.label}</span>
                    <b>{e[f.key] ?? '-'}{e[f.key] !== undefined && f.suffix !== 'cm' ? f.suffix : ''}</b>
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FormProps {
  initial: Partial<TestEntry> & { month: number; week: number };
  onSave: (e: TestEntry) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  saveLabel?: string;
}

const ballRule = plan.rules.find((r) => /ball/i.test(r.label));

export function TestForm({ initial, onSave, onCancel, onDelete, saveLabel = 'Save' }: FormProps) {
  const [month, setMonth] = useState(initial.month);
  const [week, setWeek] = useState(initial.week);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] === undefined ? '' : String(initial[f.key])])),
  );

  const submit = () => {
    const entry: TestEntry = { id: initial.id ?? newId(), date: initial.date ?? todayKey(), month, week };
    for (const f of FIELDS) {
      const n = parseFloat(values[f.key].replace(',', '.'));
      if (Number.isFinite(n)) (entry[f.key] as number) = f.max ? Math.min(f.max, Math.max(0, Math.round(n))) : n;
    }
    onSave(entry);
  };

  return (
    <div className="test-form">
      <div className="stepper">
        <span>Month</span>
        <button onClick={() => setMonth(Math.max(1, month - 1))} aria-label="Previous month">−</button>
        <b>{month}</b>
        <button onClick={() => setMonth(Math.min(LIMITS.month, month + 1))} aria-label="Next month">+</button>
      </div>
      <div className="stepper">
        <span>Week</span>
        <button onClick={() => setWeek(Math.max(1, week - 1))} aria-label="Previous week">−</button>
        <b>{week}</b>
        <button onClick={() => setWeek(Math.min(4, week + 1))} aria-label="Next week">+</button>
      </div>
      {FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span>{f.label}</span>
          <input
            inputMode={f.max ? 'numeric' : 'decimal'}
            pattern={f.max ? '[0-9]*' : undefined}
            value={values[f.key]}
            placeholder="-"
            onChange={(ev) => setValues({ ...values, [f.key]: ev.target.value })}
          />
          <span className="suffix">{f.suffix}</span>
        </label>
      ))}
      {ballRule && <p className="muted small"><b>{ballRule.label}:</b> {ballRule.text}</p>}
      <button className="primary" onClick={submit}>{saveLabel}</button>
      <div className="split">
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
        {onDelete && <button className="secondary danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
