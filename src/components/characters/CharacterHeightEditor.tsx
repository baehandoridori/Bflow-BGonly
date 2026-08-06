import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { effectiveHeightPx } from '@/utils/characterHeight';
import type { Character, CharacterCostume } from '@/types';
import {
  DEFAULT_HEIGHT_GUIDES,
  type HeightGuides,
  clampGuides,
  guidesToHeightPx,
} from '@/utils/characterHeightGuides';

/**
 * 기준 키 드래그 조정 에디터 (피드백 33b).
 * - 복장 대표 이미지 위에 머리/바닥 기준선 2개를 드래그해 캐릭터 키(px)를 맞춘다
 *   (모자를 쓴 캐릭터는 머리선을 내리고, 까치발처럼 그려진 캐릭터는 바닥선을 올린다).
 * - 환산 기준은 이미지의 '원본' 세로 px(natural_height). 원본 크기 미기록(과거 업로드)이면
 *   저장본(최대 800px) 세로로 계산하고 경고를 띄운다 — 새로 업로드하면 정확해진다.
 * - 저장은 기존 setCharacterReferenceHeight(캐릭터 단위, 낙관+롤백) 재사용 — 신규 IPC/스키마 없음.
 * - CharacterImageFitEditor 와 같은 최상단 에디터 레이어/ESC 패턴. fit(썸네일 변환)은 적용하지 않고
 *   원본 비율 그대로 표시한다 — 기준선↔px 환산이 단순해지도록.
 */
export function CharacterHeightEditor({
  character,
  costume,
  onClose,
}: {
  character: Character;
  costume: CharacterCostume;
  onClose: () => void;
}) {
  const imagesByCostume = useCharacterBoardStore((s) => s.imagesByCostume);
  const setCharacterReferenceHeight = useCharacterBoardStore((s) => s.setCharacterReferenceHeight);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  // 피드백 47: 저장 대상 — 기본은 기존 동작(대표 키). '이 복장에만'을 고르면 복장 오버라이드에 저장.
  const [saveTarget, setSaveTarget] = useState<'character' | 'costume'>('character');

  // 편집 대상 = 이 복장의 대표 이미지(없으면 첫 이미지). 진입 버튼이 이미지 존재를 보장하지만 방어적으로 처리.
  const image = useMemo(() => {
    const list = imagesByCostume.get(costume.id) ?? [];
    return list.find((i) => i.isPrimary) ?? list[0] ?? null;
  }, [imagesByCostume, costume.id]);

  const [guides, setGuides] = useState<HeightGuides>(DEFAULT_HEIGHT_GUIDES);
  const [loadedHeight, setLoadedHeight] = useState<number | null>(null); // 저장본 naturalHeight — 원본 미기록 시 폴백
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ which: 'top' | 'bottom'; pointerId: number } | null>(null);

  // 환산 기준: 원본 세로 px(natural_height) 우선, 없으면 로드된 저장본(≤800px) 세로 — 경고 표시.
  const baseHeightPx = image?.naturalHeight ?? loadedHeight;
  const isFallbackBase = image != null && image.naturalHeight == null;
  const previewPx = baseHeightPx != null && baseHeightPx > 0 ? guidesToHeightPx(guides, baseHeightPx) : null;

  useEffect(() => {
    // 최상단 모달 패턴 — 부모 CharacterDetailModal 의 Escape 리스너까지 닫히는 것을 막는다(RiggingAnnounceModal 선례).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const beginDrag = (which: 'top' | 'bottom') => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { which, pointerId: event.pointerId };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const ratio = (event.clientY - rect.top) / rect.height;
    setGuides((prev) => clampGuides(
      drag.which === 'top' ? { ...prev, topRatio: ratio } : { ...prev, bottomRatio: ratio },
      drag.which,
    ));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  const onSave = async () => {
    if (previewPx == null || saving) return;
    setSaving(true);
    const ok = saveTarget === 'costume'
      ? await updateCostumeField(costume.id, { heightPx: previewPx })
      : await setCharacterReferenceHeight(character.id, previewPx);
    setSaving(false);
    if (ok) {
      toast.success(saveTarget === 'costume' ? `이 복장 키를 ${previewPx}px로 저장했어요` : `기준 키를 ${previewPx}px로 저장했어요`);
      onClose();
    }
    // 실패 시 토스트와 롤백은 store 가 담당 — 에디터는 열린 채 재시도 가능.
  };

  /** 기준선 1개 — 라벨 + 드래그 손잡이(터치 영역은 선보다 두껍게). */
  const guideLine = (which: 'top' | 'bottom', ratio: number, label: string) => (
    <div
      role="slider"
      aria-label={`${label} 기준선`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="absolute left-0 right-0 h-5 -mt-2.5 cursor-ns-resize touch-none group"
      style={{ top: `${ratio * 100}%` }}
      onPointerDown={beginDrag(which)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="absolute left-0 right-0 top-1/2 -mt-px h-0.5 bg-accent shadow-[0_0_6px_rgba(108,92,231,0.8)]" />
      <span className="absolute left-1.5 top-1/2 -translate-y-[130%] rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white select-none">
        {label}
      </span>
    </div>
  );

  return (
    <div
      data-character-height-editor
      className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.editor} flex items-center justify-center bg-black/70 backdrop-blur-sm p-6`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="bg-bg-card border border-bg-border rounded-2xl p-5 flex flex-col gap-4 max-w-[min(88vw,720px)] max-h-[90vh]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-text-primary">기준 키 조정 — {character.name}</h2>
            <span className="text-xs text-text-secondary">
              머리·바닥 기준선을 드래그해 실제 키 범위를 맞춰요 (모자·까치발 보정).
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="닫기 (Esc)"
            className="shrink-0 p-1.5 rounded-md text-text-secondary hover:bg-bg-border/40"
          >
            <X size={16} />
          </button>
        </div>

        {!image ? (
          <div className="text-sm text-text-secondary py-10 text-center">이 복장에 이미지가 없어요 — 이미지를 먼저 추가해주세요.</div>
        ) : loadFailed ? (
          <div className="text-sm text-text-secondary py-10 text-center">이미지를 불러오지 못했어요 — 잠시 후 다시 열어주세요.</div>
        ) : (
          <div className="relative self-center overflow-hidden rounded-lg border border-bg-border bg-[conic-gradient(#26293a_0_25%,#1d2030_0_50%,#26293a_0_75%,#1d2030_0)] bg-[length:16px_16px]">
            <img
              ref={imgRef}
              src={image.url}
              alt={`${character.name} 기준 키 조정`}
              draggable={false}
              onLoad={(event) => {
                const el = event.currentTarget;
                setLoadFailed(false);
                setLoadedHeight(Math.max(1, el.naturalHeight));
              }}
              onError={() => setLoadFailed(true)}
              className="block max-h-[52vh] max-w-[80vw] select-none"
            />
            {guideLine('top', guides.topRatio, '머리')}
            {guideLine('bottom', guides.bottomRatio, '바닥')}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm text-text-primary font-semibold">
              {previewPx != null ? `키 ${previewPx}px` : '계산 중…'}
              {effectiveHeightPx(character, costume) != null && (
                <span className="ml-2 text-xs font-normal text-text-secondary">
                  (현재 저장값 {effectiveHeightPx(character, costume)}px{costume.heightPx != null ? ' · 이 복장' : ' · 대표'})
                </span>
              )}
            </span>
            {isFallbackBase && (
              <span className="text-[11px] text-yellow-400/90">
                이 이미지는 원본 크기 정보가 없는 예전 업로드라 축소본 기준으로 계산돼요 — 이미지를 새로 올리면 정확해져요.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* 저장 대상 (피드백 47) — 기본은 대표 키(기존 동작 유지) */}
            <div className="flex items-center gap-3 text-xs text-text-secondary">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="height-save-target" checked={saveTarget === 'character'} onChange={() => setSaveTarget('character')} />
                대표 키에 저장
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="height-save-target" checked={saveTarget === 'costume'} onChange={() => setSaveTarget('costume')} />
                이 복장에만 저장
              </label>
            </div>
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40">취소</button>
            <button
              type="button"
              onClick={onSave}
              disabled={previewPx == null || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              이 키로 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
