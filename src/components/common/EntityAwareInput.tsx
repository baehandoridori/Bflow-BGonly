import { useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject, UIEvent } from 'react';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { MentionDropdown } from './MentionDropdown';
import { EntityHighlightOverlay } from './EntityHighlightOverlay';

interface MentionUser { id: string; name: string }

interface Props {
  value: string;
  onChange: (v: string) => void;
  users: readonly MentionUser[];
  multiline?: boolean;            // true=textarea, false=input
  placeholder?: string;
  /** 입력칸 스타일. 정렬을 위해 하이라이트 레이어와 공유한다(bg 는 내부서 transparent 처리). */
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  dropdownPositionClassName?: string;
  submitOn?: 'enter' | 'ctrl-enter' | 'none';  // 기본 'none'
  onSubmit?: () => void;
  onCancel?: () => void;          // Escape (멘션 비활성 시)
  onPaste?: (e: ClipboardEvent) => void;
  'aria-label'?: string;
}

/**
 * 멘션 자동완성(@) + 인-인풋 하이라이트 내장 공통 입력(스펙 §10, 4a).
 * useMentionAutocomplete + MentionDropdown + EntityHighlightOverlay 조립을 한 컴포넌트로(6곳+ 반복 제거).
 * 입력은 실제 textarea/input(한글 IME·caret 안정), 토큰 강조는 뒤 레이어가 담당.
 * 표시(보낸 뒤 칩)는 EntityText 별도. CommentPanel/RevisionCommentThread 는 특수성 커서 직접 조립 유지.
 */
export function EntityAwareInput({
  value, onChange, users, multiline, placeholder, className, rows, autoFocus,
  dropdownPositionClassName, submitOn = 'none', onSubmit, onCancel, onPaste,
  'aria-label': ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  // P1: useRef<union> 은 훅 param(union of RefObjects)과 직접 호환 안 돼 캐스트.
  const mention = useMentionAutocomplete({
    onChange,
    users,
    inputRef: inputRef as RefObject<HTMLTextAreaElement | null>,
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention.onKeyDown(e)) return;
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); return; }
    if (onSubmit && e.key === 'Enter') {
      if (submitOn === 'enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
      else if (submitOn === 'ctrl-enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value);
    mention.refresh();
  };
  const handleScroll = (e: UIEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft });
  };

  const shared = {
    value,
    onChange: handleChange,
    onClick: mention.refresh,
    onSelect: mention.refresh,
    onKeyDown: handleKeyDown,
    onScroll: handleScroll,
    onPaste,
    placeholder,
    autoFocus,
    'aria-label': ariaLabel,
    className: `${className ?? ''} relative bg-transparent`,
  };

  return (
    <div className="relative">
      <EntityHighlightOverlay
        text={value}
        userNames={users.map((u) => u.name)}
        className={className}
        scrollTop={scroll.top}
        scrollLeft={scroll.left}
      />
      {mention.active && (
        <MentionDropdown
          items={mention.items}
          index={mention.index}
          onPick={mention.select}
          positionClassName={dropdownPositionClassName}
        />
      )}
      {multiline
        ? <textarea ref={inputRef as RefObject<HTMLTextAreaElement>} rows={rows} {...shared} />
        : <input type="text" ref={inputRef as RefObject<HTMLInputElement>} {...shared} />}
    </div>
  );
}
