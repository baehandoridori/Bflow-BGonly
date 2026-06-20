/**
 * #씬·파트·화 태그의 마크다운 링크식 직렬화/역직렬화(4c).
 *  - 저장: `[#<라벨>](b<kind>:<payload>)` — 표시는 라벨만 칩, 점프는 payload(EP·파트·씬)로 정확.
 *  - scene: bscene:<ep>:<partId>:<sceneId> / part: bpart:<ep>:<partId> / episode: bepisode:<ep>
 * 화 간 sceneId 중복을 (episodeNumber, partId, sceneId) 조합으로 해소한다.
 * 순수 함수 — node:test 검증.
 */

export type HashTarget =
  | { kind: 'scene'; episodeNumber: number; partId: string; sceneId: string }
  | { kind: 'part'; episodeNumber: number; partId: string }
  | { kind: 'episode'; episodeNumber: number };

export interface HashTag {
  kind: HashTarget['kind'];
  /** 칩에 보이는 짧은 라벨(sceneId / 파트라벨 / 화 제목). */
  label: string;
  episodeNumber: number;
  partId?: string;
  sceneId?: string;
}

export function serializeHashTag(t: HashTag): string {
  const payload =
    t.kind === 'scene'
      ? `bscene:${t.episodeNumber}:${t.partId}:${t.sceneId}`
      : t.kind === 'part'
        ? `bpart:${t.episodeNumber}:${t.partId}`
        : `bepisode:${t.episodeNumber}`;
  // 라벨은 free-form(커스텀 화 제목)이라 `[`,`]`,`(`,`)`가 들어가면 마크다운식 토큰이 깨진다
  // (HASH_LINK_REGEX `[^\]]+`가 첫 `]`에서 멈춰 파싱 실패 → 평문화). payload는 영숫자라 안전, 라벨만 제거.
  const safeLabel = t.label.replace(/[[\]()]/g, '');
  return `[#${safeLabel}](${payload})`;
}

export function parseHashTarget(target: string): HashTarget | null {
  const seg = target.split(':');
  const ep = parseInt(seg[1], 10);
  if (!Number.isInteger(ep) || ep <= 0) return null;
  if (seg[0] === 'bscene' && seg.length === 4 && seg[2] && seg[3])
    return { kind: 'scene', episodeNumber: ep, partId: seg[2], sceneId: seg[3] };
  if (seg[0] === 'bpart' && seg.length === 3 && seg[2])
    return { kind: 'part', episodeNumber: ep, partId: seg[2] };
  if (seg[0] === 'bepisode' && seg.length === 2)
    return { kind: 'episode', episodeNumber: ep };
  return null;
}
