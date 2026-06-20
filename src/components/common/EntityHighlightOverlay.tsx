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
  /** 한 줄 input 용(줄바꿈 없음, 가로 스크롤). textarea 는 false(기본). */
  singleLine?: boolean;
}

/**
 * 입력칸 뒤에 겹쳐 토큰 배경만 칠하는 미러 레이어(스펙 §10.3 — 인-인풋 멘션 강조, 슬랙 느낌).
 * 입력칸은 bg-transparent + 위, 이 레이어는 뒤에서 같은 위치에 토큰 배경을 보여준다.
 * contentEditable 미사용 — 입력은 실제 textarea/input 이 처리하므로 한글 IME·caret 100% 안정.
 * 정렬: 호출 측(EntityAwareInput)이 입력칸과 동일한 className 을 넘겨 font/padding/line-height 를 맞춘다.
 */
export function EntityHighlightOverlay({ text, userNames, className, scrollTop = 0, scrollLeft = 0, singleLine = false }: Props) {
  const tokens = tokenizeEntities(text, userNames);
  return (
    <div
      aria-hidden
      // 테두리·배경·글자색은 입력칸이 단독으로 그린다. overlay 는 토큰 배경 span 만 보이게 모두 중화
      // (border-width/padding 은 className 으로 유지해 정렬만 맞춘다 — 포커스 시 테두리 이중색 방지).
      className={`pointer-events-none absolute inset-0 overflow-hidden !bg-transparent !border-transparent !text-transparent ${singleLine ? 'whitespace-pre' : 'whitespace-pre-wrap break-words'} ${className ?? ''}`}
      style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}
    >
      {tokens.map((t, i) => {
        if (t.type === 'mention') return <span key={i} className="rounded bg-accent/25">{t.content}</span>;
        if (t.type === 'path') return <span key={i} className="rounded bg-[#74B9FF]/20">{t.content}</span>;
        if (t.type === 'hash') return <span key={i} className="rounded bg-[#5fe3cd]/25">{t.content}</span>;
        return <Fragment key={i}>{t.content}</Fragment>;
      })}
      {/* 마지막 글자가 개행이면 caret 줄 높이 보정 */}
      {text.endsWith('\n') ? ' ' : null}
    </div>
  );
}
