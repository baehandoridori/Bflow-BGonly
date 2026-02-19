/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0F1117',
          card: '#1A1D27',
          border: '#2D3041',
        },
        text: {
          primary: '#E8E8EE',
          secondary: '#8B8DA3',
        },
        accent: '#6C5CE7',
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
    },
  },
  plugins: [],
};
