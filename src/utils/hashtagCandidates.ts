/**
 * #태그 자동완성 후보 빌더(4c). 활성 에피소드의 씬/파트/화를 query 로 필터.
 * 씬 sceneId 는 화 간 중복이 흔하므로 context('EP01 A')로 구분 표시.
 * 화 라벨은 커스텀 제목(episodeTitles) 우선, 없으면 Episode.title.
 * 아카이브 제외는 호출 측이 활성 episodes 만 넘기는 것으로 보장(useDataStore.episodes).
 * 순수 함수 — node:test 검증. (구조적 타입 — @/ alias 없이 node:test 가능)
 *
 * BG/ACT 통합 + 부서 UI 비노출 정책상 같은 sceneId 는 통합 후보 1개로 병합, 통합 모달로 점프.
 * 새 에피소드는 같은 partId 에 BG·ACT 파트가 함께 생겨 같은 sceneId(예 a001) row 가 2개 존재하나,
 * (episodeNumber, partId, sceneId) 키로 dedupe 해 후보엔 1개만 싣는다. 동일 부서 내 진짜 sceneId
 * 중복은 데이터상 부재(sceneId 는 부서 내 유니크). scene 후보는 sceneUuid 를 싣지 않는다 —
 * navigateToHashTarget 이 uuid 없이 resolveSceneById 로 찾은 scene.id 로 all-mode 통합 모달을 연다.
 */
import { type HashTag } from './hashEntity.ts';

// id(Supabase scene UUID)는 실데이터엔 있으나 통합 점프 정책상 tag 에 싣지 않는다(병합 후보 1개).
interface SceneLike { sceneId: string; id?: string }
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
  // 같은 (ep, partId, sceneId) 가 BG·ACT 2개로 와도 scene 후보는 1개만 — dedupe 키.
  const seenScene = new Set<string>();
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
        const key = `${ep.episodeNumber}:${part.partId}:${sc.sceneId}`;
        if (!seenScene.has(key) && (!q || sc.sceneId.toLowerCase().includes(q))) {
          seenScene.add(key);
          out.push({
            kind: 'scene',
            label: sc.sceneId,
            context: `${ep2(ep.episodeNumber)} ${part.partId}`,
            // sceneUuid 미탑재 — BG/ACT 통합 점프(navigateToHashTarget 이 resolveSceneById 로 all-mode 모달 오픈).
            tag: { kind: 'scene', label: sc.sceneId, episodeNumber: ep.episodeNumber, partId: part.partId, sceneId: sc.sceneId },
          });
        }
      }
    }
    if (out.length >= limit * 6) break; // 과다 순회 방지
  }
  return out.slice(0, limit);
}
