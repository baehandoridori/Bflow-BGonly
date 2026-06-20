/**
 * #태그 자동완성 후보 빌더(4c). 활성 에피소드의 씬/파트/화를 query 로 필터.
 * 씬 sceneId 는 화 간 중복이 흔하므로 context('EP01 A')로 구분 표시.
 * 화 라벨은 커스텀 제목(episodeTitles) 우선, 없으면 Episode.title.
 * 아카이브 제외는 호출 측이 활성 episodes 만 넘기는 것으로 보장(useDataStore.episodes).
 * 순수 함수 — node:test 검증. (구조적 타입 — @/ alias 없이 node:test 가능)
 */
import { type HashTag } from './hashEntity.ts';

interface SceneLike { sceneId: string }
interface PartLike { partId: string; scenes: readonly SceneLike[] }
interface EpisodeLike { episodeNumber: number; title: string; parts: readonly PartLike[] }

export interface HashCandidate {
  kind: 'scene' | 'part' | 'episode';
  label: string; // 칩에 보일 짧은 라벨
  context: string; // 드롭다운 부제(중복 구분: 'EP01 A')
  tag: HashTag; // applyHashtag 삽입용
}

const ep2 = (n: number) => `EP${String(n).padStart(2, '0')}`;

export function buildHashtagCandidates(
  episodes: readonly EpisodeLike[],
  episodeTitles: Record<number, string>,
  query: string,
  limit = 12,
): HashCandidate[] {
  const q = query.trim().toLowerCase();
  const out: HashCandidate[] = [];
  for (const ep of episodes) {
    const title = episodeTitles[ep.episodeNumber] || ep.title;
    // 화
    if (!q || title.toLowerCase().includes(q) || ep2(ep.episodeNumber).toLowerCase().includes(q) || String(ep.episodeNumber).includes(q)) {
      out.push({ kind: 'episode', label: title, context: ep2(ep.episodeNumber), tag: { kind: 'episode', label: title, episodeNumber: ep.episodeNumber } });
    }
    for (const part of ep.parts) {
      const partLabel = `${part.partId}파트`;
      if (!q || partLabel.toLowerCase().includes(q)) {
        out.push({ kind: 'part', label: partLabel, context: title, tag: { kind: 'part', label: partLabel, episodeNumber: ep.episodeNumber, partId: part.partId } });
      }
      for (const sc of part.scenes) {
        if (!q || sc.sceneId.toLowerCase().includes(q)) {
          out.push({
            kind: 'scene',
            label: sc.sceneId,
            context: `${ep2(ep.episodeNumber)} ${part.partId}`,
            tag: { kind: 'scene', label: sc.sceneId, episodeNumber: ep.episodeNumber, partId: part.partId, sceneId: sc.sceneId },
          });
        }
      }
    }
    if (out.length >= limit * 6) break; // 과다 순회 방지
  }
  return out.slice(0, limit);
}
