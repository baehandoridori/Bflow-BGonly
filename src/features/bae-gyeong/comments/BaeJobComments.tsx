/**
 * BAE경 기록 한 건의 코멘트(9단계) — 씬 · 캐릭터 댓글과 같은 댓글 패널(CommentPanelResizable → CommentPanel)을 bae:{작업 id} 스레드로 연다.
 * 댓글 · 답글 · @멘션 · 반응 · 그림 첨부가 씬 댓글처럼 되고, 길은 세션 래퍼(bae_gyeong_session_comment_*)뿐이다 — 그 기록을 만든 사람과
 * 검수자(관리자 포함)만 읽고 쓴다(서버가 정한다). 만든 사람에게는 남이 쓴 코멘트마다 종 알림이 간다.
 * 기록 한 건 화면(records/JobView)은 오른쪽 접는 칸(BaeJobCommentsDock)에 한 번 붙인다 — 접혀 있어도 이 칸은 살아 있어(숨김)
 * 코멘트 수(onCount)와 실시간 새로 읽기가 그대로 되고, 서버를 더 부르지 않는다.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { CommentPanelResizable } from '@/components/scenes/CommentPanelResizable';
import { buildBaeCommentKey, isBaeCommentJobId } from '@/shared/bae/comments';
import { BAE_COMMENTS_UNAVAILABLE, baeCommentsGateway } from './baeCommentsApi';

export interface BaeJobCommentsProps {
  jobId: string;
  /** 기록 이름(입력칸 안내 · 슬랙 위치 칸). 없으면 '이 기록'. */
  jobName?: string | null;
  /** 알림 · 바로가기로 들어왔을 때 강조할 코멘트. */
  focusCommentId?: string | null;
  /** 패널 높이(Tailwind 클래스). 기본은 화면 높이의 70%까지. */
  heightClass?: string;
  className?: string;
  /** 코멘트 수가 바뀔 때마다(처음 불러올 때 포함) — 칸이 이미 불러온 목록에서 센다(서버를 더 부르지 않는다). */
  onCount?: (count: number) => void;
  /** 칸 머리 오른쪽에 놓을 것 (한 건 보기의 '접기'). */
  headerRight?: ReactNode;
}

export function BaeJobComments({ jobId, jobName = null, focusCommentId = null, heightClass = 'h-[min(720px,70vh)]', className = '', onCount, headerRight }: BaeJobCommentsProps) {
  const [count, setCount] = useState(0);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const handleCount = useCallback((n: number) => {
    setCount(n);
    onCountRef.current?.(n);
  }, []);
  const sceneKey = useMemo(() => buildBaeCommentKey(jobId), [jobId]);
  const thread = useMemo(() => ({ jobId, jobName }), [jobId, jobName]);
  const available = useMemo(() => !!baeCommentsGateway(), []);

  if (!isBaeCommentJobId(jobId)) return null;
  if (!available) {
    return (
      <section className={`bae-comments-unavailable rounded-2xl border border-bg-border bg-bg-card px-4 py-3 text-xs text-text-secondary ${className}`} aria-label="코멘트">
        <p className="flex items-center gap-2"><MessageSquare size={14} aria-hidden="true" />{BAE_COMMENTS_UNAVAILABLE}</p>
        {headerRight ? <div className="mt-2 flex justify-end">{headerRight}</div> : null}
      </section>
    );
  }
  return (
    <CommentPanelResizable
      key={jobId}
      sceneKey={sceneKey}
      baeThread={thread}
      headerTitle="코멘트"
      headerRight={headerRight}
      sceneLabel={jobName?.trim() || 'BAE경 기록'}
      commentCount={count}
      onCountChange={handleCount}
      focusCommentId={focusCommentId ?? undefined}
      heightClass={heightClass}
      className={`bae-comments rounded-modal ${className}`}
    />
  );
}
