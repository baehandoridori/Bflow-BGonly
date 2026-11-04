/**
 * 슬랙 웹훅 알림 서비스
 * 댓글 @멘션 시 멘션된 팀원에게 슬랙 워크플로 알림 전송
 */

import {
  buildMentionWebhookPayloads,
  mergeMentionDeliveryRetry,
  type MentionDeliveryResult,
  type MentionWebhookUser,
} from '../utils/mentionWebhookPayloads.ts';

export type { MentionDeliveryResult } from '../utils/mentionWebhookPayloads.ts';
import { stripEntityTokens } from '../utils/entityTokens.ts';

interface RiggingAnnounceParams {
  /** 공지 제목(title). 템플릿 버튼으로 채우거나 직접 입력. 비우면 빈 문자열. */
  title: string;
  /** 공지에 표기할 이름(CH_name). 보통 캐릭터명. */
  characterName: string;
  /** 캐릭터 작업 폴더 경로(Path). 미연결이면 빈 문자열. */
  folderPath: string | null;
  /** 비고 여러 줄. 슬랙에선 줄바꿈으로 이어진다(bigo). */
  notes: string[];
  /** 공지에 붙일 이미지 공개 URL 들(image). 없으면 빈 문자열 — 슬랙이 각 링크를 언펄해 미리보기(피드백 50). */
  imageUrls: string[];
}

/**
 * 캐릭터 작업 폴더 경로 → 스튜디오 공용 jbbj://open/ 링크 (피드백 31c).
 * 오토핫키 Ctrl+Shift+V 가 만드는 링크와 같은 포맷 — 백슬래시는 /, 공백만 %20 으로 바꾸고
 * 한글·대괄호·드라이브 문자 등 나머지는 전부 원문 유지.
 * (#공지사항-작업 채널의 실사용 수동 공지 링크 <jbbj://open/G:/공유%20드라이브/...> 로 확인.
 *  팀원 PC 의 jbbj 핸들러가 이 포맷 기준이라, 한글까지 percent 인코딩하면 클릭해도 폴더를 못 찾는다.)
 * 예) G:\공유 드라이브\사우스 코리안 파크 → jbbj://open/G:/공유%20드라이브/사우스%20코리안%20파크
 */
export function buildJbbjOpenLink(path: string): string {
  return `jbbj://open/${path.replace(/\\/g, '/').replace(/ /g, '%20')}`;
}

/** 비고 배열 → 슬랙 bigo 문자열(빈 줄 제거 + 줄바꿈 결합). */
export function buildRiggingBigo(notes: string[]): string {
  return notes.map((n) => n.trim()).filter((n) => n.length > 0).join('\n');
}

/**
 * 내용(CH_name) 줄 + 비고를 한 변수로 병합 (피드백 43).
 * 비고가 없으면 내용 줄만 반환 — 슬랙 템플릿의 `• {bigo}` 줄을 없애는 대신 앱이 비고 불릿을 소유해,
 * 비고 생략 시 빈 불릿이 남지 않는다. 불릿 문자(`• `)는 비고 줄에만 붙인다(내용 줄 불릿은 템플릿 소유).
 */
export function buildRiggingContent(characterLine: string, notes: string[]): string {
  const bigo = buildRiggingBigo(notes);
  if (!bigo) return characterLine;
  return `${characterLine}\n${bigo.split('\n').map((n) => `• ${n}`).join('\n')}`;
}

/** 이미지 URL 배열 → image 변수 값(줄바꿈 join, 피드백 50). 슬랙이 각 줄의 링크를 언펄해 미리보기 여러 개가 뜬다. */
export function buildRiggingImageValue(urls: string[]): string {
  return urls.filter((u) => u.trim().length > 0).join('\n');
}

/** 리깅 완성 작업공지 전송. 워크플로 변수 title/CH_name/Path/bigo/image 를 채운다. 실패 시 throw. */
export async function sendRiggingAnnounce(params: RiggingAnnounceParams): Promise<{ ok: boolean }> {
  const payload: Record<string, string> = {
    title: params.title,
    // 피드백 43: 비고는 CH_name 에 병합해 보낸다 — 템플릿의 bigo 줄 삭제 후에도 비고가 보이고,
    //   비고가 없으면 빈 불릿 없이 내용 줄만 나간다.
    CH_name: buildRiggingContent(params.characterName, params.notes),
    // 피드백 31(c): Path 는 원본 경로 대신 클릭하면 탐색기가 열리는 jbbj://open/ 링크로 보낸다
    //   (슬랙 워크플로 메시지의 하이퍼링크 서식이 이 변수를 URL 로 쓴다 — 한솔 확인).
    Path: params.folderPath ? buildJbbjOpenLink(params.folderPath) : '',
    // 트리거에 정의된 변수는 계속 전송(누락 시 요청 거부 가능) — 템플릿이 참조만 안 하면 된다.
    bigo: buildRiggingBigo(params.notes),
    image: buildRiggingImageValue(params.imageUrls),
  };
  return window.electronAPI.sendRiggingWebhook(payload);
}

export interface NotifyMentionsInput {
  comment: { text: string; images?: readonly string[] | null; mentions: readonly string[] };
  /** 댓글이 저장된 시트(예 'EP05_A_BG')와 scene.no — 바로가기 주소. */
  sheetName: string;
  sceneNo: string;
  /** 사람이 읽는 씬 번호('a001'). */
  sceneLabel?: string | null;
  me: MentionWebhookUser;
  users: readonly MentionWebhookUser[];
  /** 멘션 말고 더 보낼 사람(리테이크 댓글의 요청자). 답글 상대는 넣지 않는다(한솔 결정 2026-11-04). */
  extraTargetIds?: readonly string[];
  /** '다시 보내기' — 이 사람들에게만 보낸다(처음에 실패한 사람). */
  onlyTargetIds?: readonly string[];
}

/**
 * 댓글 슬랙 알림 — 본문 입력칸·스레드 창·리테이크 카드 입력칸이 모두 이것만 부른다(씬 댓글 B안 §6.2).
 * 받는 사람: 본문에 직접 부른 @이름 + extraTargetIds. 작성자 슬랙 ID 가 없어도 받는 사람에게는 보낸다.
 * 실패를 조용히 삼키지 않고 결과로 돌려준다.
 */
export async function notifyMentionsForComment(input: NotifyMentionsInput): Promise<MentionDeliveryResult> {
  const byName = new Map(input.users.map((user) => [user.name, user]));
  const byId = new Map(input.users.map((user) => [user.id, user]));
  const targets: MentionWebhookUser[] = [];
  for (const name of input.comment.mentions) {
    const user = byName.get(name);
    if (user) targets.push(user);
  }
  for (const id of input.extraTargetIds ?? []) {
    const user = byId.get(id);
    if (user) targets.push(user);
  }
  const only = input.onlyTargetIds ? new Set(input.onlyTargetIds) : null;
  const plan = buildMentionWebhookPayloads({
    comment: input.comment,
    sheetName: input.sheetName,
    sceneNo: input.sceneNo,
    sceneLabel: input.sceneLabel,
    me: input.me,
    targets: only ? targets.filter((user) => only.has(user.id)) : targets,
    plainText: stripEntityTokens,
  });
  const result: MentionDeliveryResult = {
    targets: plan.payloads.length + plan.missing.length,
    sent: 0,
    failed: 0,
    failedIds: [],
    missing: plan.missing,
  };
  const send = window.electronAPI?.sendSlackWebhook;
  // 받는 사람 모두에게 한꺼번에 보낸다(코덱스 5차) — 메인은 요청마다 그 순간의 로그인 세션을 붙잡으므로,
  //   한 명씩 기다리며 보내면 그 사이 로그아웃·계정 전환이 있을 때 나머지가 새 사람의 세션으로 나갔다.
  //   모두 지금 보내면 모두 이 댓글을 쓴 사람의 세션으로 나간다(예전처럼).
  const outcomes = await Promise.allSettled(plan.payloads.map(({ payload }) => (
    send ? send(payload) : Promise.reject(new Error('슬랙 전송을 쓸 수 없어요'))
  )));
  outcomes.forEach((outcome, index) => {
    const { target } = plan.payloads[index];
    if (outcome.status === 'fulfilled') {
      result.sent += 1;
      return;
    }
    result.failed += 1;
    result.failedIds.push(target.id);
    console.error('[SlackWebhook] 댓글 알림 전송 실패', { target: target.name, err: outcome.reason });
  });
  return result;
}

/** 말풍선 아래 슬랙 상태 한 칸 — 결과·보내는 중·다시 보내기. */
export interface MentionDeliveryEntry {
  result: MentionDeliveryResult;
  sending: boolean;
  retry: () => void;
}

/**
 * 슬랙 보내기 + '다시 보내기'를 한 벌로(본문 입력칸·스레드 창·리테이크 카드가 같이 쓴다).
 * 다시 보내기는 처음에 실패한 사람에게만 보내고(받은 사람에게 두 번 가지 않게), 보내는 중에는 다시 눌러도 무시한다.
 * 보낼 사람이 없으면 onUpdate 를 부르지 않는다.
 */
export function startMentionDelivery(
  input: NotifyMentionsInput,
  onUpdate: (entry: MentionDeliveryEntry) => void,
): void {
  let current: MentionDeliveryResult | null = null;
  let sending = false;
  const retry = () => {
    if (sending || !current || current.failedIds.length === 0) return;
    run(current.failedIds);
  };
  const run = (onlyTargetIds?: readonly string[]) => {
    sending = true;
    if (current) onUpdate({ result: current, sending: true, retry });
    void notifyMentionsForComment({ ...input, onlyTargetIds }).then((result) => {
      current = current ? mergeMentionDeliveryRetry(current, result) : result;
    }).catch((err) => {
      console.error('[SlackWebhook] 댓글 알림 전송 실패', err);
    }).finally(() => {
      sending = false;
      if (current && current.targets > 0) onUpdate({ result: current, sending: false, retry });
    });
  };
  run();
}

/** 말풍선 아래 한 줄 — 보낼 사람이 없으면 null. */
export function describeMentionDelivery(result: MentionDeliveryResult | null | undefined): { text: string; failed: boolean } | null {
  if (!result || result.targets === 0) return null;
  if (result.failed > 0) return { text: '슬랙 전송 실패', failed: true };
  if (result.sent === 0) return { text: result.missing.length === 1 ? '슬랙 ID 가 없어 슬랙으로는 못 보냈어요' : `${result.missing.length}명은 슬랙 ID 가 없어 못 보냈어요`, failed: false };
  return {
    text: result.missing.length > 0 ? `슬랙 전달됨 · ${result.missing.length}명은 슬랙 ID 없음` : '슬랙 전달됨',
    failed: false,
  };
}
