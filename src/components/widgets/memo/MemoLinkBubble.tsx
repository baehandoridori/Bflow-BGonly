/**
 * 링크 버블 메뉴 — 새 링크 생성 / 기존 링크 편집·제거 UI
 *
 * 2가지 모드:
 *  1) 편집 모드: URL input + 적용 버튼. editMode === true 또는 링크 커서 위가 아닌 상태에서 사용자가 링크 버튼을 눌렀을 때
 *  2) 읽기 모드: 현재 링크 URL 표시 + 열기/편집/제거 버튼
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { BubbleMenu } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { ExternalLink, Pencil, X, Link2, Check } from 'lucide-react';

interface MemoLinkBubbleProps {
  editor: Editor | null;
  /** 외부 트리거 (툴바의 🔗 또는 Ctrl+K) — 이 값이 true 로 들어오면 강제 편집 모드 진입 */
  editRequestToken: number;
}

/** URL 유효성 검사 + https:// prepend */
function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (v.startsWith('/')) return v; // 상대 경로
  return `https://${v}`;
}

export function MemoLinkBubble({ editor, editRequestToken }: MemoLinkBubbleProps) {
  const [editMode, setEditMode] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 외부 요청 시 편집 모드 진입 + 현재 링크 URL 프리필
  useEffect(() => {
    if (editRequestToken <= 0 || !editor) return;
    const currentUrl = (editor.getAttributes('link')?.href as string | undefined) ?? '';
    setUrl(currentUrl);
    setEditMode(true);
  }, [editRequestToken, editor]);

  // 편집 모드 진입 시 input 포커스
  useEffect(() => {
    if (editMode) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [editMode]);

  // 버블을 언제 표시할지
  const shouldShow = useCallback(({ editor: ed, from, to }: { editor: Editor; from: number; to: number }) => {
    if (!ed) return false;
    // 편집 요청 중이면 무조건 노출
    if (editMode) return true;
    // 커서가 링크 위에 있으면 읽기 모드 표시
    if (ed.isActive('link')) return true;
    // 선택 영역이 있으면 링크 버튼 대기 — 자동 노출 안 함 (툴바 버튼으로 트리거)
    if (from !== to) return false;
    return false;
  }, [editMode]);

  const apply = useCallback(() => {
    if (!editor) return;
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setEditMode(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.chain().focus() as any).extendMarkRange('link').setLink({ href: normalized }).run();
    setEditMode(false);
  }, [editor, url]);

  const unlink = useCallback(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.chain().focus() as any).extendMarkRange('link').unsetLink().run();
    setEditMode(false);
  }, [editor]);

  const openExternal = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes('link')?.href as string | undefined;
    if (!href) return;
    window.electronAPI?.openExternal?.(href) ?? window.open(href, '_blank', 'noopener,noreferrer');
  }, [editor]);

  const startEdit = useCallback(() => {
    if (!editor) return;
    const href = (editor.getAttributes('link')?.href as string | undefined) ?? '';
    setUrl(href);
    setEditMode(true);
  }, [editor]);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
      tippyOptions={{
        duration: 150,
        placement: 'top',
        hideOnClick: false,
      }}
    >
      <div
        role="dialog"
        aria-label={editMode ? '링크 편집' : '링크'}
        className="flex items-center gap-1 px-2 py-1.5 min-w-[240px] rounded-lg border border-bg-border bg-bg-card shadow-lg"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditMode(false);
            editor.commands.focus();
          }
        }}
      >
        {editMode ? (
          <>
            <Link2 size={14} className="text-text-secondary/70 shrink-0" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); apply(); }
              }}
              placeholder="https://..."
              aria-label="링크 URL"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-secondary/40"
            />
            <button
              type="button"
              className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md bg-accent text-on-accent hover:bg-accent/90 cursor-pointer"
              onClick={apply}
              title="적용"
              aria-label="링크 적용"
            >
              <Check size={13} />
            </button>
          </>
        ) : (
          <>
            <span
              className="flex-1 min-w-0 text-[12px] text-text-secondary truncate px-1"
              title={editor.getAttributes('link')?.href as string}
            >
              {(editor.getAttributes('link')?.href as string | undefined) ?? ''}
            </span>
            <button type="button"
              className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md text-text-secondary/70 hover:text-accent hover:bg-accent/10 cursor-pointer"
              onClick={openExternal}
              title="브라우저로 열기" aria-label="브라우저로 열기">
              <ExternalLink size={13} />
            </button>
            <button type="button"
              className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md text-text-secondary/70 hover:text-accent hover:bg-accent/10 cursor-pointer"
              onClick={startEdit}
              title="편집" aria-label="링크 편집">
              <Pencil size={13} />
            </button>
            <button type="button"
              className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md text-text-secondary/70 hover:text-red-400 hover:bg-red-400/10 cursor-pointer"
              onClick={unlink}
              title="링크 제거" aria-label="링크 제거">
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
