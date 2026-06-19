import { Fragment } from 'react';
import { tokenizeEntities } from '@/utils/entityTokens';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  userNames: string[];
  /** 멘션 칩 클릭 — 팀 뷰로 점프 등. 미지정 시 비클릭. */
  onMentionClick?: (name: string) => void;
}

/**
 * 평문 텍스트를 엔티티 칩으로 렌더(스펙 §10.3 — 보낸 댓글 표시 칩).
 *  - 경로: PathBadge(기존)  · 멘션: 보라 칩(클릭 시 onMentionClick)
 * PathLinkifiedText + renderMentionInSegment 조합을 한 컴포넌트로 통합.
 * (씬·컷 칩은 4단계 추가)
 */
export function EntityText({ text, userNames, onMentionClick }: Props) {
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
              onClick={onMentionClick ? () => onMentionClick(name) : undefined}
              title={onMentionClick ? `${name} 팀원 보기` : undefined}
            >
              {tok.content}
            </span>
          );
        }
        return <Fragment key={`t${i}`}>{tok.content}</Fragment>;
      })}
    </>
  );
}
