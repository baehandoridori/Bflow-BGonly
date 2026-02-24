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
        // 시멘틱 컬러 (라이트/다크 자동 대응)
        overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)',
        stage: {
          lo: '#74B9FF',
          done: '#A29BFE',
          review: '#FDCB6E',
          png: '#00B894',
        },
        status: {
          high: '#00B894',
          mid: '#FDCB6E',
          low: '#E17055',
          none: '#FF6B6B',
        },
      },
      keyframes: {
        'slide-down': {
          '0%': { opacity: '0', transform: 'translate(-50%, -12px)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0)' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
