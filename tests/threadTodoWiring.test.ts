/**
 * 피드백 58: 팀 할 일 배선 앵커 — 마이그레이션(규칙 7 경계)·main·preload·types·realtime·mock·댓글 패널 삽입.
 * 줄 경계는 \s* 만 쓴다(작업 트리가 CRLF).
 * 게이트 등록(package.json) 확인은 tests/sidebarCharacterPopout.test.ts 가 맡는다 — 같은 파일에 두면 죽은 가드.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('DEVLOG/migrations/2026-09-14-comment-thread-todos.sql', 'utf8');
const smoke = readFileSync('DEVLOG/verification/2026-09-14-comment-thread-todos-smoke.sql', 'utf8');
const store = readFileSync('electron/threadTodoStore.ts', 'utf8');
const ipc = readFileSync('electron/threadTodoIpc.ts', 'utf8');
const main = readFileSync('electron/main.ts', 'utf8');
const realtime = readFileSync('electron/realtime.ts', 'utf8');
const preload = readFileSync('electron/preload.ts', 'utf8');
const types = readFileSync('src/types/index.ts', 'utf8');
const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const section = readFileSync('src/components/scenes/ThreadTodoSection.tsx', 'utf8');

const WRAPPERS = [
  'comment_thread_todos_session_list',
  'comment_thread_todos_session_add',
  'comment_thread_todos_session_set_done',
  'comment_thread_todos_session_delete',
];

function functionBody(sql: string, name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?END \\$\\$;`));
  assert.ok(match, `${name} 정의가 있어야 한다`);
  return match[0];
}

test('마이그레이션: 테이블은 anon 직접 권한 없음(정책 0·권한 회수), 래퍼 4개만 토큰으로 연다', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.comment_thread_todos/);
  assert.match(migration, /ALTER TABLE public\.comment_thread_todos ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.comment_thread_todos FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.comment_thread_todos FROM %I/);
  assert.doesNotMatch(migration, /p_actor_id/);
  assert.doesNotMatch(migration, /REFERENCES public\.users|REFERENCES users/);
  for (const name of WRAPPERS) {
    const body = functionBody(migration, name);
    assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/);
    assert.match(body, /v_user := public\.app_session_user_id\(p_session_token\);/);
    assert.match(body, /SELECT u\.name, u\.role INTO v_name, v_role FROM public\.users u WHERE u\.id = v_user;/);
    assert.match(body, /ERRCODE = '42501'/);
    assert.doesNotMatch(body, /select\s+\*[\s\S]{0,60}from\s+public\.users/i);
  }
  assert.match(functionBody(migration, 'comment_thread_todos_session_add'), /regexp_replace\(COALESCE\(p_text, ''\), '\\s\+', ' ', 'g'\)/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_set_done'), /IF p_id IS NULL OR p_done IS NULL THEN/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_set_done'), /COALESCE\(done_by, v_user\)/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_set_done'), /ERRCODE = 'P0002'/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_delete'), /WHERE id = p_id AND \(created_by = v_user OR v_role = 'admin'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION\s*public\.comment_thread_todos_session_list\(TEXT, TEXT\),/);
});

test('마이그레이션: 실시간은 내용 없는 신호만 (publication 미등록 + statement 트리거 + NOTIFY)', () => {
  assert.match(migration, /realtime\.send\(jsonb_build_object\('table', TG_TABLE_NAME, 'op', TG_OP\), 'thread-todos-changed', 'bflow-realtime', false\)/);
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON public\.comment_thread_todos\s*FOR EACH STATEMENT EXECUTE FUNCTION public\.comment_thread_todos_notify_change\(\)/);
  assert.doesNotMatch(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime DROP TABLE public\.comment_thread_todos/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
});

test('스모크: 한 배치·ROLLBACK·anon 직접 접근 거부·삭제 권한 매트릭스', () => {
  assert.match(smoke, /^BEGIN;/m);
  assert.match(smoke, /SET LOCAL ROLE anon;/);
  assert.match(smoke, /PERFORM 1 FROM public\.comment_thread_todos; RAISE EXCEPTION 'anon could read comment_thread_todos'/);
  assert.match(smoke, /IF msg NOT LIKE '%내가 추가한%' THEN RAISE; END IF;/);
  assert.match(smoke, /EXCEPTION WHEN no_data_found THEN rejected := true;/);
  assert.match(smoke, /RESET ROLE;\s*ROLLBACK;/);
  assert.match(smoke, /true AS passed/);
});

test('main 저장소: ./supabase 상대 import·공유 계약 import·토큰 리졸버, actor id 미전송', () => {
  assert.match(store, /import \{ supabase \} from '\.\/supabase';/);
  assert.match(store, /from '\.\.\/src\/shared\/threadTodo';/);
  assert.match(store, /export function setThreadTodoSessionTokenResolver/);
  assert.match(store, /export function createThreadTodoStore\(/);
  for (const name of WRAPPERS) assert.match(store, new RegExp(`client\\.rpc\\('${name}', \\{ p_session_token: token`));
  assert.doesNotMatch(store, /p_actor_id/);
  assert.match(store, /\['42P01', 'PGRST205', '42883', 'PGRST202'\]/);
});

test('IPC: 4채널, 세션 문구 통일, 응답 폐기 문구는 공유 상수, onChanged 가 current 검사보다 먼저', () => {
  for (const ch of ['thread-todo:list', 'thread-todo:add', 'thread-todo:set-done', 'thread-todo:delete']) {
    assert.match(ipc, new RegExp(`ipc\\.handle\\('${ch}'`));
  }
  assert.match(ipc, /const SESSION_REQUIRED = '로그인 세션이 필요합니다\. 다시 로그인해 주세요\.';/);
  assert.match(ipc, /import \{ THREAD_TODO_RESPONSE_DISCARDED \} from '\.\.\/src\/shared\/threadTodo';/);
  // 세션이 바뀐 경우 + 커밋 뒤 세션이 사라진 경우(로그아웃) 둘 다 '폐기' 문구
  assert.equal((ipc.match(/throw new Error\(THREAD_TODO_RESPONSE_DISCARDED\)/g) ?? []).length, 2);
  assert.match(ipc, /try \{ now = originOrThrow\(\); \} catch \{ throw new Error\(THREAD_TODO_RESPONSE_DISCARDED\); \}/);
  assert.match(ipc, /function originOrThrow\(\): SessionOrigin \{\s*try \{[\s\S]*?\} catch \{\s*throw new Error\(SESSION_REQUIRED\);/);
  assert.equal((ipc.match(/notify\(\);\s*current\(origin\);/g) ?? []).length, 3);
  assert.doesNotMatch(ipc, /origin\.role/);
});

test('main.ts: 리졸버·IPC 등록·Realtime 콜백 배선', () => {
  assert.match(main, /import \{ registerThreadTodoIpc \} from '\.\/threadTodoIpc';/);
  assert.match(main, /import \{ setThreadTodoSessionTokenResolver \} from '\.\/threadTodoStore';/);
  assert.match(main, /setThreadTodoSessionTokenResolver\(\{ tokenFor: \(actorId\) => sessionManager\.getSessionTokenFor\(actorId\) \}\);/);
  assert.match(main, /registerThreadTodoIpc\(\{ getSessionOriginOrThrow, onChanged: \(\) => broadcastToAllWindows\('thread-todos:changed', \{\}\) \}\);/);
  assert.match(main, /onThreadTodosChange: \(\) => broadcastToAllWindows\('thread-todos:changed', \{\}\),/);
  assert.doesNotMatch(main, /ipcMain\.handle\('thread-todo:/);
});

test('realtime.ts: broadcast 리스너 + 콜백 타입', () => {
  assert.match(realtime, /onThreadTodosChange\?: \(\) => void;/);
  assert.match(realtime, /built\.on\('broadcast', \{ event: 'thread-todos-changed' \}, \(\) => callbacks\.onThreadTodosChange\?\.\(\)\);/);
});

test('preload/types: 4 메서드는 요청 epoch 를 붙이고 신원 인자를 받지 않는다 + 변경 리스너', () => {
  assert.match(preload, /threadTodoList: \(threadKey: string\) => ipcRenderer\.invoke\('thread-todo:list', threadKey, canonicalSessionEpoch\),/);
  assert.match(preload, /threadTodoAdd: \(threadKey: string, text: string\) => ipcRenderer\.invoke\('thread-todo:add', threadKey, text, canonicalSessionEpoch\),/);
  assert.match(preload, /threadTodoSetDone: \(id: string, done: boolean\) => ipcRenderer\.invoke\('thread-todo:set-done', id, done, canonicalSessionEpoch\),/);
  assert.match(preload, /threadTodoDelete: \(id: string\) => ipcRenderer\.invoke\('thread-todo:delete', id, canonicalSessionEpoch\),/);
  assert.match(preload, /ipcRenderer\.on\('thread-todos:changed', listener\);/);
  assert.match(types, /threadTodoList: \(threadKey: string\) => Promise<import\('\.\.\/shared\/threadTodo'\)\.ThreadTodoRow\[\]>;/);
  assert.match(types, /threadTodoDelete: \(id: string\) => Promise<\{ ok: boolean; deleted: boolean \}>;/);
  assert.match(types, /onThreadTodosChanged: \(callback: \(\) => void\) => \(\) => void;/);
});

test('미리보기 mock: 5 메서드 + 공유 검증기·삭제 권한 재사용 + 변경 신호', () => {
  for (const name of ['threadTodoList', 'threadTodoAdd', 'threadTodoSetDone', 'threadTodoDelete']) {
    assert.match(mock, new RegExp(`${name}: async \\(`));
  }
  // 코덱스 2차: 새로고침·다른 창 공유를 위해 localStorage 저장소로 위임 (규칙은 tests/threadTodoPreviewStore.test.ts)
  assert.match(mock, /import \{ createThreadTodoPreviewStore, type ThreadTodoPreviewStore \} from '\.\/threadTodoPreviewStore';/);
  assert.match(mock, /threadTodoAdd: async \(threadKey, text\) => threadTodoPreviewStore\(\)\.add\(requireMockCalendarUser\(\), threadKey, text\),/);
  assert.match(mock, /threadTodoDelete: async \(id\) => threadTodoPreviewStore\(\)\.remove\(requireMockCalendarUser\(\), id\),/);
  assert.match(mock, /onThreadTodosChanged: \(callback\) => threadTodoPreviewStore\(\)\.subscribe\(callback\),/);
  assert.doesNotMatch(mock, /previewThreadTodos\b/);
});

test('댓글 패널: 섹션은 툴바 바로 아래·댓글 목록 바로 위, 스레드 키로 리마운트, 스레드 키가 비면 숨긴다', () => {
  assert.match(commentPanel, /import \{ ThreadTodoSection \} from '\.\/ThreadTodoSection';/);
  assert.match(
    commentPanel,
    /re만\s*<\/button>\s*<\/div>\s*\{\/\* 피드백 58[\s\S]{0,300}\{effectiveSceneThreadKey && currentUser \? \(\s*<ThreadTodoSection\s+key=\{effectiveSceneThreadKey\}\s+threadKey=\{effectiveSceneThreadKey\}\s+currentUser=\{currentUser\}\s+onHeightGrow=\{\(grewBy, firstLoadAfterMs\) => \{[\s\S]{0,900}?\}\}\s*\/>\s*\) : null\}\s*\{\/\* 댓글 목록/,
  );
  assert.ok(commentPanel.indexOf('<ThreadTodoSection') < commentPanel.indexOf('ref={scrollRef}'));
  assert.equal((commentPanel.match(/<ThreadTodoSection/g) ?? []).length, 1);
});

test('섹션: IPC 직접 호출·변경 신호 구독·재로그인 재조회·낙관적 롤백·응답 폐기 처리·금지 문자열 없음', () => {
  assert.match(section, /window\.electronAPI\.threadTodoList\(threadKey\)/);
  assert.match(section, /window\.electronAPI\.onThreadTodosChanged\(/);
  assert.match(section, /useEffect\(\(\) => \{ void load\(\); \}, \[load, currentUser\]\);/);
  assert.match(section, /cleanIpcErrorMessage\(/);
  assert.match(section, /const COLLAPSED_KEY = 'bflow_comment_todo_collapsed';/);
  assert.match(section, /type="checkbox"/);
  assert.match(section, /canDeleteThreadTodo\(item, currentUser\)/);
  // 신호 리스너 + 뮤테이션 finally 두 곳에서 "마지막 뮤테이션이 끝나면 다시 읽는다", load 자체도 뮤테이션 중엔 건너뛴다
  assert.equal((section.match(/if \(inFlightRef\.current === 0\) void load\(\);/g) ?? []).length, 2);
  assert.match(section, /if \(inFlightRef\.current > 0\) return;/);
  assert.doesNotMatch(section, /dirtyRef/);
  // 서버엔 저장됐지만 응답만 폐기된 경우: 세 뮤테이션 모두 롤백·토스트 없이 재조회에 맡긴다
  assert.match(section, /=== THREAD_TODO_RESPONSE_DISCARDED/);
  assert.equal((section.match(/if \(isDiscardedResponse\(err\)\) return;/g) ?? []).length, 3);
  assert.match(section, /setItems\(\(prev\) => prev\.filter\(\(r\) => r\.id !== tempId\)\);/);
  assert.match(section, /setItems\(\(prev\) => prev\.map\(\(r\) => \(r\.id === item\.id \? item : r\)\)\);/);
  assert.doesNotMatch(section, /layout="position"/);
  assert.doesNotMatch(section, /italic/);
  assert.doesNotMatch(section, /text-emerald-100|text-sky-100/);
  assert.doesNotMatch(section, /리비전|피드백 허브/);
  assert.doesNotMatch(section, /from '@\/services\/supabaseService'/);
});

// ── 작업 4 에서 append — 59 테스트 자신의 test:ui 등록은 자기 파일에서 감시하면 죽은 가드라 여기서 본다 ──
test('게이트 등록: 59 테스트가 test:ui 에 나열돼 있다', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts['test:ui'].includes('./tests/sidebarCharacterPopout.test.ts'), 'sidebarCharacterPopout.test.ts 가 test:ui 에 등록돼야 한다');
});

// ── 구현 후 리뷰 반영: 섹션이 늦게 커져도 댓글 목록의 최신 댓글이 가려지지 않게 ──
test('섹션 높이 증가 알림 → 댓글 패널이 스크롤 의도(맨 아래·댓글 이동)에 맞춰 보정', () => {
  assert.match(section, /<section ref=\{sectionRef\} aria-label="팀 할 일"/);
  assert.match(section, /useLayoutEffect\(\(\) => \{\s*const height = sectionRef\.current\?\.offsetHeight \?\? 0;\s*const prev = heightRef\.current;\s*heightRef\.current = height;\s*const firstLoad = !loading && !firstLoadSeenRef\.current;\s*if \(firstLoad\) firstLoadSeenRef\.current = true;\s*const firstLoadAfterMs = firstLoad \? performance\.now\(\) - mountedAtRef\.current : null;\s*if \(prev !== null && height > prev\) onHeightGrowRef\.current\?\.\(height - prev, firstLoadAfterMs\);\s*\}\);/);
  assert.match(section, /onHeightGrowRef\.current = onHeightGrow;/);
  assert.match(commentPanel, /import \{ commentListScrollAfterSectionGrow \} from '@\/utils\/commentListAnchor';/);
  assert.match(commentPanel, /const el = scrollRef\.current;\s*if \(!el\) return;\s*const behavior = commentListScrollAfterSectionGrow\(\{\s*scrollHeight: el\.scrollHeight,\s*clientHeight: el\.clientHeight,\s*scrollTop: el\.scrollTop,\s*grewBy,\s*firstLoadAfterMs,\s*jumpingToComment: !!firstUnreadCommentId \|\| !!focusCommentId,\s*\}\);\s*if \(behavior\) el\.scrollTo\(\{ top: el\.scrollHeight, behavior \}\);/);
});

// ── 구현 후 리뷰(뮤테이션 테스트) 보강: 기존 앵커를 피해 가던 결함 중 동작 테스트로 잡을 수 없는 SQL·preload·섹션 줄 ──
test('마이그레이션: 권한 대상·목록 필터와 순서·완료 해제·삭제 판정 순서·작성자 이름·신호 실패 흡수', () => {
  // 래퍼 EXECUTE 는 앱이 쓰는 anon 에도 준다(빠지면 배포 후 전원 권한 오류) / 테이블 직접 권한 회수 대상은 anon·authenticated
  assert.match(migration, /FOREACH role_name IN ARRAY ARRAY\['anon','authenticated','service_role'\] LOOP[\s\S]{0,200}?GRANT EXECUTE ON FUNCTION/);
  assert.match(migration, /FOREACH role_name IN ARRAY ARRAY\['anon','authenticated'\] LOOP\s*IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = role_name\) THEN\s*EXECUTE format\('REVOKE ALL PRIVILEGES ON TABLE public\.comment_thread_todos FROM %I', role_name\);/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_list'), /jsonb_agg\(to_jsonb\(t\) ORDER BY t\.created_at, t\.id\)\s*FROM public\.comment_thread_todos t WHERE t\.thread_key = p_thread_key\)/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_add'), /VALUES \(p_thread_key, v_text, v_user, v_name\)/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_set_done'), /done_at\s*= CASE WHEN p_done THEN COALESCE\(done_at, now\(\)\) ELSE NULL END,\s*done_by\s*= CASE WHEN p_done THEN COALESCE\(done_by, v_user\) ELSE NULL END,\s*done_by_name = CASE WHEN p_done THEN COALESCE\(done_by_name, v_name\) ELSE NULL END/);
  assert.match(functionBody(migration, 'comment_thread_todos_session_delete'), /IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object\('ok', true, 'deleted', true\); END IF;\s*IF EXISTS \(SELECT 1 FROM public\.comment_thread_todos WHERE id = p_id\) THEN\s*RAISE EXCEPTION '내가 추가한 할 일만 지울 수 있어요\.' USING ERRCODE = '42501';\s*END IF;\s*RETURN jsonb_build_object\('ok', true, 'deleted', false\);/);
  assert.match(functionBody(migration, 'comment_thread_todos_notify_change'), /EXCEPTION WHEN OTHERS THEN\s*RAISE WARNING '\[thread-todos\] realtime 변경 신호 전송 실패: %', SQLERRM;/);
});

test('preload: 변경 신호 구독 해제는 같은 채널에서 같은 리스너를 뗀다', () => {
  assert.match(preload, /ipcRenderer\.on\('thread-todos:changed', listener\);\s*return \(\) => ipcRenderer\.removeListener\('thread-todos:changed', listener\);/);
});

test('섹션: 완료 방향·체크 표시·뮤테이션 마무리·조회 순번·안내 해제·입력 비우기/복구·폐기 판정·빈 입력·삭제 롤백·구독 해제·디바운스', () => {
  assert.match(section, /const done = item\.done_at == null;/);
  assert.match(section, /checked=\{item\.done_at != null\}/);
  assert.match(section, /className=\{cn\('block text-xs break-words', item\.done_at \? 'line-through text-text-secondary\/60' : 'text-text-primary'\)\}/);
  assert.match(section, /\} finally \{\s*inFlightRef\.current -= 1;\s*if \(mountedRef\.current\) \{\s*setBusyIds\(\(prev\) => \{ const next = new Set\(prev\); next\.delete\(id\); return next; \}\);/);
  assert.match(section, /const seq = \+\+loadSeqRef\.current;/);
  assert.match(section, /if \(loadPendingRef\.current\) \{\s*loadSeqRef\.current \+= 1;\s*loadPendingRef\.current = false;\s*\}\s*inFlightRef\.current \+= 1;/);
  assert.match(section, /setItems\(rows\.filter\(isThreadTodoRow\)\);\s*setNotice\(null\);/);
  assert.match(section, /const submitted = draft;\s*setItems\(\(prev\) => \[\.\.\.prev, optimistic\]\);\s*setDraft\(failedDraftsRef\.current\.shift\(\) \?\? ''\);/);
  // 코덱스 4차: 실패 문구는 입력창이 비었으면 되돌리고, 새로 치는 중이면 줄 세워 다음 추가 뒤 채운다(연달아 실패해도 잃지 않음)
  assert.match(section, /if \(mountedRef\.current && draftRef\.current\.trim\(\) === ''\) setDraft\(submitted\);\s*else failedDraftsRef\.current\.push\(submitted\);/);
  assert.match(section, /const draftRef = useRef\(draft\);\s*draftRef\.current = draft;\s*const failedDraftsRef = useRef<string\[\]>\(\[\]\);/);
  assert.match(section, /function isDiscardedResponse\(err: unknown\): boolean \{\s*return cleanIpcErrorMessage\(err, ''\) === THREAD_TODO_RESPONSE_DISCARDED;\s*\}/);
  assert.match(section, /const text = sanitizeThreadTodoText\(draft\);\s*if \(!isValidThreadTodoText\(text\)\) return;/);
  assert.match(section, /setItems\(\(prev\) => \(prev\.some\(\(r\) => r\.id === item\.id\) \? prev : \[\.\.\.prev, item\]\.sort\(byCreated\)\)\);/);
  assert.match(section, /return \(\) => \{\s*unsubscribe\(\);\s*if \(timer\) clearTimeout\(timer\);\s*\};/);
  assert.match(section, /const SIGNAL_DEBOUNCE_MS = 300;/);
  assert.match(section, /if \(inFlightRef\.current === 0\) void load\(\);\s*\}, SIGNAL_DEBOUNCE_MS\);/);
});

// ── 코덱스 3차: 휴지통은 보이기 전에는 눌리지 않게 (투명한 채 클릭을 받아 확인 없이 지워지던 구간 제거) ──
test('섹션: 휴지통 버튼은 visibility 로 숨기고, 행 hover·키보드 포커스에서만 드러난다', () => {
  const trashClass = section.match(/aria-label="팀 할 일 지우기"\s*className="([^"]*)"/)?.[1] ?? '';
  assert.ok(trashClass.length > 0);
  assert.match(trashClass, /\binvisible group-hover\/todo:visible group-focus-within\/todo:visible\b/);
  assert.doesNotMatch(trashClass, /opacity-0|transition-opacity|delay-\d+/);
});

// ── 코덱스 4차: 아키텍처 경계 문서 ──
test('문서: AGENTS.md·CLAUDE.md 에 팀 할 일 경계(세션 래퍼·내용 없는 신호·preview 저장소)가 적혀 있다', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');
  const claude = readFileSync('CLAUDE.md', 'utf8');
  const sectionDoc = agents.match(/### 팀 할 일 경계 \(v1\.118\.0\)[\s\S]*?(?=\n### )/)?.[0] ?? '';
  assert.ok(sectionDoc.length > 0);
  for (const phrase of ['comment_thread_todos_session_list/add/set_done/delete', 'thread-todos-changed', 'threadTodoPreviewStore.ts', '2026-09-14-comment-thread-todos.sql', '#widget-popup/{widgetId}']) {
    assert.ok(sectionDoc.includes(phrase), `AGENTS.md 팀 할 일 경계에 ${phrase}`);
  }
  assert.match(claude, /팀 할 일은 세션 토큰 래퍼 \+ 내용 없는 신호/);
});
