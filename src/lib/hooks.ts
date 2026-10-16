import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { load, save, subscribe } from './storage';
import { getSyncStatus, subscribeSync } from './sync';

/** A stored value. Re-renders when it changes, including when a backup or cloud copy replaces it. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const initial = useRef(fallback).current;
  const value = useSyncExternalStore(subscribe, () => load(key, initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => save(key, typeof v === 'function' ? (v as (p: T) => T)(load(key, initial)) : v),
    [key, initial],
  );
  return [value, set];
}

export const useSyncStatus = () => useSyncExternalStore(subscribeSync, getSyncStatus);

/** First tap arms the button for 3 s, second tap confirms. */
export function useTwoTap(action: () => void): [boolean, () => void] {
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
