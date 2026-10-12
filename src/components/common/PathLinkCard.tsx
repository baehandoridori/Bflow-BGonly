import type { ReactNode, Ref } from 'react';
import { ExternalLink, File, Folder, FolderPlus, Link2, Loader2, Pencil, Unlink } from 'lucide-react';
import { cn } from '@/utils/cn';
import { splitPathForDisplay } from '@/utils/pathDisplay';

export interface PathLinkCardProps {
  kind: 'folder' | 'file';
  /** 칸 이름 — '작업 폴더', '대표 파일' 등. */
  label: string;
  path: string | null | undefined;
  /** 아이콘 칸의 색(부서 색 등). 없으면 액센트. */
  tone?: string;
  onOpen: () => void;
  opening?: boolean;
  /** 연결(비어 있을 때)·수정(연결돼 있을 때). 같은 동작이라 핸들러와 ref 를 함께 쓴다. */
  onEdit: () => void;
  editButtonRef?: Ref<HTMLButtonElement>;
  /** 저장·만들기가 도는 중 — 연결·수정·해제를 잠근다. */
  busy?: boolean;
  /** 연결·수정을 할 수 없는 사유(씬 데이터 없음 등). 비어 있는 칸에서는 버튼 대신 이 글을 보인다. */
  lockedReason?: string;
  /** 연결만 지운다(실제 폴더·파일은 그대로). 없으면 해제 버튼을 두지 않는다. */
  onUnlink?: () => void;
  /** 비어 있는 칸에서 폴더를 만들어 연결 — 주면 '만들기' 버튼이 생긴다. */
  onCreate?: () => void;
  createTitle?: string;
  /** 버튼 줄 아래에 붙는 것 — 경고 표시, 경로 붙여넣기 칸 등. */
  children?: ReactNode;
}

const TEXT_BUTTON =
  'inline-flex h-[30px] shrink-0 items-center gap-1 rounded-md border border-text-secondary/30 px-2.5 text-xs text-text-primary transition-colors hover:border-text-secondary/60 hover:bg-text-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-45';
const ICON_BUTTON =
  'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-45';

/**
 * 연결된 폴더·파일 한 칸 — 씬 상세의 '작업 링크'와 캐릭터 현황판의 '작업 경로'가 함께 쓴다.
 *
 * 버튼은 쓰는 빈도 순서로 놓고 무게도 그 순서로 준다(글자 수가 크기를 정하지 않게):
 *   열기 — 남는 폭을 다 쓰는 글자 버튼 / 수정 — 테두리 있는 아이콘 / 해제 — 테두리 없는 아이콘(올리면 빨강).
 * 경로는 이름(크게)과 위치(흐리게) 두 줄로 나눠 보인다 — 한 줄로 두면 길 때 이름이 잘린다.
 */
export function PathLinkCard({
  kind,
  label,
  path,
  tone,
  onOpen,
  opening = false,
  onEdit,
  editButtonRef,
  busy = false,
  lockedReason,
  onUnlink,
  onCreate,
  createTitle,
  children,
}: PathLinkCardProps) {
  const Icon = kind === 'folder' ? Folder : File;
  const linked = !!path?.trim();
  const { name, location } = splitPathForDisplay(path);

  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border px-3 py-2.5',
        linked ? 'border-bg-border/60 bg-bg-primary/30' : 'border-dashed border-bg-border/70',
      )}
    >
      {linked ? (
        <>
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/25 text-accent"
              style={tone ? { color: tone } : undefined}
            >
              <Icon size={15} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-text-secondary">{label}</div>
              {/* 이름이 잘렸을 때 올리면 이름 전체가 뜬다 — 전체 경로는 위치 줄과 '열기'가 맡는다. */}
              <div className="truncate text-[13px] font-medium text-text-primary" title={name}>{name}</div>
              {/* 위치는 넘치면 앞쪽을 줄인다(글 방향을 뒤집어 말줄임이 앞에 오게) — 이름에 가까운 폴더가 더 쓸모 있다. */}
              {location && (
                <div className="truncate text-left text-[11px] text-text-secondary/80 [direction:rtl]" title={path ?? undefined}>
                  <bdi dir="ltr">{location}</bdi>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              disabled={opening}
              title={path ?? undefined}
              className="inline-flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent/15 text-xs font-medium text-text-primary transition-colors hover:bg-accent/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-45"
            >
              {opening ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ExternalLink size={14} aria-hidden />}
              열기
            </button>
            <button
              ref={editButtonRef}
              type="button"
              onClick={onEdit}
              disabled={busy || !!lockedReason}
              aria-label={`${label} 수정`}
              title={lockedReason ?? '수정 — 다른 경로로 바꿔요'}
              className={cn(ICON_BUTTON, 'border border-bg-border hover:border-text-secondary/50 hover:text-text-primary focus-visible:ring-accent/45')}
            >
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Pencil size={13} aria-hidden />}
            </button>
            {onUnlink && (
              <button
                type="button"
                onClick={onUnlink}
                disabled={busy}
                aria-label={`${label} 연결 해제`}
                title="연결 해제 — 실제 폴더·파일은 그대로예요"
                className={cn(ICON_BUTTON, 'hover:bg-red-500/12 hover:text-red-300 focus-visible:ring-red-400/45')}
              >
                <Unlink size={13} aria-hidden />
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-bg-border/70 text-text-secondary/70">
            <Icon size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-20">
            <div className="text-[11px] text-text-secondary">{label}</div>
            <div className="truncate text-[11.5px] text-text-secondary/60">{lockedReason ?? '아직 연결 안 됨'}</div>
          </div>
          {!lockedReason && (
            <div className="flex shrink-0 items-center gap-1.5">
              {onCreate && (
                <button type="button" onClick={onCreate} disabled={busy} title={createTitle} className={TEXT_BUTTON}>
                  {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FolderPlus size={13} aria-hidden />}
                  만들기
                </button>
              )}
              <button
                ref={editButtonRef}
                type="button"
                onClick={onEdit}
                disabled={busy}
                title={`${label} 경로를 골라 연결해요`}
                className={TEXT_BUTTON}
              >
                {busy && !onCreate ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Link2 size={13} aria-hidden />}
                연결
              </button>
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
