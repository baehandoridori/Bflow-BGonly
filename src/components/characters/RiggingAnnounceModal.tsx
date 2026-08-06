import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { sendRiggingAnnounce } from '@/services/slackWebhookService';
import { uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { dataUrlToFile } from '@/utils/dataUrlToFile';
import type { Character, CharacterCostume } from '@/types';

interface NoteRow {
  id: number;
  text: string;
}

/** 공지 전용으로 붙여넣은 이미지 — 복장 이미지 목록(character_costume_images)에는 등록하지 않는 one-off 업로드. */
interface PastedImage {
  id: string;
  url: string;
}

/** 제목 템플릿 — 버튼을 누르면 제목(title)만 채운다(비고는 직접 작성).
 *  슬랙 워크플로 서식이 제목 앞에 '[모호 리깅 현황] - ' 머리말을 자동으로 붙이므로,
 *  앱은 머리말 없이 보낸다 — 포함해 보내면 공지에 머리말이 두 번 찍힌다 (피드백 34a). */
const TITLE_TEMPLATES: { key: string; label: string; title: string }[] = [
  { key: 'general', label: '일반 리깅 완료', title: '리깅 완료 공지' },
  { key: 'drama', label: '드라마 톤 특수리깅 완료', title: '드라마 톤 특수리깅 완료 공지' },
  { key: 'fix', label: '수정·보완 완료', title: '리깅 수정·보완 완료 공지' },
];

const MAX_ANNOUNCE_IMAGES = 5; // 슬랙 링크 미리보기 상한(~5개)에 맞춘 첨부 상한.

/**
 * 리깅 완성 슬랙 공지 모달 (B11 + 피드백 31).
 * - 제목은 '일반 리깅 완료' 템플릿이 미리 채워져 있고, 다른 템플릿 버튼이나 직접 입력으로 바꾼다.
 * - 캐릭터 작업 폴더 경로가 자동으로 뜨고(연결돼 있으면), 슬랙에는 jbbj://open/ 링크로 변환돼 나간다.
 * - 이미지는 그 복장의 이미지 중 고르거나(기본 대표), 화면 캡처를 Ctrl+V 로 바로 붙여넣는다(공지 전용 업로드).
 * - 비고는 선택 사항 — 없어도 보낼 수 있다(피드백 31d). 여러 줄은 슬랙에서 줄바꿈으로 이어진다.
 * - 워크플로 변수 CH_name='"캐릭터" - "복장" 리깅완료' / Path=폴더 jbbj 링크 / bigo=비고(줄바꿈) / image=고른 이미지 공개 URL.
 *   제목 머리말 '[모호 리깅 현황] - ' 은 슬랙 워크플로 서식이 붙인다(피드백 34a — 앱은 머리말 없이 전송).
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

  // 제목은 기본 템플릿(일반 리깅 완료)이 미리 채워진 상태로 시작 — 비고 없이도 바로 보낼 수 있게 (피드백 31a·31d).
  const [title, setTitle] = useState(TITLE_TEMPLATES[0].title);
  const [activeTpl, setActiveTpl] = useState<string | null>(TITLE_TEMPLATES[0].key);
  const nextRowId = useRef(1);
  const [rows, setRows] = useState<NoteRow[]>([{ id: 0, text: '' }]);
  // 기본 선택 = 대표(primary), 없으면 첫 이미지 1장. 클릭 순서를 유지하는 배열 — 순번이 곧 공지에 실리는 순서(피드백 50).
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>(() => {
    const first = (images.find((i) => i.isPrimary) ?? images[0])?.id;
    return first ? [first] : [];
  });
  const [pasted, setPasted] = useState<PastedImage[]>([]);
  const [pasting, setPasting] = useState(false);
  const [sending, setSending] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: false });

  // 정리(cleanup)용 최신값 참조 — Escape 리스너는 deps 없이 한 번만 걸리므로 ref 로 최신 상태를 본다.
  const pastedRef = useRef<PastedImage[]>([]);
  useEffect(() => { pastedRef.current = pasted; }, [pasted]);

  /** 공지 전용 업로드 정리 — keepUrls(전송에 쓴 이미지들)만 남기고 스토리지에서 삭제(고아 방지, fire-and-forget). */
  const cleanupPastedUploads = (keepUrls: ReadonlySet<string>) => {
    for (const img of pastedRef.current) {
      if (keepUrls.has(img.url)) continue;
      deleteImage(img.url).catch((e) => console.warn('[rigging-announce] 붙여넣기 이미지 정리 실패:', e));
    }
  };

  // 닫힌 뒤에 완료되는 업로드(in-flight)가 고아 파일을 남기지 않도록 닫힘 여부를 기록한다(코덱스 P2).
  const closedRef = useRef(false);

  /** 취소·백드롭·Escape 공통 닫기 — 보내지 않은 붙여넣기 이미지를 정리하고 닫는다. */
  const handleClose = () => {
    closedRef.current = true;
    // 전송(sending) 중 닫기: 웹훅이 이미 나가 슬랙 메시지가 선택 이미지를 참조할 수 있으므로
    //   그 이미지는 지우지 않는다(코덱스 3차 P2). 평상시 닫기는 전부 정리.
    cleanupPastedUploads(sending ? selectedUrlSet : new Set());
    onClose();
  };
  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; });

  useEffect(() => {
    // 최상단 모달 패턴(capture + stopImmediatePropagation) — 부모 CharacterDetailModal 의 Escape 리스너까지
    //   함께 발동해 상세 뷰가 닫히며 작성 내용이 날아가는 것을 막는다(코덱스 P2).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handleCloseRef.current();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  /** 피드백 31(b): 캡처 이미지 업로드 — 복장 이미지에 등록하지 않는 공지 전용(one-off) 업로드. */
  const pasteLockRef = useRef(false);
  const uploadPastedFile = useCallback(async (file: File) => {
    if (pasteLockRef.current) return;
    if (!file.type.startsWith('image/')) {
      toast.info('이미지 파일만 붙여넣을 수 있어요');
      return;
    }
    pasteLockRef.current = true;
    setPasting(true);
    try {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const base64 = await resizeBlob(file, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
      const res = await uploadCharacterImage(character.id, costume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 업로드 완료 전에 모달이 닫혔으면(취소·Escape·백드롭) 목록에 등록하지 않고 방금 파일을 바로 정리 —
      //   닫기 시점의 cleanupPastedUploads 는 아직 등록 전인 이 URL 을 모른다(코덱스 P2).
      if (closedRef.current) {
        deleteImage(res.url).catch((e) => console.warn('[rigging-announce] 붙여넣기 이미지 정리 실패:', e));
        return;
      }
      const entry: PastedImage = {
        id: `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: res.url,
      };
      setPasted((prev) => [...prev, entry]);
      // 상한에 걸리면 선택은 안 하되 목록에는 남긴다(사용자가 다른 장을 빼고 고를 수 있게).
      setSelectedImageIds((prev) => (prev.length >= MAX_ANNOUNCE_IMAGES ? prev : [...prev, entry.id]));
    } catch (err) {
      console.error('[rigging-announce] 붙여넣기 이미지 업로드 실패:', err);
      toast.error('이미지 붙여넣기에 실패했어요');
    } finally {
      pasteLockRef.current = false;
      setPasting(false);
    }
  }, [character.id, costume.id]);

  // 피드백 31(b): 공지 이미지 Ctrl+V.
  //   비고 입력칸에 포커스가 있어도(모달 열림 직후 autoFocus) 클립보드에 '이미지'가 있으면 첨부로 처리한다 —
  //   텍스트 붙여넣기는 이미지 item 이 없으므로 그대로 입력칸에 들어간다.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void uploadPastedFile(file);
        return;
      }
      // 탐색기 '파일 복사'는 clipboardData 에 안 실리는 환경이 있어 메인 프로세스에서 파일 경로('FileNameW')를 직접 읽는다.
      //   텍스트 붙여넣기면 아래가 null 을 반환해 아무 일도 일어나지 않는다.
      void (async () => {
        // 파일 경로 조회가 끝날 때까지 pending 으로 잠가 '이미지 없이 전송' 경합을 막는다(코덱스 2차 P2) —
        //   조회가 null(텍스트 붙여넣기)이면 잠깐 잠겼다 바로 풀린다.
        setPasting(true);
        try {
          const pastedFile = await window.electronAPI.clipboardReadImageFile();
          if (!pastedFile) return;
          const f = dataUrlToFile(pastedFile.dataUrl, pastedFile.fileName);
          if (f) await uploadPastedFile(f);
        } finally {
          setPasting(false);
        }
      })();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadPastedFile]);

  const notes = rows.map((r) => r.text);

  // 고를 수 있는 이미지 = 복장에 등록된 이미지 + 이번 공지에서 붙여넣은 이미지.
  const selectable = useMemo(
    () => [
      ...images.map((img) => ({ id: img.id, url: img.url, isPrimary: img.isPrimary, isPasted: false })),
      ...pasted.map((img) => ({ id: img.id, url: img.url, isPrimary: false, isPasted: true })),
    ],
    [images, pasted],
  );
  const selectedImages = selectedImageIds
    .map((id) => selectable.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const selectedUrlSet = new Set(selectedImages.map((i) => i.url));

  const addRow = () => setRows((prev) => [...prev, { id: nextRowId.current++, text: '' }]);
  const removeRow = (id: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  const updateRow = (id: number, text: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, text } : r)));

  const onSend = async () => {
    if (sending || pasting) return;
    setSending(true);
    try {
      await sendRiggingAnnounce({
        // 피드백 34(b): [내용] 줄 포맷 — '"캐릭터 이름" - "복장 이름" 리깅완료'. 입력 없이도 완성 공지가 나간다.
        characterName: `"${character.name}" - "${costume.name}" 리깅완료`,
        title: title.trim(),
        folderPath: character.workFolderPath,
        notes,
        imageUrls: selectedImages.map((i) => i.url),
      });
      toast.success('슬랙에 리깅 완성 공지를 보냈어요');
      // 전송에 쓴 이미지는 남기고, 붙여넣기만 하고 안 쓴 이미지는 정리.
      cleanupPastedUploads(selectedUrlSet);
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
      data-rigging-announce="true"
      className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.modal} flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-6`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}
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
          <span className="text-[11px] text-text-secondary/80">슬랙 공지 제목 앞에는 [모호 리깅 현황] 머리말이 자동으로 붙어요 — 제목에 또 쓰지 않아도 돼요.</span>
        </div>

        {/* 경로 (자동) — 슬랙에는 jbbj://open/ 링크로 변환돼 나간다 (피드백 31c) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">캐릭터 경로 — 슬랙에서 클릭하면 폴더가 열려요</span>
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

        {/* 이미지 고르기 + Ctrl+V 붙여넣기 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">공지에 붙일 이미지</span>
          {selectable.length === 0 ? (
            <div className="text-xs text-text-secondary">이 복장에 등록된 이미지가 없어요 — 캡처를 Ctrl+V 로 붙여넣거나, 이미지 없이 보냅니다.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectable.map((img) => {
                const on = selectedImageIds.includes(img.id);
                const order = selectedImageIds.indexOf(img.id);
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedImageIds((prev) => {
                      if (prev.includes(img.id)) return prev.filter((id) => id !== img.id);
                      if (prev.length >= MAX_ANNOUNCE_IMAGES) {
                        toast.info(`이미지는 최대 ${MAX_ANNOUNCE_IMAGES}장까지 첨부할 수 있어요`);
                        return prev;
                      }
                      return [...prev, img.id];
                    })}
                    title={on ? '선택 해제' : '이 이미지도 공지에 첨부'}
                    className={`relative h-16 w-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      on ? 'border-accent' : 'border-bg-border/70 hover:border-bg-border'
                    }`}
                  >
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                    {img.isPrimary && (
                      <span className="absolute top-0.5 left-0.5 text-[9px] leading-none px-1 py-0.5 rounded bg-black/60 text-white">대표</span>
                    )}
                    {img.isPasted && (
                      <span className="absolute top-0.5 left-0.5 text-[9px] leading-none px-1 py-0.5 rounded bg-accent/80 text-white">붙여넣기</span>
                    )}
                    {on && (
                      <span className="absolute bottom-0.5 right-0.5 min-w-4 text-center text-[9px] leading-none px-1 py-0.5 rounded bg-accent text-white">{order + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <span className="text-[11px] text-text-secondary">
            {pasting
              ? '이미지 올리는 중…'
              : selectedImages.length > 0
                ? `선택한 ${selectedImages.length}장이 공지에 함께 표시돼요 (최대 ${MAX_ANNOUNCE_IMAGES}장). 캡처는 Ctrl+V 로 추가할 수 있어요.`
                : '이미지 없이 텍스트만 보냅니다. 캡처는 Ctrl+V 로 추가할 수 있어요.'}
          </span>
        </div>

        {/* 비고 (선택, 여러 줄) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">비고 (선택 — 여러 줄 가능, 슬랙에서 줄바꿈으로 표시)</span>
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
                  placeholder={idx === 0 ? '예) 서준 잠옷버전에 퀭한 이미지 추가! (생략 가능)' : '비고 추가'}
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
          <button type="button" onClick={handleClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || pasting}
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
