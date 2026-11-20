import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { BrainMark } from './components/Logo';
import { Spinner } from './components/ui';
import AppShell, { PageFrame } from './layouts/AppShell';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import { StoreProvider, useStore } from './services/store';

const Chat = lazy(() => import('./pages/Chat'));
const Voice = lazy(() => import('./pages/Voice'));
const Devices = lazy(() => import('./pages/Devices'));
const Automations = lazy(() => import('./pages/Automations'));
const Files = lazy(() => import('./pages/Files'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const Browser = lazy(() => import('./pages/Browser'));
const History = lazy(() => import('./pages/History'));
const Settings = lazy(() => import('./pages/Settings'));

function Loading() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="h-6 w-6 text-ice" />
    </div>
  );
}

function NotFound() {
  return (
    <PageFrame>
      <div className="py-20 text-center">
        <p className="font-display text-2xl font-bold">Page not found</p>
        <Link to="/" className="btn-primary mt-4">Back to dashboard</Link>
      </div>
    </PageFrame>
  );
}

function Gate() {
  const { auth } = useStore();
  if (auth === 'loading')
    return (
      <div className="grid min-h-screen place-items-center">
        <BrainMark className="h-14 w-14 animate-pulse" />
      </div>
    );
  if (auth !== 'ready') return <Login />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        {[
          ['chat', Chat], ['voice', Voice], ['devices', Devices], ['automations', Automations], ['files', Files],
          ['whatsapp', WhatsApp], ['browser', Browser], ['history', History], ['settings', Settings],
        ].map(([path, C]: any) => (
          <Route key={path} path={path} element={<Suspense fallback={<Loading />}><C /></Suspense>} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </BrowserRouter>
  );
}
