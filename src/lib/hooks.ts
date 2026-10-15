import { useCallback, useEffect, useState } from 'react';
import { load, save } from './storage';

/** State mirrored to localStorage. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const nextValue = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        save(key, nextValue);
        return nextValue;
      });
    },
    [key],
  );
  return [value, set];
}

/** Keeps the screen on while `active`, re-acquiring after the app comes back to the foreground. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (stopped) void l.release();
        else lock = l;
      } catch {
        // Denied (low battery mode, unsupported context). The session still runs.
      }
    };
    const onVisible = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
