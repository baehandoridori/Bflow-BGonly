import { File, Folder } from 'lucide-react';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { cn } from '@/utils/cn';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';
import type { SceneWorkLinkDepartment } from '@/types';

type BadgeMode = 'card-all' | 'card-bg' | 'card-acting' | 'sheet-all' | 'sheet-bg' | 'sheet-acting';
type SlotKind = 'folder' | 'primary_file';

const DEPARTMENT_TONE: Record<SceneWorkLinkDepartment, string> = {
  bg: 'rgb(var(--color-accent))',
  acting: '#E17055',
};

const DEPARTMENT_LABEL: Record<SceneWorkLinkDepartment, string> = {
  bg: 'BG',
  acting: 'ACT',
};

export function SceneWorkLinkBadges({
  bgSceneUuid,
  actSceneUuid,
  mode,
  className,
}: {
  bgSceneUuid?: string | null;
  actSceneUuid?: string | null;
  mode: BadgeMode;
  className?: string;
}) {
  const linkMap = useSceneWorkLinkStore((state) => state.linkMap);
  const isSheet = mode.startsWith('sheet');
  const showBg = mode.endsWith('all') || mode.endsWith('bg');
  const showActing = mode.endsWith('all') || mode.endsWith('acting');

  const bgSlots = getSceneWorkLinkSlots(linkMap, bgSceneUuid, 'bg');
  const actSlots = getSceneWorkLinkSlots(linkMap, actSceneUuid, 'acting');

  const bgGroup = showBg ? (
    <DepartmentIconGroup
      key="bg"
      department="bg"
      folderLinked={!!bgSlots.folder}
      fileLinked={!!bgSlots.primaryFile}
      compact={isSheet}
    />
  ) : null;
  const actGroup = showActing ? (
    <DepartmentIconGroup
      key="acting"
      department="acting"
      folderLinked={!!actSlots.folder}
      fileLinked={!!actSlots.primaryFile}
      compact={isSheet}
    />
  ) : null;

  if (isSheet) {
    return (
      <div
        className={cn(
          'pointer-events-none inline-flex flex-col items-center gap-0.5 rounded-md border border-bg-border/50 bg-bg-card/92 p-0.5 shadow-sm',
          className,
        )}
        aria-label="작업 링크 배지"
      >
        {bgGroup}
        {actGroup}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 rounded-md border border-bg-border/55 bg-bg-primary/82 px-1.5 py-1 shadow-sm',
        className,
      )}
      aria-label="작업 링크 배지"
    >
      {bgGroup}
      {showBg && showActing && <span className="h-4 w-px bg-bg-border/60" />}
      {actGroup}
    </div>
  );
}

function DepartmentIconGroup({
  department,
  folderLinked,
  fileLinked,
  compact,
}: {
  department: SceneWorkLinkDepartment;
  folderLinked: boolean;
  fileLinked: boolean;
  compact: boolean;
}) {
  return (
    <div className={cn('inline-flex items-center', compact ? 'gap-0.5' : 'gap-1')}>
      <WorkLinkIcon department={department} kind="folder" linked={folderLinked} compact={compact} />
      <WorkLinkIcon department={department} kind="primary_file" linked={fileLinked} compact={compact} />
    </div>
  );
}

function WorkLinkIcon({
  department,
  kind,
  linked,
  compact,
}: {
  department: SceneWorkLinkDepartment;
  kind: SlotKind;
  linked: boolean;
  compact: boolean;
}) {
  const Icon = kind === 'folder' ? Folder : File;
  const tone = DEPARTMENT_TONE[department];
  const kindLabel = kind === 'folder' ? '작업 폴더' : '대표 파일';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-[4px] border transition-colors duration-200',
        compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
        linked ? 'border-current/25' : 'border-bg-border/55 text-text-secondary/35',
      )}
      style={linked ? {
        color: tone,
        backgroundColor: `color-mix(in oklab, ${tone} 13%, transparent)`,
      } : undefined}
      title={`${DEPARTMENT_LABEL[department]} ${kindLabel} ${linked ? '연결됨' : '비어 있음'}`}
    >
      <Icon size={compact ? 9 : 10} strokeWidth={2.2} aria-hidden />
    </span>
  );
}
