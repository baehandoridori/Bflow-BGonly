import { Fragment, type ReactNode, type MouseEvent } from 'react';
import { Scissors, Image, Layers, Clapperboard } from 'lucide-react';
import { tokenizeEntities } from '@/utils/entityTokens';
import type { HashTarget } from '@/utils/hashEntity';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  userNames: string[];
  /** 멘션 칩 클릭 — 팀 뷰로 점프 등. 미지정 시 비클릭. */
  onMentionClick?: (name: string) => void;
  /** 컷 칩 클릭 — 해당 씬으로 점프. 씬 컨텍스트 있는 곳에서만 전달(없으면 색 표시만). */
  onCutClick?: (cutNumber: number) => void;
  /** path/멘션/컷 외 평문 세그먼트 추가 변환(예: 검색어 하이라이트). 미지정 시 그대로. PathLinkifiedText와 동일 계약(평문 토큰에만 적용). */
  renderTextSegment?: (segment: string, idx: number) => ReactNode;
  /** #태그 칩 좌클릭 — 옆 참조 패널 등(4c). 미지정 시 비클릭. */
  onHashClick?: (target: HashTarget) => void;
  /** #태그 칩 우클릭 — 이동/옆에띄우기/수정 메뉴(4c). */
  onHashContextMenu?: (target: HashTarget, e: MouseEvent) => void;
}

/**
 * 평문 텍스트를 엔티티 칩으로 렌더(스펙 §10.3 — 보낸 댓글/내용 표시 칩).
 *  - 경로: PathBadge  · 멘션: 보라 칩(onMentionClick)  · 컷: 중립 칩(onCutClick 있으면 점프)
 * 컷 칩 색은 상태색(#74B9FF 진행중)·경로색과 겹치지 않게 중립으로 둠 — 6단계 폴리싱서 재검토.
 */
export function EntityText({ text, userNames, onMentionClick, onCutClick, renderTextSegment, onHashClick, onHashContextMenu }: Props) {
  const tokens = tokenizeEntities(text, userNames);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.type === 'path') return <PathBadge key={`p${i}`} path={tok.content} />;
        if (tok.type === 'mention') {
          const name = tok.name;
          return (
            <span
              key={`m${i}`}
              className={`text-accent font-bold bg-accent/10 rounded px-0.5 transition-colors ${
                onMentionClick ? 'cursor-pointer hover:bg-accent/20' : ''
              }`}
              onClick={onMentionClick ? (e) => { e.stopPropagation(); onMentionClick(name); } : undefined}
              title={onMentionClick ? `${name} 팀원 보기` : undefined}
            >
              {tok.content}
            </span>
          );
        }
        if (tok.type === 'cut') {
          const number = tok.number;
          return (
            <span
              key={`c${i}`}
              className={`inline-flex items-center gap-0.5 align-baseline rounded px-1 font-semibold text-text-secondary bg-text-secondary/15 transition-colors ${
                onCutClick ? 'cursor-pointer hover:bg-accent/15 hover:text-accent-sub' : ''
              }`}
              onClick={onCutClick ? (e) => { e.stopPropagation(); onCutClick(number); } : undefined}
              title={onCutClick ? `컷${number}(으)로 이동` : '씬·컷 표시'}
            >
              <Scissors size={9} className="shrink-0" />
              {tok.content}
            </span>
          );
        }
        if (tok.type === 'hash') {
          const target = tok.target;
          const Icon = target.kind === 'scene' ? Image : target.kind === 'part' ? Layers : Clapperboard;
          const color =
            target.kind === 'scene'
              ? 'text-[#5fe3cd] bg-[#5fe3cd]/12'
              : target.kind === 'part'
                ? 'text-[#f5c97a] bg-[#f5c97a]/12'
                : 'text-[#9cc9ff] bg-[#9cc9ff]/12';
          return (
            <span
              key={`h${i}`}
              className={`inline-flex items-center gap-0.5 align-baseline rounded px-1 font-semibold transition-opacity ${color} ${onHashClick ? 'cursor-pointer hover:opacity-75' : ''}`}
              onClick={onHashClick ? (e) => { e.stopPropagation(); onHashClick(target); } : undefined}
              onContextMenu={onHashContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onHashContextMenu(target, e); } : undefined}
              title={`#${tok.label}`}
            >
              <Icon size={9} className="shrink-0" />
              {tok.label}
            </span>
          );
        }
        return <Fragment key={`t${i}`}>{renderTextSegment ? renderTextSegment(tok.content, i) : tok.content}</Fragment>;
      })}
    </>
  );
}
