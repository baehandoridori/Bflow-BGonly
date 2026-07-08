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
  sheetName: string;
  authorSlackId: string;
  targetSlackId: string;
}

/** bflow:// 딥링크 URL 생성 */
export function buildDeepLink(sheetName: string, sceneId: string): string {
  return `bflow://scene/${encodeURIComponent(sheetName)}/${encodeURIComponent(sceneId)}`;
}

interface RiggingAnnounceParams {
  /** 공지 제목(title). 템플릿 버튼으로 채우거나 직접 입력. 비우면 빈 문자열. */
  title: string;
  /** 공지에 표기할 이름(CH_name). 보통 캐릭터명. */
  characterName: string;
  /** 캐릭터 작업 폴더 경로(Path). 미연결이면 빈 문자열. */
  folderPath: string | null;
  /** 비고 여러 줄. 슬랙에선 줄바꿈으로 이어진다(bigo). */
  notes: string[];
  /** 공지에 붙일 이미지 공개 URL(image). 없으면 빈 문자열 — 슬랙이 링크 언펄로 미리보기. */
  imageUrl: string | null;
}

/** 비고 배열 → 슬랙 bigo 문자열(빈 줄 제거 + 줄바꿈 결합). */
export function buildRiggingBigo(notes: string[]): string {
  return notes.map((n) => n.trim()).filter((n) => n.length > 0).join('\n');
}

/** 리깅 완성 작업공지 전송. 워크플로 변수 title/CH_name/Path/bigo/image 를 채운다. 실패 시 throw. */
export async function sendRiggingAnnounce(params: RiggingAnnounceParams): Promise<{ ok: boolean }> {
  const payload: Record<string, string> = {
    title: params.title,
    CH_name: params.characterName,
    Path: params.folderPath ?? '',
    bigo: buildRiggingBigo(params.notes),
    image: params.imageUrl ?? '',
  };
  return window.electronAPI.sendRiggingWebhook(payload);
}

export async function sendMentionWebhook(params: MentionWebhookParams): Promise<void> {
  const { commentText, episodeLabel, sceneId, partLabel, sheetName, authorSlackId, targetSlackId } = params;
  try {
    const deepLink = buildDeepLink(sheetName, sceneId);
    console.log('[SlackWebhook] 전송 시도:', { episodeLabel, sceneId, deepLink, authorSlackId, targetSlackId });
    const result = await window.electronAPI.sendSlackWebhook({
      comment: commentText,
      EP: episodeLabel,
      time: formatKoreanTime(new Date()),
      scene: sceneId,
      name_my: authorSlackId,
      name_target: targetSlackId,
      part: partLabel,
      deep_link: deepLink,
    });
    console.log('[SlackWebhook] 전송 성공:', result);
  } catch (err) {
    console.error('[SlackWebhook] 전송 실패:', err);
  }
}
