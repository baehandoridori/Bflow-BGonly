/**
 * 캐릭터 현황판.
 *
 * - 캐릭터 카드 그리드(이름 검색 + 태그 AND 필터) + 에피소드 에셋 탭.
 * - 카드 클릭 → 전체화면급 오버레이 모달: 좌측 캐릭터 목록 / 우측 상세(마스터-디테일).
 *   상세 = 큰 대표 이미지(클릭=크게보기, 별도 버튼으로 교체) + 복장명·메모 + 복장 썸네일 갤러리
 *          + 버전·담당자 + 디자인/리깅 단계 레일 + 구조/에셋 태그(태그별 고유색).
 *
 * 모든 변경은 낙관적 업데이트 + 실시간 동기화 (useCharacterBoardStore).
 * 접근 권한은 사이드바에서 게이팅 (useCharacterBoardAccess).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Plus, X, Image as ImageIcon, Trash2, Pencil, Search, User, Check, Upload, MessageSquare, FolderOpen, FileText, Copy } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  COSTUME_DESIGN_STAGES,
  COSTUME_RIGGING_STAGES,
  type Character,
  type CharacterCostume,
  type CharacterImageBackground,
  type CharacterImageFit,
  type CostumeDesignStage,
  type CostumeRiggingStage,
} from '@/types';
import { updateEpisodeReelPath, uploadCharacterImage } from '@/services/supabaseService';
import { deleteImage } from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { cn } from '@/utils/cn';
import { EpisodeAssetBoard } from './EpisodeAssetBoard';
import { tagColor } from '@/utils/tagColor';
import { CommentPanelResizable } from '@/components/scenes/CommentPanelResizable';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { CharacterImageFitEditor } from '@/components/characters/CharacterImageFitEditor';
import { CharacterImageLightbox, type CharacterImageLightboxEntry } from '@/components/characters/CharacterImageLightbox';
import { chooseWorkFile, chooseWorkFolder, openWorkPath } from '@/services/sceneWorkLinkService';
import { copyImageToClipboard } from '@/utils/imageActions';
import { getResolvedCharacterFolderAfterFilePick } from '@/utils/characterAssets';
import { getUserColor } from '@/components/common/AssigneeSelect';

type BoardTab = 'board' | 'episode-assets';

// 단계별 색 (씬 단계색 재사용):
//   대기 #8B8DA3 / 진행·벡터화 #74B9FF / 리깅 #6C5CE7 / 피드백 #FDCB6E / 완료 #A29BFE / 완성 #00B894
const DESIGN_STAGE_META: Record<CostumeDesignStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  in_progress: { label: '진행 중', color: '#74B9FF' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완료', color: '#A29BFE' },
};
const RIGGING_STAGE_META: Record<CostumeRiggingStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  vectorized: { label: '벡터화', color: '#74B9FF' },
  rigging: { label: '리깅', color: '#6C5CE7' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완성', color: '#00B894' },
};

// 미리 정의된 태그 팔레트 — 토글 칩으로 노출.
const STRUCTURE_TAG_PALETTE = ['얼굴각도 컨트롤러', '책가방 세트', '뒷모습', '앞모습 없음', '측면'] as const;
const ASSET_TAG_PALETTE = ['담배', '핸드폰', '가방', '안경', '모자'] as const;

/** 태그별 고유색 토글 칩. on 이면 색 채움(틴트), off 면 회색 + 색 점. */
function TagPill({
  tag,
  on,
  onClick,
}: {
  tag: string;
  on: boolean;
  onClick: () => void;
}) {
  const c = tagColor(tag);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 transition-all duration-150 cursor-pointer"
      style={
        on
          ? { background: `${c}26`, borderColor: `${c}99`, color: c }
          : { background: 'transparent', borderColor: 'rgb(var(--color-bg-border))', color: 'rgb(var(--color-text-secondary))' }
      }
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, opacity: on ? 1 : 0.55 }} />
      {tag}
    </button>
  );
}

function parseAssigneeNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function formatAssigneeNames(names: string[]): string | null {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  return unique.length > 0 ? unique.join(', ') : null;
}

function AssigneeNamePicker({
  label,
  value,
  onChange,
  variant = 'stack',
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  variant?: 'stack' | 'inline';
}) {
  const users = useAuthStore((s) => s.users);
  const [draftName, setDraftName] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = parseAssigneeNames(value);
  const userNameSet = useMemo(() => new Set(users.map((user) => user.name)), [users]);
  const closeModal = () => {
    setDraftName('');
    setModalOpen(false);
  };
  const remove = (name: string) => {
    const next = selected.filter((item) => item !== name);
    onChange(formatAssigneeNames(next));
  };
  useEffect(() => {
    if (!modalOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [modalOpen]);
  const addDraftName = () => {
    const names = draftName
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    const next = [...selected];
    for (const name of names) {
      if (!next.includes(name)) next.push(name);
    }
    onChange(formatAssigneeNames(next));
    setDraftName('');
    setModalOpen(false);
  };

  const modal = modalOpen && (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4" onMouseDown={closeModal}>
      <div className="w-full max-w-sm rounded-2xl bg-bg-card p-4 shadow-2xl ring-1 ring-white/10" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">{label} 추가</div>
            <div className="text-xs text-text-secondary">쉼표로 여러 이름을 한 번에 추가할 수 있어요</div>
          </div>
          <button type="button" aria-label="닫기" onClick={closeModal} className="rounded-lg p-2 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary">
            <X size={17} />
          </button>
        </div>
        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {selected.map((name) => {
              const color = getUserColor(name);
              const isListedUser = userNameSet.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  title={isListedUser ? `${name} 제거` : `${name} 제거 (사용자 목록에 없는 이름)`}
                  onClick={() => remove(name)}
                  className="group flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-[background-color,box-shadow] hover:bg-bg-border/25"
                  style={{ color, boxShadow: `inset 0 0 0 1px ${color}${isListedUser ? '66' : '99'}` }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  {name}
                  <X size={12} className="text-text-secondary opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addDraftName();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              closeModal();
            }
          }}
          placeholder="이름 입력"
          className="w-full rounded-xl border border-bg-border bg-bg-border/10 px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-accent/70"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={closeModal} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-border/25 hover:text-text-primary">
            취소
          </button>
          <button type="button" disabled={!draftName.trim()} onClick={addDraftName} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
            추가
          </button>
        </div>
      </div>
    </div>
  );

  if (variant === 'inline') {
    const firstName = selected[0] ?? null;
    const color = firstName ? getUserColor(firstName) : 'rgb(var(--color-text-secondary))';
    const display = firstName
      ? selected.length > 1
        ? `${firstName} 외 ${selected.length - 1}`
        : firstName
      : '담당자 추가';
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title={label}
          className={cn(
            'flex min-h-8 max-w-[160px] items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-[background-color,box-shadow,transform] active:scale-[0.96]',
            selected.length > 0
              ? 'bg-bg-border/20 text-text-primary shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-bg-border/35'
              : 'bg-transparent text-text-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-bg-border/20 hover:text-text-primary',
          )}
          aria-label={`${label} 편집`}
        >
          <User size={12} className="shrink-0" style={{ color }} />
          <span className="truncate">{display}</span>
        </button>
        {modal}
      </div>
    );
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-secondary">{label}</span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-text-secondary/70 hover:text-text-primary"
          >
            해제
          </button>
        )}
      </div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className="text-xs text-text-secondary/60">미지정</span>
        ) : selected.map((name) => {
          const color = getUserColor(name);
          const isListedUser = userNameSet.has(name);
          return (
            <button
              key={name}
              type="button"
              title={isListedUser ? `${name} 제거` : `${name} 제거 (사용자 목록에 없는 이름)`}
              onClick={() => remove(name)}
              className="group flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-[background-color,box-shadow] hover:bg-bg-border/25"
              style={{ color, boxShadow: `inset 0 0 0 1px ${color}${isListedUser ? '66' : '99'}` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {name}
              <X size={12} className="text-text-secondary opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex min-h-10 items-center gap-1.5 rounded-lg border border-bg-border px-3 text-xs text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary active:scale-[0.96]"
          aria-label={`${label} 추가`}
        >
          <Plus size={13} /> 추가
        </button>
      </div>
      {modal}
    </div>
  );
}

function displayPathName(path: string | null | undefined): string {
  const value = (path ?? '').trim();
  if (!value) return '미등록';
  const normalized = value.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

async function openStoredPath(targetPath: string | null | undefined, label: string): Promise<void> {
  const path = (targetPath ?? '').trim();
  if (!path) {
    toast.error(`${label} 경로가 등록되지 않았어요`);
    return;
  }
  const res = await openWorkPath(path);
  if (!res.ok) toast.error(`${label} 열기에 실패했어요`);
}

async function copyCharacterImage(url: string | null | undefined): Promise<void> {
  if (!url) {
    toast.error('복사할 이미지가 없어요');
    return;
  }
  await copyImageToClipboard(url);
}

async function resolveFolderAfterFilePick(currentFolderPath: string | null, filePath: string): Promise<string> {
  if (currentFolderPath?.trim()) return currentFolderPath;
  try {
    const dirname = await window.electronAPI?.pathDirname?.(filePath);
    if (dirname) return dirname;
  } catch {
    // renderer fallback below
  }
  return getResolvedCharacterFolderAfterFilePick(currentFolderPath, filePath);
}

// ─── 단계 레일 ──────────────────────────────────
// 채움형 스텝 레일: 지난 단계=채운 점(체크), 현재=색 강조+글로우, 이후=빈 점. 클릭으로 설정.
function StageRail<T extends string>({
  label,
  stages,
  meta,
  current,
  onSelect,
  headerRight,
}: {
  label: string;
  stages: readonly T[];
  meta: Record<T, { label: string; color: string }>;
  current: T;
  onSelect: (s: T) => void;
  headerRight?: ReactNode;
}) {
  const curIdx = Math.max(0, stages.indexOf(current));
  const curColor = meta[current].color;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-xs font-medium" style={{ color: curColor }}>{meta[current].label}</span>
        </div>
        {headerRight}
      </div>
      <div className="flex items-start">
        {stages.map((s, i) => {
          const m = meta[s];
          const passed = i < curIdx;
          const isCur = i === curIdx;
          const reached = i <= curIdx;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              aria-label={`${label} ${m.label}`}
              aria-pressed={isCur}
              className="group relative flex-1 flex flex-col items-center gap-1.5 cursor-pointer"
            >
              {/* 연결선 (이전 노드 → 이 노드) */}
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute top-[9px] h-[2px] -z-0"
                  style={{
                    left: '-50%',
                    width: '100%',
                    background: reached ? meta[stages[i - 1]].color : 'rgb(var(--color-bg-border))',
                  }}
                />
              )}
              {/* 노드 */}
              <span
                className="relative z-[1] w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all duration-200"
                style={{
                  background: reached ? m.color : 'rgb(var(--color-bg-card))',
                  border: `2px solid ${reached ? m.color : 'rgb(var(--color-bg-border))'}`,
                  boxShadow: isCur ? `0 0 0 4px ${m.color}33` : 'none',
                }}
              >
                {passed && <Check size={10} className="text-white" strokeWidth={3} />}
                {isCur && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span
                className="text-[11px] leading-tight text-center transition-colors"
                style={{ color: isCur ? m.color : reached ? 'rgb(var(--color-text-secondary))' : 'rgb(var(--color-text-secondary) / 0.5)' }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CharacterCard({
  character,
  costumes,
  onOpen,
  onContextMenu,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const featured = costumes.find((c) => c.featuredImageUrl) ?? null;
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="text-left bg-bg-card border border-bg-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors duration-200 flex flex-col cursor-pointer"
    >
      <div className="aspect-[4/3] bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {featured ? (
          <CharacterImageFrame
            url={featured.featuredImageUrl}
            alt={character.name}
            background={featured.imageBackground}
            fit={featured.imageFit}
            className="w-full h-full"
          />
        ) : (
          <ImageIcon size={28} className="text-text-secondary/40" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="font-semibold text-text-primary truncate">{character.name}</div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>복장 {costumes.length}</span>
          {character.episodeIds.length > 0 && (
            <span className="text-text-secondary/70">· EP {character.episodeIds.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#A29BFE22', color: '#A29BFE' }}>
            디자인 {designDone}/{costumes.length}
          </span>
          <span className="px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#00B89422', color: '#00B894' }}>
            리깅 {riggingDone}/{costumes.length}
          </span>
        </div>
      </div>
    </button>
  );
}

/** 미리 정의된 토글 칩(태그별 고유색) + 자유 추가. */
function TagChipSection({
  label,
  palette,
  tags,
  onChange,
}: {
  label: string;
  palette: readonly string[];
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const chips = useMemo(() => {
    const extra = tags.filter((t) => !palette.includes(t));
    return [...palette, ...extra];
  }, [palette, tags]);

  const toggle = (tag: string) => {
    if (tags.includes(tag)) onChange(tags.filter((t) => t !== tag));
    else onChange([...tags, tag]);
  };

  const addCustom = () => {
    const t = input.trim();
    if (!t || tags.includes(t)) { setInput(''); return; }
    onChange([...tags, t]);
    setInput('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((tag) => (
          <TagPill key={tag} tag={tag} on={tags.includes(tag)} onClick={() => toggle(tag)} />
        ))}
        <div className="flex items-center gap-1">
          <Plus size={12} className="text-text-secondary/60" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            onBlur={addCustom}
            placeholder="직접 추가"
            aria-label={`${label} 직접 추가`}
            className="bg-transparent border border-bg-border rounded-full px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50 w-20"
          />
        </div>
      </div>
    </div>
  );
}

/** 이미지 크게 보기 라이트박스. */
function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={url} alt={alt} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute top-5 right-5 text-white/80 hover:text-white cursor-pointer"
      >
        <X size={24} />
      </button>
    </div>
  );
}

/** 큰 대표 이미지 — 클릭=크게보기, 아래 별도 버튼으로 교체/추가. */
function FeaturedImageSlot({
  character,
  costume,
  shownCostume,
  onView,
  onPickFolder,
  onPickFile,
}: {
  character: Character;
  costume: CharacterCostume | null;
  shownCostume: CharacterCostume | null;
  onView: (costumeId: string) => void;
  onPickFolder: () => void;
  onPickFile: () => void;
}) {
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [fitEditorOpen, setFitEditorOpen] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    if (!costume) { toast.error('먼저 디자인(복장)을 추가해주세요'); return; }
    setUploading(true);
    try {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const base64 = await resizeBlob(file, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
      const res = await uploadCharacterImage(character.id, costume.id, base64);
      if (!res.ok || !res.url) throw new Error(res.error ?? '업로드 실패');
      // 이전 대표 이미지 정리는 서버(updateCharacterCostume)가 DB 업데이트 성공 후 처리 — 롤백 시 깨진 URL 방지.
      const saved = await updateCostumeField(costume.id, { featuredImageUrl: res.url });
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
  }, [character.id, costume, updateCostumeField]);

  const shownUrl = shownCostume?.featuredImageUrl ?? null;
  const shownBackground = shownCostume?.imageBackground ?? 'black';
  const shownFit = shownCostume?.imageFit;

  return (
    <div className="w-[240px] shrink-0 flex flex-col gap-2">
      <CharacterImageFrame
        url={shownUrl}
        alt={shownCostume?.name ?? character.name}
        background={shownBackground}
        fit={shownFit}
        className={cn(
          'group aspect-[3/4] w-full rounded-xl border border-bg-border',
          shownUrl ? 'cursor-zoom-in hover:border-accent/50 transition-colors' : '',
        )}
        onClick={shownUrl && shownCostume ? () => onView(shownCostume.id) : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bg-border text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 transition-colors cursor-pointer disabled:opacity-50"
      >
        <Upload size={13} />
        {uploading ? '업로드 중...' : shownUrl ? '이미지 바꾸기' : '이미지 추가'}
      </button>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={character.workFolderPath ? () => openStoredPath(character.workFolderPath, '작업 폴더') : onPickFolder}
          className="flex items-center justify-center gap-1 rounded-md border border-bg-border px-1.5 py-1 text-[11px] text-text-secondary hover:text-text-primary"
          title={character.workFolderPath ?? '작업 폴더 등록'}
        >
          <FolderOpen size={12} /> 작업 폴더
        </button>
        <button
          type="button"
          onClick={shownCostume?.workFilePath ? () => openStoredPath(shownCostume.workFilePath, '작업 파일') : onPickFile}
          className="flex items-center justify-center gap-1 rounded-md border border-bg-border px-1.5 py-1 text-[11px] text-text-secondary hover:text-text-primary"
          title={shownCostume?.workFilePath ?? '작업 파일 등록'}
        >
          <FileText size={12} /> 작업 파일
        </button>
        <button
          type="button"
          disabled={!shownUrl}
          onClick={() => copyCharacterImage(shownUrl)}
          className="flex items-center justify-center gap-1 rounded-md border border-bg-border px-1.5 py-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <Copy size={12} /> 이미지 복사
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
          background={shownBackground}
          hasImage={!!shownUrl}
          hasFolder={!!character.workFolderPath}
          hasFile={!!shownCostume?.workFilePath}
          onClose={() => setContextMenu(null)}
          onBackground={(background: CharacterImageBackground) => {
            if (shownCostume) void updateCostumeField(shownCostume.id, { imageBackground: background });
          }}
          onEditFit={() => setFitEditorOpen(true)}
          onCopyImage={() => copyCharacterImage(shownUrl)}
          onOpenFolder={() => openStoredPath(character.workFolderPath, '작업 폴더')}
          onOpenFile={() => openStoredPath(shownCostume?.workFilePath, '작업 파일')}
        />
      )}
      {fitEditorOpen && shownUrl && shownCostume && (
        <CharacterImageFitEditor
          url={shownUrl}
          alt={shownCostume.name}
          background={shownBackground}
          fit={shownCostume.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeField(shownCostume.id, { imageFit: fit })}
          onClose={() => setFitEditorOpen(false)}
        />
      )}
    </div>
  );
}

/** 복장 메모 — 키 입력마다 저장 말고 blur 때 한 번만(동시 쓰기 경합·텍스트 유실 방지). */
function CostumeMemoInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
      placeholder="이 디자인 메모…"
      aria-label="디자인 메모"
      rows={3}
      className="w-full bg-bg-border/20 border border-bg-border rounded-lg px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
    />
  );
}

/** 이미지 아래 — 이 복장이 무슨 디자인인지(이름, 편집 가능) + 디자인별 메모. */
function CostumeIdentity({ costume }: { costume: CharacterCostume }) {
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
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(costume.name); setEditing(false); } }}
            aria-label="복장 이름"
            className="flex-1 min-w-0 bg-transparent border border-accent/50 rounded-md px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none"
          />
        ) : (
          <>
            <span className="text-sm font-medium text-text-primary truncate">{costume.name}</span>
            <span className="text-[11px] text-text-secondary/70 shrink-0">v{costume.versionNo}</span>
            <button
              type="button"
              aria-label="복장 이름 편집"
              onClick={() => { setDraft(costume.name); setEditing(true); }}
              className="text-text-secondary/70 hover:text-text-primary cursor-pointer shrink-0"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>
      <CostumeMemoInput
        value={costume.memo ?? ''}
        onCommit={(next) => updateCostumeField(costume.id, { memo: next.trim() ? next : null })}
      />
    </div>
  );
}

function PathActionRow({
  label,
  path,
  onPick,
  onOpen,
}: {
  label: string;
  path: string | null;
  onPick: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-bg-border/70 bg-bg-border/10 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        <div className="text-sm text-text-primary truncate" title={path ?? undefined}>{displayPathName(path)}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onPick}
          className="px-2 py-1 rounded-md border border-bg-border text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50"
        >
          선택
        </button>
        <button
          type="button"
          disabled={!path}
          onClick={onOpen}
          className="px-2 py-1 rounded-md border border-bg-border text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 disabled:opacity-40"
        >
          열기
        </button>
      </div>
    </div>
  );
}

/** 선택 복장의 진행 상세 — 버전·작업 경로·단계별 담당자·태그. */
function CostumeDetail({
  character,
  costume,
  onPickFolder,
  onPickFile,
}: {
  character: Character;
  costume: CharacterCostume;
  onPickFolder: () => void;
  onPickFile: () => void;
}) {
  const updateCostumeStage = useCharacterBoardStore((s) => s.updateCostumeStage);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const setCostumeTags = useCharacterBoardStore((s) => s.setCostumeTags);
  const setVersion = useCharacterBoardStore((s) => s.setVersion);

  return (
    <div className="flex flex-col gap-5">
      {/* 버전 */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-secondary">버전</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="버전 내리기"
              className="w-7 h-7 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.max(1, Math.floor(costume.versionNo) - 1))}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              value={costume.versionNo}
              aria-label="버전 번호"
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) setVersion(costume.id, Math.floor(n)); }}
              className="w-14 text-center bg-transparent border border-bg-border rounded-md px-1 py-1 text-text-primary outline-none focus:border-accent/50"
            />
            <button
              type="button"
              aria-label="버전 올리기"
              className="w-7 h-7 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.floor(costume.versionNo) + 1)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* 작업 경로 */}
      <div className="grid gap-2 md:grid-cols-2">
        <PathActionRow
          label="작업 폴더"
          path={character.workFolderPath}
          onPick={onPickFolder}
          onOpen={() => openStoredPath(character.workFolderPath, '작업 폴더')}
        />
        <PathActionRow
          label="작업 파일"
          path={costume.workFilePath}
          onPick={onPickFile}
          onOpen={() => openStoredPath(costume.workFilePath, '작업 파일')}
        />
      </div>

      {/* 단계 레일 + 담당자 */}
      <div className="flex flex-col gap-5 rounded-xl border border-bg-border/60 bg-bg-border/10 p-4">
        <StageRail
          label="디자인 단계"
          stages={COSTUME_DESIGN_STAGES}
          meta={DESIGN_STAGE_META}
          current={costume.designStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'design', s)}
          headerRight={
            <AssigneeNamePicker
              label="디자인 담당자"
              value={costume.designAssignee}
              onChange={(next) => updateCostumeField(costume.id, { designAssignee: next })}
              variant="inline"
            />
          }
        />
        <div className="h-px bg-bg-border/50" />
        <StageRail
          label="리깅 단계"
          stages={COSTUME_RIGGING_STAGES}
          meta={RIGGING_STAGE_META}
          current={costume.riggingStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'rigging', s)}
          headerRight={
            <AssigneeNamePicker
              label="리깅 담당자"
              value={costume.riggingAssignee}
              onChange={(next) => updateCostumeField(costume.id, { riggingAssignee: next })}
              variant="inline"
            />
          }
        />
      </div>

      {/* 태그 */}
      <TagChipSection
        label="구조 태그"
        palette={STRUCTURE_TAG_PALETTE}
        tags={costume.structureTags}
        onChange={(next) => setCostumeTags(costume.id, 'structure', next)}
      />
      <TagChipSection
        label="에셋 태그"
        palette={ASSET_TAG_PALETTE}
        tags={costume.assetTags}
        onChange={(next) => setCostumeTags(costume.id, 'asset', next)}
      />
    </div>
  );
}

function riggingRatio(costumes: CharacterCostume[]): number {
  if (costumes.length === 0) return 0;
  return costumes.filter((c) => c.riggingStage === 'done').length / costumes.length;
}

function CharacterListRow({
  character,
  costumes,
  selected,
  onSelect,
}: {
  character: Character;
  costumes: CharacterCostume[];
  selected: boolean;
  onSelect: () => void;
}) {
  const thumb = costumes.find((c) => c.featuredImageUrl)?.featuredImageUrl ?? null;
  const ratio = riggingRatio(costumes);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left border-l-2 transition-colors cursor-pointer',
        selected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg-border/30',
      )}
    >
      <div className="w-8 h-8 rounded-md bg-bg-border/40 overflow-hidden flex items-center justify-center shrink-0">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <User size={15} className="text-text-secondary/50" />}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className={cn('text-sm truncate', selected ? 'text-text-primary font-medium' : 'text-text-secondary')}>{character.name}</div>
        <div className="h-1 rounded-full bg-bg-border/60 overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: '#00B894' }} />
        </div>
      </div>
    </button>
  );
}

function CostumeThumbCard({
  costume,
  selected,
  onSelect,
  onDelete,
  onImageContextMenu,
}: {
  costume: CharacterCostume;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onImageContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group relative w-[104px] shrink-0 flex flex-col rounded-lg overflow-hidden border transition-colors cursor-pointer',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
      )}
    >
      <div className="aspect-[3/4] w-full bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {costume.featuredImageUrl ? (
          <CharacterImageFrame
            url={costume.featuredImageUrl}
            alt={costume.name}
            background={costume.imageBackground}
            fit={costume.imageFit}
            className="w-full h-full"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onImageContextMenu(event);
            }}
          />
        ) : (
          <ImageIcon size={18} className="text-text-secondary/40" />
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-bg-card">
        <span className={cn('text-xs truncate', selected ? 'text-text-primary' : 'text-text-secondary')}>{costume.name}</span>
        <span className="text-[10px] text-text-secondary/70 shrink-0">v{costume.versionNo}</span>
      </div>
      <span
        role="button"
        tabIndex={-1}
        aria-label={`${costume.name} 삭제`}
        onClick={(e) => { e.stopPropagation(); if (window.confirm(`'${costume.name}' 복장을 삭제할까요?`)) onDelete(); }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-black/40 text-white/80 hover:text-[#FF6B6B] transition-opacity cursor-pointer"
      >
        <X size={12} />
      </span>
    </div>
  );
}

/** 우측 상세 패널. */
function CharacterDetailPanel({
  character,
  onClose,
  commentOpen,
  onToggleComment,
  commentCount,
}: {
  character: Character;
  onClose: () => void;
  commentOpen: boolean;
  onToggleComment: () => void;
  commentCount: number;
}) {
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const addCostume = useCharacterBoardStore((s) => s.addCostume);
  const deleteCostume = useCharacterBoardStore((s) => s.deleteCostume);
  const deleteCharacter = useCharacterBoardStore((s) => s.deleteCharacter);
  const renameCharacter = useCharacterBoardStore((s) => s.renameCharacter);
  const updateCharacterFolder = useCharacterBoardStore((s) => s.updateCharacterFolder);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const linkEpisode = useCharacterBoardStore((s) => s.linkEpisode);
  const unlinkEpisode = useCharacterBoardStore((s) => s.unlinkEpisode);
  const episodes = useDataStore((s) => s.episodes);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);

  const costumes = byCharacter.get(character.id) ?? [];
  const [activeCostumeId, setActiveCostumeId] = useState<string | null>(costumes[0]?.id ?? null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(character.name);
  const [lightboxCostumeId, setLightboxCostumeId] = useState<string | null>(null);
  const [imageMenu, setImageMenu] = useState<{ costumeId: string; x: number; y: number } | null>(null);
  const [fitEditorCostumeId, setFitEditorCostumeId] = useState<string | null>(null);

  // 갤러리 휠 → 가로 스크롤.
  const galleryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (costumes.length === 0) { setActiveCostumeId(null); return; }
    if (!costumes.some((c) => c.id === activeCostumeId)) setActiveCostumeId(costumes[0].id);
  }, [costumes, activeCostumeId]);

  useEffect(() => { setEditingName(false); setNameDraft(character.name); }, [character.id, character.name]);

  const activeCostume = costumes.find((c) => c.id === activeCostumeId) ?? null;
  const shownCostume = activeCostume;
  const imageEntries: CharacterImageLightboxEntry[] = costumes
    .filter((c) => !!c.featuredImageUrl)
    .map((c) => ({
      costumeId: c.id,
      name: `${character.name} · ${c.name}`,
      costumeName: c.name,
      versionNo: c.versionNo,
      url: c.featuredImageUrl!,
      background: c.imageBackground,
      fit: c.imageFit,
    }));
  const menuCostume = imageMenu ? costumes.find((c) => c.id === imageMenu.costumeId) ?? null : null;
  const fitEditorCostume = fitEditorCostumeId ? costumes.find((c) => c.id === fitEditorCostumeId) ?? null : null;

  const handlePickFolder = useCallback(async () => {
    const folder = await chooseWorkFolder();
    if (!folder) return;
    await updateCharacterFolder(character.id, folder);
  }, [character.id, updateCharacterFolder]);

  const handlePickFile = useCallback(async (targetCostume = activeCostume) => {
    if (!targetCostume) {
      toast.error('먼저 디자인(복장)을 선택해주세요');
      return;
    }
    const filePath = await chooseWorkFile();
    if (!filePath) return;
    const saved = await updateCostumeField(targetCostume.id, { workFilePath: filePath });
    if (!saved) return;
    const latestFolderPath = useCharacterBoardStore.getState().characters.find((item) => item.id === character.id)?.workFolderPath ?? character.workFolderPath;
    if (!latestFolderPath?.trim()) {
      const folder = await resolveFolderAfterFilePick(latestFolderPath, filePath);
      if (folder) await updateCharacterFolder(character.id, folder);
    }
  }, [activeCostume, character.id, character.workFolderPath, updateCharacterFolder, updateCostumeField]);

  const handleEpisodeReel = useCallback(async (episode: typeof episodes[number]) => {
    if (episode.reelFilePath) {
      await openStoredPath(episode.reelFilePath, '릴 파일');
      return;
    }
    const filePath = await chooseWorkFile();
    if (!filePath) return;
    const prev = useDataStore.getState().episodes;
    setEpisodes(prev.map((item) => item.episodeNumber === episode.episodeNumber ? { ...item, reelFilePath: filePath } : item));
    try {
      await updateEpisodeReelPath(episode.episodeNumber, filePath);
      toast.success('릴 파일 경로를 등록했어요');
    } catch (err) {
      console.error('[character-board] 릴 파일 경로 저장 실패:', err);
      setEpisodes(prev);
      toast.error('릴 파일 경로 저장에 실패했어요');
    }
  }, [episodes, setEpisodes]);

  const handleAddCostume = async () => {
    // 중간 복장 삭제 후에도 UNIQUE(character_id, name) 충돌하지 않도록 안 쓰는 번호 생성.
    const used = new Set(costumes.map((c) => c.name));
    let n = costumes.length + 1;
    while (used.has(`복장 ${n}`)) n++;
    const created = await addCostume(character.id, `복장 ${n}`);
    if (created) setActiveCostumeId(created.id);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 (글래스) */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 border-b border-bg-border/40 shrink-0"
        style={{ background: 'rgba(255,255,255,0.015)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft !== character.name) renameCharacter(character.id, nameDraft.trim()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              aria-label="캐릭터 이름"
              className="bg-transparent border border-accent/50 rounded-md px-2 py-1 text-lg font-semibold text-text-primary outline-none"
            />
          ) : (
            <>
              <h2 className="text-lg font-semibold text-text-primary truncate">{character.name}</h2>
              <button type="button" aria-label="이름 편집" onClick={() => { setNameDraft(character.name); setEditingName(true); }} className="text-text-secondary hover:text-text-primary cursor-pointer">
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleComment}
            aria-pressed={commentOpen}
            title={commentOpen ? '댓글 닫기' : '댓글 열기'}
            className={cn(
              'flex items-center gap-1 text-sm px-2 py-1 rounded-md transition-colors cursor-pointer',
              commentOpen ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <MessageSquare size={14} /> 댓글{commentCount > 0 ? ` ${commentCount}` : ''}
          </button>
          <button
            type="button"
            onClick={() => { if (window.confirm(`'${character.name}' 캐릭터를 삭제할까요? 복장도 함께 삭제됩니다.`)) deleteCharacter(character.id); }}
            className="text-text-secondary hover:text-[#FF6B6B] flex items-center gap-1 text-sm cursor-pointer"
          >
            <Trash2 size={14} /> 삭제
          </button>
          <button type="button" aria-label="닫기" onClick={onClose} className="text-text-secondary hover:text-text-primary cursor-pointer">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 본문 (스크롤) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* 좌측: 큰 이미지 + 복장명 + 메모 */}
          <div className="flex flex-col gap-3">
            <FeaturedImageSlot
              character={character}
              costume={activeCostume}
              shownCostume={shownCostume}
              onView={(costumeId) => setLightboxCostumeId(costumeId)}
              onPickFolder={handlePickFolder}
              onPickFile={() => handlePickFile(activeCostume)}
            />
            {activeCostume && <CostumeIdentity costume={activeCostume} />}
          </div>

          {/* 우측: 에피소드 + 갤러리 + 진행 상세 */}
          <div className="flex flex-col gap-5 min-w-0 flex-1">
            {/* 출연 에피소드 */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-text-secondary">출연 에피소드</div>
              <div className="flex flex-wrap gap-1.5">
                {episodes.map((ep) => {
                  const linked = character.episodeIds.includes(ep.episodeNumber);
                  return (
                    <button
                      key={ep.episodeNumber}
                      type="button"
                      onClick={() => (linked ? unlinkEpisode(character.id, ep.episodeNumber) : linkEpisode(character.id, ep.episodeNumber))}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void handleEpisodeReel(ep);
                      }}
                      title={ep.reelFilePath ? '릴 파일 보기' : '릴 파일 등록'}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-xs border transition-colors cursor-pointer',
                        linked ? 'bg-accent/20 text-accent border-accent/40' : 'text-text-secondary border-bg-border hover:text-text-primary',
                      )}
                    >
                      {getEpisodeDisplayName(ep)}
                    </button>
                  );
                })}
                {episodes.length === 0 && <span className="text-xs text-text-secondary/60">등록된 에피소드가 없어요</span>}
              </div>
            </div>

            {/* 복장 갤러리 */}
            <div className="flex flex-col gap-2">
              <div className="text-xs text-text-secondary">디자인 (복장)</div>
              <div ref={galleryRef} className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
                {costumes.map((c) => (
                  <CostumeThumbCard
                    key={c.id}
                    costume={c}
                    selected={activeCostumeId === c.id}
                    onSelect={() => setActiveCostumeId(c.id)}
                    onDelete={() => deleteCostume(c.id)}
                    onImageContextMenu={(event) => {
                      setActiveCostumeId(c.id);
                      setImageMenu({ costumeId: c.id, x: event.clientX, y: event.clientY });
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleAddCostume}
                  aria-label="디자인 추가"
                  className="w-[104px] shrink-0 aspect-[3/4] flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-bg-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <Plus size={20} />
                  <span className="text-xs">디자인 추가</span>
                </button>
              </div>
            </div>

            {/* 선택 복장 진행 상세 */}
            {activeCostume ? (
              <CostumeDetail
                character={character}
                costume={activeCostume}
                onPickFolder={handlePickFolder}
                onPickFile={() => handlePickFile(activeCostume)}
              />
            ) : (
              <div className="text-center text-text-secondary text-sm py-10 border border-dashed border-bg-border rounded-lg">
                복장이 없습니다. "디자인 추가"로 첫 복장을 만들어보세요.
              </div>
            )}
          </div>
        </div>
      </div>

      {imageMenu && menuCostume && (
        <CharacterImageContextMenu
          x={imageMenu.x}
          y={imageMenu.y}
          background={menuCostume.imageBackground}
          hasImage={!!menuCostume.featuredImageUrl}
          hasFolder={!!character.workFolderPath}
          hasFile={!!menuCostume.workFilePath}
          onClose={() => setImageMenu(null)}
          onBackground={(background: CharacterImageBackground) => updateCostumeField(menuCostume.id, { imageBackground: background })}
          onEditFit={() => setFitEditorCostumeId(menuCostume.id)}
          onCopyImage={() => copyCharacterImage(menuCostume.featuredImageUrl)}
          onOpenFolder={() => openStoredPath(character.workFolderPath, '작업 폴더')}
          onOpenFile={() => openStoredPath(menuCostume.workFilePath, '작업 파일')}
        />
      )}
      {fitEditorCostume?.featuredImageUrl && (
        <CharacterImageFitEditor
          url={fitEditorCostume.featuredImageUrl}
          alt={fitEditorCostume.name}
          background={fitEditorCostume.imageBackground}
          fit={fitEditorCostume.imageFit}
          onCommit={(fit: CharacterImageFit) => updateCostumeField(fitEditorCostume.id, { imageFit: fit })}
          onClose={() => setFitEditorCostumeId(null)}
        />
      )}
      {lightboxCostumeId && imageEntries.length > 0 && (
        <CharacterImageLightbox
          entries={imageEntries}
          initialCostumeId={lightboxCostumeId}
          onClose={() => setLightboxCostumeId(null)}
          onFitCommit={(costumeId, fit) => updateCostumeField(costumeId, { imageFit: fit })}
          onCopyImage={(url) => copyCharacterImage(url)}
        />
      )}
    </div>
  );
}

/** 카드 클릭 → 오버레이 + 좌측 목록 / 우측 상세. */
function CharacterDetailModal({
  initialCharacterId,
  onClose,
}: {
  initialCharacterId: string;
  onClose: () => void;
}) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);
  const [selectedId, setSelectedId] = useState(initialCharacterId);

  const [commentOpen, setCommentOpen] = useState(true);
  const [commentCount, setCommentCount] = useState(0);
  // 캐릭터를 바꾸면 댓글 수 배지를 리셋(새 캐릭터 패널이 onCountChange 로 다시 채움).
  useEffect(() => { setCommentCount(0); }, [selectedId]);

  const selected = activeCharacters.find((c) => c.id === selectedId) ?? null;
  useEffect(() => {
    if (selected) return;
    if (activeCharacters.length > 0) setSelectedId(activeCharacters[0].id);
    else onClose();
  }, [selected, activeCharacters, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex items-stretch gap-3 h-[88vh] max-w-full max-h-full overflow-x-auto overflow-y-hidden" onClick={(e) => e.stopPropagation()}>
        <div
          className="relative flex bg-bg-card border border-bg-border overflow-hidden w-[1024px] shrink-0 h-full"
          style={{ borderRadius: 18, boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}
        >
          {/* 배경 글로우 */}
          <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            <div className="absolute" style={{ top: -100, left: -100, width: 400, height: 400, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent) / 0.16) 0%, transparent 60%)', filter: 'blur(40px)' }} />
            <div className="absolute" style={{ bottom: -150, right: -100, width: 500, height: 500, borderRadius: 999, background: 'radial-gradient(circle, rgb(var(--color-accent-sub) / 0.12) 0%, transparent 60%)', filter: 'blur(50px)' }} />
          </div>

          {/* 좌측 목록 */}
          <aside className="relative z-[1] w-[200px] shrink-0 border-r border-bg-border/60 flex flex-col min-h-0">
            <div className="px-3 py-3 border-b border-bg-border/40 shrink-0">
              <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary cursor-pointer">
                <X size={15} /> 닫기
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
              {activeCharacters.map((c) => (
                <CharacterListRow key={c.id} character={c} costumes={byCharacter.get(c.id) ?? []} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
              ))}
            </div>
          </aside>

          {/* 우측 상세 */}
          <main className="relative z-[1] flex-1 min-w-0">
            {selected && (
              <CharacterDetailPanel
                character={selected}
                onClose={onClose}
                commentOpen={commentOpen}
                onToggleComment={() => setCommentOpen((v) => !v)}
                commentCount={commentCount}
              />
            )}
          </main>
        </div>

        {/* 댓글 패널 — 씬 상세모달과 동일한 리사이즈 패널(char:{id} 스레드). 열기/닫기 + 드래그 너비 조절. */}
        {commentOpen && selected && (
          <CommentPanelResizable
            key={selected.id}
            sceneKey={`char:${selected.id}`}
            characterThread={{ characterId: selected.id, characterName: selected.name }}
            headerTitle="이 캐릭터에 대한 이야기"
            sceneLabel={selected.name}
            commentCount={commentCount}
            onCountChange={setCommentCount}
            heightClass="h-full"
            className="rounded-[18px]"
            headerRight={
              <button type="button" onClick={() => setCommentOpen(false)} aria-label="댓글 닫기" title="댓글 닫기" className="text-text-secondary hover:text-text-primary cursor-pointer">
                <X size={15} />
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}

function AddCharacterModal({ onClose }: { onClose: () => void }) {
  const addCharacter = useCharacterBoardStore((s) => s.addCharacter);
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const created = await addCharacter(name.trim(), memo.trim() || undefined);
    setSaving(false);
    if (created) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-primary">캐릭터 추가</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">이름</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="캐릭터 이름" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">메모 (선택)</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="메모" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50 resize-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button type="button" onClick={submit} disabled={!name.trim() || saving} className="px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50 cursor-pointer">추가</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer', active ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/40')}
    >
      {children}
    </button>
  );
}

function CharacterGrid({ onAdd, pendingOpenId, onConsumeOpen }: { onAdd: () => void; pendingOpenId?: string | null; onConsumeOpen?: () => void }) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const loadError = useCharacterBoardStore((s) => s.loadError);
  const reload = useCharacterBoardStore((s) => s.load);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const detailCharacter = useMemo(() => characters.find((c) => c.id === detailId) ?? null, [characters, detailId]);
  useEffect(() => { if (detailId && !detailCharacter) setDetailId(null); }, [detailId, detailCharacter]);

  // 에피소드 에셋 탭의 '캐릭터 현황판에서 보기' → 해당 캐릭터 상세 자동 오픈.
  useEffect(() => {
    if (pendingOpenId) { setDetailId(pendingOpenId); onConsumeOpen?.(); }
  }, [pendingOpenId, onConsumeOpen]);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const arr of byCharacter.values()) for (const c of arr) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [byCharacter]);

  function characterTags(characterId: string): Set<string> {
    const set = new Set<string>();
    for (const c of byCharacter.get(characterId) ?? []) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return set;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeCharacters.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (activeTags.length > 0) { const tags = characterTags(c.id); if (!activeTags.every((t) => tags.has(t))) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacters, query, activeTags, byCharacter]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  if (!loaded) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
          <span className="text-sm text-text-secondary">캐릭터 현황판을 불러오지 못했어요.</span>
          <button
            type="button"
            onClick={() => { void reload(); }}
            className="px-3 py-1.5 rounded-lg border border-bg-border text-xs text-text-primary hover:border-accent/50 hover:bg-bg-border/30 transition-colors cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/60" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 검색" className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
          </div>
          <button type="button" onClick={onAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 shrink-0 cursor-pointer">
            <Plus size={16} /> 캐릭터 추가
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((t) => <TagPill key={t} tag={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)} />)}
            {activeTags.length > 0 && (
              <button type="button" onClick={() => setActiveTags([])} className="text-xs text-text-secondary/70 hover:text-text-primary px-1.5 cursor-pointer">필터 해제</button>
            )}
          </div>
        )}
      </div>

      {activeCharacters.length === 0 ? (
        <div className="text-center text-text-secondary py-16">아직 캐릭터가 없습니다. "캐릭터 추가"로 시작해보세요.</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-text-secondary py-16">조건에 맞는 캐릭터가 없어요. 검색어나 태그 필터를 바꿔보세요.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {filtered.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              costumes={byCharacter.get(c.id) ?? []}
              onOpen={() => setDetailId(c.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (c.workFolderPath) void openStoredPath(c.workFolderPath, '작업 폴더');
                else toast.info('상세 화면에서 작업 폴더를 먼저 등록해주세요');
              }}
            />
          ))}
        </div>
      )}

      {detailCharacter && <CharacterDetailModal initialCharacterId={detailCharacter.id} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export function CharacterBoardView() {
  const load = useCharacterBoardStore((s) => s.load);
  const startRealtime = useCharacterBoardStore((s) => s.startRealtime);

  const [tab, setTab] = useState<BoardTab>('board');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    const stop = startRealtime();
    return () => { stop(); };
  }, [load, startRealtime]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">캐릭터 현황판</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {tab === 'board' ? '캐릭터별 복장 디자인·리깅 진행 상황' : '에피소드별 등장 캐릭터·이 편 주의점·복장'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 border-b border-bg-border pb-2">
          <TabButton active={tab === 'board'} onClick={() => setTab('board')}>캐릭터 현황판</TabButton>
          <TabButton active={tab === 'episode-assets'} onClick={() => setTab('episode-assets')}>에피소드 에셋</TabButton>
        </div>
      </div>

      {tab === 'board' ? (
        <CharacterGrid onAdd={() => setAddOpen(true)} pendingOpenId={pendingOpenId} onConsumeOpen={() => setPendingOpenId(null)} />
      ) : (
        <EpisodeAssetBoard onOpenCharacter={(id) => { setTab('board'); setPendingOpenId(id); }} />
      )}

      {addOpen && <AddCharacterModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

export default CharacterBoardView;
