import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { sendRiggingAnnounce, buildRiggingBigo } from '@/services/slackWebhookService';
import type { Character, CharacterCostume } from '@/types';

interface NoteRow {
  id: number;
  text: string;
}

/** 제목 템플릿 — 버튼을 누르면 제목(title)만 채운다(비고는 직접 작성). */
const TITLE_TEMPLATES: { key: string; label: string; title: string }[] = [
  { key: 'general', label: '일반 리깅 완료', title: '[모호 리깅 현황] 리깅 완료 공지' },
  { key: 'drama', label: '드라마 톤 특수리깅 완료', title: '[모호 리깅 현황] 드라마 톤 특수리깅 완료 공지' },
  { key: 'fix', label: '수정·보완 완료', title: '[모호 리깅 현황] 리깅 수정·보완 완료 공지' },
];

/**
 * 리깅 완성 슬랙 공지 모달 (B11).
 * - 캐릭터 작업 폴더 경로가 자동으로 뜨고(연결돼 있으면), 이미지는 그 복장의 이미지 중 골라 붙인다(기본 대표).
 * - 비고는 여러 줄을 쓸 수 있고, 슬랙에서는 줄바꿈으로 이어진다.
 * - 워크플로 변수 CH_name=캐릭터명 / Path=캐릭터 폴더 / bigo=비고(줄바꿈) / image=고른 이미지 공개 URL.
 */
export function RiggingAnnounceModal({
  character,
  costume,
  onClose,
}: {
  character: Character;
  costume: CharacterCostume;
  onClose: () => void;
}) {
  const imagesByCostume = useCharacterBoardStore((s) => s.imagesByCostume);
  const images = useMemo(() => imagesByCostume.get(costume.id) ?? [], [imagesByCostume, costume.id]);

  const [title, setTitle] = useState('');
  const [activeTpl, setActiveTpl] = useState<string | null>(null);
  const nextRowId = useRef(1);
  const [rows, setRows] = useState<NoteRow[]>([{ id: 0, text: '' }]);
  // 기본 선택 이미지 = 대표(primary), 없으면 첫 이미지, 그것도 없으면 이미지 없이.
  const [selectedImageId, setSelectedImageId] = useState<string | null>(
    () => (images.find((i) => i.isPrimary) ?? images[0])?.id ?? null,
  );
  const [sending, setSending] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: false });

  useEffect(() => {
    // 최상단 모달 패턴(capture + stopImmediatePropagation) — 부모 CharacterDetailModal 의 Escape 리스너까지
    //   함께 발동해 상세 뷰가 닫히며 작성 내용이 날아가는 것을 막는다(코덱스 P2).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const notes = rows.map((r) => r.text);
  const hasNote = buildRiggingBigo(notes).length > 0;
  const selectedImage = selectedImageId ? images.find((i) => i.id === selectedImageId) ?? null : null;

  const addRow = () => setRows((prev) => [...prev, { id: nextRowId.current++, text: '' }]);
  const removeRow = (id: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  const updateRow = (id: number, text: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, text } : r)));

  const onSend = async () => {
    if (sending) return;
    if (!hasNote) { toast.error('비고를 한 줄 이상 적어주세요'); return; }
    setSending(true);
    try {
      await sendRiggingAnnounce({
        // 복장이 여러 개인 캐릭터도 어떤 복장인지 구분되도록 '캐릭터 · 복장'으로 보낸다(코덱스 P2, 한솔 결정).
        characterName: `${character.name} · ${costume.name}`,
        title: title.trim(),
        folderPath: character.workFolderPath,
        notes,
        imageUrl: selectedImage?.url ?? null,
      });
      toast.success('슬랙에 리깅 완성 공지를 보냈어요');
      onClose();
    } catch (err) {
      console.error('[rigging-announce] 전송 실패:', err);
      toast.error('공지 전송에 실패했어요');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.modal} flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-6`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="리깅 완성 공지"
        tabIndex={-1}
        onKeyDown={modalFocus.onKeyDown}
        className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-lg p-5 flex flex-col gap-4 outline-none max-h-[85vh] overflow-y-auto"
      >
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-text-primary">리깅 완성 공지</h2>
          <span className="text-xs text-text-secondary">{character.name} · {costume.name} 리깅 완성을 슬랙에 알려요</span>
        </div>

        {/* 템플릿 — 누르면 제목만 채운다 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">템플릿 — 누르면 제목이 채워져요</span>
          <div className="flex flex-wrap gap-1.5">
            {TITLE_TEMPLATES.map((t) => {
              const on = activeTpl === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setTitle(t.title); setActiveTpl(t.key); }}
                  className={`rounded-full px-2.5 py-1 text-[11px] border transition-colors ${
                    on ? 'border-accent bg-accent/15 text-accent' : 'border-bg-border text-text-secondary hover:border-bg-border/60'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 제목 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">제목</span>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setActiveTpl(null); }}
            placeholder="예) 드라마 톤 특수리깅 완료 공지"
            className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
          />
        </div>

        {/* 경로 (자동) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">캐릭터 경로</span>
          {character.workFolderPath ? (
            <div
              className="text-sm text-text-primary bg-bg-border/10 border border-bg-border/70 rounded-md px-3 py-2 break-all"
              title={character.workFolderPath}
            >
              {character.workFolderPath}
            </div>
          ) : (
            <div className="text-sm text-text-secondary bg-bg-border/10 border border-dashed border-bg-border/70 rounded-md px-3 py-2">
              연결된 경로가 없어요 — 캐릭터 상세에서 작업 폴더를 연결하면 여기 자동으로 떠요.
            </div>
          )}
        </div>

        {/* 이미지 고르기 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">공지에 붙일 이미지</span>
          {images.length === 0 ? (
            <div className="text-xs text-text-secondary">이 복장에 등록된 이미지가 없어요 — 이미지 없이 보냅니다.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => {
                const on = img.id === selectedImageId;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedImageId(on ? null : img.id)}
                    title={on ? '선택 해제' : '이 이미지로 공지'}
                    className={`relative h-16 w-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      on ? 'border-accent' : 'border-bg-border/70 hover:border-bg-border'
                    }`}
                  >
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                    {img.isPrimary && (
                      <span className="absolute top-0.5 left-0.5 text-[9px] leading-none px-1 py-0.5 rounded bg-black/60 text-white">대표</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <span className="text-[11px] text-text-secondary">
            {selectedImage ? '슬랙에서 이 이미지 미리보기가 함께 표시돼요.' : '이미지 없이 텍스트만 보냅니다.'}
          </span>
        </div>

        {/* 비고 (여러 줄) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">비고 (여러 줄 가능 — 슬랙에서 줄바꿈으로 표시)</span>
          <div className="flex flex-col gap-1.5">
            {rows.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-1.5">
                <input
                  autoFocus={idx === 0}
                  value={row.text}
                  onChange={(e) => updateRow(row.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addRow(); }
                  }}
                  placeholder={idx === 0 ? '예) 서준 잠옷버전에 퀭한 이미지 추가!' : '비고 추가'}
                  className="flex-1 bg-transparent border border-bg-border rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length <= 1}
                  title="이 줄 삭제"
                  className="shrink-0 p-1.5 rounded-md text-text-secondary hover:bg-bg-border/40 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRow}
            className="self-start inline-flex items-center gap-1 text-xs text-accent hover:bg-accent/10 rounded-md px-2 py-1"
          >
            <Plus size={12} /> 비고 추가
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !hasNote}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50 cursor-pointer"
          >
            {sending && <Loader2 size={13} className="animate-spin" />}
            슬랙으로 보내기
          </button>
        </div>
      </div>
    </div>
  );
}
