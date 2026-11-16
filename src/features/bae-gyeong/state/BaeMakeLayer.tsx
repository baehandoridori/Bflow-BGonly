// 만들기 창들 (재료 창 · 만드는 창 · 그림체 기준 창 · 부품 자르기 창 · 노이즈 제거 창 · 4K로 키우기 창 · 다른 각도로 창 · 레이어로 나누기 창).
// 창은 한 번에 하나 (14d 1장). 상태는 useBaeMake · useBaeTools · useBaeUpscale · useBaeAngle, 글자는 baeViewModel.
import { useEffect, useState } from 'react';
import { useBaeMake } from './useBaeMake';
import { baeBoard, baeReswatch, BAE_STRIP_SRC } from './useBaeMake';
import { useBaeTools } from './useBaeTools';
import { makeProps, materialProps, styleEntries, stylePlaceHint } from './baeViewModel';
import { useBaeStore } from '../useBaeStore';
import { MaterialWindow } from '../windows/MaterialWindow';
import { MakeWindow } from '../windows/MakeWindow';
import { StyleWindow } from '../windows/StyleWindow';
import { PartsWindow } from '../windows/PartsWindow';
import { DenoiseWindow } from '../windows/DenoiseWindow';
import { UpscaleWindow } from '../windows/UpscaleWindow';
import { useBaeUpscale } from './useBaeUpscale';
import { BoardView } from '../make/board';
import { toast } from 'sonner';
import { AngleWindow } from '../windows/AngleWindow';
import { LayersWindow } from '../windows/LayersWindow';
import { previewAngleDepth } from '../angle/previewAngle';
import { unavailableLayersGateway } from '../layers/layersApi';
import { baeModels } from '../modelAccess';
import { BAE_LAYERS_PREVIEW_TEXT, baeToolsPreview } from '../angleAccess';
import { useBaeAngle, baeAngleResolve, baeAngleResults } from './useBaeAngle';

/** 테스트 모드의 레이어 통로: 흉내가 없어서 일을 시키면 안내 글로 실패한다 (창은 뜬다). 창이 다시 그려져도 같은 것. */
let layersPreviewGw: ReturnType<typeof unavailableLayersGateway> | null = null;
const previewLayers = () => (layersPreviewGw ??= unavailableLayersGateway(BAE_LAYERS_PREVIEW_TEXT));

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
  const tools = useBaeTools();
  const upscale = useBaeUpscale();
  const ag = useBaeAngle();
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
  if (s.win === 'parts' && s.bases.length) {
    return (
      <PartsWindow
        bases={s.bases} at={s.partsAt} onTab={(i) => s.set('partsAt', i)}
        onParts={s.setParts} onSwatches={s.setSwatches} onSwatchReset={s.resetSwatches} onPartsSettled={baeReswatch} onDone={s.backFromParts}
      />
    );
  }
  if (s.win === 'denoise' && tools.dn) {
    const d = tools.dn;
    return (
      <DenoiseWindow
        label={d.label} w={d.w} h={d.h} sourceSrc={d.sourceUrl} cleanSrc={d.cleanUrl} on={d.on} busy={d.busy ? d.step || '지우는 중' : ''} sec={d.sec}
        onToggle={() => { void tools.toggleDenoise(); }} onReplace={(f) => { void tools.openDenoise({ blob: f, label: f.name }); }} onClose={tools.closeDenoise}
      />
    );
  }
  if (s.win === 'upscale' && upscale.up) {
    return (
      <UpscaleWindow
        up={upscale.up} onMode={upscale.setMode} onRun={() => { void upscale.run(); }} onAgain={upscale.again} onSave={() => { void upscale.save(); }}
        onReplace={(f) => { void upscale.open({ blob: f, label: f.name }); }} onClose={upscale.close}
      />
    );
  }
  if (s.win === 'angle' && ag.target) {
    const preview = baeToolsPreview();
    const models = settings.row('models')?.value as { pdModel?: unknown } | undefined;
    const pd = (settings.row('prices')?.value as { pd?: Record<string, unknown> } | undefined)?.pd;
    const price = pd && typeof models?.pdModel === 'string' ? pd[models.pdModel] : null;
    const busy = !!s.job && (s.job.phase === 'ordering' || s.job.phase === 'revising' || s.job.phase === 'drawing');
    return (
      <AngleWindow
        target={ag.target} results={baeAngleResults()} resolveResult={baeAngleResolve} tier={s.tier} krwPerUsd={rate}
        pdPrice={Array.isArray(price) && price.length === 2 ? [Number(price[0]), Number(price[1])] : null}
        {...(preview ? { depth: previewAngleDepth, depthReady: async () => true } : {})}
        busy={busy} error={ag.error || undefined} toast={(m) => toast(m)}
        onDraw={ag.drawAngle} onClose={ag.closeAngle}
      />
    );
  }
  if (s.win === 'layers' && ag.layers) {
    const preview = baeToolsPreview();
    const { seq, ...picture } = ag.layers;
    return (
      <LayersWindow
        key={seq} picture={picture} krwPerUsd={rate} onClose={ag.closeLayers}
        {...(preview ? { gateway: previewLayers(), modelGateway: baeModels() } : {})}
      />
    );
  }
  if (s.win === 'style') {
    return (
      <StyleWindow
        stripSrc={BAE_STRIP_SRC}
        mode={s.styleMode}
        onMode={s.setStyleMode}
        entries={styleEntries()}
        onPick={s.togglePick}
        backTo={s.styleBack === 'material' ? (s.kind === 'same' || s.bases.length ? '같은 장소 다른 컷' : '새 배경 만들기') : null}
        placeHint={stylePlaceHint()}
        onBack={s.backFromStyle}
        onClose={s.closeWin}
      />
    );
  }
  return null;
}
