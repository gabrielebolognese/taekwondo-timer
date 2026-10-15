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
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      maybeApply();
    },
  });
}

export function setRunnerOpen(open: boolean) {
  busy = open;
  maybeApply();
}
