import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAudioUnlock } from './lib/audio';
import { migrate } from './lib/migrate';
import { initPwa } from './lib/pwa';
import './styles.css';

// Before the first render, so every screen reads data in the current shape.
migrate();
installAudioUnlock();
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
