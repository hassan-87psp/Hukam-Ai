import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import Logo from '../components/Logo';
import { Spinner } from '../components/ui';
import { useReducedMotion } from '../hooks/useVoice';
import { useStore } from '../services/store';

const BrainOrb = lazy(() => import('../features/brain/BrainOrb'));

export default function Login() {
  const { auth, login, setup } = useStore();
  const isSetup = auth === 'setup';
  const reduced = useReducedMotion();
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (isSetup) await setup(f.email, f.name, f.password, f.code);
      else await login(f.email, f.password);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neural-bg relative grid min-h-screen lg:grid-cols-2">
      <div className="relative z-10 hidden flex-col items-center justify-center p-10 lg:flex">
        <div className="h-[420px] w-full max-w-[560px]">
          <Suspense fallback={null}><BrainOrb state="idle" reducedMotion={reduced} className="h-full w-full" /></Suspense>
        </div>
        <p className="font-display text-4xl font-bold tracking-tight">Just Speak. <span className="text-gradient">It’s Done.</span></p>
        <p className="mt-3 max-w-md text-center text-ink2">Control your own Windows laptop from your phone or browser — in Urdu, Roman Urdu or English.</p>
      </div>
      <div className="relative z-10 flex items-center justify-center p-5">
        <form onSubmit={submit} className="glass-strong w-full max-w-md animate-fade-up rounded-3xl p-7">
          <div className="mb-7 flex justify-center lg:justify-start"><Logo /></div>
          <h1 className="font-display text-2xl font-bold">{isSetup ? 'Create your owner account' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-ink2">{isSetup ? 'First run. Only one owner account can be created on this relay.' : 'Sign in to control your devices.'}</p>
          <div className="mt-6 space-y-4">
            {isSetup && (
              <>
                <div>
                  <label className="label" htmlFor="code">Setup code</label>
                  <input id="code" className="input font-mono tracking-widest" placeholder="XXXX-XXXX" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required autoComplete="off" />
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink2"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Printed in the relay server’s console on first start. It stops strangers from claiming your relay.</p>
                </div>
                <div>
                  <label className="label" htmlFor="name">Your name</label>
                  <input id="name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
                </div>
              </>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" type="password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={isSetup ? 10 : 1} autoComplete={isSetup ? 'new-password' : 'current-password'} />
              {isSetup && <p className="mt-1.5 text-xs text-ink2">At least 10 characters.</p>}
            </div>
          </div>
          {err && <p className="mt-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad ring-1 ring-bad/25">{err}</p>}
          <button className="btn-primary mt-6 w-full py-3" disabled={busy}>{busy ? <Spinner /> : isSetup ? <ShieldCheck className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}{isSetup ? 'Create account' : 'Sign in'}</button>
          <p className="mt-5 text-center text-xs text-ink2">Remote access is visible on the laptop and can be revoked at any time.</p>
        </form>
      </div>
    </div>
  );
}
