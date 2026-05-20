/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'rgb(var(--color-bg-primary) / <alpha-value>)',
          card: 'rgb(var(--color-bg-card) / <alpha-value>)',
          border: 'rgb(var(--color-bg-border) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
        },
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-sub': 'rgb(var(--color-accent-sub) / <alpha-value>)',
        // 씬 길이 변경 (LD/SD)
        'length-up': 'rgb(var(--color-length-up) / <alpha-value>)',
        'length-down': 'rgb(var(--color-length-down) / <alpha-value>)',
        // 시멘틱 컬러 (라이트/다크 자동 대응)
        overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)',
        stage: {
          lo: '#C4BCFA',
          done: '#A599F5',
          review: '#8677EF',
          png: '#6C5CE7',
        },
        status: {
          high: '#6C5CE7',
          mid: '#A599F5',
          low: '#E17055',
          none: '#F5BEB3',
          // ── v1.30.0: 컴포지팅 6 단계 (값은 src/index.css 의 CSS 변수) ──
          batch: 'var(--status-batch)',
          combine: 'var(--status-combine)',
          aggregated: 'var(--status-aggregated)',
          adjust: 'var(--status-adjust)',
          error: 'var(--status-error)',
          done: 'var(--status-done)',
        },
        // ── v1.30.0: 컴포지팅 파트 색 ──
        part: {
          a: 'var(--part-a)',
          b: 'var(--part-b)',
          c: 'var(--part-c)',
          d: 'var(--part-d)',
        },
      },
      keyframes: {
        'slide-down': {
          '0%': { opacity: '0', transform: 'translate(-50%, -12px)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.3s ease-in-out',
      },
    },
  },
  plugins: [],
};
