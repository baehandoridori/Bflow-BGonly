/**
 * 메모 에디터 툴바 — 11개 서식 버튼 + 반응형 드롭다운
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, ListChecks, Link2, ChevronDown,
} from 'lucide-react';

interface MemoToolbarProps {
  editor: Editor | null;
  /** 툴바 컨테이너 (ResizeObserver 측정 대상). 제공되지 않으면 툴바 자체 폭 사용 */
  widthRef?: React.RefObject<HTMLElement | null>;
  /** 링크 버튼을 누를 때 호출 (MemoWidget 에서 버블 열기 지시용) */
  onLinkRequest?: () => void;
}

const NARROW_THRESHOLD = 320;

export function MemoToolbar({ editor, widthRef, onLinkRequest }: MemoToolbarProps) {
  const selfRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  // 드롭다운 열림 상태
  const [openMenu, setOpenMenu] = useState<null | 'heading' | 'list'>(null);

  // 반응형: 컨테이너 폭 측정
  useEffect(() => {
    const target = widthRef?.current ?? selfRef.current;
    if (!target) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setIsNarrow(w < NARROW_THRESHOLD);
      }
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [widthRef]);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!selfRef.current?.contains(t)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenu]);

  const run = useCallback((fn: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => void) => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn(editor.chain().focus() as any);
  }, [editor]);

  const isActive = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs);
  const disabled = !editor;

  const btnBase = 'inline-flex items-center justify-center w-[22px] h-[22px] rounded-md transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent/40';
  const btnCls = (active: boolean) => {
    if (disabled) return `${btnBase} opacity-40 cursor-not-allowed text-text-secondary/60`;
    if (active) return `${btnBase} text-accent bg-accent/15`;
    return `${btnBase} text-text-secondary/60 hover:text-accent hover:bg-accent/10`;
  };

  // ─── 버튼 렌더러들 ─────────────────────────────
  const InlineButtons = (
    <div className="flex items-center gap-0.5">
      <button type="button" className={btnCls(isActive('bold'))}
        title="굵게 (Ctrl+B)" aria-label="굵게"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleBold().run())}
        disabled={disabled}>
        <Bold size={13} />
      </button>
      <button type="button" className={btnCls(isActive('italic'))}
        title="기울임 (Ctrl+I)" aria-label="기울임"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleItalic().run())}
        disabled={disabled}>
        <Italic size={13} />
      </button>
      <button type="button" className={btnCls(isActive('underline'))}
        title="밑줄 (Ctrl+U)" aria-label="밑줄"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleUnderline().run())}
        disabled={disabled}>
        <Underline size={13} />
      </button>
      <button type="button" className={btnCls(isActive('strike'))}
        title="취소선 (Ctrl+Shift+X)" aria-label="취소선"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleStrike().run())}
        disabled={disabled}>
        <Strikethrough size={13} />
      </button>
    </div>
  );

  const HeadingButtons = (
    <div className="flex items-center gap-0.5">
      {([1, 2, 3] as const).map((lvl) => (
        <button
          key={lvl}
          type="button"
          className={btnCls(isActive('heading', { level: lvl }))}
          title={`제목${lvl} (Ctrl+Alt+${lvl})`}
          aria-label={`제목${lvl}`}
          onMouseDown={(e) => e.preventDefault()}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => run((c: any) => c.toggleHeading({ level: lvl }).run())}
          disabled={disabled}
          style={{ fontSize: 10, fontWeight: 700 }}
        >
          H{lvl}
        </button>
      ))}
    </div>
  );

  const ListButtons = (
    <div className="flex items-center gap-0.5">
      <button type="button" className={btnCls(isActive('bulletList'))}
        title="불릿 목록 (Ctrl+Shift+8)" aria-label="불릿 목록"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleBulletList().run())}
        disabled={disabled}>
        <List size={13} />
      </button>
      <button type="button" className={btnCls(isActive('orderedList'))}
        title="번호 목록 (Ctrl+Shift+7)" aria-label="번호 목록"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleOrderedList().run())}
        disabled={disabled}>
        <ListOrdered size={13} />
      </button>
      <button type="button" className={btnCls(isActive('taskList'))}
        title="체크리스트 (Ctrl+Shift+9)" aria-label="체크리스트"
        onMouseDown={(e) => e.preventDefault()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={() => run((c: any) => c.toggleTaskList().run())}
        disabled={disabled}>
        <ListChecks size={13} />
      </button>
    </div>
  );

  const LinkButton = (
    <button type="button" className={btnCls(isActive('link'))}
      title="링크 (Ctrl+K)" aria-label="링크"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onLinkRequest?.(); }}
      disabled={disabled}>
      <Link2 size={13} />
    </button>
  );

  const dropdownBtn = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-text-secondary/70 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const menuCls = 'absolute top-full left-0 mt-1 min-w-[140px] rounded-md border border-bg-border bg-bg-card shadow-lg py-1 z-[60] animate-fade-in';
  const menuItem = 'w-full text-left px-3 py-1.5 text-[12px] text-text-primary hover:bg-accent/10 hover:text-accent cursor-pointer flex items-center gap-2';
  const menuItemActive = 'bg-accent/15 text-accent';

  // ─── 좁은 모드: 헤딩/리스트를 드롭다운으로 ─────────────
  const HeadingDropdown = (
    <div className="relative">
      <button
        type="button"
        className={dropdownBtn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpenMenu(openMenu === 'heading' ? null : 'heading')}
        disabled={disabled}
      >
        단락 <ChevronDown size={10} />
      </button>
      {openMenu === 'heading' && (
        <div className={menuCls} role="menu">
          <button className={`${menuItem} ${isActive('paragraph') && !isActive('heading') ? menuItemActive : ''}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => { run((c: any) => c.setParagraph().run()); setOpenMenu(null); }}>
            본문
          </button>
          {([1, 2, 3] as const).map((lvl) => (
            <button key={lvl}
              className={`${menuItem} ${isActive('heading', { level: lvl }) ? menuItemActive : ''}`}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => { run((c: any) => c.toggleHeading({ level: lvl }).run()); setOpenMenu(null); }}>
              <span style={{ fontSize: lvl === 1 ? 16 : lvl === 2 ? 14 : 13, fontWeight: 600 }}>제목 {lvl}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const ListDropdown = (
    <div className="relative">
      <button
        type="button"
        className={dropdownBtn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpenMenu(openMenu === 'list' ? null : 'list')}
        disabled={disabled}
      >
        리스트 <ChevronDown size={10} />
      </button>
      {openMenu === 'list' && (
        <div className={menuCls} role="menu">
          <button className={`${menuItem} ${isActive('bulletList') ? menuItemActive : ''}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => { run((c: any) => c.toggleBulletList().run()); setOpenMenu(null); }}>
            <List size={13} /> 불릿 목록
          </button>
          <button className={`${menuItem} ${isActive('orderedList') ? menuItemActive : ''}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => { run((c: any) => c.toggleOrderedList().run()); setOpenMenu(null); }}>
            <ListOrdered size={13} /> 번호 목록
          </button>
          <button className={`${menuItem} ${isActive('taskList') ? menuItemActive : ''}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => { run((c: any) => c.toggleTaskList().run()); setOpenMenu(null); }}>
            <ListChecks size={13} /> 체크리스트
          </button>
        </div>
      )}
    </div>
  );

  const Divider = <div className="w-px h-4 bg-bg-border/40 shrink-0" aria-hidden />;

  return (
    <div
      ref={selfRef}
      className="flex items-center gap-2 px-1.5 py-0.5 border-b border-bg-border/20 min-h-[28px] shrink-0 relative"
    >
      {InlineButtons}
      {Divider}
      {isNarrow ? HeadingDropdown : HeadingButtons}
      {Divider}
      {isNarrow ? ListDropdown : ListButtons}
      {Divider}
      {LinkButton}
    </div>
  );
}
