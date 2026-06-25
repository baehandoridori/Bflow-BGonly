import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clipboard,
  ExternalLink,
  File,
  Folder,
  Link2,
  Loader2,
  MousePointerClick,
  Pencil,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import {
  chooseWorkFile,
  chooseWorkFolder,
  openWorkPath,
  pathExists as checkPathExists,
} from '@/services/sceneWorkLinkService';
import { cn } from '@/utils/cn';
import {
  getUniqueSceneUuids,
  getSceneWorkLinkSlots,
  getWorkLinkWarnings,
  type WorkLinkWarning,
} from '@/utils/sceneWorkLinks';
import type { Scene, SceneWorkLink, SceneWorkLinkDepartment } from '@/types';

type SlotKind = 'folder' | 'primary_file';

export interface SceneWorkLinksPanelProps {
  bgScene: Scene | null;
  actScene: Scene | null;
  visibleDepartments: SceneWorkLinkDepartment[];
}

const DEPT_META: Record<SceneWorkLinkDepartment, { label: string; shortLabel: string; tone: string }> = {
  bg: { label: '배경', shortLabel: 'BG', tone: 'rgb(var(--color-accent))' },
  acting: { label: '액팅', shortLabel: 'ACT', tone: '#E17055' },
};

const KIND_META: Record<SlotKind, { label: string; Icon: typeof Folder }> = {
  folder: { label: '작업 폴더', Icon: Folder },
  primary_file: { label: '대표 파일', Icon: File },
};

const WARNING_TEXT: Record<WorkLinkWarning | 'missing_path', string> = {
  personal_path: '개인 경로일 수 있음',
  maybe_not_file: '파일이 아닌 경로일 수 있음',
  maybe_not_folder: '폴더가 아닌 경로일 수 있음',
  missing_path: '이 PC에서 확인 안 됨',
};

export function SceneWorkLinksPanel({
  bgScene,
  actScene,
  visibleDepartments,
}: SceneWorkLinksPanelProps) {
  const linkMap = useSceneWorkLinkStore((state) => state.linkMap);
  const loadForSceneUuids = useSceneWorkLinkStore((state) => state.loadForSceneUuids);
  const departments = useMemo(
    () => visibleDepartments.filter((dept, index, arr) => arr.indexOf(dept) === index),
    [visibleDepartments],
  );
  const sceneUuidKey = useMemo(
    () => getUniqueSceneUuids([bgScene, actScene]).join('|'),
    [actScene, bgScene],
  );

  useEffect(() => {
    if (!sceneUuidKey) return;
    const sceneUuids = sceneUuidKey.split('|').filter(Boolean);
    void loadForSceneUuids(sceneUuids).catch((err) => {
      console.warn('[SceneWorkLinks] 패널 링크 로드 실패', err);
    });
  }, [loadForSceneUuids, sceneUuidKey]);

  if (departments.length === 0) return null;

  return (
    <section className="mb-5 rounded-lg border border-bg-border/55 bg-bg-card/35 overflow-visible">
      <div className="flex items-center justify-between border-b border-bg-border/45 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-text-secondary" aria-hidden />
          <span className="text-xs font-semibold text-text-primary">작업 링크</span>
        </div>
        <span className="text-[10.5px] text-text-secondary/70">경로만 저장</span>
      </div>

      <div className="divide-y divide-bg-border/35">
        {departments.map((department) => {
          const scene = department === 'bg' ? bgScene : actScene;
          const slots = getSceneWorkLinkSlots(linkMap, scene?.id, department);
          return (
            <DepartmentBlock
              key={department}
              department={department}
              scene={scene}
              folder={slots.folder}
              primaryFile={slots.primaryFile}
            />
          );
        })}
      </div>
    </section>
  );
}

function DepartmentBlock({
  department,
  scene,
  folder,
  primaryFile,
}: {
  department: SceneWorkLinkDepartment;
  scene: Scene | null;
  folder?: SceneWorkLink;
  primaryFile?: SceneWorkLink;
}) {
  const meta = DEPT_META[department];
  return (
    <div className="px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex h-5 min-w-9 items-center justify-center rounded px-1.5 text-[10px] font-bold"
          style={{
            color: meta.tone,
            backgroundColor: `color-mix(in oklab, ${meta.tone} 15%, transparent)`,
          }}
        >
          {meta.shortLabel}
        </span>
        <span className="text-[11.5px] font-medium text-text-primary">{meta.label}</span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <WorkLinkRow department={department} scene={scene} linkKind="folder" link={folder} />
        <WorkLinkRow department={department} scene={scene} linkKind="primary_file" link={primaryFile} />
      </div>
    </div>
  );
}

function WorkLinkRow({
  department,
  scene,
  linkKind,
  link,
}: {
  department: SceneWorkLinkDepartment;
  scene: Scene | null;
  linkKind: SlotKind;
  link?: SceneWorkLink;
}) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const upsertLink = useSceneWorkLinkStore((state) => state.upsertLink);
  const deleteLink = useSceneWorkLinkStore((state) => state.deleteLink);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);

  const kindMeta = KIND_META[linkKind];
  const Icon = kindMeta.Icon;
  const canEdit = !!scene?.id;
  const warningKeys = useMemo(() => {
    if (!link?.path) return [] as Array<WorkLinkWarning | 'missing_path'>;
    const warnings: Array<WorkLinkWarning | 'missing_path'> = [
      ...getWorkLinkWarnings(link.path, linkKind),
    ];
    if (exists === false) warnings.push('missing_path');
    return warnings;
  }, [exists, link?.path, linkKind]);

  useEffect(() => {
    let cancelled = false;
    setExists(null);
    if (!link?.path) return () => { cancelled = true; };
    void checkPathExists(link.path).then((result) => {
      if (!cancelled) setExists(result);
    }).catch(() => {
      if (!cancelled) setExists(false);
    });
    return () => { cancelled = true; };
  }, [link?.path]);

  const savePath = async (nextPath: string) => {
    const trimmed = nextPath.trim();
    if (!scene?.id || !trimmed) return;
    setSaving(true);
    try {
      await upsertLink({
        sceneUuid: scene.id,
        department,
        linkKind,
        path: trimmed,
        userId: currentUser?.id ?? null,
      });
      setPasteOpen(false);
      setMenuOpen(false);
      toast.success(link ? '작업 링크를 변경했습니다' : '작업 링크를 연결했습니다');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`작업 링크 저장 실패: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleChoose = async () => {
    const selected = linkKind === 'folder' ? await chooseWorkFolder() : await chooseWorkFile();
    if (selected) await savePath(selected);
  };

  const handlePaste = () => {
    setDraftPath(link?.path ?? '');
    setPasteOpen(true);
    setMenuOpen(false);
  };

  const handleOpen = async () => {
    if (!link?.path) return;
    setOpening(true);
    try {
      const result = await openWorkPath(link.path);
      if (!result.ok) {
        toast.error(linkKind === 'folder' ? '이 PC에서 폴더를 찾을 수 없음' : '이 PC에서 파일을 찾을 수 없음');
      }
    } finally {
      setOpening(false);
    }
  };

  const handleUnlink = async () => {
    if (!scene?.id || !link) return;
    const ok = await ConfirmDialog.show({
      message: '이 작업 링크를 해제할까요?\n실제 파일이나 폴더는 삭제되지 않고, Bflow에 저장된 연결만 사라집니다.',
      confirmLabel: '링크 해제',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteLink(scene.id, department, linkKind);
      toast.success('작업 링크를 해제했습니다');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`작업 링크 해제 실패: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-bg-border/45 bg-bg-primary/30 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
            link
              ? 'border-current/25'
              : 'border-bg-border/60 text-text-secondary/45',
          )}
          style={link ? { color: DEPT_META[department].tone } : undefined}
        >
          <Icon size={15} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-text-primary">{kindMeta.label}</div>
              <div
                className={cn(
                  'mt-0.5 truncate text-[10.5px]',
                  link ? 'text-text-secondary' : 'text-text-secondary/45',
                )}
                title={link?.path ?? undefined}
              >
                {link?.path ?? (canEdit ? '연결된 경로 없음' : '씬 데이터 없음')}
              </div>
            </div>

            <div className="relative flex shrink-0 items-center gap-1">
              {link && (
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={opening}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-200 hover:bg-white/8 hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/45 disabled:opacity-45"
                  aria-label={`${kindMeta.label} 열기`}
                  title="열기"
                >
                  {opening ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ExternalLink size={14} aria-hidden />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                disabled={!canEdit || saving}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/45',
                  canEdit
                    ? 'bg-white/6 text-text-primary hover:bg-white/10 cursor-pointer'
                    : 'bg-white/4 text-text-secondary/40 cursor-not-allowed',
                )}
              >
                {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : link ? <Pencil size={12} aria-hidden /> : <Link2 size={12} aria-hidden />}
                {link ? '변경' : '연결'}
              </button>
              {link && (
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={saving}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-200 hover:bg-red-500/12 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/45 disabled:opacity-45"
                  aria-label={`${kindMeta.label} 링크 해제`}
                  title="링크 해제"
                >
                  <Unlink size={13} aria-hidden />
                </button>
              )}

              {menuOpen && (
                <div className="absolute right-0 top-8 z-30 w-40 overflow-hidden rounded-md border border-bg-border bg-bg-card shadow-xl">
                  <button
                    type="button"
                    onClick={handleChoose}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-text-primary transition-colors hover:bg-white/8"
                  >
                    <MousePointerClick size={13} aria-hidden />
                    선택창으로 고르기
                  </button>
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-text-primary transition-colors hover:bg-white/8"
                  >
                    <Clipboard size={13} aria-hidden />
                    경로 붙여넣기
                  </button>
                </div>
              )}
            </div>
          </div>

          {warningKeys.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {warningKeys.map((warning) => (
                <span
                  key={warning}
                  className="inline-flex items-center gap-1 rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200"
                >
                  <AlertTriangle size={10} aria-hidden />
                  {WARNING_TEXT[warning]}
                </span>
              ))}
            </div>
          )}

          {pasteOpen && (
            <div className="mt-2 flex gap-1.5">
              <input
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void savePath(draftPath);
                  if (event.key === 'Escape') setPasteOpen(false);
                }}
                placeholder="G:\\공유 드라이브\\..."
                className="h-8 min-w-0 flex-1 rounded-md border border-bg-border bg-bg-primary px-2 text-[11.5px] text-text-primary outline-none transition-colors focus:border-accent/60"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void savePath(draftPath)}
                disabled={!draftPath.trim() || saving}
                className="h-8 rounded-md bg-accent px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-sub focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-45"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="h-8 rounded-md px-2 text-[11px] text-text-secondary transition-colors hover:bg-white/8 hover:text-text-primary"
              >
                취소
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
