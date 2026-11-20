import { Loader2, PlugZap, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: any; [k: string]: any }) {
  return (
    <As className={cx('card', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ icon, title, action, className }: { icon?: ReactNode; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 px-5 pt-4', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-ice/90">{icon}</span>}
        <h3 className="truncate font-display text-[15px] font-semibold text-ink">{title}</h3>
      </div>
      {action}
    </div>
  );
}

type Tone = 'info' | 'ok' | 'warn' | 'bad' | 'muted';
const TONE: Record<Tone, string> = {
  info: 'bg-blue/15 text-blue2 ring-1 ring-blue/30',
  ok: 'bg-ok/12 text-ok ring-1 ring-ok/30',
  warn: 'bg-warn/12 text-warn ring-1 ring-warn/30',
  bad: 'bg-bad/12 text-bad ring-1 ring-bad/30',
  muted: 'bg-ink2/10 text-ink2 ring-1 ring-ink2/20',
};
export function Badge({ tone = 'info', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('chip', TONE[tone], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : tone === 'muted' ? 'bg-ink2' : 'bg-blue2')} />}
      {children}
    </span>
  );
}

export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2.5 w-2.5', className)}>
      {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-50" />}
      <span className={cx('relative inline-flex h-2.5 w-2.5 rounded-full', online ? 'bg-ok shadow-[0_0_10px_rgb(var(--ok))]' : 'bg-ink2/50')} />
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; description?: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 py-2', disabled && 'cursor-not-allowed opacity-50')}>
      {(label || description) && (
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-ink2">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice/60',
          checked ? 'bg-blue shadow-[0_0_14px_-2px_rgb(var(--blue))]' : 'bg-field ring-1 ring-line/20',
        )}
      >
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className ?? 'h-4 w-4')} aria-hidden />;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cx('glass-strong relative w-full animate-fade-up rounded-t-3xl p-5 sm:rounded-3xl safe-bottom', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button className="rounded-lg p-1.5 text-ink2 hover:bg-field hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blue/10 text-ice ring-1 ring-ice/20">{icon}</div>
      <p className="font-display font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Honest placeholder for features whose integration is not built yet. */
export function NotConnected({ title, body, children }: { title: string; body: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-ice/25 bg-field/30 p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-blue/10 blur-2xl" />
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warn/10 text-warn ring-1 ring-warn/25">
          <PlugZap className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-semibold">{title}</p>
            <Badge tone="warn">Not yet connected</Badge>
          </div>
          <div className="mt-1 text-sm text-ink2">{body}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight lg:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-field/60 p-1 ring-1 ring-line/15">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', value === o.value ? 'bg-blue text-white shadow-[0_6px_18px_-8px_rgb(var(--blue))]' : 'text-ink2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-shimmer rounded-lg bg-[linear-gradient(90deg,rgb(var(--field)/.5),rgb(var(--surface)/.9),rgb(var(--field)/.5))] bg-[length:200%_100%]', className)} />;
}
