// Service worker registration. New versions are applied right away, except while
// a session or GTG run is on screen, where a reload would interrupt the timer.

import { registerSW } from 'virtual:pwa-register';

let update: ((reload?: boolean) => Promise<void>) | null = null;
let pending = false;
let busy = false;

function maybeApply() {
  if (pending && !busy && update) {
    pending = false;
    void update(true);
  }
}

export function initPwa() {
  let registration: ServiceWorkerRegistration | undefined;
  let lastCheck = Date.now();
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      maybeApply();
    },
    onRegisteredSW(_url, r) {
      registration = r;
    },
  });
  // iOS often brings a home screen app back without reloading it, which skips the update check
  // a fresh start does. Check again when the app returns to the screen, at most once a minute.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !registration || Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    void registration.update().catch(() => {});
  });
}

export function setRunnerOpen(open: boolean) {
  busy = open;
  maybeApply();
}
