import { useEffect, useState } from 'react';
import { useStored, useSyncStatus } from './lib/hooks';
import { getDay, gtgDay, nextPos, START, type GtgSlot, type Pos } from './lib/plan';
import { setRunnerOpen } from './lib/pwa';
import { back, counts } from './lib/run';
import { buildGtg, buildSession, type Run } from './lib/steps';
import { goalKey, todayKey, type Completion, type GoalTicks, type GtgLog, type TestEntry } from './lib/storage';
import { Gtg } from './screens/Gtg';
import { Home } from './screens/Home';
import { Progress } from './screens/Progress';
import { Runner } from './screens/Runner';
import { Settings } from './screens/Settings';
import { TestForm, Tests } from './screens/Tests';

type Tab = 'train' | 'gtg' | 'tests' | 'progress' | 'settings';
type TestDraft = Partial<TestEntry> & { month: number; week: number };

const TABS: { id: Tab; label: string }[] = [
  { id: 'train', label: 'Train' },
  { id: 'gtg', label: 'GTG' },
  { id: 'tests', label: 'Tests' },
  { id: 'progress', label: 'Progress' },
  { id: 'settings', label: 'Settings' },
];

const samePos = (a: Pos, b: Pos) => a.month === b.month && a.week === b.week && a.day === b.day;

/** Main exercises the run reached (or ended with "Output dropped"). Warm-up items are not counted. */
function exercisesDone(run: Run): string[] {
  const visited = new Set([...run.history, run.idx]);
  const reached = new Set(run.steps.filter((_, i) => visited.has(i)).map((s) => s.ex));
  return run.exercises
    .filter((e, i) => !e.warmup && (reached.has(i) || run.dropped.includes(i)))
    .map((e) => e.name);
}

export function App() {
  const [tab, setTab] = useStored<Tab>('tab', 'train');
  const [pos, setPos] = useStored<Pos>('pos', START);
  const [session, setSession] = useStored<Run | null>('run', null);
  const [log, setLog] = useStored<Completion[]>('log', []);
  const [tests, setTests] = useStored<TestEntry[]>('tests', []);
  const [gtg, setGtg] = useStored<GtgLog>('gtg', {});
  const [ticks, setTicks] = useStored<GoalTicks>('goals', {});
  const [gtgRun, setGtgRun] = useState<Run | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [testDraft, setTestDraft] = useState<TestDraft | null>(null);
  const [today, setToday] = useState(todayKey);
  const sync = useSyncStatus();

  useEffect(() => {
    const refresh = () => setToday(todayKey());
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const runnerOpen = (sessionOpen && !!session) || !!gtgRun;
  useEffect(() => setRunnerOpen(runnerOpen), [runnerOpen]);

  // GTG follows the plan day completed today (its day decides the slot column), else the current day.
  const todayDone = log.findLast((c) => c.date === today);
  const gtgPos = todayDone?.pos ?? pos;
  const doneSlots = gtg[today]?.done ?? [];

  const upsertTest = (t: TestEntry) => setTests((list) => [...list.filter((x) => x.id !== t.id), t]);

  /** Records a completed plan day and moves to the next one, with week and month rollover. */
  const complete = (entry: Omit<Completion, 'date' | 'at'>) => {
    setLog((l) => [...l, { date: todayKey(), at: Date.now(), ...entry }]);
    const n = nextPos(entry.pos);
    if (n) setPos(n);
  };

  const finishSession = (run: Run, test?: TestEntry) => {
    complete({
      pos: run.pos,
      title: run.title,
      minutes: Math.round((Date.now() - run.startedAt) / 60_000),
      dropped: run.dropped.map((i) => run.exercises[i].name),
      done: exercisesDone(run),
    });
    if (test) upsertTest(test);
    setSession(null);
    setSessionOpen(false);
    setTab('train');
  };

  const markCompleted = () => {
    const day = getDay(pos);
    complete({ pos, title: `Day ${pos.day} · ${day.title}`, manual: true, dropped: [], done: day.exercises.map((e) => e.name) });
    // A half-run session for the same day is superseded by the completion.
    if (session && samePos(session.pos, pos)) setSession(null);
  };

  const undoLastCompletion = () => {
    const last = log.at(-1);
    if (!last) return;
    setLog((l) => l.slice(0, -1));
    setPos(last.pos);
  };

  const setSlotDone = (index: number, on: boolean, date = today) => {
    const total = gtgDay(gtgPos).slots.length;
    setGtg((all) => {
      const list = all[date]?.done ?? [];
      const done = on ? [...new Set([...list, index])] : list.filter((i) => i !== index);
      return { ...all, [date]: { done, total } };
    });
  };

  const toggleGoal = (month: number, goal: string) => {
    const key = goalKey(month, goal);
    setTicks((t) => {
      const nextTicks = { ...t };
      if (nextTicks[key]) delete nextTicks[key];
      else nextTicks[key] = true;
      return nextTicks;
    });
  };

  if (sessionOpen && session) {
    return (
      <Runner
        run={session}
        onChange={setSession}
        onClose={() => setSessionOpen(false)}
        renderFinish={(run) => (
          <SessionFinish run={run} onBack={() => setSession(back(run))} onDone={(t) => finishSession(run, t)} />
        )}
      />
    );
  }

  if (gtgRun) {
    return (
      <Runner
        run={gtgRun}
        onChange={setGtgRun}
        onClose={() => setGtgRun(null)}
        renderFinish={(run) => (
          <div className="finish-inner">
            <span className="eyebrow">GTG set done</span>
            <h1>{run.title}</h1>
            <button
              className="primary"
              onClick={() => {
                if (run.gtgSlot) setSlotDone(run.gtgSlot.index, true, run.gtgSlot.date);
                setGtgRun(null);
              }}
            >
              Mark done
            </button>
            <button className="ghost" onClick={() => setGtgRun(back(run))}>Back</button>
          </div>
        )}
      />
    );
  }

  return (
    <div className="app">
      {tab === 'train' && (
        <Home
          pos={pos}
          run={session}
          today={todayDone}
          last={log.at(-1)}
          completedHere={log.findLast((c) => samePos(c.pos, pos))}
          onSetPos={setPos}
          onStart={() => {
            setSession(buildSession(pos));
            setSessionOpen(true);
          }}
          onResume={() => setSessionOpen(true)}
          onDiscard={() => setSession(null)}
          onMarkCompleted={markCompleted}
          onUndo={undoLastCompletion}
          onLogTest={() => setTestDraft({ month: pos.month, week: pos.week })}
        />
      )}
      {tab === 'gtg' && (
        <Gtg
          pos={gtgPos}
          done={doneSlots}
          onToggle={(i) => setSlotDone(i, !doneSlots.includes(i))}
          onRun={(s: GtgSlot) => setGtgRun(buildGtg(gtgPos, s.letter, s.time, today, s.index))}
        />
      )}
      {tab === 'tests' && (
        <Tests
          entries={tests}
          isTestDay={pos.day === 6}
          onAdd={() => setTestDraft({ month: pos.month, week: pos.week })}
          onEdit={(e) => setTestDraft(e)}
        />
      )}
      {tab === 'progress' && (
        <Progress pos={pos} log={log} gtg={gtg} tests={tests} ticks={ticks} today={today} onToggleGoal={toggleGoal} />
      )}
      {tab === 'settings' && <Settings />}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-label">
              {t.label}
              {t.id === 'settings' && (sync.state === 'error' || sync.state === 'conflict') && (
                <span className="tab-badge" aria-label="Sync needs attention" />
              )}
            </span>
          </button>
        ))}
      </nav>

      {testDraft && (
        <div className="sheet-backdrop" onClick={() => setTestDraft(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <b>{testDraft.id ? 'Edit test' : 'Log test'}</b>
            </div>
            <TestForm
              initial={testDraft}
              onSave={(t) => {
                upsertTest(t);
                setTestDraft(null);
              }}
              onCancel={() => setTestDraft(null)}
              onDelete={testDraft.id ? () => {
                setTests((list) => list.filter((x) => x.id !== testDraft.id));
                setTestDraft(null);
              } : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SessionFinish({ run, onDone, onBack }: { run: Run; onDone: (t?: TestEntry) => void; onBack: () => void }) {
  const minutes = Math.max(1, Math.round((Date.now() - run.startedAt) / 60_000));
  const dropped = run.dropped.map((i) => run.exercises[i].name);
  const isTestDay = run.pos.day === 6;
  return (
    <div className="finish-inner">
      <span className="eyebrow">Session done</span>
      <h1>{run.title}</h1>
      <p className="muted">Month {run.pos.month} · Week {run.pos.week} · {minutes} min</p>
      {dropped.length > 0 && <p className="muted small">Output dropped: {dropped.join(', ')}</p>}
      {isTestDay ? (
        <>
          <h2 className="section-title">Test results</h2>
          <TestForm
            initial={{ month: run.pos.month, week: run.pos.week, ...counts(run) }}
            onSave={(t) => onDone(t)}
            saveLabel="Save test and finish"
          />
          <button className="secondary wide" onClick={() => onDone()}>Finish without saving</button>
        </>
      ) : (
        <button className="primary" onClick={() => onDone()}>Finish</button>
      )}
      <button className="ghost" onClick={onBack}>Back</button>
    </div>
  );
}
