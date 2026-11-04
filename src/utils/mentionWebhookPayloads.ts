/**
 * 댓글 슬랙 알림 조립 — 순수 함수 하나 (씬 댓글 B안 인수인계 §6.2, 2026-11-04).
 *
 * 본문 입력칸·스레드 창·리테이크 카드 안 입력칸이 모두 이것만 쓴다(예전엔 두 벌로 복제돼 있었다).
 * 워크플로 변수는 리테이크 알림(electron/retakeNotificationService.ts)과 같은 형식으로 맞춘다:
 *   comment · EP(EP05) · time(Intl ko-KR Asia/Seoul) · scene(a001) · name_my(슬랙 ID 또는 이름) · name_target · part(A) · deep_link
 * 받는 사람: kind='mention' → 본문에 직접 부른 사람 / kind='retake' → 리테이크 요청자(+ 직접 부른 사람).
 * 답글 상대는 슬랙을 보내지 않는다(한솔 결정 2026-11-04).
 * node --test 로 바로 검사하도록 런타임 의존이 없다.
 */

export interface MentionWebhookUser {
  id: string;
  name: string;
  slackId?: string | null;
}

export interface MentionWebhookInput {
  comment: { text: string; images?: readonly string[] | null };
  /** 'EP05_A_BG' 같은 저장 시트 이름. */
  sheetName: string;
  /** 바로가기용 scene.no 문자열. */
  sceneNo: string;
  /** 사람이 읽는 씬 번호('a001'). 모르면 sceneNo. */
  sceneLabel?: string | null;
  me: MentionWebhookUser;
  /** 받을 사람(호출자가 멘션 이름·리테이크 요청자를 사용자로 풀어 넘긴다). */
  targets: readonly MentionWebhookUser[];
  now?: number;
  plainText: (text: string) => string;
}

export interface MentionWebhookPlan {
  payloads: Array<{ target: MentionWebhookUser; payload: Record<string, string> }>;
  /** 슬랙 ID 가 없어 보내지 못하는 사람 이름. */
  missing: string[];
}

/** 댓글 슬랙 알림 결과 — 말풍선 아래 작은 상태('슬랙 전달됨 · 1명은 슬랙 ID 없음' / '슬랙 전송 실패')에 쓴다. */
export interface MentionDeliveryResult {
  /** 보내려 한 사람 수(슬랙 ID 없는 사람 포함, 나 제외). */
  targets: number;
  sent: number;
  failed: number;
  /** 보내지 못한 사람 id — '다시 보내기'는 이 사람들에게만 보낸다(받은 사람에게 두 번 가지 않게). */
  failedIds: string[];
  /** 슬랙 ID 가 없어 못 보낸 사람 이름. */
  missing: string[];
}

/** '다시 보내기' 결과를 처음 결과에 합친다 — 받는 사람 수·슬랙 ID 없는 사람은 처음 그대로, 실패는 이번 결과로. */
export function mergeMentionDeliveryRetry(previous: MentionDeliveryResult, retry: MentionDeliveryResult): MentionDeliveryResult {
  return {
    targets: previous.targets,
    sent: previous.sent + retry.sent,
    failed: retry.failed,
    failedIds: [...retry.failedIds],
    missing: [...previous.missing],
  };
}

export function buildDeepLinkForScene(sheetName: string, sceneNo: string): string {
  return `bflow://scene/${encodeURIComponent(sheetName)}/${encodeURIComponent(sceneNo)}`;
}

/** 'EP05_A_BG' → { EP: 'EP05', part: 'A' } (형식이 다르면 시트 이름 그대로). */
export function slackEpisodeAndPart(sheetName: string): { EP: string; part: string } {
  const match = sheetName.match(/^EP(\d+)_([A-Z0-9]+)_/i);
  if (!match) return { EP: sheetName, part: '' };
  return { EP: `EP${match[1].padStart(2, '0')}`, part: match[2].toUpperCase() };
}

export function formatSlackTime(now: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric',
  }).format(new Date(now));
}

export function slackCommentText(comment: MentionWebhookInput['comment'], plainText: (text: string) => string): string {
  const plain = plainText(comment.text ?? '').trim();
  const imageCount = comment.images?.length ?? 0;
  if (plain) return plain;
  return imageCount > 0 ? `(이미지 ${imageCount}장)` : '';
}

export function buildMentionWebhookPayloads(input: MentionWebhookInput): MentionWebhookPlan {
  const { EP, part } = slackEpisodeAndPart(input.sheetName);
  const base = {
    comment: slackCommentText(input.comment, input.plainText),
    EP,
    time: formatSlackTime(input.now ?? Date.now()),
    scene: (input.sceneLabel || input.sceneNo || '').trim(),
    // 작성자 슬랙 ID 가 없어도 받는 사람에게는 보낸다(이름으로 표시).
    name_my: input.me.slackId || input.me.name,
    part,
    deep_link: buildDeepLinkForScene(input.sheetName, input.sceneNo),
  };
  const payloads: MentionWebhookPlan['payloads'] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (!target?.id || target.id === input.me.id || seen.has(target.id)) continue;
    seen.add(target.id);
    if (!target.slackId) {
      missing.push(target.name);
      continue;
    }
    payloads.push({ target, payload: { ...base, name_target: target.slackId } });
  }
  return { payloads, missing };
}
