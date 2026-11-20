/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), bg2: v('bg2'), surface: v('surface'), field: v('field'),
        blue: v('blue'), blue2: v('blue2'), ice: v('ice'),
        ink: v('ink'), ink2: v('ink2'), line: v('line'),
        ok: v('ok'), warn: v('warn'), bad: v('bad'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        urdu: ['"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'Tahoma', 'serif'],
      },
      borderRadius: { xl: '12px', '2xl': '16px', '3xl': '20px' },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--ice) / 0.10), 0 10px 40px -10px rgb(var(--blue) / 0.45)',
        card: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 18px 50px -24px rgb(0 0 0 / 0.65)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        'pulse-ring': { '0%': { transform: 'scale(0.9)', opacity: 0.7 }, '100%': { transform: 'scale(1.6)', opacity: 0 } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-up': 'fade-up .35s ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'spin-slow': 'spin-slow 1.2s linear infinite',
      },
    },
  },
  plugins: [],
};
