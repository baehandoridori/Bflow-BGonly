import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Upload, Copy } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import type { Character, CharacterCostume, CharacterImageFit } from '@/types';
import { uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { cn } from '@/utils/cn';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { CharacterImageFitEditor } from '@/components/characters/CharacterImageFitEditor';
import { DEFAULT_CHARACTER_IMAGE_BACKGROUND } from '@/utils/characterAssets';
import { claimReactKey } from '@/utils/claimReactKey';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { copyCharacterImage } from '@/services/characterPathActions';

const costumeMemoDraftCache = new Map<string, string>();

/** 큰 대표 이미지 — 클릭=크게보기, 아래 별도 버튼으로 교체/추가. */
export function FeaturedImageSlot({
  character,
  costume,
  onView,
  onEnsureCostume,
}: {
  character: Character;
  costume: CharacterCostume | null;
  onView: (costumeId: string) => void;
  onEnsureCostume: () => Promise<CharacterCostume | null>;
}) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [fitEditorOpen, setFitEditorOpen] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    const targetCostume = costume ?? await onEnsureCostume();
    if (!targetCostume) return;
    if (targetCostume.featuredImageUrl) {
      const ok = await ConfirmDialog.show({
        message: '현재 이미지를 새 이미지로 바꿀까요?\n이전 이미지는 복구할 수 없어요.',
        confirmLabel: '바꾸기',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setUploading(true);
    try {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const base64 = await resizeBlob(file, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
      const res = await uploadCharacterImage(character.id, targetCostume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 이전 대표 이미지 정리는 서버(updateCharacterCostume)가 DB 업데이트 성공 후 처리 — 롤백 시 깨진 URL 방지.
      const saved = await updateCostumeField(targetCostume.id, { featuredImageUrl: res.url });
      // 업로드는 됐는데 DB 반영이 실패(롤백)하면 방금 올린 파일이 고아가 됨 → 정리.
      if (!saved) {
        deleteImage(res.url).catch((e) => console.warn('[character-board] 실패한 업로드 정리:', e));
      }
    } catch (err) {
      console.error('[character-board] 이미지 업로드 실패:', err);
      toast.error('이미지 업로드에 실패했어요');
    } finally {
      setUploading(false);
    }
  }, [character.id, costume, onEnsureCostume, updateCostumeField]);

  const uploadFileIfImage = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.info('이미지 파일만 올릴 수 있어요');
      return;
    }
    void handleUpload(file);
  }, [handleUpload]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // 패널 레벨 오버레이(갤러리 우클릭 메뉴·썸네일 맞추기)는 로컬 상태로 알 수 없어 DOM 마커로 감지.
      if (
        uploading || contextMenu || fitEditorOpen
        || document.querySelector('[data-character-lightbox], [data-character-fit-editor], [data-character-context-menu]')
      ) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      uploadFileIfImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [contextMenu, fitEditorOpen, uploadFileIfImage, uploading]);

  const shownUrl = costume?.featuredImageUrl ?? null;
  const shownBackground = costume?.imageBackground ?? DEFAULT_CHARACTER_IMAGE_BACKGROUND;
  const shownFit = costume?.imageFit;

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <div
        className={cn(
          'relative aspect-[3/4] w-full rounded-xl border border-bg-border transition-colors',
          shownUrl ? 'cursor-zoom-in hover:border-accent/50 transition-colors' : '',
          draggingImage && 'border-accent bg-accent/10',
        )}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return;
          event.preventDefault();
          setDraggingImage(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDraggingImage(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingImage(false);
          uploadFileIfImage(event.dataTransfer.files?.[0]);
        }}
      >
        <CharacterImageFrame
          url={shownUrl}
          alt={costume?.name ?? character.name}
          background={shownBackground}
          fit={shownFit}
          className="h-full w-full rounded-xl"
          onClick={shownUrl && costume ? () => onView(costume.id) : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        />
        {draggingImage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent/15 text-xs font-medium text-accent ring-1 ring-accent/60">
            이미지 놓기
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
        >
          <Upload size={13} />
          {uploading ? '업로드 중...' : shownUrl ? '이미지 바꾸기' : '이미지 추가'}
        </button>
        <button
          type="button"
          disabled={!shownUrl}
          onClick={() => copyCharacterImage(shownUrl)}
          className="flex items-center justify-center gap-1.5 rounded-md border border-bg-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 disabled:opacity-40 whitespace-nowrap"
        >
          <Copy size={13} /> 이미지 복사
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
      />
      {contextMenu && (
        <CharacterImageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          character={character}
          imageCostume={costume}
          fileCostume={costume}
          onClose={() => setContextMenu(null)}
          onBackground={(costumeId, background) => { void updateCostumeField(costumeId, { imageBackground: background }); }}
          onEditFit={() => setFitEditorOpen(true)}
        />
      )}
      {fitEditorOpen && shownUrl && costume && (
        <CharacterImageFitEditor
          url={shownUrl}
          alt={costume.name}
          background={shownBackground}
          fit={costume.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeField(costume.id, { imageFit: fit })}
          onClose={() => setFitEditorOpen(false)}
        />
      )}
    </div>
  );
}

/** 복장 메모 — 키 입력마다 저장 말고 blur 때 한 번만(동시 쓰기 경합·텍스트 유실 방지). */
function CostumeMemoInput({
  draftKey,
  value,
  onCommit,
}: {
  draftKey: string;
  value: string;
  /** false 를 resolve 하면 저장 실패 — 초안 캐시를 유지해 입력 텍스트를 보존한다 (GAP-B). */
  onCommit: (next: string) => void | boolean | Promise<boolean | void>;
}) {
  const [draft, setDraft] = useState(() => costumeMemoDraftCache.get(draftKey) ?? value);
  const focused = useRef(false);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => {
    if (focused.current) return;
    const cached = costumeMemoDraftCache.get(draftKey);
    setDraft(cached ?? value);
  }, [draftKey, value]);
  useEffect(() => () => {
    const latestDraft = draftRef.current;
    if (focused.current && latestDraft !== valueRef.current) {
      const result = onCommitRef.current(latestDraft);
      void Promise.resolve(result).then((ok) => {
        if (ok !== false && costumeMemoDraftCache.get(draftKey) === latestDraft) {
          costumeMemoDraftCache.delete(draftKey);
        }
      });
      return;
    }
    // 이전 커밋 실패로 남겨둔 초안은 유지 — 이미 저장된 값과 같은 캐시만 정리.
    const cached = costumeMemoDraftCache.get(draftKey);
    if (cached === undefined || cached === valueRef.current) costumeMemoDraftCache.delete(draftKey);
  }, [draftKey]);

  const commit = useCallback(() => {
    focused.current = false;
    const next = draftRef.current;
    if (next === valueRef.current) {
      costumeMemoDraftCache.delete(draftKey);
      return;
    }
    const result = onCommitRef.current(next);
    void Promise.resolve(result).then((ok) => {
      // 실패(false)나 더 최신 초안이 있으면 캐시를 유지 — 다시 포커스 아웃하면 재시도된다.
      if (ok !== false && costumeMemoDraftCache.get(draftKey) === next) {
        costumeMemoDraftCache.delete(draftKey);
      }
    });
  }, [draftKey]);

  const updateDraft = (next: string) => {
    setDraft(next);
    draftRef.current = next;
    if (focused.current) costumeMemoDraftCache.set(draftKey, next);
  };

  return (
    <textarea
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={commit}
      placeholder="이 복장 메모…"
      aria-label="복장 메모"
      rows={3}
      className="w-full bg-bg-border/20 border border-bg-border rounded-lg px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
    />
  );
}

/** 이미지 아래 — 이 복장이 무슨 디자인인지(이름, 편집 가능) + 디자인별 메모. */
export function CostumeIdentity({ costume }: { costume: CharacterCostume }) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(costume.name);

  useEffect(() => { setEditing(false); setDraft(costume.name); }, [costume.id, costume.name]);

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); const t = draft.trim(); if (t && t !== costume.name) updateCostumeField(costume.id, { name: t }); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                claimReactKey(e);
                setDraft(costume.name);
                setEditing(false);
              }
            }}
            aria-label="복장 이름"
            className="flex-1 min-w-0 bg-transparent border border-accent/50 rounded-md px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none"
          />
        ) : (
          <>
            <span className="text-sm font-medium text-text-primary truncate">{costume.name}</span>
            <span className="text-[11px] text-text-secondary shrink-0">v{costume.versionNo}</span>
            <button
              type="button"
              aria-label="복장 이름 편집"
              onClick={() => { setDraft(costume.name); setEditing(true); }}
              className="-m-1.5 rounded-md p-1.5 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary cursor-pointer shrink-0"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>
      <CostumeMemoInput
        key={costume.id}
        draftKey={costume.id}
        value={costume.memo ?? ''}
        onCommit={(next) => updateCostumeField(costume.id, { memo: next.trim() ? next : null })}
      />
    </div>
  );
}
