import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { StickyNote, Type, Eye, Pencil } from 'lucide-react';
import { Widget, WidgetIdContext, IsPopupContext } from './Widget';

const MEMO_FILE = 'memo.json';
const SAVE_DEBOUNCE_MS = 500;
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

interface MemoData {
  content: string;
  fontSize: number;
}

type MemoStore = Record<string, MemoData>;

function getMemoKey(widgetId: string | null): string {
  if (!widgetId || widgetId === 'memo') return 'memo';
  return widgetId;
}

/* ── 간단한 마크다운 렌더러 ── */

function inlineFormat(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  let k = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2]) parts.push(<strong key={k++}>{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={k++}>{match[3]}</em>);
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

/* ── 메모 위젯 ── */

export function MemoWidget() {
  const widgetId = useContext(WidgetIdContext);
  const isPopup = useContext(IsPopupContext);
  const memoKey = getMemoKey(widgetId);

  const [content, setContent] = useState('');
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [loaded, setLoaded] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const fontSizeRef = useRef(fontSize);
  contentRef.current = content;
  fontSizeRef.current = fontSize;

  // 로드
  useEffect(() => {
    (async () => {
      try {
        const store = (await window.electronAPI?.readSettings(MEMO_FILE)) as MemoStore | null;
        if (store && store[memoKey]) {
          setContent(store[memoKey].content ?? '');
          setFontSize(store[memoKey].fontSize ?? DEFAULT_FONT_SIZE);
        }
      } catch (err) {
        console.error('[MemoWidget] 로드 실패:', err);
      }
      setLoaded(true);
    })();
  }, [memoKey]);

  // 저장 (debounce) + 다른 윈도우에 시그널
  const save = useCallback((newContent: string, newFontSize: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const store = ((await window.electronAPI?.readSettings(MEMO_FILE)) ?? {}) as MemoStore;
        store[memoKey] = { content: newContent, fontSize: newFontSize };
        await window.electronAPI?.writeSettings(MEMO_FILE, store);
        // 다른 윈도우에 변경 알림 (storage 이벤트는 다른 윈도우에서만 발생)
        localStorage.setItem('memo-sync', `${memoKey}:${Date.now()}`);
      } catch (err) {
        console.error('[MemoWidget] 저장 실패:', err);
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
          const store = (await window.electronAPI?.readSettings(MEMO_FILE)) as MemoStore | null;
          if (store && store[memoKey]) {
            setContent(store[memoKey].content ?? '');
            setFontSize(store[memoKey].fontSize ?? DEFAULT_FONT_SIZE);
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
        const fc = contentRef.current;
        const ff = fontSizeRef.current;
        (async () => {
          try {
            const store = ((await window.electronAPI?.readSettings(MEMO_FILE)) ?? {}) as MemoStore;
            store[memoKey] = { content: fc, fontSize: ff };
            await window.electronAPI?.writeSettings(MEMO_FILE, store);
            localStorage.setItem('memo-sync', `${memoKey}:${Date.now()}`);
          } catch { /* ignore */ }
        })();
      }
    };
  }, [memoKey]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    save(val, fontSizeRef.current);
  }, [save]);

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setFontSize(val);
    save(contentRef.current, val);
  }, [save]);

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
        value={fontSize}
        onChange={handleFontSizeChange}
        className="w-14 h-1 cursor-pointer"
        title={`글자 크기: ${fontSize}px`}
      />
      <span className="text-[10px] text-text-secondary/40 tabular-nums w-5 text-right">
        {fontSize}
      </span>
    </div>
  );

  const memoContent = loaded ? (
    previewMode ? (
      <div className="w-full h-full overflow-auto cursor-text" onClick={() => setPreviewMode(false)}>
        <SimpleMarkdown content={content} fontSize={fontSize} />
      </div>
    ) : (
      <textarea
        value={content}
        onChange={handleContentChange}
        placeholder="메모를 입력하세요... (- 목록, 1. 번호목록, **굵게**, *기울임*)"
        className="w-full h-full bg-transparent text-text-primary resize-none outline-none placeholder:text-text-secondary/30 leading-relaxed"
        style={{ fontSize: `${fontSize}px`, minHeight: isPopup ? '100%' : '80px' }}
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
        <div className="flex-1 overflow-auto p-4">
          {memoContent}
        </div>
      </div>
    );
  }

  return (
    <Widget title="메모" icon={<StickyNote size={15} />} headerRight={controls}>
      {memoContent}
    </Widget>
  );
}
