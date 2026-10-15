import { useState } from 'react';
import { beep } from '../lib/audio';
import { getDay, isDeload, LIMITS, monthTarget, nextPos, plan, type Pos } from '../lib/plan';
import type { Run } from '../lib/steps';
import { shortDate, type Completion } from '../lib/storage';

interface Props {
  pos: Pos;
  run: Run | null;
  /** Latest completion logged today. */
  today: Completion | undefined;
  /** Most recent completion overall, the one Undo reverts. */
  last: Completion | undefined;
  /** Latest completion of the day on screen, if it was completed before. */
  completedHere: Completion | undefined;
  onSetPos: (p: Pos) => void;
  onStart: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onMarkCompleted: () => void;
  onUndo: () => void;
  onLogTest: () => void;
}

/** First tap arms the button for 3 s, second tap confirms. */
function useTwoTap(action: () => void): [boolean, () => void] {
  const [armed, setArmed] = useState(false);
  const tap = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
    } else {
      setArmed(false);
      action();
    }
  };
  return [armed, tap];
}

const where = (p: Pos) => `Month ${p.month} · Week ${p.week} · Day ${p.day}`;

export function Home(props: Props) {
  const { pos, run, today, last, completedHere, onSetPos, onStart, onResume, onDiscard, onMarkCompleted, onUndo, onLogTest } = props;
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discardArmed, tapDiscard] = useTwoTap(onDiscard);
  const [undoArmed, tapUndo] = useTwoTap(onUndo);
  const day = getDay(pos);
  const deload = isDeload(pos);
  const inProgress = !!run && !run.finished && run.kind === 'session';
  const done = new Set(completedHere?.done ?? []);
  const next = nextPos(pos);

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
      {completedHere && (
        <p className="ok-line">✓ Completed {shortDate(completedHere.date)}{completedHere.manual ? ' (marked)' : ''}</p>
      )}
      {!completedHere && today && <p className="ok-line">Done today: Day {today.pos.day} · {today.title.replace(/^Day \d+ · /, '')}</p>}

      {inProgress && (
        <div className="card resume">
          <span className="eyebrow">Session in progress</span>
          <b>{run.title}</b>
          <span className="muted small">
            Month {run.pos.month} · Week {run.pos.week} · exercise {run.steps[run.idx].ex + 1} of {run.exercises.length}
          </span>
          <button className={`secondary${discardArmed ? ' danger' : ''}`} onClick={tapDiscard}>
            {discardArmed ? 'Tap to discard' : 'Discard'}
          </button>
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
          <li key={i} className={done.has(e.name) ? 'done' : undefined}>
            <span className="name">{done.has(e.name) && <span className="check-mark">✓ </span>}{e.name}</span>
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

      {last && (
        <button className="link-btn" onClick={tapUndo}>
          {undoArmed ? `Tap again to undo Day ${last.pos.day}` : `Undo last completion (Day ${last.pos.day}, ${shortDate(last.date)})`}
        </button>
      )}

      <div className="dock above-tabs">
        <div className="dock-split">
          <button className="secondary dock-secondary" onClick={() => setConfirming(true)}>Mark as completed</button>
          {inProgress
            ? <button className="primary" onClick={onResume}>Resume</button>
            : <button className="primary" onClick={onStart}>Start session</button>}
        </div>
      </div>

      {confirming && (
        <div className="sheet-backdrop" onClick={() => setConfirming(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title" className="confirm-title">Mark Day {pos.day} as completed?</h2>
            <p className="muted">{where(pos)} · {day.title}</p>
            <p className="small">
              Logs today&apos;s date with every exercise done and no timer data,
              {next ? ` then moves on to ${where(next)}.` : ' This is the last day of the plan.'}
            </p>
            {completedHere && <p className="small muted">Already completed on {shortDate(completedHere.date)}.</p>}
            {inProgress && run.pos.month === pos.month && run.pos.week === pos.week && run.pos.day === pos.day && (
              <p className="small muted">The session in progress for this day will be closed.</p>
            )}
            <div className="split">
              <button className="secondary" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="primary small-primary" onClick={() => { setConfirming(false); onMarkCompleted(); }}>Mark completed</button>
            </div>
          </div>
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
