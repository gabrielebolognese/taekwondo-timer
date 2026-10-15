import { useState, type PointerEvent } from 'react';
import { plan, planWeek, type Pos } from '../lib/plan';
import { dayStates, firstActivity, fullGtg, isSession, planDaysCompleted, streaks, windowStats, type DayState } from '../lib/progress';
import { addDays, goalKey, shortDate, type Completion, type GoalTicks, type GtgLog, type TestEntry } from '../lib/storage';

const TOTAL_DAYS = plan.months.reduce((n, m) => n + m.weeks.length * m.weeks[0].days.length, 0);

interface Props {
  pos: Pos;
  log: Completion[];
  gtg: GtgLog;
  tests: TestEntry[];
  ticks: GoalTicks;
  today: string;
  onToggleGoal: (month: number, goal: string) => void;
}

export function Progress({ pos, log, gtg, tests, ticks, today, onToggleGoal }: Props) {
  const states = dayStates(log, gtg);
  const { current, longest } = streaks(states, today);
  const start = firstActivity(log, gtg);
  const daysDone = planDaysCompleted(log);
  const gtgSlots = Object.values(gtg).reduce((n, d) => n + d.done.length, 0);

  return (
    <div className="screen">
      <h2 className="day-title">Progress</h2>

      <section className="pcard">
        <span className="eyebrow">Now at</span>
        <div className="p-pos">Month {pos.month} · Week {pos.week} · Day {pos.day}</div>
        <Meter value={daysDone} max={TOTAL_DAYS} />
        <div className="meter-caption">
          <span><b>{daysDone}</b> of {TOTAL_DAYS} plan days completed</span>
          <span>{Math.round((daysDone / TOTAL_DAYS) * 100)}%</span>
        </div>
        <div className="tiles">
          <Tile label="Sessions completed" value={log.filter(isSession).length} />
          <Tile label="GTG slots done" value={gtgSlots} />
        </div>
      </section>

      <h3 className="section-title">Momentum</h3>
      <div className="tiles">
        <Tile label="Current streak" value={current} unit={current === 1 ? 'day' : 'days'} />
        <Tile label="Longest streak" value={longest} unit={longest === 1 ? 'day' : 'days'} />
      </div>
      <section className="pcard">
        <Ratio label="Last 7 days" stats={windowStats(log, start, today, 7)} />
        <Ratio label="Last 28 days" stats={windowStats(log, start, today, 28)} />
        <p className="muted small">Planned is 6 sessions per 7 days, counted from your first logged day.</p>
      </section>
      <Heatmap states={states} log={log} gtg={gtg} today={today} />

      <h3 className="section-title">Goals</h3>
      <Goals month={pos.month} ticks={ticks} onToggle={onToggleGoal} />

      <h3 className="section-title">Test results</h3>
      {METRICS.map((m) => <MetricCard key={m.key} metric={m} tests={tests} />)}
    </div>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

function Tile({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}{unit && <span className="tile-unit"> {unit}</span>}</span>
    </div>
  );
}

function Ratio({ label, stats }: { label: string; stats: ReturnType<typeof windowStats> }) {
  return (
    <div className="ratio">
      <div className="ratio-head">
        <span>{label}</span>
        {stats.pct === null ? (
          <span className="muted">No sessions logged yet</span>
        ) : (
          <span><b>{stats.done}</b> of {stats.planned} · <b>{stats.pct}%</b></span>
        )}
      </div>
      <Meter value={stats.done} max={stats.planned} />
    </div>
  );
}

const STATE_TEXT: Record<DayState, string> = { session: 'Session done', gtg: 'All GTG slots done', none: 'Nothing logged' };

function Heatmap({ states, log, gtg, today }: { states: Map<string, DayState>; log: Completion[]; gtg: GtgLog; today: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const dates = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
  const rows = [0, 1, 2, 3].map((r) => dates.slice(r * 7, r * 7 + 7));

  const detail = (date: string) => {
    const parts = log.filter((c) => c.date === date).map((c) => `${c.title}${c.manual ? ' (marked)' : ''}`);
    const g = gtg[date];
    if (g?.done.length) parts.push(`GTG ${g.done.length} of ${g.total}${fullGtg(gtg, date) ? ', full day' : ''}`);
    return `${shortDate(date)}: ${parts.length ? parts.join(', ') : 'nothing logged'}`;
  };

  return (
    <section className="pcard">
      <div className="heatmap">
        {rows.map((row) => (
          <div className="hm-row" key={row[0]}>
            <span className="hm-label">{shortDate(row[0])}</span>
            {row.map((d) => {
              const state = states.get(d) ?? 'none';
              return (
                <button
                  key={d}
                  className={`hm-cell ${state}${d === today ? ' today' : ''}${d === selected ? ' sel' : ''}`}
                  aria-label={`${shortDate(d)}: ${STATE_TEXT[state]}`}
                  onClick={() => setSelected(d)}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hm-detail">{selected ? detail(selected) : 'Tap a day for details.'}</p>
      <div className="legend">
        <span><i className="hm-key session" />Session</span>
        <span><i className="hm-key gtg" />GTG only, all slots</span>
        <span><i className="hm-key none" />Nothing</span>
      </div>
    </section>
  );
}

function Goals({ month, ticks, onToggle }: { month: number; ticks: GoalTicks; onToggle: (m: number, g: string) => void }) {
  const cur = plan.months[month - 1];
  const past = plan.months.slice(0, month - 1).reverse();
  const list = (m: number, goals: string[]) => (
    <ul className="goals">
      {goals.map((g) => {
        const on = !!ticks[goalKey(m, g)];
        return (
          <li key={g}>
            <button className={`goal${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onToggle(m, g)}>
              <span className="tick">{on ? '✓' : ''}</span>
              <span>{g}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <section className="pcard">
        <span className="eyebrow">Month {cur.month}</span>
        {list(cur.month, cur.goals)}
        {cur.targetNote && <p className="muted small">{cur.targetNote}</p>}
      </section>
      {past.map((m) => {
        const ticked = m.goals.filter((g) => ticks[goalKey(m.month, g)]).length;
        return (
          <details className="rules" key={m.month}>
            <summary>Month {m.month} goals · {ticked} of {m.goals.length} ticked</summary>
            {list(m.month, m.goals)}
          </details>
        );
      })}
    </>
  );
}

type MetricKey = 'maxJump' | 'highestKick' | 'landed540' | 'landed720' | 'ballHeight';
interface Metric {
  key: MetricKey;
  label: string;
  outOf10?: boolean;
}

const METRICS: Metric[] = [
  { key: 'maxJump', label: 'Max jump' },
  { key: 'highestKick', label: 'Highest kick' },
  { key: 'landed540', label: '540 landed', outOf10: true },
  { key: 'landed720', label: '720 landed', outOf10: true },
  { key: 'ballHeight', label: 'Ball height' },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

function MetricCard({ metric, tests }: { metric: Metric; tests: TestEntry[] }) {
  const [active, setActive] = useState<number | null>(null);
  const fmt = (v: number) => (metric.outOf10 ? `${v}/10` : `${v} cm`);
  const points = [...tests]
    .sort((a, b) => planWeek(a) - planWeek(b) || a.date.localeCompare(b.date))
    .filter((t) => t[metric.key] !== undefined)
    .map((t) => ({ v: t[metric.key]!, week: planWeek(t) }));

  if (!points.length) {
    return (
      <section className="pcard metric">
        <div className="metric-head"><b>{metric.label}</b><span className="muted small">No tests logged</span></div>
      </section>
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  const delta = round1(last.v - first.v);
  const deltaText = delta === 0 ? 'No change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}${metric.outOf10 ? '' : ' cm'}`;
  const readout = active !== null && points[active]
    ? `Week ${points[active].week}: ${fmt(points[active].v)}`
    : points.length > 1 ? 'Tap the chart for values' : 'One test so far';

  return (
    <section className="pcard metric">
      <div className="metric-head"><b>{metric.label}</b><span className="muted small">{readout}</span></div>
      <div className="metric-stats">
        <span><span className="muted small">First</span><b>{fmt(first.v)}</b><span className="muted small">Week {first.week}</span></span>
        <span><span className="muted small">Latest</span><b>{fmt(last.v)}</b><span className="muted small">Week {last.week}</span></span>
        <span><span className="muted small">Change</span><b className={delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>{deltaText}</b></span>
      </div>
      {points.length > 1 && (
        <LineChart
          values={points.map((p) => p.v)}
          weeks={points.map((p) => p.week)}
          max={metric.outOf10 ? 10 : undefined}
          label={metric.label}
          active={active}
          onActive={setActive}
        />
      )}
    </section>
  );
}

function niceTicks(lo: number, hi: number, max?: number): number[] {
  if (max) return [0, max / 2, max];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / 2;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t < hi + step * 0.999; t += step) out.push(round1(t));
  return out;
}

interface ChartProps {
  values: number[];
  weeks: number[];
  max?: number;
  label: string;
  active: number | null;
  onActive: (i: number) => void;
}

function LineChart({ values, weeks, max, label, active, onActive }: ChartProps) {
  const W = 320;
  const H = 140;
  const L = 34;
  const R = 34;
  const T = 12;
  const B = 24;
  const ticks = niceTicks(Math.min(...values), Math.max(...values), max);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const n = values.length;
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    onActive(best);
  };

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label} by plan week, from ${values[0]} to ${values[n - 1]}`}
      onPointerDown={pick}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text className="axis" x={L - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">{t}</text>
        </g>
      ))}
      <text className="axis" x={x(0)} y={H - 6} textAnchor="start">W{weeks[0]}</text>
      <text className="axis" x={x(n - 1)} y={H - 6} textAnchor="end">W{weeks[n - 1]}</text>
      {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={T} y2={H - B} />}
      <polyline className="line" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
      {values.map((v, i) => (
        <circle key={i} className="dot" cx={x(i)} cy={y(v)} r={i === active ? 6 : 4.5} />
      ))}
      <text className="end-label" x={x(n - 1) + 9} y={y(values[n - 1])} dominantBaseline="middle">{values[n - 1]}</text>
    </svg>
  );
}
