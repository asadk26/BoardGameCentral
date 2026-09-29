import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Phones get the lightweight controller; everything else gets the 3D board.
// Hash routing keeps every link working after a reload on static hosting.
const isPhone = () => location.hash.startsWith('#/join');
const PhoneApp = lazy(() => import('./phone/PhoneApp').then((m) => ({ default: m.PhoneApp })));
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));

const phone = isPhone();
window.addEventListener('hashchange', () => {
  if (isPhone() !== phone) location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>{phone ? <PhoneApp /> : <App />}</Suspense>
  </StrictMode>,
);

