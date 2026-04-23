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
import { toast } from 'sonner';
import { ExternalLink, Pencil, X, Link2, Check } from 'lucide-react';

interface MemoLinkBubbleProps {
  editor: Editor | null;
  /** 외부 트리거 (툴바의 🔗 또는 Ctrl+K) — 이 값이 true 로 들어오면 강제 편집 모드 진입 */
  editRequestToken: number;
}

/**
 * URL 유효성 검사 + https:// prepend.
 *
 * Electron main 의 `shell:open-external` 핸들러는 http(s)/mailto/tel 프로토콜만 허용하므로
 * 같은 화이트리스트에 맞춘다. 상대 경로(`/foo`) 나 프로토콜만(`http:`) 등은 거부 (`null` 반환).
 * 반환값 규약:
 *   - `''` (빈 입력): `null` — 의도적 취소로 해석
 *   - 유효한 http(s)/mailto/tel 또는 도메인 형태: 정규화된 절대 URL
 *   - 그 외 (상대 경로, 프로토콜 누락, 공백 섞인 쓰레기): `null`
 */
function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  // 이미 지원되는 프로토콜: 그대로 반환 (최소 길이 검증)
  if (/^https?:\/\/\S+/i.test(v)) return v;
  if (/^mailto:\S+@\S+/i.test(v)) return v;
  if (/^tel:\S+/i.test(v)) return v;
  // 상대 경로 `/foo`, 프로토콜 미지원 `ftp://...`, 스킴만 있는 `http:` 등은 거부
  if (/^\//.test(v)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  if (/\s/.test(v)) return null;
  // 도메인 형태만 남음 → 최소 점 하나 포함(도메인.tld) 요구
  if (!/\.[a-z]{2,}/i.test(v)) return null;
  return `https://${v}`;
}

export function MemoLinkBubble({ editor, editRequestToken }: MemoLinkBubbleProps) {
  const [editMode, setEditMode] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * 이미 처리한 editRequestToken 추적.
   * editRequestToken 은 상위에서 monotonic 증가만 하므로 reset 이 없음.
   * dependency 에 editor 가 들어가야 최신 editor 에서 editRequestToken 을 처리할 수 있지만,
   * token 동일한 상태로 editor 가 교체되면 (예: 탭 전환 시 MemoEditor key 재마운트) effect 가
   * 다시 뛰어 의도치 않게 버블이 열리는 문제가 있어 — ref 로 처리된 토큰을 기록해서 중복 실행 방지.
   */
  const lastHandledTokenRef = useRef(0);

  // editor 인스턴스가 교체되면 (탭 전환으로 MemoEditor 가 리마운트) 편집 상태 리셋.
  // 이 reset effect 가 token effect 보다 선언 순서상 먼저여야, 탭 전환과 동시에 Ctrl+K 가
  // 눌린 경우에도 reset 후 token effect 가 뒤이어 editMode=true 로 올바르게 설정된다.
  useEffect(() => {
    setEditMode(false);
    setUrl('');
  }, [editor]);

  // 외부 요청 시 편집 모드 진입 + 현재 링크 URL 프리필
  useEffect(() => {
    if (editRequestToken <= 0 || !editor) return;
    if (editRequestToken === lastHandledTokenRef.current) return;
    lastHandledTokenRef.current = editRequestToken;
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
    const raw = url.trim();
    // 빈 입력은 취소로 해석 (기존 링크 있으면 유지)
    if (!raw) {
      setEditMode(false);
      return;
    }
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      toast.error('유효하지 않은 URL 형식입니다. http:// 또는 https:// 로 시작하거나 도메인을 입력해주세요.');
      // 버블 유지 + input 재포커스
      inputRef.current?.focus();
      inputRef.current?.select();
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
