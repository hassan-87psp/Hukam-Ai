import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useStore } from '../services/store';
import { cx } from './ui';

const ICON = { info: Info, ok: CheckCircle2, warn: AlertTriangle, bad: XCircle };
const COLOR = { info: 'text-blue2', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

export default function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex flex-col items-center gap-2 px-3 lg:bottom-6 lg:left-auto lg:right-6 lg:top-auto lg:items-end" aria-live="polite">
      {toasts.map((t) => {
        const I = ICON[t.tone];
        return (
          <div key={t.id} className="glass-strong pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-2xl px-4 py-3">
            <I className={cx('mt-0.5 h-5 w-5 shrink-0', COLOR[t.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-xs text-ink2" dir="auto">{t.body}</p>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="text-ink2 hover:text-ink" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        );
      })}
    </div>
  );
}
