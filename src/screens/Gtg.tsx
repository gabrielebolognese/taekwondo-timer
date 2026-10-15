import { gtgDay, gtgSet, plan, type GtgSlot, type Pos } from '../lib/plan';

interface Props {
  pos: Pos;
  done: number[];
  onToggle: (index: number) => void;
  onRun: (slot: GtgSlot) => void;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function Gtg({ pos, done, onToggle, onRun }: Props) {
  const { slots, alternate, altDays, deload } = gtgDay(pos);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Next = first open slot that is not more than 45 min in the past.
  const next = slots.find((s) => !done.includes(s.index) && minutesOf(s.time) >= nowMin - 45);
  const doneToday = slots.filter((s) => done.includes(s.index)).length;

  return (
    <div className="screen">
      <span className="eyebrow">Month {pos.month} · Week {pos.week} · Day {pos.day}</span>
      <h2 className="day-title">GTG today</h2>
      <p className="gtg-progress"><b>{doneToday}</b> of {slots.length} done</p>
      {alternate && <p className="note">Alternate slots for Day {altDays.join(' and Day ')}: no set D.</p>}
      {deload && <p className="note">Deload week: {plan.gtg.deloadSlots} sets today.</p>}

      <ul className="slots">
        {slots.map((s) => {
          const { set, version } = gtgSet(s.letter, pos.month);
          const isDone = done.includes(s.index);
          return (
            <li key={s.index} className={`slot${isDone ? ' done' : ''}${s === next ? ' next' : ''}`}>
              <button className="slot-main" onClick={() => onRun(s)}>
                <span className="slot-time">{s.time}</span>
                <span className="slot-body">
                  <span className="slot-head"><span className="letter">{s.letter}</span>{set.label}{s === next && <span className="chip">Next</span>}</span>
                  <span className="slot-text">{version.text}</span>
                </span>
              </button>
              <button
                className={`check${isDone ? ' on' : ''}`}
                onClick={() => onToggle(s.index)}
                aria-label={isDone ? `Mark ${s.time} not done` : `Mark ${s.time} done`}
              >
                {isDone ? '✓' : ''}
              </button>
            </li>
          );
        })}
      </ul>

      <details className="rules">
        <summary>GTG rules</summary>
        {plan.gtg.rules.map((r) => <p key={r}>{r}</p>)}
      </details>
    </div>
  );
}
