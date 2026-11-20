import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

// The legacy Vercel hostname is a static frontend with no /api backend.
// Sending visitors to the canonical same-origin relay prevents mobile login
// failures (404) and preserves HttpOnly auth cookies on the correct domain.
const staticFrontend = location.hostname === 'hukam-ai.vercel.app';
if (staticFrontend) {
  const safePath = /^\/[a-z0-9/_-]*$/i.test(location.pathname) ? location.pathname : '/';
  location.replace('https://hukm-ai-relay.onrender.com' + safePath);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Only the canonical hosted app has working API, sessions and PWA caching.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}
