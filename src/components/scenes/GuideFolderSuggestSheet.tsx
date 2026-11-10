// 가이드 그림 작업 폴더 제안 창 — 화면 아래에서 올라오는 시트(설계 2026-11-10 5절).
// 틀은 BulkWorkLinkDialog 와 같다(명령형 show + 호스트 + 네이티브 <dialog>). 다른 점: 떠 있으면 내용을 바꾸고, 바깥을 눌러도 닫지 않는다.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ExternalLink, FolderSearch, Loader2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useMotionPref } from '@/hooks/useMotionPref';
import { openWorkPath } from '@/services/sceneWorkLinkService';
import { offerBulkWorkLink } from '@/services/sceneBulkWorkLinkActions';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { cn } from '@/utils/cn';
import {
  GUIDE_FOLDER_TEXT, displayPathParts, guideFolderMismatchText, guideFolderSourceLine, guideFolderTitle, leafName, samePath,
} from '@/utils/guideFolderSuggest';
import { reconcileCurrentFolder, suggestionMode, type GuideFolderSuggestion } from '@/utils/guideFolderSuggestBuild';
import { animateEl } from '@/utils/motion';
import { findSceneLocation } from '@/utils/sceneBulkWorkLink';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';
import { flashWorkLinks } from '@/utils/workLinkFlash';

type Shown = { suggestion: GuideFolderSuggestion; version: number };

let externalShow: ((suggestion: GuideFolderSuggestion) => void) | null = null;
/** 지금 창이 떠 있는가 — 호스트가 띄울 때 켜고 창이 다 닫히면 끈다. */
let openNow = false;

export const GuideFolderSuggestSheet = {
  isOpen: (): boolean => openNow,
  /** 제안을 띄운다. 이미 떠 있으면 내용만 새 제안으로 바꾼다(다시 올라오지 않는다, 설계 4.9). */
  show(suggestion: GuideFolderSuggestion): void {
    if (!externalShow) {
      console.warn('[GuideFolderSuggestSheet] 호스트가 없어 제안을 건너뜁니다');
      return;
    }
    externalShow(suggestion);
  },
};

export function GuideFolderSuggestSheetHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    externalShow = (next) => {
      openNow = true;
      setShown((prev) => ({ suggestion: next, version: (prev?.version ?? 0) + 1 }));
    };
    return () => { externalShow = null; openNow = false; };
  }, []);
  if (!shown) return null;
  const closed = (after: (() => void) | null) => {
    openNow = false;
    setShown(null);
    // 창이 화면에서 빠진 뒤 — 다른 창이 떠 있으면 스스로 건너뛰는 '한꺼번에 연결'이 이 창을 보지 않게.
    if (after) window.setTimeout(after, 0);
  };
  return <GuideFolderSheetWindow suggestion={shown.suggestion} version={shown.version} onClosed={closed} />;
}

/** 뒤에 깔린 상세 창이 창 단위(window)로 듣는 단축키·붙여넣기에 닿지 않게 한다. */
const stop = (event: React.SyntheticEvent) => { event.stopPropagation(); };

/** 닫힘 움직임이 끝나기를 이보다 오래 기다리지 않는다(시트 180ms + 여유). */
const CLOSE_FALLBACK_MS = 260;

function PathBox({ path, muted = false }: { path: string; muted?: boolean }) {
  const { head, leaf } = displayPathParts(path);
  return (
    <div
      title={path}
      className={cn(
        'min-w-0 flex-1 break-all rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-[12px] leading-relaxed',
        muted && 'line-through opacity-55',
      )}
    >
      {head.length > 0 && <span className="text-text-secondary">{`${head.join(' › ')} › `}</span>}
      <span className="font-semibold text-text-primary">{leaf}</span>
    </div>
  );
}

function GuideFolderSheetWindow({
  suggestion, version, onClosed,
}: { suggestion: GuideFolderSuggestion; version: number; onClosed: (after: (() => void) | null) => void }) {
  const { reduce } = useMotionPref();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [view, setView] = useState(suggestion);
  const [selected, setSelected] = useState(0);
  const [clipChecked, setClipChecked] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [closing, setClosing] = useState(false);
  // await 뒤에 읽는 값은 지금 값이어야 한다 — 상태가 아닌 ref 로 본다.
  const savingRef = useRef(false);
  // 이미 저장한 작업 폴더 경로 — 대표 파일만 실패했을 때 다시 시도가 폴더를 건너뛰는 기준. 다른 후보로 바꿔 저장되지 않게 경로로 쥔다.
  const savedFolderRef = useRef<string | null>(null);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const closingRef = useRef(false);

  // 새 제안이 들어오면 내용만 갈아 끼운다.
  useEffect(() => {
    setView(suggestion);
    setSelected(0);
    setClipChecked(true);
    setPhase('idle');
    savingRef.current = false;
    savedFolderRef.current = null;
    setSavedFolder(null);
  }, [suggestion, version]);

  const previousRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      previousRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
    primaryRef.current?.focus();
    return () => {
      const previous = previousRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const stopPasteAtWindow = (pasted: ClipboardEvent) => { pasted.stopPropagation(); };
    window.addEventListener('paste', stopPasteAtWindow, true);
    return () => window.removeEventListener('paste', stopPasteAtWindow, true);
  }, []);
  useEffect(() => {
    // Tab 이 마지막 버튼을 지나면 포커스가 한 번 창 밖(body)에 놓인다. 그때의 키가 뒤의 상세 창에 닿기 전에 여기서 멈춘다.
    const stopOutsideKeyAtWindow = (pressed: KeyboardEvent) => {
      if (!dialogRef.current?.contains(pressed.target as Node | null)) pressed.stopPropagation();
    };
    window.addEventListener('keydown', stopOutsideKeyAtWindow, true);
    return () => window.removeEventListener('keydown', stopOutsideKeyAtWindow, true);
  }, []);

  const close = (after: (() => void) | null) => {
    if (closingRef.current) return;
    closingRef.current = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      dialogRef.current?.close();
      onClosed(after);
    };
    if (reduce) { finish(); return; }
    setClosing(true);
    sheetRef.current?.addEventListener('animationend', finish, { once: true });
    window.setTimeout(finish, CLOSE_FALLBACK_MS);
  };

  // 다른 팀원이 실시간으로 작업 폴더를 바꾸면 다시 판정한다. 내 저장(낙관적 반영)을 남의 변경으로 오해하지 않게 저장 중·뒤엔 보지 않는다.
  const currentFolder = useSceneWorkLinkStore((state) => getSceneWorkLinkSlots(state.linkMap, view.sceneUuid, 'bg').folder?.path ?? null);
  useEffect(() => {
    if (savingRef.current || savedFolderRef.current !== null || closingRef.current) return;
    const next = reconcileCurrentFolder(view, currentFolder);
    if (next === null) { close(null); return; }
    if (next !== view) setView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder]);

  // 씬이 자료에서 사라지면(삭제 등) 저장하지 않고 닫는다.
  const sceneGone = useDataStore((state) => findSceneLocation(state.episodes, view.sceneUuid) === null);
  useEffect(() => {
    if (sceneGone && !savingRef.current) close(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneGone]);

  const mode = suggestionMode(view);
  const candidate = view.candidates[selected] ?? view.candidates[0];
  const showClip = view.offerClip && !!candidate?.clip;

  const save = async () => {
    if (savingRef.current || closingRef.current || !candidate) return;
    savingRef.current = true;
    setPhase('saving');
    const sceneUuid = view.sceneUuid;
    const userId = useAuthStore.getState().currentUser?.id ?? null;
    const slotsNow = () => getSceneWorkLinkSlots(useSceneWorkLinkStore.getState().linkMap, sceneUuid, 'bg');
    const kinds: Array<'folder' | 'primary_file'> = ['folder'];
    let clipSaved: string | null = null;
    try {
      if (!samePath(savedFolderRef.current, candidate.folder) && !samePath(slotsNow().folder?.path, candidate.folder)) {
        await useSceneWorkLinkStore.getState().upsertLink({ sceneUuid, department: 'bg', linkKind: 'folder', path: candidate.folder, userId });
      }
      savedFolderRef.current = candidate.folder;
      setSavedFolder(candidate.folder);
      const clip = showClip && clipChecked ? candidate.clip : null;
      if (clip && !slotsNow().primaryFile?.path) {
        await useSceneWorkLinkStore.getState().upsertLink({ sceneUuid, department: 'bg', linkKind: 'primary_file', path: clip, userId });
        clipSaved = clip;
        kinds.push('primary_file');
      }
    } catch (err) {
      console.warn('[GuideFolderSuggestSheet] 저장 실패', err);
      savingRef.current = false;
      setPhase('error');
      animateEl(sheetRef.current, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
      ], { duration: 260 }, reduce);
      return;
    }
    const savedToastId = toast.success(mode === 'change' ? GUIDE_FOLDER_TEXT.savedChange : GUIDE_FOLDER_TEXT.savedNew);
    flashWorkLinks({ sceneUuid, department: 'bg', kinds });
    const bulkPath = clipSaved;
    close(bulkPath
      ? () => { void offerBulkWorkLink({ sceneUuid, department: 'bg', path: bulkPath, userId, savedToastId }); }
      : null);
  };

  const openFolder = async () => {
    if (!candidate) return;
    const result = await openWorkPath(candidate.folder);
    if (!result.ok) toast.error(GUIDE_FOLDER_TEXT.openFailed);
  };

  const primaryLabel = phase === 'error'
    ? GUIDE_FOLDER_TEXT.retry
    : mode === 'change' ? GUIDE_FOLDER_TEXT.addChange : GUIDE_FOLDER_TEXT.addNew;
  const secondaryLabel = mode === 'change' ? GUIDE_FOLDER_TEXT.skipChange : GUIDE_FOLDER_TEXT.skipNew;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-text-primary backdrop:bg-transparent"
      onCancel={(event) => { event.preventDefault(); close(null); }}
      onKeyDown={stop}
      onPaste={stop}
      /* 창이 떠 있을 때 그림을 다시 끌어다 놓아도 앱 화면이 그 파일로 바뀌지 않게(기본 동작 막기). */
      onDragOver={(event) => { event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); }}
    >
      <div aria-hidden className={cn('absolute inset-0 bg-black/55 backdrop-blur-[6px]', closing ? 'bf-gfs-scrim-out' : 'bf-gfs-scrim-in')} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <div
          ref={sheetRef}
          className={cn(
            'pointer-events-auto w-[min(520px,calc(100vw-32px))] rounded-t-2xl border border-b-0 border-bg-border bg-bg-card px-5 pb-4 pt-2.5 shadow-2xl',
            closing ? 'bf-gfs-sheet-out' : 'bf-gfs-sheet-in',
          )}
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-bg-border" />
          <header className="mb-3 flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <FolderSearch size={17} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[14.5px] font-semibold leading-snug text-text-primary">{guideFolderTitle(mode, view.guessed)}</h2>
              <p className="mt-0.5 text-[11.5px] text-text-secondary">
                {guideFolderSourceLine({ method: view.method, fileName: view.fileName, guessed: view.guessed })}
              </p>
            </div>
          </header>

          {mode === 'change' && view.currentFolder && (
            <>
              <p className="mb-1 text-[11px] text-text-secondary">{GUIDE_FOLDER_TEXT.current}</p>
              <div className="flex"><PathBox path={view.currentFolder} muted /></div>
              <div className="my-1 flex justify-center text-text-secondary"><ArrowDown size={14} aria-hidden /></div>
              <p className="mb-1 text-[11px] text-text-secondary">{GUIDE_FOLDER_TEXT.next}</p>
            </>
          )}

          {view.candidates.length > 1 ? (
            <fieldset className="min-w-0 border-0 p-0">
              <div className="flex flex-col gap-1.5">
                {view.candidates.map((item, index) => (
                  <label key={item.folder} className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="radio"
                      name={`${titleId}-candidate`}
                      className="h-4 w-4 shrink-0 accent-accent"
                      checked={index === selected}
                      disabled={savedFolder !== null}
                      onChange={() => setSelected(index)}
                    />
                    <PathBox path={item.folder} />
                  </label>
                ))}
              </div>
              <p className="ml-6 mt-1 text-[11px] text-text-secondary">{GUIDE_FOLDER_TEXT.candidatesNote}</p>
            </fieldset>
          ) : candidate ? (
            <div className="flex"><PathBox path={candidate.folder} /></div>
          ) : null}

          {view.mismatch && (
            <div className="mt-2.5 flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11.5px] leading-snug text-amber-200">
              <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
              <span>{guideFolderMismatchText(view.sceneId)}</span>
            </div>
          )}

          {showClip && candidate?.clip && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-text-primary">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={clipChecked} onChange={(event) => setClipChecked(event.target.checked)} />
              {GUIDE_FOLDER_TEXT.clipLabel}
              <span className="text-text-secondary">· {leafName(candidate.clip)}</span>
            </label>
          )}

          {phase === 'error' && (
            <p role="alert" className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-red-300">
              <WifiOff size={13} aria-hidden />
              {GUIDE_FOLDER_TEXT.saveFailed}
            </p>
          )}

          <footer className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => { void openFolder(); }}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
            >
              <ExternalLink size={13} aria-hidden />
              {GUIDE_FOLDER_TEXT.openFolder}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => close(null)}
                className="h-8 rounded-lg border border-bg-border px-3.5 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-white/5"
              >
                {secondaryLabel}
              </button>
              <button
                ref={primaryRef}
                type="button"
                onClick={() => { void save(); }}
                disabled={phase === 'saving'}
                className="bf-gfs-primary flex h-8 items-center gap-1.5 rounded-lg bg-accent text-on-accent px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-80"
              >
                {phase === 'saving' && <Loader2 size={13} className="animate-spin" aria-hidden />}
                {phase === 'saving' ? GUIDE_FOLDER_TEXT.saving : primaryLabel}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
