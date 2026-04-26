import { Fragment, type ReactNode } from 'react';
import { tokenizeGPaths } from '@/utils/pathLink';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  /**
   * 텍스트 세그먼트 추가 변환 (예: 댓글의 @멘션 처리).
   * 미지정 시 그대로 렌더. 지정 시 path 외의 텍스트만 이 함수가 받는다.
   */
  renderTextSegment?: (segment: string, idx: number) => ReactNode;
}

/**
 * 텍스트에서 G:\ 경로만 PathBadge로 교체하고 나머지는 그대로 렌더.
 * renderTextSegment를 주면 텍스트 부분에 추가 변환(예: @멘션) 적용 가능.
 */
export function PathLinkifiedText({ text, renderTextSegment }: Props) {
  const tokens = tokenizeGPaths(text);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.type === 'path' ? (
          <PathBadge key={`p${i}`} path={tok.content} />
        ) : (
          <Fragment key={`t${i}`}>
            {renderTextSegment ? renderTextSegment(tok.content, i) : tok.content}
          </Fragment>
        ),
      )}
    </>
  );
}
