import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAudioUnlock } from './lib/audio';
import { migrate } from './lib/migrate';
import { initPwa } from './lib/pwa';
import { initStorage, requestPersistence } from './lib/storage';
import { startSync } from './lib/sync';
import './styles.css';

async function boot() {
  // Before the first render, so every screen reads data from IndexedDB in the current shape.
  await initStorage();
  migrate();
  installAudioUnlock();
  initPwa();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void requestPersistence();
  startSync();
}

void boot();
