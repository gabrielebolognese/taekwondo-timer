import { useEffect, useRef, useState, type ReactNode } from 'react';
import { coach, freshMemory } from '../lib/coach';
import { useStored, useWakeLock } from '../lib/hooks';
import * as R from '../lib/run';
import { isCountdown, type Run, type Step } from '../lib/steps';
import { hush, voiceSupported } from '../lib/voice';

interface Props {
  run: Run;
  onChange: (run: Run) => void;
  onClose: () => void;
  renderFinish: (run: Run) => ReactNode;
}

/** "45" for timers under a minute, "1:30" otherwise. */
export function fmtTime(ms: number, totalSec = 60): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sizeClass(text: string): string {
  if (text.length <= 3) return 'big-xl';
  if (text.length <= 5) return 'big-l';
  if (text.length <= 9) return 'big-m';
  return 'big-s';
}

function describe(s: Step): string {
  const value = s.big ?? (s.lines ? s.lines.join(', ') : s.sec ? fmtTime(s.sec * 1000, s.sec) + (s.sec < 60 ? ' s' : '') : '');
  return [s.label, [value, s.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

export function Runner({ run, onChange, onClose, renderFinish }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [listOpen, setListOpen] = useState(false);
  const runRef = useRef(run);
  const onChangeRef = useRef(onChange);
  const coachRef = useRef(freshMemory());
  const [voice, setVoice] = useStored<boolean>('voiceOn', true);
  runRef.current = run;
  onChangeRef.current = onChange;
  useWakeLock(!run.finished);

  const commit = (r: Run) => {
    runRef.current = r;
    onChangeRef.current(r);
  };
  const act = (f: (r: Run, t: number) => Run) => commit(f(runRef.current, Date.now()));

  useEffect(() => {
    coachRef.current = freshMemory();
    const loop = () => {
      const t = Date.now();
      const { run: r, ended } = R.tick(runRef.current, t);
      // Timers that ran out while the app was in the background move on without a sound.
      const quiet = ended.length > 0 && t - ended[ended.length - 1] > 1500;
      if (r !== runRef.current) commit(r);
      coach(r, t, coachRef.current, quiet);
      setNow(t);
    };
    loop();
    const id = window.setInterval(loop, 100);
    document.addEventListener('visibilitychange', loop);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', loop);
      hush();
    };
  }, []);

  if (run.finished) return <div className="runner finish">{renderFinish(run)}</div>;

  const step = run.steps[run.idx];
  const ex = run.exercises[step.ex];
  const timer = run.timer;
  const running = !!timer && 'endsAt' in timer;
  const paused = !!timer && 'left' in timer;
  const leftMs = timer ? ('endsAt' in timer ? Math.max(0, timer.endsAt - now) : timer.left) : (step.sec ?? 0) * 1000;
  const timed = R.isTimed(step);
  const isRest = isCountdown(step);
  const cd = isRest ? step.cd ?? 'rest' : null;
  const canDrop = run.kind === 'session' && !ex.warmup && !isRest;
  let nextIdx = run.idx + 1;
  while (isCountdown(run.steps[nextIdx])) nextIdx++;
  const upcoming = run.steps[nextIdx] as Step | undefined;

  let label = step.label;
  let big = step.big ?? '';
  let unit = step.unit;
  let detail = step.detail;
  if (step.mode === 'timer' || isRest) big = fmtTime(leftMs, step.sec);
  if (step.mode === 'emom') {
    const total = step.sec! * 1000;
    const minutes = Math.round(step.sec! / 60);
    const elapsed = total - leftMs;
    const minute = Math.min(Math.floor(elapsed / 60000), minutes - 1);
    big = String(Math.ceil((60000 - (elapsed % 60000)) / 1000));
    label = `Minute ${minute + 1} of ${minutes}`;
    unit = step.cues ? step.cues[minute % step.cues.length] : undefined;
    detail = `${step.perMinute} per minute · ${fmtTime(leftMs, step.sec)} left`;
  }

  const nextEx = run.exercises[step.ex + 1];
  let preview: ReactNode = null;
  if (isRest && upcoming) {
    preview = (
      <>
        <span className="eyebrow">Up next</span>
        <b>{run.exercises[upcoming.ex].name}</b>
        <span>{describe(upcoming)}</span>
      </>
    );
  } else if (nextEx) {
    preview = (
      <>
        <span className="eyebrow">Next exercise</span>
        <b>{nextEx.name}</b>
        <span>{nextEx.summary}</span>
      </>
    );
  } else {
    preview = <span className="eyebrow">Last exercise</span>;
  }

  const toggleTimer = () => act(running ? R.pause : R.startOrResume);
  const doneCount = run.steps.length ? run.idx / run.steps.length : 0;

  return (
    <div className={`runner${isRest ? ' resting' : ''}`}>
      <header className="runner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close and keep progress">✕</button>
        <div className="runner-count">
          {ex.warmup && <span className="chip">Warm-up</span>}
          {run.kind === 'gtg' && <span className="chip">GTG</span>}
          <span>{step.ex + 1} / {run.exercises.length}</span>
        </div>
        <div className="runner-actions">
          {voiceSupported() && (
            <button
              className={`icon-btn voice-btn${voice ? ' on' : ''}`}
              aria-label={voice ? 'Voice on, tap to mute' : 'Voice off, tap to turn on'}
              aria-pressed={voice}
              onClick={() => {
                if (voice) hush();
                setVoice(!voice);
              }}
            >
              <SpeakerIcon on={voice} />
            </button>
          )}
          <button className="icon-btn text" onClick={() => setListOpen(true)}>List</button>
        </div>
      </header>
      <div className="progress"><div style={{ width: `${doneCount * 100}%` }} /></div>

      <h1 className="ex-name">{cd === 'switch' ? 'Switch sides' : cd === 'ready' ? 'Get ready' : cd ? 'Rest' : ex.name}</h1>

      <main
        className={`stage${timed ? ' tappable' : ''}`}
        onClick={timed && !isRest ? toggleTimer : undefined}
      >
        {!isRest && <div className="step-label">{label}</div>}
        {step.lines ? (
          <ol className="lines">{step.lines.map((l) => <li key={l}>{l}</li>)}</ol>
        ) : (
          <div className={`big ${sizeClass(big)}${paused ? ' paused' : ''}`}>{big}</div>
        )}
        {isRest
          ? <div className="unit">{cd === 'switch' && upcoming ? upcoming.label : upcoming ? run.exercises[upcoming.ex].name : ex.name}</div>
          : unit && <div className="unit">{unit}</div>}
        {!isRest && detail && <div className="detail">{detail}</div>}
        {paused && <div className="detail">Paused</div>}
        {step.mode === 'count' && (
          <div className="detail">
            {step.count!.yes} so far: {R.counts(run)[step.count!.field] ?? 0}
          </div>
        )}
      </main>

      <div className="preview">{preview}</div>

      <div className="secondary-row">
        <button className="ghost" onClick={() => commit(R.back(runRef.current))} disabled={!run.history.length}>Back</button>
        {isRest && <button className="ghost" onClick={() => act((r) => R.addTime(r, 15000))}>+15 s</button>}
        {(step.mode === 'timer' || step.mode === 'emom' || step.mode === 'count') && (
          <button className="ghost" onClick={() => act(R.next)}>Skip</button>
        )}
        {canDrop && <button className="ghost warn" onClick={() => act(R.dropExercise)}>Output dropped</button>}
      </div>

      <div className="dock runner-dock">
        {step.mode === 'tap' && <button className="primary" onClick={() => act(R.next)}>{step.done ?? 'Done'}</button>}
        {(step.mode === 'timer' || step.mode === 'emom') && (
          <button className={`primary${running ? ' muted-btn' : ''}`} onClick={toggleTimer}>
            {running ? 'Pause' : paused ? 'Resume' : 'Start'}
          </button>
        )}
        {isRest && <button className="primary rest-btn" onClick={() => act(R.next)}>{cd === 'rest' ? 'Skip rest' : 'Start now'}</button>}
        {step.mode === 'count' && (
          <div className="split">
            <button className="primary muted-btn" onClick={() => act((r, t) => R.answer(r, false, t))}>{step.count!.no}</button>
            <button className="primary" onClick={() => act((r, t) => R.answer(r, true, t))}>{step.count!.yes}</button>
          </div>
        )}
      </div>

      {listOpen && (
        <div className="sheet-backdrop" onClick={() => setListOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <b>{run.title}</b>
              <button className="icon-btn text" onClick={() => setListOpen(false)}>Close</button>
            </div>
            <ul className="ex-list">
              {run.exercises.map((e, i) => {
                const state = run.dropped.includes(i) ? 'dropped' : i === step.ex ? 'current' : R.lastStepOf(run, i) < run.idx ? 'done' : '';
                return (
                  <li key={i}>
                    <button
                      className={`ex-row ${state}`}
                      onClick={() => {
                        act((r, t) => R.jumpToExercise(r, i, t));
                        setListOpen(false);
                      }}
                    >
                      <span className="ex-row-name">{e.warmup ? `Warm-up: ${e.name}` : e.name}</span>
                      <span className="ex-row-do">{state === 'dropped' ? 'Output dropped' : state === 'done' ? 'Done' : e.summary}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button className="secondary" onClick={() => { act(R.finishNow); setListOpen(false); }}>
              {run.kind === 'session' ? 'Finish session now' : 'Finish set now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6M22 9l-6 6" />}
    </svg>
  );
}
