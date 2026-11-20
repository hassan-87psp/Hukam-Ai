import { useId } from 'react';

export function LaptopArt({ className, on = true }: { className?: string; on?: boolean }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <defs>
        <linearGradient id={`la-s${u}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={on ? '#1d64d8' : '#2a3b55'} />
          <stop offset=".55" stopColor={on ? '#4CA8FF' : '#3a4d6a'} />
          <stop offset="1" stopColor={on ? '#0b2b66' : '#1d2a3f'} />
        </linearGradient>
        <linearGradient id={`la-b${u}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9d6e8" />
          <stop offset="1" stopColor="#7d8ea8" />
        </linearGradient>
      </defs>
      <rect x="16" y="6" width="88" height="56" rx="4" fill="#0d1626" stroke="#8fa3c0" strokeOpacity=".5" />
      <rect x="20" y="10" width="80" height="48" rx="2" fill={`url(#la-s${u})`} />
      {on && <path d="M32 50 C48 20 70 46 92 18 L100 18 L100 58 L20 58 Z" fill="#75D6FF" opacity=".25" />}
      {on && <path d="M40 54 C55 30 70 50 98 26" stroke="#bfe9ff" strokeOpacity=".5" fill="none" />}
      <path d="M6 64 h108 l-6 8 H12 z" fill={`url(#la-b${u})`} />
      <rect x="50" y="64" width="20" height="2" rx="1" fill="#5d6f8b" />
    </svg>
  );
}

export function PhoneArt({ className, on = true }: { className?: string; on?: boolean }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 60 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`ph-s${u}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={on ? '#0e3d8f' : '#2a3b55'} />
          <stop offset=".6" stopColor={on ? '#2989FE' : '#3a4d6a'} />
          <stop offset="1" stopColor={on ? '#081526' : '#1d2a3f'} />
        </linearGradient>
      </defs>
      <rect x="8" y="2" width="44" height="96" rx="9" fill="#0d1626" stroke="#9fb3cf" strokeOpacity=".6" />
      <rect x="11" y="5" width="38" height="90" rx="7" fill={`url(#ph-s${u})`} />
      <rect x="24" y="8" width="12" height="3" rx="1.5" fill="#0d1626" />
      {on && <circle cx="30" cy="44" r="10" fill="none" stroke="#75D6FF" strokeOpacity=".7" />}
      {on && <circle cx="30" cy="44" r="4" fill="#75D6FF" opacity=".8" />}
    </svg>
  );
}
