import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { StickyNote, Type, Eye, Pencil, Plus, X, Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import { Widget, WidgetIdContext, IsPopupContext } from './Widget';
import * as supabaseService from '@/services/supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';

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

/* ── 간단한 마크다운 렌더러 ──
 * 지원: **굵게**, *기울임*, __밑줄__, ~~취소선~~
 * 굵게(**)는 밑줄(__)보다 먼저 매칭되어야 `**` 가 `_ _` 로 오해석되지 않음
 */

function inlineFormat(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // 순서 주의: ** 를 * 보다 먼저, __ 를 _ 보다 먼저 매칭
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  let k = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) parts.push(<strong key={k++}>{match[2]}</strong>);
    else if (match[3] !== undefined) parts.push(<u key={k++}>{match[3]}</u>);
    else if (match[4] !== undefined) parts.push(<s key={k++}>{match[4]}</s>);
    else if (match[5] !== undefined) parts.push(<em key={k++}>{match[5]}</em>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length <= 1 ? (parts[0] ?? '') : <>{parts}</>;
}

function SimpleMarkdown({ content, fontSize }: { content: string; fontSize: number }) {
  if (!content) {
    return <div className="text-text-secondary/30" style={{ fontSize }}>메모를 입력하세요...</div>;
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 비순서 목록 (- 또는 * )
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc pl-5 my-0.5 text-text-primary" style={{ fontSize }}>
          {items.map((item, idx) => <li key={idx} className="py-px">{inlineFormat(item)}</li>)}
        </ul>,
      );
      continue;
    }

    // 순서 목록 (1. 또는 1) )
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal pl-5 my-0.5 text-text-primary" style={{ fontSize }}>
          {items.map((item, idx) => <li key={idx} className="py-px">{inlineFormat(item)}</li>)}
        </ol>,
      );
      continue;
    }

    // 빈 줄
    if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1.5" />);
      i++;
      continue;
    }

    // 일반 텍스트
    elements.push(
      <div key={key++} className="text-text-primary leading-relaxed" style={{ fontSize }}>
        {inlineFormat(line)}
      </div>,
    );
    i++;
  }

  return <div>{elements}</div>;
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
            {/* 연필 아이콘 — 호버 시 노출, 한 번 클릭으로 편집 */}
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

/* ── 서식 툴바 (textarea 선택 텍스트를 마크다운으로 감쌈) ── */

type MdStyle = 'bold' | 'italic' | 'underline' | 'strike';

function applyMarkdown(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  style: MdStyle,
  onChange: (nextValue: string) => void,
) {
  const ta = textareaRef.current;
  if (!ta) return;

  const wrapMap: Record<MdStyle, string> = {
    bold: '**',
    italic: '*',
    underline: '__',
    strike: '~~',
  };
  const wrap = wrapMap[style];
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const before = value.slice(0, s);
  const selected = value.slice(s, e);
  const after = value.slice(e);

  // 이미 같은 서식으로 감싸져 있으면 토글 해제
  const alreadyWrapped =
    selected.startsWith(wrap) && selected.endsWith(wrap) && selected.length >= wrap.length * 2;
  const insertion = alreadyWrapped
    ? selected.slice(wrap.length, selected.length - wrap.length)
    : `${wrap}${selected || '텍스트'}${wrap}`;
  const next = `${before}${insertion}${after}`;

  onChange(next);

  // 다음 렌더 후 커서/선택 영역 복원
  requestAnimationFrame(() => {
    const cur = textareaRef.current;
    if (!cur) return;
    if (alreadyWrapped) {
      cur.selectionStart = s;
      cur.selectionEnd = s + insertion.length;
    } else {
      cur.selectionStart = s + wrap.length;
      cur.selectionEnd = s + wrap.length + (selected || '텍스트').length;
    }
    cur.focus();
  });
}

function FormatToolbar({
  textareaRef,
  onChange,
  disabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const btn = 'p-1 rounded-md text-text-secondary/60 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-0.5 border-b border-bg-border/10 shrink-0">
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyMarkdown(textareaRef, 'bold', onChange)}
        disabled={disabled}
        title="굵게 (**text**)"
        aria-label="굵게"
      >
        <Bold size={12} />
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyMarkdown(textareaRef, 'italic', onChange)}
        disabled={disabled}
        title="기울임 (*text*)"
        aria-label="기울임"
      >
        <Italic size={12} />
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyMarkdown(textareaRef, 'underline', onChange)}
        disabled={disabled}
        title="밑줄 (__text__)"
        aria-label="밑줄"
      >
        <Underline size={12} />
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyMarkdown(textareaRef, 'strike', onChange)}
        disabled={disabled}
        title="취소선 (~~text~~)"
        aria-label="취소선"
      >
        <Strikethrough size={12} />
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
  const [previewMode, setPreviewMode] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoDataRef = useRef(memoData);
  memoDataRef.current = memoData;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeTab = memoData.tabs.find((t) => t.id === memoData.activeTabId) ?? memoData.tabs[0];

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
            // 사용자 전환 시 이전 데이터 초기화
            setMemoData(makeDefaultMemoData());
          }
        }
      } catch (err) {
        console.error('[MemoWidget] 로드 실패:', err);
      }
      setLoaded(true);
    })();
  }, [memoKey, currentUserId]);

  // 저장 (debounce, Supabase)
  const save = useCallback((data: MemoData) => {
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

  // 언마운트 시 즉시 저장
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
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
      }
    };
  }, [memoKey]);

  // ── 탭 관리 핸들러 ──

  const handleSelectTab = useCallback((id: string) => {
    const updated = { ...memoData, activeTabId: id };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  const handleAddTab = useCallback(() => {
    const newId = `tab-${Date.now()}`;
    // 제목은 빈 값으로 생성 — 탭 바에서 "메모 N" placeholder 로 노출되며,
    // 사용자가 직접 입력하면 그 값이 저장됨
    const newTab: MemoTab = {
      id: newId,
      title: '',
      content: '',
    };
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

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const updated: MemoData = {
      ...memoData,
      tabs: memoData.tabs.map((t) =>
        t.id === memoData.activeTabId ? { ...t, content: val } : t,
      ),
    };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const updated: MemoData = { ...memoData, fontSize: val };
    setMemoData(updated);
    save(updated);
  }, [memoData, save]);

  // 컨트롤 바 (미리보기 토글 + 글자 크기 슬라이더)
  const controls = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setPreviewMode(!previewMode)}
        className="p-1 rounded-md text-text-secondary/40 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
        title={previewMode ? '편집 모드' : '미리보기'}
      >
        {previewMode ? <Pencil size={13} /> : <Eye size={13} />}
      </button>
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

  // 서식 툴바가 본문을 변경할 때 활성 탭의 content 를 업데이트
  const handleFormatToolbarChange = useCallback((nextValue: string) => {
    const latest = memoDataRef.current;
    const updated: MemoData = {
      ...latest,
      tabs: latest.tabs.map((t) =>
        t.id === latest.activeTabId ? { ...t, content: nextValue } : t,
      ),
    };
    setMemoData(updated);
    save(updated);
  }, [save]);

  const formatToolbar = !previewMode && loaded ? (
    <FormatToolbar
      textareaRef={textareaRef}
      onChange={handleFormatToolbarChange}
    />
  ) : null;

  const memoContent = loaded ? (
    previewMode ? (
      <div className="w-full h-full overflow-auto cursor-text" onClick={() => setPreviewMode(false)}>
        <SimpleMarkdown content={activeTab?.content ?? ''} fontSize={memoData.fontSize} />
      </div>
    ) : (
      <textarea
        key={activeTab?.id}
        ref={textareaRef}
        value={activeTab?.content ?? ''}
        onChange={handleContentChange}
        placeholder="메모를 입력하세요... (상단 툴바로 서식 적용 가능)"
        className="w-full h-full bg-transparent text-text-primary resize-none outline-none placeholder:text-text-secondary/30 leading-relaxed"
        style={{ fontSize: `${memoData.fontSize}px`, minHeight: isPopup ? '100%' : '80px' }}
        spellCheck={false}
      />
    )
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
        {formatToolbar}
        <div className="flex-1 overflow-auto p-4">
          {memoContent}
        </div>
      </div>
    );
  }

  return (
    <Widget title="메모" icon={<StickyNote size={15} />} headerRight={controls}>
      {tabBar}
      {formatToolbar}
      {memoContent}
    </Widget>
  );
}
