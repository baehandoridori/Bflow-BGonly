import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* 움직임 폴리싱 검증 지적 review-motion-rules-4 — 뮤테이션에서 살아남은 가드를 자리까지 고정한다.
   - 14번 부드러운 닫힘: 닫히는 중 연타·단축키·붙여넣기 무시, exit 신호가 안 와도 닫히는 안전 타이머, 부모 onClose 는 한 번.
   - 20번 되돌리기: 서버 삭제가 시작된 댓글은 되돌리지 않는다(서버엔 지워졌는데 화면에 되살아나는 일 방지).
   - 동작 줄이기: MotionConfig 가 막지 못하는 WAAPI·FLIP 경로의 분기.
   파일 전체에 한 번이라도 나오면 통과하던 기존 검사와 달리, 각 가드가 '그 함수 안, 그 동작보다 앞'에 있는지 본다. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
/** 주석을 뺀 코드만 — 설명 글에 같은 낱말이 나와도 세지 않게. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** header 가 여는 중괄호 블록의 안쪽(괄호 짝을 세어). header 는 '{' 로 끝나야 한다. */
function blocksAfter(source: string, header: string): string[] {
  assert.ok(header.endsWith('{'), header);
  const out: string[] = [];
  for (let at = source.indexOf(header); at >= 0; at = source.indexOf(header, at + header.length)) {
    const open = at + header.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return out;
}
function blockAfter(source: string, header: string, label = header): string {
  const blocks = blocksAfter(source, header);
  assert.ok(blocks.length > 0, `${label} 없음`);
  return blocks[0];
}

const MODALS: Array<[string, string]> = [
  ['씬 상세', 'src/components/scenes/SceneDetailModal.tsx'],
  ['통합 상세', 'src/components/scenes/UnifiedSceneDetailModal.tsx'],
];

/* ─── 14번 부드러운 닫힘 ─── */

test('두 상세 창: 닫기 요청은 한 번만 — 가라앉는 중 다시 눌러도 무시하고, 무시 판정 뒤에야 닫힘을 켠다', () => {
  for (const [name, path] of MODALS) {
    const body = blockAfter(code(path), 'const requestClose = useCallback(() => {', `${name}: requestClose`);
    const guard = body.search(/\bif \(closingRef\.current\) return;/);
    const latch = body.indexOf('closingRef.current = true;');
    const shown = body.indexOf('setClosing(true);');
    assert.ok(guard >= 0, `${name}: 닫히는 중 연타 무시 가드`);
    assert.ok(latch > guard, `${name}: 가드 → 닫힘 표시 순서`);
    assert.ok(shown > latch, `${name}: closing 상태는 표시 뒤에`);
    assert.doesNotMatch(body.slice(0, guard), /setClosing|pointerEvents|closingRef\.current = true/, `${name}: 가드 앞에서 닫힘을 시작하지 않는다`);
  }
});

test('두 상세 창: exit 완료 신호가 오지 않아도 안전 타이머가 반드시 닫는다(투명한 창이 클릭을 막지 않게)', () => {
  for (const [name, path] of MODALS) {
    const source = code(path);
    const effect = source.match(/useEffect\(\(\) => \{\n\s*if \(!closing\) return;([\s\S]*?)\n\s*\}, \[closing, finishClose\]\);/);
    assert.ok(effect, `${name}: closing 이 켜지면 도는 안전 타이머 이펙트`);
    const timer = effect[1].match(/const timer = setTimeout\(finishClose, (\d+)\);/);
    assert.ok(timer, `${name}: 타이머가 finishClose 를 부른다`);
    const ms = Number(timer[1]);
    assert.ok(ms >= 300 && ms <= 1000, `${name}: 가라앉는 움직임(0.16초)보다 넉넉히 길고 1초 안 — ${ms}ms`);
    assert.match(effect[1], /return \(\) => clearTimeout\(timer\);/, `${name}: 다시 열리면 타이머 정리`);
  }
});

test('두 상세 창: 부모 onClose 는 닫힘이 시작된 뒤 한 번만(exit 신호·안전 타이머·언마운트가 겹쳐도)', () => {
  for (const [name, path] of MODALS) {
    const body = blockAfter(code(path), 'const finishClose = useCallback(() => {', `${name}: finishClose`);
    assert.match(
      body,
      /^\s*if \(!closingRef\.current \|\| closedRef\.current\) return;\s*closedRef\.current = true;\s*onCloseRef\.current\(\);\s*$/,
      `${name}: 한 번만 닫는 가드`,
    );
  }
});

test('두 상세 창: 가라앉는 중에는 Esc·화살표 단축키와 그림 붙여넣기를 받지 않는다', () => {
  for (const [name, path] of MODALS) {
    const source = code(path);
    const keyHandlers = blocksAfter(source, 'const onKey = (e: KeyboardEvent) => {').filter((body) => body.includes('requestClose()'));
    assert.equal(keyHandlers.length, 1, `${name}: 닫기 단축키 처리기`);
    const keys = keyHandlers[0];
    const guard = keys.indexOf('if (closingRef.current) return;');
    assert.ok(guard >= 0, `${name}: 단축키 가드`);
    for (const action of ["e.key === 'Escape'", 'requestClose()', 'flip.']) {
      const at = keys.indexOf(action);
      assert.ok(at > guard, `${name}: ${action} 보다 가드가 먼저`);
    }

    const paste = blockAfter(source, 'const onPaste = async (e: ClipboardEvent) => {', `${name}: 붙여넣기 처리기`);
    const pasteGuard = paste.indexOf('if (closingRef.current) return;');
    assert.ok(pasteGuard >= 0 && pasteGuard < paste.indexOf('e.clipboardData'), `${name}: 붙여넣기 가드가 클립보드 읽기보다 먼저`);
  }
});

/* ─── 20번 지운 댓글 되돌리기 ─── */

test('댓글 되돌리기: 기다리는 중(waiting)일 때만 — 서버 삭제가 시작된 뒤에는 화면에 되살리지 않는다', () => {
  const comments = code('src/components/scenes/CommentPanel.tsx');
  const restore = blockAfter(comments, 'const restoreDeletedComment = (commentId: string) => {');
  assert.match(restore, /^\s*const entry = pendingDeletesRef\.current\.get\(commentId\);\s*if \(!entry \|\| entry\.phase !== 'waiting'\) return;/);
  const guard = restore.indexOf("entry.phase !== 'waiting'");
  for (const action of ['pendingDeletesRef.current.delete(commentId)', 'settleDeleteVisual(entry)', 'reinsertComment(entry.comment)']) {
    assert.ok(restore.indexOf(action) > guard, `${action} 는 가드 뒤에`);
  }
  // 서버 삭제를 시작하는 쪽이 phase 를 바꿔야 위 가드가 의미가 있다.
  const commit = blockAfter(comments, 'const commitDeletedComment = (commentId: string) => {');
  assert.ok(commit.indexOf("entry.phase = 'deleting';") >= 0 && commit.indexOf("entry.phase = 'deleting';") < commit.indexOf('deleteComment('));
});

/* ─── 동작 줄이기: MotionConfig 밖(WAAPI·FLIP) ─── */

test('헤더 새로고침 아이콘: 동작 줄이기면 돌기 시작하지 않고, 멈출 때도 바로 멈춘다', () => {
  const sync = code('src/components/layout/HeaderSyncStatus.tsx');
  assert.match(sync, /const \{ reduce \} = useMotionPref\(\);/);
  assert.match(sync, /const reduceRef = useRef\(reduce\);\n\s*reduceRef\.current = reduce;/);
  const startAt = sync.indexOf("if (change.spin === 'start') {");
  const spinAt = sync.indexOf('el.animate(SPIN_KEYFRAMES');
  assert.ok(startAt >= 0 && spinAt > startAt);
  assert.match(sync.slice(startAt, spinAt), /if \([^)]*\breduceRef\.current\b[^)]*\) return;/, '돌기 전에 동작 줄이기 확인');
  const stop = blockAfter(sync, "if (change.spin === 'stop') {");
  assert.match(stop, /if \([^)]*\breduceRef\.current\b[^)]*\) \{\s*running\.cancel\(\);/, '멈출 때 감속 회전 없이 바로');
});

test('씬 완료: 카드 \'톡\'은 동작 줄이기가 아닐 때만, 동작 줄이기면 완료 칸 빛 테두리로 대신한다', () => {
  const fx = code('src/components/scenes/SceneCompletionFx.tsx');
  assert.match(fx, /const \{ reduce \} = useMotionPref\(\);/);
  assert.equal(fx.match(/\.animate\(CARD_POP_KEYFRAMES/g)?.length, 1, '톡은 한 곳에서만');
  const pop = blockAfter(fx, 'if (!reduce) {', '동작 줄이기가 아닐 때 분기');
  assert.match(pop, /card\.animate\(CARD_POP_KEYFRAMES, \{ duration: CARD_POP_MS, easing: CARD_POP_EASE \}\);\s*return;/);
  assert.ok(fx.indexOf('setGlows(cells.map') > fx.indexOf('if (!reduce) {'), '빛 테두리는 톡 분기 뒤(동작 줄이기 쪽)');
  assert.match(fx, /\}, \[celebrating, reduce\]\);/);
});

test('씬 넘김 끝 고무줄 튕김: 동작 줄이기면 아예 돌지 않는다', () => {
  const flip = code('src/hooks/useSceneFlip.ts');
  const bounce = blockAfter(flip, 'const bounce = useCallback((dir: FlipDir) => {');
  assert.match(bounce, /const \{[^}]*\breduce\b[^}]*\} = optsRef\.current;/);
  const animateAt = bounce.indexOf('animateEl(');
  assert.ok(animateAt > 0);
  assert.match(bounce.slice(0, animateAt), /if \([^)]*\breduce\b[^)]*\) return;/, '움직이기 전에 동작 줄이기 확인');
});

test('내 리테이크 위젯: 줄 미끄러짐(FLIP)은 동작 줄이기에서 끈다', () => {
  const widget = code('src/components/widgets/MyRetakesWidget.tsx');
  assert.match(widget, /const \{ reduce \} = useMotionPref\(\);/);
  assert.match(widget, /useRowFlip\(listRef, [^;]*, \{ disabled: reduce \}\);/);
});
