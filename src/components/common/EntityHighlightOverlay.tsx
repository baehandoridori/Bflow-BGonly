import { Fragment } from 'react';
import { tokenizeEntities } from '@/utils/entityTokens';

interface Props {
  text: string;
  userNames: string[];
  /** 입력칸(textarea/input)과 '정확히 동일한' typography+padding 클래스 (정렬 핵심). 텍스트색은 내부서 transparent 강제. */
  className?: string;
  /** 입력칸 스크롤 동기화 */
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * 입력칸 뒤에 겹쳐 토큰 배경만 칠하는 미러 레이어(스펙 §10.3 — 인-인풋 멘션 강조, 슬랙 느낌).
 * 입력칸은 bg-transparent + 위, 이 레이어는 뒤에서 같은 위치에 토큰 배경을 보여준다.
 * contentEditable 미사용 — 입력은 실제 textarea/input 이 처리하므로 한글 IME·caret 100% 안정.
 * 정렬: 호출 측(EntityAwareInput)이 입력칸과 동일한 className 을 넘겨 font/padding/line-height 를 맞춘다.
 */
export function EntityHighlightOverlay({ text, userNames, className, scrollTop = 0, scrollLeft = 0 }: Props) {
  const tokens = tokenizeEntities(text, userNames);
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words !text-transparent ${className ?? ''}`}
      style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}
    >
      {tokens.map((t, i) => {
        if (t.type === 'mention') return <span key={i} className="rounded bg-accent/25">{t.content}</span>;
        if (t.type === 'path') return <span key={i} className="rounded bg-[#74B9FF]/20">{t.content}</span>;
        if (t.type === 'cut') return <span key={i} className="rounded bg-text-secondary/25">{t.content}</span>;
        return <Fragment key={i}>{t.content}</Fragment>;
      })}
      {/* 마지막 글자가 개행이면 caret 줄 높이 보정 */}
      {text.endsWith('\n') ? ' ' : null}
    </div>
  );
}
