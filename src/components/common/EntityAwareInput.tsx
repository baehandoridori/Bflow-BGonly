import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, RefObject, UIEvent } from 'react';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useHashtagAutocomplete } from '@/hooks/useHashtagAutocomplete';
import { MentionDropdown } from './MentionDropdown';
import { HashtagDropdown } from './HashtagDropdown';
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
  /** 포커스 떠날 때(인라인 메모 blur 저장). 멘션 드롭다운 클릭은 preventDefault라 여기로 안 옴(MentionDropdown). */
  onBlur?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /**
   * #태그 자동완성 사용 여부(opt-in, 기본 false). 입력값이 표시될 때 EntityText + onHashClick(점프)으로
   * #칩이 렌더되는 입력칸(씬 메모/일정 메모/작업 메모 등)에서만 true 로 켠다.
   * 표시 측이 평문(`<p>{...}</p>`)이거나 #이 의미없는 입력은 미지정(끔) — 그래야 raw 직렬화
   * 토큰('[#a001](...)')이 평문으로 노출되지 않는다.
   * 훅은 항상 호출하고(React 훅 순서 유지) 키핸들·드롭다운에서만 게이트한다.
   */
  enableHashtag?: boolean;
  /**
   * multiline 일 때 내용 높이에 맞춰 자동 확장(opt-in, 기본 끔). 긴 메모가 작은 칸에 갇히지 않고 큰 상태로 시작.
   * 공용 컴포넌트라 무조건 켜면, resize-y(수동 드래그 리사이즈) 입력칸들의 수동 높이가 매 입력마다 덮어써지는
   * 회귀가 생긴다 → 자동 확장을 원하는 칸만 켜고, 켠 칸은 resize-none 권장(수동/자동 충돌 방지).
   */
  autoGrow?: boolean;
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
  dropdownPositionClassName, submitOn = 'none', onSubmit, onCancel, onPaste, onBlur,
  enableHashtag, autoGrow, 'aria-label': ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  // P1: useRef<union> 은 훅 param(union of RefObjects)과 직접 호환 안 돼 캐스트.
  const mention = useMentionAutocomplete({
    onChange,
    users,
    inputRef: inputRef as RefObject<HTMLTextAreaElement | null>,
  });
  const hash = useHashtagAutocomplete({
    onChange,
    inputRef: inputRef as RefObject<HTMLTextAreaElement | null>,
  });
  // #태그는 opt-in(기본 끔) — enableHashtag === true 로 명시한 입력칸(표시 측 EntityText+onHashClick)에서만 켠다.
  // 끈 입력칸에선 키핸들·드롭다운만 게이트, 훅 호출 자체는 항상(훅 순서 유지).
  const hashEnabled = enableHashtag === true;
  // @멘션·#태그 둘 다 DOM 을 직접 읽어 갱신. active 는 한쪽만(키핸들에서 mention 우선).
  // refresh 는 무해(상태만 갱신, hashEnabled 시 드롭다운 미표시)하므로 게이트 불필요.
  const refreshAll = () => { mention.refresh(); hash.refresh(); };

  // autoGrow(opt-in) 일 때만 multiline 내용 높이에 맞춰 자동 확장 — 긴 메모가 작은 칸에 갇히지 않고 큰 상태로 시작(한솔, E2).
  //   무조건 켜면 resize-y 입력칸(완료멘트·리테이크 등)의 수동 리사이즈가 매 입력마다 덮어써지는 회귀가 생겨 opt-in 으로 둔다.
  useEffect(() => {
    if (!autoGrow || !multiline) return;
    const el = inputRef.current as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, multiline, autoGrow]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention.onKeyDown(e)) return;
    if (hashEnabled && hash.onKeyDown(e)) return;
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); return; }
    if (onSubmit && e.key === 'Enter') {
      if (submitOn === 'enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
      else if (submitOn === 'ctrl-enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value);
    refreshAll();
  };
  const handleScroll = (e: UIEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft });
  };

  const shared = {
    value,
    onChange: handleChange,
    onClick: refreshAll,
    onSelect: refreshAll,
    onKeyDown: handleKeyDown,
    onScroll: handleScroll,
    onPaste,
    onBlur,
    // 멘션·경로·#태그 입력칸은 spell-check 불필요(고유명사·G:\경로·한글 다수 → Electron 기본 영어 사전이 오탐). 전역 off.
    spellCheck: false,
    placeholder,
    autoFocus,
    'aria-label': ariaLabel,
    // 입력칸 배경은 투명 강제(뒤 하이라이트 레이어가 비치도록). 배경/보더는 overlay 가 className 으로 그린다.
    className: `${className ?? ''} relative !bg-transparent`,
  };

  return (
    <div className="relative">
      <EntityHighlightOverlay
        text={value}
        userNames={users.map((u) => u.name)}
        className={className}
        scrollTop={scroll.top}
        scrollLeft={scroll.left}
        singleLine={!multiline}
      />
      {mention.active ? (
        <MentionDropdown
          items={mention.items}
          index={mention.index}
          onPick={mention.select}
          positionClassName={dropdownPositionClassName}
        />
      ) : hashEnabled && hash.active ? (
        <HashtagDropdown
          items={hash.items}
          index={hash.index}
          onPick={hash.select}
          positionClassName={dropdownPositionClassName}
        />
      ) : null}
      {multiline
        ? <textarea ref={inputRef as RefObject<HTMLTextAreaElement>} rows={rows} {...shared} />
        : <input type="text" ref={inputRef as RefObject<HTMLInputElement>} {...shared} />}
    </div>
  );
}
