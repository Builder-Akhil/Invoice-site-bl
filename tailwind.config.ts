import type { Config } from 'tailwindcss';

// Buildable Labs — "Alloy" palette. Locked per Brand Foundation V01.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        blue: {
          DEFAULT: '#0B3FDE',
          50: '#EEF3FF',
          100: '#DCE6FF',
          200: '#B8CCFF',
          300: '#8AABFF',
          400: '#4B7BF5',
          500: '#0B3FDE',
          600: '#0932B4',
          700: '#08298F',
          800: '#061F6E',
          900: '#04154C',
        },
        ink: {
          DEFAULT: '#0A0B0E',
          800: '#0E1015',
          700: '#12141A',
          600: '#171A21',
          500: '#1A1D24',
          400: '#222630',
          300: '#2C3444',
        },
        chrome: {
          DEFAULT: '#7A8296',
          light: '#B9C0CE',
          dark: '#4A5162',
        },
        paper: '#F5F6F8',
        line: '#242832',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.8)',
        pop: '0 24px 60px -20px rgba(0,0,0,0.85)',
      },
      opacity: { 8: '0.08', 12: '0.12', 18: '0.18' },
      backgroundImage: {
        chrome: 'linear-gradient(135deg,#F5F6F8 0%,#B9C0CE 28%,#7A8296 52%,#E7EAF0 74%,#9AA2B3 100%)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        pulse6: { '0%,100%': { opacity: '0.06' }, '50%': { opacity: '0.14' } },
      },
      animation: { 'fade-up': 'fade-up .28s ease-out both', pulse6: 'pulse6 6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
export default config;
