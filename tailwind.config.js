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
          lo: '#7C9AEF',
          done: '#A78BFA',
          review: '#F0B866',
          png: '#5EC4B6',
        },
        status: {
          high: '#5EC4B6',
          mid: '#F0B866',
          low: '#E17055',
          none: '#F0917E',
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
