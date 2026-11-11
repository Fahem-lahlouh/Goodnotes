import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa/register';
import { applyTheme, getPrefs } from './ui/prefs';
import './styles/app.css';

applyTheme(getPrefs().theme);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
