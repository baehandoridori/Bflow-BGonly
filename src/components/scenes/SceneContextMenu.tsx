/**
 * 카드/시트 공용 우클릭 메뉴.
 *
 * 현재 v1.16.0 항목:
 *   - 길이 늘어남 (LD) — scene.lengthChange='LD'
 *   - 길이 줄어듦 (SD) — scene.lengthChange='SD'
 *   - 표시 해제      — scene.lengthChange=null
 *
 * 카드/시트 어디서 우클릭하든 동일한 메뉴.
 * 클릭 시 즉시 낙관적 업데이트 → Supabase 저장.
 */

import { useEffect, useRef } from 'react';
import { File, Folder } from 'lucide-react';
import { LengthIcon } from './LengthIcon';
import type { SceneWorkLink } from '@/types';

export interface SceneContextMenuProps {
  x: number;
  y: number;
  current: 'LD' | 'SD' | null | undefined;
  onSelect: (value: 'LD' | 'SD' | null) => void;
  onClose: () => void;
  sceneLabel?: string;
  workLinks?: {
    episodeName?: string;
    departments: Array<{
      department: 'bg' | 'acting';
      folder?: SceneWorkLink;
      primaryFile?: SceneWorkLink;
    }>;
    onOpen: (link: SceneWorkLink) => void;
    /** 빈 슬롯에서 "연결" 클릭 시 폴더/파일 선택창을 열어 링크를 추가한다. */
    onAdd?: (department: 'bg' | 'acting', linkKind: 'folder' | 'primary_file') => void | Promise<void>;
  };
}

export function SceneContextMenu({ x, y, current, onSelect, onClose, sceneLabel, workLinks }: SceneContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭/Esc 닫기
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // 화면 경계 자동 보정 — 메뉴가 잘리지 않게
  const menuWidth = 220;
  const menuHeight = workLinks ? 376 : 168;
  const adjustedX = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 8));
  const adjustedY = Math.max(4, Math.min(y, window.innerHeight - menuHeight - 8));

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 9999,
        width: menuWidth,
      }}
      className="bg-bg-card border border-bg-border rounded-lg shadow-2xl p-1.5 select-none"
      onContextMenu={(e) => e.preventDefault()}
      // v1.16.0 fix (Codex 라운드 5): 메뉴 컨테이너 click 도 부모 (카드/시트 행) 로 bubble 막음 — 안전망
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {workLinks && (
        <>
          <div className="px-2.5 py-1.5 text-[10px] font-bold text-text-secondary uppercase tracking-wider">
            작업 링크
          </div>
          {(workLinks.episodeName || sceneLabel) && (
            <div className="mx-1.5 mb-1 rounded-md bg-bg-primary/65 px-2 py-1 text-[11px] text-text-secondary">
              {[workLinks.episodeName, sceneLabel].filter(Boolean).join(' · ')}
            </div>
          )}
          <div className="space-y-1">
            {workLinks.departments.map((item) => (
              <WorkLinkDepartmentMenu
                key={item.department}
                department={item.department}
                folder={item.folder}
                primaryFile={item.primaryFile}
                onOpen={(link) => {
                  workLinks.onOpen(link);
                  onClose();
                }}
                onAdd={workLinks.onAdd
                  ? (department, linkKind) => {
                      void workLinks.onAdd?.(department, linkKind);
                      onClose();
                    }
                  : undefined}
              />
            ))}
          </div>
          <div className="h-px bg-bg-border/60 mx-1.5 my-1.5" />
        </>
      )}

      <div className="px-2.5 py-1.5 text-[10px] font-bold text-text-secondary uppercase tracking-wider">
        씬 길이 변경
      </div>

      <MenuItem
        active={current === 'LD'}
        onClick={() => { onSelect('LD'); onClose(); }}
        accent="up"
      >
        <span className="inline-flex items-center justify-center w-[22px] h-4 text-length-up flex-shrink-0">
          <LengthIcon kind="LD" />
        </span>
        길이 늘어남 (LD)
      </MenuItem>

      <MenuItem
        active={current === 'SD'}
        onClick={() => { onSelect('SD'); onClose(); }}
        accent="down"
      >
        <span className="inline-flex items-center justify-center w-[22px] h-4 text-length-down flex-shrink-0">
          <LengthIcon kind="SD" />
        </span>
        길이 줄어듦 (SD)
      </MenuItem>

      <div className="h-px bg-bg-border/60 mx-1.5 my-1" />

      <MenuItem
        disabled={!current}
        onClick={() => { onSelect(null); onClose(); }}
      >
        <span className="inline-flex items-center justify-center w-[22px] h-4 text-text-secondary/60 flex-shrink-0 font-mono text-[11px] font-bold">
          — —
        </span>
        길이 변경 표시 해제
      </MenuItem>
    </div>
  );
}

function WorkLinkDepartmentMenu({
  department,
  folder,
  primaryFile,
  onOpen,
  onAdd,
}: {
  department: 'bg' | 'acting';
  folder?: SceneWorkLink;
  primaryFile?: SceneWorkLink;
  onOpen: (link: SceneWorkLink) => void;
  onAdd?: (department: 'bg' | 'acting', linkKind: 'folder' | 'primary_file') => void;
}) {
  const label = department === 'bg' ? '배경' : '액팅';
  const tone = department === 'bg' ? 'text-accent-sub' : 'text-[#F09A87]';
  return (
    <div>
      <div className={`px-2.5 py-0.5 text-[10.5px] font-bold ${tone}`}>{label}</div>
      <WorkLinkMenuItem
        department={department}
        linkKind="folder"
        icon={<Folder size={13} aria-hidden />}
        openLabel="작업 폴더 열기"
        addLabel="작업 폴더 연결"
        link={folder}
        onOpen={onOpen}
        onAdd={onAdd}
      />
      <WorkLinkMenuItem
        department={department}
        linkKind="primary_file"
        icon={<File size={13} aria-hidden />}
        openLabel="작업 파일 열기"
        addLabel="대표 파일 연결"
        link={primaryFile}
        onOpen={onOpen}
        onAdd={onAdd}
      />
    </div>
  );
}

function WorkLinkMenuItem({
  department,
  linkKind,
  icon,
  openLabel,
  addLabel,
  link,
  onOpen,
  onAdd,
}: {
  department: 'bg' | 'acting';
  linkKind: 'folder' | 'primary_file';
  icon: React.ReactNode;
  openLabel: string;
  addLabel: string;
  link?: SceneWorkLink;
  onOpen: (link: SceneWorkLink) => void;
  onAdd?: (department: 'bg' | 'acting', linkKind: 'folder' | 'primary_file') => void;
}) {
  // 연결된 슬롯 = "열기", 빈 슬롯 = "연결" (선택창 열기). onAdd 미제공 시 빈 슬롯은 비활성.
  const canAdd = !link && !!onAdd;
  const interactive = !!link || canAdd;
  return (
    <button
      role="menuitem"
      disabled={!interactive}
      onClick={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        if (link) onOpen(link);
        else onAdd?.(department, linkKind);
      }}
      className={[
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] text-left transition-colors',
        interactive
          ? 'text-text-primary hover:bg-accent/10 hover:text-accent cursor-pointer'
          : 'text-text-secondary/35 cursor-not-allowed',
      ].join(' ')}
    >
      <span className="inline-flex w-[22px] justify-center flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{link ? openLabel : addLabel}</span>
    </button>
  );
}

interface MenuItemProps {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  accent?: 'up' | 'down';
}

function MenuItem({ children, onClick, active, disabled, accent }: MenuItemProps) {
  const accentClass =
    accent === 'up'
      ? 'hover:bg-length-up/10 hover:text-length-up'
      : accent === 'down'
        ? 'hover:bg-length-down/10 hover:text-length-down'
        : 'hover:bg-accent/10 hover:text-accent';

  const activeClass = active
    ? accent === 'up'
      ? 'bg-length-up/10 text-length-up'
      : accent === 'down'
        ? 'bg-length-down/10 text-length-down'
        : 'bg-accent/10 text-accent'
    : 'text-text-primary';

  const disabledClass = disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer';

  return (
    <button
      role="menuitem"
      // v1.16.0 fix (Codex 라운드 5): createPortal 이라도 React event 는 부모로 bubble.
      //                              ancestor 의 onClick (카드 선택) 트리거 방지.
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={[
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] text-left transition-colors',
        disabled ? '' : accentClass,
        activeClass,
        disabledClass,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
