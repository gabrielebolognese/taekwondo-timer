import { useState } from 'react';
import { beep } from '../lib/audio';
import { getDay, isDeload, LIMITS, monthTarget, plan, type Pos } from '../lib/plan';
import type { Run } from '../lib/steps';
import { shortDate, type LogEntry } from '../lib/storage';

interface Props {
  pos: Pos;
  run: Run | null;
  today: LogEntry | undefined;
  lastLog: LogEntry | undefined;
  onSetPos: (p: Pos) => void;
  onStart: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onMarkDone: () => void;
  onLogTest: () => void;
}

export function Home({ pos, run, today, lastLog, onSetPos, onStart, onResume, onDiscard, onMarkDone, onLogTest }: Props) {
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const day = getDay(pos);
  const deload = isDeload(pos);

  return (
    <div className="screen">
      <button className="pos-btn" onClick={() => setPicking(true)}>
        <span className="eyebrow">Month {pos.month} · Week {pos.week}{deload ? ' · Deload' : ''}</span>
        <span className="pos-day">Day {pos.day}</span>
        <span className="pos-change">Change</span>
      </button>
      <h2 className="day-title">{day.title}</h2>
      {deload && <p className="note">Deload week: half the sets, same effort.</p>}
      {day.notes.map((n) => <p className="note" key={n}>{n}</p>)}
      {today && <p className="ok-line">Done today: Day {today.pos.day} · {today.title.replace(/^Day \d+ · /, '')}</p>}
      {!today && lastLog && <p className="muted small">Last: {shortDate(lastLog.date)}, Month {lastLog.pos.month} · Week {lastLog.pos.week} · Day {lastLog.pos.day}</p>}

      {run && !run.finished && run.kind === 'session' && (
        <div className="card resume">
          <span className="eyebrow">Session in progress</span>
          <b>{run.title}</b>
          <span className="muted small">
            Month {run.pos.month} · Week {run.pos.week} · exercise {run.steps[run.idx].ex + 1} of {run.exercises.length}
          </span>
          <div className="split">
            <button
              className={`secondary${confirmDiscard ? ' danger' : ''}`}
              onClick={() => {
                if (!confirmDiscard) {
                  setConfirmDiscard(true);
                  window.setTimeout(() => setConfirmDiscard(false), 3000);
                } else {
                  setConfirmDiscard(false);
                  onDiscard();
                }
              }}
            >
              {confirmDiscard ? 'Tap to discard' : 'Discard'}
            </button>
            <button className="primary small-primary" onClick={onResume}>Resume</button>
          </div>
        </div>
      )}

      <ul className="plan-list">
        {day.warmup && (
          <li>
            <span className="name">Warm-up</span>
            <span className="do">{day.warmup.items.map((i) => i.name.toLowerCase()).join(', ')}</span>
          </li>
        )}
        {day.exercises.map((e, i) => (
          <li key={i}>
            <span className="name">{e.name}</span>
            <span className="do">{e.do}</span>
          </li>
        ))}
      </ul>

      {pos.day === 6 && <button className="secondary wide" onClick={onLogTest}>Log test results</button>}

      <details className="rules">
        <summary>Month {pos.month} target and rules</summary>
        <p>{monthTarget(pos)}</p>
        {plan.rules.map((r) => <p key={r.label}><b>{r.label}:</b> {r.text}</p>)}
        <p className="muted small">Beeps need the ringer switch off silent. Tap below to check the volume.</p>
        <button className="secondary" onClick={() => beep('long')}>Test sound</button>
      </details>

      <button className="link-btn" onClick={onMarkDone}>Mark Day {pos.day} done without the timer</button>

      {!(run && !run.finished && run.kind === 'session') && (
        <div className="dock above-tabs">
          <button className="primary" onClick={onStart}>Start session</button>
        </div>
      )}

      {picking && <DayPicker pos={pos} onClose={() => setPicking(false)} onSave={(p) => { onSetPos(p); setPicking(false); }} />}
    </div>
  );
}

function DayPicker({ pos, onSave, onClose }: { pos: Pos; onSave: (p: Pos) => void; onClose: () => void }) {
  const [p, setP] = useState(pos);
  const row = (key: keyof Pos, label: string) => (
    <div className="stepper">
      <span>{label}</span>
      <button onClick={() => setP({ ...p, [key]: Math.max(1, p[key] - 1) })} aria-label={`Previous ${label}`}>−</button>
      <b>{p[key]}</b>
      <button onClick={() => setP({ ...p, [key]: Math.min(LIMITS[key], p[key] + 1) })} aria-label={`Next ${label}`}>+</button>
    </div>
  );
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>Go to day</b>
          <button className="icon-btn text" onClick={onClose}>Cancel</button>
        </div>
        {row('month', 'Month')}
        {row('week', 'Week')}
        {row('day', 'Day')}
        <p className="muted small">{getDay(p).title}{isDeload(p) ? ' · Deload' : ''}</p>
        <button className="primary" onClick={() => onSave(p)}>Save</button>
      </div>
    </div>
  );
}
