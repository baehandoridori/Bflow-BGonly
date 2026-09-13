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
  assert.match(mock, /onThreadTodosChanged: \(callback\) => \{/);
  assert.match(mock, /from '\.\.\/shared\/threadTodo';/);
  assert.match(mock, /canDeleteThreadTodo\(previewThreadTodos\[idx\], actor\)/);
  assert.match(mock, /notifyPreviewThreadTodos\(\);/);
});

test('댓글 패널: 섹션은 툴바 바로 아래·댓글 목록 바로 위, 스레드 키로 리마운트, 스레드 키가 비면 숨긴다', () => {
  assert.match(commentPanel, /import \{ ThreadTodoSection \} from '\.\/ThreadTodoSection';/);
  assert.match(
    commentPanel,
    /re만\s*<\/button>\s*<\/div>\s*\{\/\* 피드백 58[\s\S]{0,300}\{effectiveSceneThreadKey && currentUser \? \(\s*<ThreadTodoSection key=\{effectiveSceneThreadKey\} threadKey=\{effectiveSceneThreadKey\} currentUser=\{currentUser\} \/>\s*\) : null\}\s*\{\/\* 댓글 목록/,
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
