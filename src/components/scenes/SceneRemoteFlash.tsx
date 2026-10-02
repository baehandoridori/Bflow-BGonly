// src/components/scenes/SceneRemoteFlash.tsx
// 움직임 폴리싱 9번 — 팀원이 바꾼 씬: 테두리 링이 한 번 빛나고 '김지은 · 검수 ✓' 이름표가 잠깐 뜬다.
// 카드(SceneCard·UnifiedSceneCard)는 카드 루트(relative) 안, 시트는 씬번호 칸(relative) 안에 둔다.
// 이 작은 컴포넌트만 스토어를 구독한다 — 카드·행 본체는 다시 그리지 않는다.
// 다시 틀 때는 React key(seq)로 새로 붙인다(클래스로 animation 을 껐다 켜지 않는다).
import { cn } from '@/utils/cn';
import { pickSceneFlash, useSceneFlashStore } from '@/stores/sceneFlashStore';

export function SceneRemoteFlash({
  sceneUuids,
  variant,
}: {
  /** 이 카드·행이 보여 주는 씬 uuid(통합 보기면 BG·ACT 둘). */
  sceneUuids: ReadonlyArray<string | null | undefined>;
  variant: 'card' | 'row';
}) {
  const flash = useSceneFlashStore((s) => pickSceneFlash(s.flashes, sceneUuids));
  if (!flash) return null;
  const showTag = flash.tag && !!flash.byName;
  const tagText = `${flash.byName} · ${flash.label}`;

  if (variant === 'row') {
    return (
      <>
        <span
          key={`ring-${flash.seq}`}
          aria-hidden
          className={cn('scene-remote-row-flash', flash.bulk && 'is-bulk')}
        />
        {showTag && (
          <span key={`tag-${flash.seq}`} className="scene-remote-tag scene-remote-tag--row" aria-hidden title={tagText}>
            {tagText}
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <span
        key={`ring-${flash.seq}`}
        aria-hidden
        className={cn('scene-remote-ring', flash.bulk && 'is-bulk')}
      />
      {showTag && (
        <span className="scene-remote-tag-anchor" aria-hidden>
          <span key={`tag-${flash.seq}`} className="scene-remote-tag" title={tagText}>
            {tagText}
          </span>
        </span>
      )}
    </>
  );
}
