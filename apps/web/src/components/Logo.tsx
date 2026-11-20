import { useId } from 'react';
import { cx } from './ui';

export function BrainMark({ className }: { className?: string }) {
  // unique gradient id: a hidden copy (e.g. the desktop sidebar on mobile) must not own the gradient
  const id = `bm-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" className={cx('drop-shadow-[0_0_12px_rgb(var(--blue)/0.7)]', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--ice))" />
          <stop offset="1" stopColor="rgb(var(--blue))" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 12c-5-3-12-.5-13 5.5-5.5 1-8 7-5 11.5-2.5 4.5 0 10 5 10.5 1.5 5.5 8 7.5 13 4.5z" />
        <path d="M34 12c5-3 12-.5 13 5.5 5.5 1 8 7 5 11.5 2.5 4.5 0 10-5 10.5-1.5 5.5-8 7.5-13 4.5z" />
        <path d="M22 23c3 0 5 2 5 5M42 23c-3 0-5 2-5 5M23 36c2.5-1.5 5.5-1.2 7 .8M41 36c-2.5-1.5-5.5-1.2-7 .8" />
      </g>
      <g fill="rgb(var(--ice))">
        <circle cx="22" cy="23" r="1.6" /><circle cx="42" cy="23" r="1.6" /><circle cx="23" cy="36" r="1.6" /><circle cx="41" cy="36" r="1.6" />
      </g>
    </svg>
  );
}

export default function Logo({ collapsed, small }: { collapsed?: boolean; small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrainMark className={small ? 'h-8 w-8' : 'h-10 w-10'} />
      {!collapsed && (
        <div className="leading-none">
          <p className={cx('font-display font-extrabold tracking-tight', small ? 'text-lg' : 'text-[22px]')}>
            HUKM <span className="text-gradient">AI</span>
          </p>
          <p className={cx('mt-1 text-ink2', small ? 'text-[9px]' : 'text-[11px]')}>Your Personal AI Operator</p>
        </div>
      )}
    </div>
  );
}
