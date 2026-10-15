import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAudioUnlock } from './lib/audio';
import { initPwa } from './lib/pwa';
import './styles.css';

installAudioUnlock();
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
