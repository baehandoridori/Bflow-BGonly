import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { StickyNote, Type, Pencil, Plus, X } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { Widget, WidgetIdContext, IsPopupContext } from './Widget';
import * as supabaseService from '@/services/supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';
import { MemoEditor } from './memo/MemoEditor';
import { MemoToolbar } from './memo/MemoToolbar';

const MEMO_FILE = 'memo.json';
const MEMO_MIGRATION_KEY = 'bflow_migration_memo_done';
const SAVE_DEBOUNCE_MS = 500;
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

interface MemoTab {
  id: string;
  title: string;
  content: string;
}

interface MemoData {
  tabs: MemoTab[];
  activeTabId: string;
  fontSize: number;
}

function getMemoKey(widgetId: string | null): string {
  if (!widgetId || widgetId === 'memo') return 'memo';
  return widgetId;
}

/** 기존 { content, fontSize } → 신규 { tabs, activeTabId, fontSize } 마이그레이션 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateMemoData(raw: any): MemoData {
  if (raw && 'tabs' in raw && Array.isArray(raw.tabs)) {
    return raw as MemoData;
  }
  // 레거시 형식
  return {
    tabs: [{ id: 'default', title: '메모 1', content: raw?.content ?? '' }],
    activeTabId: 'default',
    fontSize: raw?.fontSize ?? DEFAULT_FONT_SIZE,
  };
}

function makeDefaultMemoData(): MemoData {
  return {
    tabs: [{ id: 'default', title: '메모 1', content: '' }],
    activeTabId: 'default',
    fontSize: DEFAULT_FONT_SIZE,
  };
}

/* ── memo.json → Supabase 마이그레이션 ── */

async function migrateMemoToSupabase(userId: string): Promise<void> {
  if (localStorage.getItem(MEMO_MIGRATION_KEY)) return;

  try {
    const store = await window.electronAPI?.readSettings(MEMO_FILE);
    if (!store || typeof store !== 'object') {
      localStorage.setItem(MEMO_MIGRATION_KEY, 'true');
      return;
    }

    for (const [key, value] of Object.entries(store)) {
      if (!value || typeof value !== 'object') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = value as any;
      await supabaseService.upsertMemo(userId, key, {
        tabs: data.tabs || [],
        activeTabId: data.activeTabId || null,
        fontSize: data.fontSize ?? 14,
      });
    }

    localStorage.setItem(MEMO_MIGRATION_KEY, 'true');

    try {
      await window.electronAPI?.writeSettings('memo.json.bak', store);
    } catch { /* 백업 실패는 무시 */ }

    console.log('[MemoWidget] memo.json → Supabase 마이그레이션 완료');
  } catch (err) {
    const msg = String(err);
    if (msg.includes('foreign key constraint') || msg.includes('violates')) {
      console.warn('[MemoWidget] 마이그레이션 스킵: 사용자가 Supabase에 존재하지 않음 (재로그인 필요)');
    } else {
      console.error('[MemoWidget] 마이그레이션 실패 (다음 실행 시 재시도):', err);
    }
  }
}

/* ── 탭 바 ── */

function MemoTabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  tabs: MemoTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const beginEdit = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const commitEdit = (id: string, fallback: string) => {
    const trimmed = editTitle.trim();
    onRename(id, trimmed || fallback);
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-bg-border/20 overflow-x-auto shrink-0 scrollbar-none">
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTabId;
        const placeholderTitle = `메모 ${idx + 1}`;
        const displayTitle = tab.title || placeholderTitle;

        if (editingId === tab.id) {
          return (
            <input
              key={tab.id}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => commitEdit(tab.id, placeholderTitle)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(tab.id, placeholderTitle); }
                if (e.key === 'Escape') setEditingId(null);
              }}
              placeholder={placeholderTitle}
              className="bg-accent/10 border-b border-accent text-[11px] text-text-primary outline-none w-28 px-1.5 py-0.5 rounded-t-md placeholder:text-text-secondary/40"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          );
        }

        return (
          <div
            key={tab.id}
            className={`group relative flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md transition-colors whitespace-nowrap select-none ${
              isActive
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-text-secondary/60 hover:text-text-primary hover:bg-accent/5'
            }`}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => beginEdit(tab.id, tab.title)}
          >
            <span className={tab.title ? 'cursor-pointer' : 'cursor-pointer italic opacity-60'}>
              {displayTitle}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent/15 hover:text-accent cursor-pointer"
              onClick={(e) => { e.stopPropagation(); beginEdit(tab.id, tab.title); }}
              title="제목 편집"
              aria-label="제목 편집"
            >
              <Pencil size={9} />
            </button>
            {tabs.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onDelete(tab.id); }}
                title="탭 삭제"
                aria-label="탭 삭제"
              >
                <X size={9} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="px-1.5 py-0.5 text-text-secondary/40 hover:text-accent hover:bg-accent/10 rounded-md transition-colors cursor-pointer text-sm shrink-0"
        title="새 탭"
        aria-label="새 탭 추가"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

/* ── 메모 위젯 ── */

export function MemoWidget() {
  const widgetId = useContext(WidgetIdContext);
  const isPopup = useContext(IsPopupContext);
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const memoKey = getMemoKey(widgetId);

  const [memoData, setMemoData] = useState<MemoData>(makeDefaultMemoData);
  const [loaded, setLoaded] = useState(false);
  // 탭별 editor 인스턴스 — 각 탭은 독립된 TipTap editor 를 가진다.
  // 이유: StarterKit 의 history 는 editor 단위 — 하나의 editor 를 공유하면 탭 A 의
  //   undo 가 탭 B 에서 replay 되어 현재 탭 content 를 이전 탭 상태로 덮어쓰는
  //   크로스탭 데이터 오염이 발생한다 (Codex 리뷰 P1 지적). 탭당 editor 분리로 차단.
  const [editorByTab, setEditorByTab] = useState<Record<string, Editor>>({});
  const [linkEditToken, setLinkEditToken] = useState(0);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoDataRef = useRef(memoData);
  memoDataRef.current = memoData;
  // 한솔 결정 (v1.15.7 Codex P1): unmount 저장 보호용 ref
  // - loadedRef: 초기 데이터 로드 완료 여부 (false 면 default 상태 — 저장 금지)
  // - dirtyRef: 사용자가 실제로 변경했는지 (false 면 무의미한 default 저장 금지)
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const editorAreaRef = useRef<HTMLDivElement>(null);

  const activeEditor = editorByTab[memoData.activeTabId] ?? null;

  // 로드 (Supabase) — 사용자 전환 시에도 재로드
  useEffect(() => {
    (async () => {
      try {
        if (currentUserId) {
          await migrateMemoToSupabase(currentUserId);
          const remote = await supabaseService.readMemo(currentUserId, memoKey);
          if (remote) {
            setMemoData(migrateMemoData(remote));
          } else {
            setMemoData(makeDefaultMemoData());
          }
        }
      } catch (err) {
        console.error('[MemoWidget] 로드 실패:', err);
      }
      setLoaded(true);
      loadedRef.current = true;  // Codex P1: unmount 저장 분기 게이트
    })();
  }, [memoKey, currentUserId]);

  // 저장 (debounce, Supabase) — save() 호출 시점에 사용자가 변경했음을 의미하므로 dirty 마킹
  const save = useCallback((data: MemoData) => {
    dirtyRef.current = true;  // Codex P1: unmount cleanup 이 default 상태 덮어쓰지 않게 게이트
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const userId = useAuthStore.getState().currentUser?.id;
        if (!userId) return;
        await supabaseService.upsertMemo(userId, memoKey, {
          tabs: data.tabs,
          activeTabId: data.activeTabId,
          fontSize: data.fontSize,
        });
        localStorage.setItem('memo-sync', `${memoKey}:${Date.now()}`);
      } catch (err) {
        const msg = String(err);
        if (!msg.includes('foreign key constraint')) {
          console.error('[MemoWidget] 저장 실패:', err);
        }
      }
    }, SAVE_DEBOUNCE_MS);
  }, [memoKey]);

  // 다른 윈도우의 메모 변경 감지 (localStorage storage 이벤트)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== 'memo-sync' || !e.newValue) return;
      const [changedKey] = e.newValue.split(':');
      if (changedKey !== memoKey) return;
      (async () => {
        try {
          const userId = useAuthStore.getState().currentUser?.id;
          if (!userId) return;
          const remote = await supabaseService.readMemo(userId, memoKey);
          if (remote) {
            setMemoData(migrateMemoData(remote));
          }
        } catch { /* ignore */ }
      })();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [memoKey]);

  // 언마운트 시 즉시 저장 — 한솔 보고 (v1.15.7): 플로팅 위젯 닫고 다시 열면 줄바꿈이 초기화됨.
  // Codex P1 fix: 초기 로드 끝나기 전 unmount 또는 사용자가 변경 안 한 상태에서 저장하면
  // default tabs/content 가 Supabase 에 덮어써져 *기존 메모가 삭제될 수 있음*. 다음 게이트 모두 통과해야 저장:
  // (1) loadedRef.current — 초기 데이터 로드 완료
  // (2) dirtyRef.current — 사용자가 실제로 변경 (save() 가 한 번이라도 호출됨)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // 게이트: 로드도 안 됐거나 사용자가 변경 안 했으면 저장 X
      if (!loadedRef.current || !dirtyRef.current) return;
      const data = memoDataRef.current;
      (async () => {
        try {
          const userId = useAuthStore.getState().currentUser?.id;
          if (!userId) return;
          await supabaseService.upsertMemo(userId, memoKey, {
            tabs: data.tabs,
            activeTabId: data.activeTabId,
            fontSize: data.fontSize,
          });
          localStorage.setItem('memo-sync', `${memoKey}:${Date.now()}`);
        } catch { /* ignore */ }
      })();
    };
  }, [memoKey]);

  // Ctrl+K 단축키 — 에디터에 포커스된 상태에서만 링크 편집 트리거
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      if (e.shiftKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const inEditor = editorAreaRef.current?.contains(active);
      if (!inEditor) return;
      e.preventDefault();
      setLinkEditToken((t) => t + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 탭 관리 핸들러 ──

  const handleSelectTab = useCallback((id: string) => {
    const updated = { ...memoData, activeTabId: id };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  const handleAddTab = useCallback(() => {
    const newId = `tab-${Date.now()}`;
    const newTab: MemoTab = { id: newId, title: '', content: '' };
    const updated: MemoData = {
      ...memoData,
      tabs: [...memoData.tabs, newTab],
      activeTabId: newId,
    };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  const handleRenameTab = useCallback((id: string, newTitle: string) => {
    const updated: MemoData = {
      ...memoData,
      tabs: memoData.tabs.map((t) => (t.id === id ? { ...t, title: newTitle } : t)),
    };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  const handleDeleteTab = useCallback((id: string) => {
    if (memoData.tabs.length <= 1) return;
    const idx = memoData.tabs.findIndex((t) => t.id === id);
    const newTabs = memoData.tabs.filter((t) => t.id !== id);
    const newActiveId = id === memoData.activeTabId
      ? newTabs[Math.min(idx, newTabs.length - 1)].id
      : memoData.activeTabId;
    const updated: MemoData = { ...memoData, tabs: newTabs, activeTabId: newActiveId };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  // ── 콘텐츠/폰트 변경 ──

  /**
   * 특정 탭의 content 를 갱신한다. tabId 를 closure 가 아닌 인자로 받아,
   * 각 탭의 onChange 가 독립된 editor 로부터 올라오는 경로를 보존한다.
   * (비활성 탭이 외부 동기화 등으로 내용 갱신을 일으켜도 activeTabId 와 무관하게 올바른 탭에 저장.)
   */
  const handleContentChangeForTab = useCallback((tabId: string, markdown: string) => {
    const latest = memoDataRef.current;
    if (latest.tabs.find(t => t.id === tabId)?.content === markdown) return;
    const updated: MemoData = {
      ...latest,
      tabs: latest.tabs.map((t) =>
        t.id === tabId ? { ...t, content: markdown } : t,
      ),
    };
    setMemoData(updated);
    save(updated);
  }, [save]);

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const updated: MemoData = { ...memoData, fontSize: val };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  /** 탭의 editor 인스턴스가 준비/해제될 때 editorByTab 에 등록/삭제 */
  const handleEditorReadyForTab = useCallback((tabId: string, ed: Editor | null) => {
    setEditorByTab((prev) => {
      if (ed) {
        if (prev[tabId] === ed) return prev;
        return { ...prev, [tabId]: ed };
      }
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const handleLinkRequest = useCallback(() => {
    setLinkEditToken((t) => t + 1);
  }, []);

  // 컨트롤 바 (글자 크기 슬라이더만 — 미리보기 토글 제거됨)
  const controls = (
    <div className="flex items-center gap-1.5">
      <Type size={12} className="text-text-secondary/50 shrink-0" />
      <input
        type="range"
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step={1}
        value={memoData.fontSize}
        onChange={handleFontSizeChange}
        className="w-14 h-1 cursor-pointer"
        title={`글자 크기: ${memoData.fontSize}px`}
      />
      <span className="text-[10px] text-text-secondary/40 tabular-nums w-5 text-right">
        {memoData.fontSize}
      </span>
    </div>
  );

  const tabBar = (
    <MemoTabBar
      tabs={memoData.tabs}
      activeTabId={memoData.activeTabId}
      onSelect={handleSelectTab}
      onAdd={handleAddTab}
      onRename={handleRenameTab}
      onDelete={handleDeleteTab}
    />
  );

  const toolbar = (
    <MemoToolbar
      editor={activeEditor}
      widthRef={editorAreaRef}
      onLinkRequest={handleLinkRequest}
    />
  );

  const memoContent = loaded ? (
    <div ref={editorAreaRef} className="flex-1 overflow-auto">
      {/*
        탭별로 독립된 MemoEditor 인스턴스를 마운트해두고 display 만 토글한다.

        이 구조의 이유:
        1) insertBefore 버그 방지 — 탭 전환/추가 시 editor 가 destroy/재생성되지 않으므로
           BubbleMenu(tippy.js) 포털과 React 재조정이 충돌할 기회가 없다.
        2) 탭별 undo 경계 보장 — StarterKit history 는 editor 단위. 하나의 editor 를
           공유하면 탭 A 의 undo transaction 이 탭 B 에서 replay 되어 B 의 content 를
           A 의 이전 상태로 덮어쓰는 크로스탭 데이터 오염이 발생한다 (Codex P1 지적).
        3) MemoLinkBubble 은 MemoEditor 내부에 포함돼 각 editor 와 부모-자식 관계 —
           언마운트 시 tippy → editor 순서로 안전하게 정리된다.
      */}
      {memoData.tabs.map((tab) => {
        const isActive = tab.id === memoData.activeTabId;
        return (
          <div
            key={tab.id}
            className={isActive ? 'h-full' : 'hidden'}
            aria-hidden={!isActive}
          >
            <MemoEditor
              content={tab.content}
              onChange={(md) => handleContentChangeForTab(tab.id, md)}
              fontSize={memoData.fontSize}
              onEditorReady={(ed) => handleEditorReadyForTab(tab.id, ed)}
              editRequestToken={linkEditToken}
            />
          </div>
        );
      })}
    </div>
  ) : (
    <div className="flex items-center justify-center h-full">
      <span className="text-sm text-text-secondary/30 animate-pulse">로딩 중...</span>
    </div>
  );

  // 팝업 모드: Widget 래퍼가 헤더를 숨기므로 인라인 툴바 직접 렌더링
  if (isPopup) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-bg-border/20 shrink-0">
          <StickyNote size={13} className="text-accent shrink-0" />
          <span className="text-xs font-medium text-text-primary/70">메모</span>
          <div className="ml-auto">{controls}</div>
        </div>
        {tabBar}
        {toolbar}
        {memoContent}
      </div>
    );
  }

  return (
    <Widget title="메모" icon={<StickyNote size={15} />} headerRight={controls}>
      {tabBar}
      {toolbar}
      {memoContent}
    </Widget>
  );
}
