// 움직임 폴리싱 바탕 B: '움직임: 최소'가 OS 동작 줄이기와 같은 CSS 를 쓰도록 마지막에 짝 규칙을 만든다
// (scripts/postcss-motion-minimal.cjs — Tailwind 가 펼친 motion-reduce/motion-safe 결과까지 보려고 맨 뒤).
const motionMinimal = require('./scripts/postcss-motion-minimal.cjs');

module.exports = {
  plugins: [
    require('tailwindcss'),
    require('autoprefixer'),
    motionMinimal(),
  ],
};
