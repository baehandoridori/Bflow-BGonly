/**
 * BAE경 확인 도장 → 슬랙(계획 14 6-2, 9단계 '도장이 코멘트 한 줄로도 남아서 Bflow 알림(종)과 슬랙 연결을 그대로 탐').
 * 종 알림은 서버가 만든다(도장 → 코멘트 한 줄 → 만든 사람에게 알림 줄). 슬랙은 Bflow 의 다른 댓글처럼 쓴 사람의 앱이 보낸다 —
 * 그래서 도장을 찍은 앱이 찍기가 끝난 뒤 이것을 한 번 부른다(2단계: 도장 찍기 화면에서). 확인함은 조용히, 내 기록이면 보내지 않는다.
 */
import { notifyMentionsForComment, type MentionDeliveryResult } from '@/services/slackWebhookService';
import { buildBaeJobDeepLink } from '@/shared/bflowDeepLink';
import { baeCommentPlaceLabel } from '@/shared/bae/comments';

export interface BaeStampSlackInput {
  job: { id: string; userId: string; name?: string | null };
  stamp: string | null;
  note: string | null;
  me: { id: string; name: string; slackId?: string | null };
  users: readonly { id: string; name: string; slackId?: string | null }[];
}

/** 보낼 일이 없으면 null(확인함 · 도장 빼기 · 내 기록). */
export async function notifyBaeStampSlack(input: BaeStampSlackInput): Promise<MentionDeliveryResult | null> {
  if (input.stamp !== 'good' && input.stamp !== 'again') return null;
  if (input.job.userId === input.me.id) return null;
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim();
  const text = `${input.stamp === 'good' ? '좋아요 도장을 찍었어요.' : '다시 도장을 찍었어요.'}${note ? ` ${note}` : ''}`;
  return notifyMentionsForComment({
    comment: { text, images: [], mentions: [] },
    sheetName: '',
    sceneNo: '',
    me: input.me,
    users: input.users,
    extraTargetIds: [input.job.userId],
    place: { EP: 'BAE경', part: '', scene: baeCommentPlaceLabel(input.job.name), deepLink: buildBaeJobDeepLink(input.job.id) },
  });
}
