import { useEffect, useRef } from 'react';
import { cx } from '../../components/ui';

/** Bar waveform. Reacts to real mic level when available, otherwise a gentle synthetic motion while active. */
export default function Waveform({ active, level = 0, bars = 28, className, mirror = false, reduced = false }: { active: boolean; level?: number; bars?: number; className?: string; mirror?: boolean; reduced?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lvl = useRef(level);
  lvl.current = level;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += 0.06;
      kids.forEach((k, i) => {
        const pos = i / (kids.length - 1);
        const center = 1 - Math.abs(pos - 0.5) * 2;
        const env = mirror ? 0.35 + 0.65 * center : 0.25 + 0.75 * Math.pow(center, 0.8);
        const base = active ? 0.25 + 0.35 * Math.abs(Math.sin(t * 1.7 + i * 0.55)) * Math.abs(Math.cos(t * 0.9 + i * 0.23)) : 0.12;
        const h = Math.min(1, (base + lvl.current * 0.9 * (0.6 + 0.4 * Math.sin(i * 1.3 + t * 3))) * env);
        k.style.transform = `scaleY(${Math.max(0.08, h)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    if (!reduced && (active || lvl.current > 0)) raf = requestAnimationFrame(tick);
    else kids.forEach((k, i) => (k.style.transform = `scaleY(${0.12 + 0.18 * Math.abs(Math.sin(i))})`));
    return () => cancelAnimationFrame(raf);
  }, [active, mirror, reduced]);

  return (
    <div ref={ref} className={cx('flex h-8 items-center gap-[3px]', className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="h-full w-[3px] origin-center rounded-full transition-[background] duration-300"
          style={{ background: active ? 'linear-gradient(180deg, rgb(var(--ice)), rgb(var(--blue)))' : 'rgb(var(--ice) / 0.35)' }}
        />
      ))}
    </div>
  );
}
