import { useEffect, useState } from 'react';
import { useStored } from './lib/hooks';
import { getDay, nextPos, START, type GtgSlot, type Pos } from './lib/plan';
import { setRunnerOpen } from './lib/pwa';
import { back, counts } from './lib/run';
import { buildGtg, buildSession, type Run } from './lib/steps';
import { todayKey, type GtgDone, type LogEntry, type TestEntry } from './lib/storage';
import { Gtg } from './screens/Gtg';
import { Home } from './screens/Home';
import { Runner } from './screens/Runner';
import { TestForm, Tests } from './screens/Tests';

type Tab = 'train' | 'gtg' | 'tests';
type TestDraft = Partial<TestEntry> & { month: number; week: number };

const TABS: { id: Tab; label: string }[] = [
  { id: 'train', label: 'Train' },
  { id: 'gtg', label: 'GTG' },
  { id: 'tests', label: 'Tests' },
];

export function App() {
  const [tab, setTab] = useStored<Tab>('tab', 'train');
  const [pos, setPos] = useStored<Pos>('pos', START);
  const [session, setSession] = useStored<Run | null>('run', null);
  const [log, setLog] = useStored<LogEntry[]>('log', []);
  const [tests, setTests] = useStored<TestEntry[]>('tests', []);
  const [gtgDone, setGtgDone] = useStored<GtgDone>('gtgDone', {});
  const [gtgRun, setGtgRun] = useState<Run | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [testDraft, setTestDraft] = useState<TestDraft | null>(null);
  const [today, setToday] = useState(todayKey);

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

  // GTG follows the session trained today (its day decides the slot column), else the current day.
  const todaySession = log.findLast((l) => l.date === today && !l.skipped);
  const gtgPos = todaySession?.pos ?? pos;
  const doneSlots = gtgDone[today] ?? [];

  const upsertTest = (t: TestEntry) => setTests((list) => [...list.filter((x) => x.id !== t.id), t]);

  const advanceFrom = (from: Pos) => {
    const n = nextPos(from);
    if (n) setPos(n);
  };

  const finishSession = (run: Run, test?: TestEntry) => {
    const entry: LogEntry = {
      date: todayKey(),
      at: Date.now(),
      pos: run.pos,
      title: run.title,
      minutes: Math.round((Date.now() - run.startedAt) / 60_000),
      dropped: run.dropped.map((i) => run.exercises[i].name),
    };
    setLog((l) => [...l, entry].slice(-500));
    if (test) upsertTest(test);
    advanceFrom(run.pos);
    setSession(null);
    setSessionOpen(false);
    setTab('train');
  };

  const markDayDone = () => {
    const entry: LogEntry = {
      date: todayKey(), at: Date.now(), pos, title: `Day ${pos.day} · ${getDay(pos).title}`, minutes: 0, dropped: [], skipped: true,
    };
    setLog((l) => [...l, entry].slice(-500));
    advanceFrom(pos);
  };

  const setSlotDone = (index: number, on: boolean, date = today) => {
    setGtgDone((all) => {
      const kept: GtgDone = {};
      const cutoff = todayKey(new Date(Date.now() - 30 * 86_400_000));
      for (const [d, list] of Object.entries(all)) if (d >= cutoff) kept[d] = list;
      const list = kept[date] ?? [];
      kept[date] = on ? [...new Set([...list, index])] : list.filter((i) => i !== index);
      return kept;
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
          today={log.findLast((l) => l.date === today)}
          lastLog={log.at(-1)}
          onSetPos={setPos}
          onStart={() => {
            setSession(buildSession(pos));
            setSessionOpen(true);
          }}
          onResume={() => setSessionOpen(true)}
          onDiscard={() => setSession(null)}
          onMarkDone={markDayDone}
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

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
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
