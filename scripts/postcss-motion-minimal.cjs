'use strict';

/**
 * 앱 설정 '움직임: 최소'(<html data-motion="minimal">)를 OS '동작 줄이기'와 똑같이 만드는 PostCSS 플러그인
 * (움직임 폴리싱 바탕 B — "'minimal' 은 reduce 규칙을 복제").
 *
 * CSS 는 @media 조건과 선택자를 한 규칙에 묶을 수 없어서, 예전에는 갈래마다 '최소' 짝을 손으로 써야 했다.
 * 짝이 빠진 갈래는 '최소'에서 팀원 변경 빛·저장됨 칩·되돌리기 남은 시간 같은 정보 표시가 아예 안 보였다.
 * 이 플러그인이 빌드 때 모든 CSS 를 같은 방식으로 맞춘다. 갈래 CSS 에는 '최소' 짝을 따로 쓰지 않는다.
 *
 * - @media (prefers-reduced-motion: reduce) { S { D } }
 *     → 블록 바로 뒤(미디어 밖)에 S' { D } 를 하나 더 둔다.
 * - @media (prefers-reduced-motion: no-preference) { S { D } }
 *     → S 를 S'' 로 바꿔 '최소'에서는 적용되지 않게 한다(OS 동작 줄이기에서 빠지는 것과 같게).
 * - S' / S'' 는 S 의 첫 덩어리(첫 결합자 앞, 가상 요소 앞)에 :where(...) 조건을 붙인 것이다.
 *   :where() 는 특이도가 0 이라 짝 규칙의 특이도·순서가 원래 규칙과 같다. 그래서 OS 동작 줄이기에서
 *   이기던 규칙이 '최소'에서도 같은 상대를 같은 순서로 이긴다(전역 0.01ms 규칙 포함 — 그 규칙도 index.css 의
 *   동작 줄이기 블록에서 같은 방식으로 복제된다).
 * - 조건은 html 자신 또는 그 안의 요소를 함께 본다(:where(html[...], html[...] *)) — html[data-dash-entry] 처럼
 *   html 에 붙는 속성으로 시작하는 선택자도 그대로 맞는다.
 *
 * Tailwind 의 motion-reduce:/motion-safe: 변형도 같은 미디어 블록으로 나오므로 함께 따른다.
 * postcss.config.js 에서 tailwindcss·autoprefixer 뒤에 둔다(Tailwind 가 펼친 결과까지 본다).
 * 규칙이 아닌 것(@keyframes·중첩 @media 등)이 블록 안에 있거나 조건이 섞인 미디어는 고치지 않고 경고만 한다
 * (tests/motion/fx-motion-levels-minimal-mirror.test.ts 가 src 의 모든 CSS 에서 경고 0 을 지킨다).
 */

const PLUGIN_NAME = 'bflow-motion-minimal';

/** '최소'일 때만 맞는 조건(특이도 0). */
const MINIMAL_ON = ":where(html[data-motion='minimal'], html[data-motion='minimal'] *)";
/** '최소'가 아닐 때만 맞는 조건(특이도 0). data-motion 이 아직 없으면 '최소'가 아닌 것으로 본다. */
const MINIMAL_OFF = ":where(html:not([data-motion='minimal']), html:not([data-motion='minimal']) *)";

/** 콜론 하나로도 쓰는 옛 가상 요소 — 조건은 이보다 앞에 붙여야 한다. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/**
 * 첫 덩어리(compound selector)에서 조건을 끼워 넣을 위치.
 * 첫 결합자(공백·>·+·~) 앞, 그 전에 가상 요소(::x, :before 등)가 나오면 그 앞.
 * 괄호·대괄호·따옴표 안과 역슬래시로 이스케이프된 글자(Tailwind 클래스 이름의 \:, \[ 등)는 건너뛴다.
 */
function conditionInsertIndex(selector) {
  let paren = 0;
  let bracket = 0;
  let quote = null;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '\\') { i += 1; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') { bracket += 1; continue; }
    if (ch === ']') { bracket -= 1; continue; }
    if (bracket > 0) continue;
    if (ch === '(') { paren += 1; continue; }
    if (ch === ')') { paren -= 1; continue; }
    if (paren > 0) continue;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '>' || ch === '+' || ch === '~') return i;
    if (ch === ':') {
      if (selector[i + 1] === ':') return i;
      const name = /^[A-Za-z-]+/.exec(selector.slice(i + 1));
      if (name && LEGACY_PSEUDO_ELEMENTS.has(name[0].toLowerCase()) && !/[\w-]/.test(selector[i + 1 + name[0].length] ?? '')) return i;
    }
  }
  return selector.length;
}

/** 선택자 하나(쉼표 없는 것)의 첫 덩어리에 조건을 붙인다. */
function withCondition(selector, condition) {
  const s = selector.trim();
  if (s.includes(condition)) return s;
  const at = conditionInsertIndex(s);
  return s.slice(0, at) + condition + s.slice(at);
}

/** @media 조건 분류: 'reduce' | 'no-preference' | 'mixed'(그 밖에 prefers-reduced-motion 이 섞임) | null. */
function classifyMedia(params) {
  const p = String(params).replace(/\s+/g, '').toLowerCase();
  if (p === '(prefers-reduced-motion:reduce)' || p === '(prefers-reduced-motion)') return 'reduce';
  if (p === '(prefers-reduced-motion:no-preference)') return 'no-preference';
  if (p.includes('prefers-reduced-motion')) return 'mixed';
  return null;
}

function warnUnsupported(result, node, message) {
  result.warn(`[${PLUGIN_NAME}] ${message} — '최소' 짝을 만들지 못했어요. 규칙만 두거나 미디어 조건을 나눠 주세요.`, { node });
}

function motionMinimal() {
  return {
    postcssPlugin: PLUGIN_NAME,
    OnceExit(root, { result }) {
      root.walkAtRules('media', (media) => {
        const kind = classifyMedia(media.params);
        if (!kind) return;
        if (kind === 'mixed') {
          warnUnsupported(result, media, `지원하지 않는 미디어 조건 '${media.params}'`);
          return;
        }
        if (kind === 'reduce') {
          const mirrors = [];
          media.each((node) => {
            if (node.type === 'comment') return;
            if (node.type !== 'rule') {
              warnUnsupported(result, node, `동작 줄이기 블록 안의 ${node.type === 'atrule' ? '@' + node.name : node.type}`);
              return;
            }
            const mirror = node.clone();
            mirror.selectors = node.selectors.map((selector) => withCondition(selector, MINIMAL_ON));
            mirror.raws.before = '\n';
            mirrors.push(mirror);
          });
          if (mirrors.length > 0) media.after(mirrors);
          return;
        }
        // no-preference: '최소'에서는 빠진다.
        media.each((node) => {
          if (node.type === 'comment') return;
          if (node.type !== 'rule') {
            warnUnsupported(result, node, `동작 허용 블록 안의 ${node.type === 'atrule' ? '@' + node.name : node.type}`);
            return;
          }
          node.selectors = node.selectors.map((selector) => withCondition(selector, MINIMAL_OFF));
        });
      });
    },
  };
}
motionMinimal.postcss = true;

module.exports = motionMinimal;
module.exports.PLUGIN_NAME = PLUGIN_NAME;
module.exports.MINIMAL_ON = MINIMAL_ON;
module.exports.MINIMAL_OFF = MINIMAL_OFF;
module.exports.withCondition = withCondition;
module.exports.classifyMedia = classifyMedia;
