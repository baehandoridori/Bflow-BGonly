/**
 * 슬랙 웹훅 알림 서비스
 * 댓글 @멘션 시 멘션된 팀원에게 슬랙 워크플로 알림 전송
 */

export function formatKoreanTime(date: Date): string {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600000);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${kst.getMonth() + 1}월 ${kst.getDate()}일 ${days[kst.getDay()]}요일 ${kst.getHours()}시 ${kst.getMinutes()}분`;
}

interface MentionWebhookParams {
  commentText: string;
  episodeLabel: string;
  sceneId: string;
  partLabel: string;
  authorSlackId: string;
  targetSlackId: string;
}

export async function sendMentionWebhook(params: MentionWebhookParams): Promise<void> {
  const { commentText, episodeLabel, sceneId, partLabel, authorSlackId, targetSlackId } = params;
  try {
    console.log('[SlackWebhook] 전송 시도:', { episodeLabel, sceneId, authorSlackId, targetSlackId });
    const result = await window.electronAPI.sendSlackWebhook({
      comment: commentText,
      EP: episodeLabel,
      time: formatKoreanTime(new Date()),
      scene: sceneId,
      name_my: authorSlackId,
      name_target: targetSlackId,
      part: partLabel,
    });
    console.log('[SlackWebhook] 전송 성공:', result);
  } catch (err) {
    console.error('[SlackWebhook] 전송 실패:', err);
  }
}
