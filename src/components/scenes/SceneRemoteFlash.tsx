// src/components/scenes/SceneRemoteFlash.tsx
// 움직임 폴리싱 9번 — 팀원이 바꾼 씬: 테두리 링이 한 번 빛나고 '김지은 · 검수 ✓' 이름표가 잠깐 뜬다.
// 카드(SceneCard·UnifiedSceneCard)는 카드 루트(relative) 안, 시트는 씬번호 칸(relative) 안에 둔다.
// 이 작은 컴포넌트만 스토어를 구독한다 — 카드·행 본체는 다시 그리지 않는다.
// 다시 틀 때는 React key(seq)로 새로 붙인다(클래스로 animation 을 껐다 켜지 않는다).
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { pickSceneFlash, useSceneFlashStore } from '@/stores/sceneFlashStore';

/** 이름표가 칸 위로 튀어나오는 높이(px) — CSS .scene-remote-tag--row 의 top: -11px 와 같다. */
const ROW_TAG_OVERHANG_PX = 11;

/**
 * 시트 이름표 — 평소엔 씬번호 칸 위쪽에 걸친다. 고정 머리줄과 맞닿은 줄(맨 위 줄, 스크롤 중 머리줄 바로 아래 줄)이면
 * 머리줄 밑에 가려 읽을 수 없으므로 붙는 순간 한 번 재서 칸 아래쪽으로 뒤집는다(is-below, 그리기 전에 정한다).
 */
function RemoteRowTag({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const cell = ref.current?.closest('td');
    const head = cell?.closest('table')?.tHead;
    if (!cell || !head) return;
    if (cell.getBoundingClientRect().top - ROW_TAG_OVERHANG_PX < head.getBoundingClientRect().bottom) setBelow(true);
  }, []);
  return (
    <span ref={ref} className={cn('scene-remote-tag scene-remote-tag--row', below && 'is-below')} aria-hidden title={text}>
      {text}
    </span>
  );
}

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
        {showTag && <RemoteRowTag key={`tag-${flash.seq}`} text={tagText} />}
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
