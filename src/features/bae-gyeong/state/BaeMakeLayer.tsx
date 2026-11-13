// 만들기 창들 (재료 창 · 만드는 창 · 그림체 기준 창). 창은 한 번에 하나 (14d 1장). 상태는 useBaeMake, 글자는 baeViewModel.
import { useEffect, useState } from 'react';
import { useBaeMake } from './useBaeMake';
import { baeBoard, BAE_STRIP_SRC } from './useBaeMake';
import { makeProps, materialProps, styleEntries } from './baeViewModel';
import { useBaeStore } from '../useBaeStore';
import { MaterialWindow } from '../windows/MaterialWindow';
import { MakeWindow } from '../windows/MakeWindow';
import { StyleWindow } from '../windows/StyleWindow';
import { BoardView } from '../make/board';

/** startedAt 부터 흐른 초 (켜 둔 동안만 1초마다). */
export function useSeconds(startedAt: number | null, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on || startedAt == null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on, startedAt]);
  return startedAt == null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

export function BaeMakeLayer() {
  const s = useBaeMake();   // 창 · 재료 · 작업이 바뀌면 다시 그린다
  const settings = useBaeStore();
  const rate = Number((settings.row('prices')?.value as { krwPerUsd?: unknown } | undefined)?.krwPerUsd) || 1400;
  const imageLabel = String((settings.row('models')?.value as { imageLabel?: unknown } | undefined)?.imageLabel ?? '2.5 Sunburst (정교함)');
  const revising = s.job?.phase === 'revising';
  const sec = useSeconds(s.job?.startedAt ?? null, revising);

  if (s.win === 'material') {
    return <MaterialWindow {...materialProps({ onAddRefs: (files) => { void s.addRefs(files); }, isAdmin: settings.access.isAdmin })} board={<BoardView board={baeBoard()} />} />;
  }
  if (s.win === 'make' && s.job?.order) {
    return <MakeWindow {...makeProps({ revisingSeconds: sec, imageLabel, rate })} />;
  }
  if (s.win === 'style') {
    return (
      <StyleWindow
        stripSrc={BAE_STRIP_SRC}
        mode={s.styleMode}
        onMode={s.setStyleMode}
        entries={styleEntries()}
        onPick={s.togglePick}
        backTo={s.styleBack === 'material' ? (s.kind === 'same' ? '같은 장소 다른 컷' : '새 배경 만들기') : null}
        onBack={s.backFromStyle}
        onClose={s.closeWin}
      />
    );
  }
  return null;
}
