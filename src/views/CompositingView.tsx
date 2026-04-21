import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  Filter,
  Clock,
  Circle,
  Check,
  AlertTriangle,
  Plus,
  ListFilter,
  ImagePlus,
  X,
  FolderOpen,
  Undo2,
} from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { setRevisionsSheetsMode, buildSceneKey } from '@/services/revisionService';
import { getUserColor } from '@/components/common/AssigneeSelect';
import { resizeBlob } from '@/utils/imageUtils';
import type { CompRevision, RevisionStatus, RevisionPriority, Episode } from '@/types';
import { formatDateTime } from '@/utils/formatTime';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/constants/revision';

// ─── 유틸 ───────────────────────────────────

/** 이름에서 이니셜 2자 추출 */
function getInitials(name: string): string {
  if (!name) return '?';
  // 한글이면 첫 2글자, 영어면 이니셜
  if (/[\uAC00-\uD7AF]/.test(name)) return name.slice(0, 2);
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);
}

/** sceneKey에서 정보 파싱 */
function parseSceneKey(sceneKey: string): { ep: string; part: string; sceneId: string } {
  const [ep, part, sceneId] = sceneKey.split(':');
  return { ep: ep || '', part: part || '', sceneId: sceneId || '' };
}

/** 텍스트에서 G: 로 시작하는 경로를 분리 */
function parsePathsFromText(text: string): { description: string; paths: string[] } {
  // 각 줄에서 G:\로 시작하는 부분을 경로로 인식 (공백 포함, 줄 끝까지)
  const lines = text.split('\n');
  const paths: string[] = [];
  const descLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // 줄 전체가 G:\로 시작하면 경로
    if (/^G:\\/i.test(trimmed)) {
      paths.push(trimmed);
    } else if (trimmed.includes('G:\\')) {
      // 줄 중간에 G:\가 있으면 그 앞은 설명, 뒤는 경로
      const idx = trimmed.indexOf('G:\\');
      const before = trimmed.slice(0, idx).trim();
      const pathPart = trimmed.slice(idx).trim();
      if (before) descLines.push(before);
      paths.push(pathPart);
    } else {
      descLines.push(line);
    }
  }

  const description = descLines.join('\n').trim();
  return { description, paths };
}

/** 경로 뱃지 컴포넌트 (클릭 시 파일탐색기 열기) */
function PathBadge({ path: filePath, resolved }: { path: string; resolved?: boolean }) {
  // 경로의 마지막 부분(파일명 또는 폴더명)만 표시
  const segments = filePath.replace(/\\/g, '/').split('/');
  const shortName = segments[segments.length - 1] || segments[segments.length - 2] || filePath;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI?.shellShowItem?.(filePath);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-[11px] font-mono rounded px-1.5 py-0.5 max-w-full cursor-pointer transition-all hover:brightness-125"
      style={resolved
        ? { color: '#6B7280', backgroundColor: 'rgba(107, 114, 128, 0.1)', border: '1px solid rgba(107, 114, 128, 0.2)' }
        : { color: '#74B9FF', backgroundColor: 'rgba(116, 185, 255, 0.1)', border: '1px solid rgba(116, 185, 255, 0.2)' }
      }
      title={`${filePath}\n(클릭하면 파일탐색기에서 열기)`}
    >
      <FolderOpen size={10} className="shrink-0" />
      <span className="truncate">{shortName}</span>
    </button>
  );
}


// ─── 씬 정보 매핑 타입 ──────────────────────

interface SceneInfo {
  sceneKey: string;
  sceneId: string;
  sceneNo: number;
  sceneName: string; // memo
  sheetName: string;
  part: string;
  department: 'bg' | 'acting';
  assignee: string;
}

interface SceneGroup {
  sceneKey: string;
  info: SceneInfo;
  revisions: CompRevision[];
  openCount: number;
  uniqueRequesters: string[];
}

// ─── 아바타 ─────────────────────────────────

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const color = getUserColor(name);
  const initials = getInitials(name);
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundColor: color,
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

function AvatarStack({ names, max = 4, size = 24 }: { names: string[]; max?: number; size?: number }) {
  const visible = names.slice(0, max);
  const overflow = names.length - max;
  return (
    <div className="flex items-center" style={{ marginLeft: size * 0.2 }}>
      {visible.map((name, i) => (
        <div
          key={name}
          className="relative rounded-full border-2 border-bg-card"
          style={{ marginLeft: i === 0 ? 0 : -(size * 0.3), zIndex: visible.length - i }}
        >
          <Avatar name={name} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-[10px] text-text-secondary">+{overflow}</span>
      )}
    </div>
  );
}

// ─── 상태 도트 ──────────────────────────────

function StatusDots({ revisions }: { revisions: CompRevision[] }) {
  const sorted = [...revisions]
    .filter(r => r.status !== 'resolved')
    .sort((a, b) => {
      const order: Record<RevisionPriority, number> = { urgent: 0, high: 1, normal: 2 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });

  if (sorted.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {sorted.slice(0, 5).map((r) => (
        <div
          key={r.id}
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: PRIORITY_CONFIG[r.priority]?.color ?? '#74B9FF' }}
          title={`${PRIORITY_CONFIG[r.priority]?.label ?? '보통'}: ${r.description.slice(0, 30)}`}
        />
      ))}
      {sorted.length > 5 && (
        <span className="text-[9px] text-text-secondary ml-0.5">+{sorted.length - 5}</span>
      )}
    </div>
  );
}

// ─── 우선순위 뱃지 ───────────────────────────

function PriorityBadge({ priority }: { priority: RevisionPriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium rounded px-1.5 py-0.5"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

// ─── 상태 드롭다운 ──────────────────────────

function StatusDropdown({
  currentStatus,
  onSelect,
}: {
  currentStatus: RevisionStatus;
  onSelect: (status: RevisionStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const options: RevisionStatus[] = ['open', 'in_progress', 'resolved'];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      >
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        상태
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden border border-bg-border shadow-xl"
            style={{ background: 'rgba(26, 29, 39, 0.95)', backdropFilter: 'blur(12px)' }}
          >
            {options.filter(s => s !== currentStatus).map((s) => {
              const cfg = STATUS_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); onSelect(s); setOpen(false); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] w-full hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
                  style={{ color: cfg.color }}
                >
                  {s === 'open' && <Circle size={10} fill="currentColor" />}
                  {s === 'in_progress' && <Clock size={10} />}
                  {s === 'resolved' && <Check size={10} />}
                  {cfg.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 리비전 아이템 (확장된 씬 내부) ──────────

function RevisionItem({
  revision,
  isSelected,
  onSelect,
  onStatusChange,
}: {
  revision: CompRevision;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const isResolved = revision.status === 'resolved';
  const { description: descText, paths } = parsePathsFromText(revision.description);

  const handleStatusSelect = (status: RevisionStatus) => {
    if (status === 'resolved') {
      setShowResolveNote(true);
      return;
    }
    onStatusChange(status);
  };

  const handleResolve = () => {
    onStatusChange('resolved', resolveNote);
    setShowResolveNote(false);
    setResolveNote('');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2 }}
      onClick={onSelect}
      className={`relative flex items-start gap-3 pl-10 pr-4 py-2.5 rounded-lg transition-colors group cursor-pointer ${
        isSelected ? 'bg-accent/[0.08]' : 'hover:bg-white/[0.02]'
      }`}
    >
      {/* 트리 가지 (가로 커넥터) */}
      <div
        className="absolute left-[22px] top-[18px] w-3 h-px bg-bg-border/50"
      />

      {/* 요청자 아바타 */}
      <Avatar name={revision.requesterName} size={28} />

      {/* 상태 도트 */}
      <div className="mt-2.5 shrink-0">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: STATUS_CONFIG[revision.status].color }}
        />
      </div>

      {/* 설명 */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-relaxed ${
            isResolved ? 'line-through text-text-secondary/50' : 'text-text-primary'
          }`}
        >
          {descText || revision.description}
        </p>

        {/* 경로 뱃지 */}
        {paths.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {paths.map((p, i) => <PathBadge key={i} path={p} resolved={isResolved} />)}
          </div>
        )}

        {/* 해결 메모 */}
        {isResolved && revision.resolvedNote && (
          <p className="text-xs text-text-secondary/50 mt-0.5">
            → {revision.resolvedNote}
          </p>
        )}

        {/* 해결 메모 입력 */}
        <AnimatePresence>
          {showResolveNote && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden"
            >
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleResolve(); }
                  if (e.key === 'Escape') { setShowResolveNote(false); setResolveNote(''); }
                }}
                placeholder="해결 메모 (선택, Enter로 전송)"
                className="w-full px-3 py-1.5 text-xs bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                rows={2}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowResolveNote(false); setResolveNote(''); }}
                  className="text-[11px] text-text-secondary hover:text-text-primary cursor-pointer"
                >
                  취소
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                  className="text-[11px] px-2.5 py-1 rounded-md text-white cursor-pointer"
                  style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                >
                  해결
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 프레임 번호 */}
      {revision.frameNo && (
        <span className="shrink-0 text-[11px] text-text-secondary/60 font-mono mt-0.5">
          {revision.frameNo}
        </span>
      )}

      {/* 상태 변경 */}
      {!isResolved ? (
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <StatusDropdown currentStatus={revision.status} onSelect={handleStatusSelect} />
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); handleStatusSelect('open'); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary hover:text-accent rounded-md hover:bg-accent/10 transition-all cursor-pointer"
          title="되돌리기"
        >
          <Undo2 size={11} />
          되돌리기
        </button>
      )}

      {/* 우선순위 뱃지 */}
      <div className="shrink-0">
        <PriorityBadge priority={revision.priority} />
      </div>
    </motion.div>
  );
}

// ─── 새 리비전 등록 폼 ──────────────────────

function AddRevisionForm({
  sceneKey,
  department,
  onClose,
}: {
  sceneKey: string;
  department?: 'bg' | 'acting';
  onClose: () => void;
}) {
  const { currentUser } = useAuthStore();
  const { createRevision } = useRevisionStore();
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RevisionPriority>('normal');
  const [frameNo, setFrameNo] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleImageFile = async (file: File) => {
    try {
      const resized = await resizeBlob(file, 800, 0.8);
      setImagePreview(resized);
    } catch { /* 무시 */ }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageFile(file);
        return;
      }
    }
  };

  const handleSubmit = async () => {
    if (!description.trim() || !currentUser || submitting) return;
    setSubmitting(true);
    try {
      await createRevision(sceneKey, {
        description: description.trim(),
        priority,
        frameNo: frameNo.trim() || undefined,
        imageUrl: imagePreview || undefined,
        lookupDepartment: department,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
      });
      onClose();
    } catch (err) {
      console.error('리비전 등록 실패:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden ml-12 mr-4 mb-2"
    >
      <div
        className="rounded-xl p-4 space-y-3 border border-bg-border/60"
        style={{ background: 'rgba(26, 29, 39, 0.8)', backdropFilter: 'blur(12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 우선순위 선택 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary w-fit">
            {(['urgent', 'high', 'normal'] as const).map((p) => {
              const cfg = PRIORITY_CONFIG[p];
              return (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    priority === p ? 'shadow-sm' : 'text-text-secondary hover:text-text-primary'
                  }`}
                  style={priority === p ? { color: cfg.color, backgroundColor: cfg.bg } : undefined}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <input
            value={frameNo}
            onChange={(e) => setFrameNo(e.target.value)}
            placeholder="F000"
            className="w-16 px-2 py-1 text-[11px] bg-bg-primary rounded-md border border-bg-border text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent/50 font-mono"
          />
        </div>

        {/* 설명 */}
        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            if (e.key === 'Escape') onClose();
          }}
          placeholder="수정 내용을 설명해주세요..."
          className="w-full px-3 py-2 text-sm bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
          rows={2}
        />

        {/* 이미지 프리뷰 */}
        {imagePreview && (
          <div className="relative w-fit">
            <img src={imagePreview} alt="preview" className="rounded-lg max-h-20 border border-bg-border/40" />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* 액션 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-primary transition-colors cursor-pointer"
            title="이미지 첨부"
          >
            <ImagePlus size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!description.trim() || submitting}
              className="px-4 py-1.5 text-[11px] font-medium rounded-lg text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#6C5CE7' }}
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── 씬 행 (접기/펼치기) ────────────────────

function SceneRow({
  group,
  expanded,
  selectedRevisionId,
  onToggle,
  onSelectRevision,
  onStatusChange,
}: {
  group: SceneGroup;
  expanded: boolean;
  selectedRevisionId: string | null;
  onToggle: () => void;
  onSelectRevision: (rev: CompRevision) => void;
  onStatusChange: (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const { info, revisions, openCount, uniqueRequesters } = group;

  // 씬 ID 표시 (a001, SC001 등 원본 그대로)
  const sceneLabel = info.sceneId || `S${String(info.sceneNo).padStart(2, '0')}`;

  return (
    <div className="border-b border-bg-border/40 last:border-b-0">
      {/* 씬 헤더 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        {/* 펼치기/접기 */}
        <span className="shrink-0 text-text-secondary/50 w-5">
          {openCount > 0 && (
            expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          )}
        </span>

        {/* 씬 번호 뱃지 */}
        <span
          className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded border ${
            expanded
              ? 'text-accent border-accent/40 bg-accent/10'
              : 'text-text-secondary border-bg-border bg-bg-primary/50'
          }`}
        >
          {sceneLabel}
        </span>

        {/* 씬 이름 */}
        <span className="font-medium text-sm text-text-primary truncate">
          {info.sceneName || info.sceneId}
        </span>

        {/* 오른쪽: 상태도트 + 아바타 + 미해결 뱃지 */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <StatusDots revisions={revisions} />
          {uniqueRequesters.length > 0 && (
            <AvatarStack names={uniqueRequesters} max={4} size={22} />
          )}
          {openCount > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.12)' }}
            >
              <AlertTriangle size={10} />
              {openCount} 미해결
            </span>
          )}
        </div>
      </button>

      {/* 확장된 리비전 목록 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            {/* 세로 가이드라인 + 리비전 아이템들 */}
            <div className="relative pb-2 ml-8">
              {/* 세로 가이드라인 */}
              <div
                className="absolute left-[22px] top-0 bottom-2 w-px bg-bg-border/50"
              />

              {/* 리비전 아이템들 */}
              {[...revisions]
                .sort((a, b) => {
                  // 미해결 먼저, 그 안에서 우선순위순
                  if (a.status === 'resolved' && b.status !== 'resolved') return 1;
                  if (a.status !== 'resolved' && b.status === 'resolved') return -1;
                  const order: Record<RevisionPriority, number> = { urgent: 0, high: 1, normal: 2 };
                  return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
                })
                .map((rev) => (
                  <RevisionItem
                    key={rev.id}
                    revision={rev}
                    isSelected={rev.id === selectedRevisionId}
                    onSelect={() => onSelectRevision(rev)}
                    onStatusChange={(status, note) =>
                      onStatusChange(rev.id, rev.sceneKey, status, note)
                    }
                  />
                ))}

              {/* 추가 버튼 / 폼 */}
              <AnimatePresence mode="wait">
                {showAddForm ? (
                    <AddRevisionForm
                      key="form"
                      sceneKey={info.sceneKey}
                      department={info.department}
                      onClose={() => setShowAddForm(false)}
                    />
                ) : (
                  <motion.div
                    key="btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="ml-4 mr-4 mb-2"
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowAddForm(true); }}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-secondary/60 hover:text-accent transition-colors cursor-pointer rounded-lg hover:bg-accent/5"
                    >
                      <Plus size={12} />
                      수정 요청 추가
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 에피소드 필터 ──────────────────────────

function EpisodeFilter({
  episodes,
  selected,
  onSelect,
}: {
  episodes: Episode[];
  selected: number | null;
  onSelect: (ep: number | null) => void;
}) {
  const getDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
          selected === null
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-bg-border text-text-secondary hover:text-text-primary'
        }`}
      >
        전체
      </button>
      {episodes.map((ep) => (
        <button
          key={ep.episodeNumber}
          onClick={() => onSelect(ep.episodeNumber)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
            selected === ep.episodeNumber
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-bg-border text-text-secondary hover:text-text-primary'
          }`}
        >
          {getDisplayName(ep)}
        </button>
      ))}
    </div>
  );
}

// ─── 피드백 상세 패널 ────────────────────────

function DetailPanel({
  revision,
  sceneInfo,
  onClose,
  onStatusChange,
}: {
  revision: CompRevision;
  sceneInfo: SceneInfo | null;
  onClose: () => void;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const { description: descText, paths: detailPaths } = parsePathsFromText(revision.description);

  const handleResolve = () => {
    onStatusChange('resolved', resolveNote);
    setShowResolveNote(false);
    setResolveNote('');
  };

  const handleStatusSelect = (status: RevisionStatus) => {
    if (status === 'resolved') {
      setShowResolveNote(true);
      return;
    }
    onStatusChange(status);
  };

  const { ep, part, sceneId } = parseSceneKey(revision.sceneKey);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 340, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="shrink-0 border-l border-bg-border overflow-hidden h-full"
    >
      <div className="w-[340px] h-full overflow-y-auto">
        <div className="p-5">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-text-primary">피드백 상세</h3>
            <button
              onClick={onClose}
              className="p-1 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/50 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* 상태 + 우선순위 뱃지 */}
          <div className="flex items-center gap-2 mb-5">
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: STATUS_CONFIG[revision.status].color, backgroundColor: STATUS_CONFIG[revision.status].bg }}
            >
              {revision.status === 'open' && <Circle size={10} fill="currentColor" />}
              {revision.status === 'in_progress' && <Clock size={10} />}
              {revision.status === 'resolved' && <Check size={10} />}
              {STATUS_CONFIG[revision.status].label}
            </span>
            <span
              className="inline-flex items-center text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: PRIORITY_CONFIG[revision.priority].color, backgroundColor: PRIORITY_CONFIG[revision.priority].bg }}
            >
              {revision.priority === 'urgent' && <AlertTriangle size={10} className="mr-0.5" />}
              {PRIORITY_CONFIG[revision.priority].label}
            </span>
          </div>

          {/* 요청자 정보 */}
          <div className="flex items-center gap-3 mb-5">
            <Avatar name={revision.requesterName} size={36} />
            <div>
              <p className="text-sm font-medium text-text-primary">{revision.requesterName}</p>
              <p className="text-[11px] text-text-secondary">{formatDateTime(revision.createdAt)}</p>
            </div>
          </div>

          {/* 설명 카드 */}
          <div
            className="rounded-xl p-4 mb-5 border border-bg-border/60"
            style={{ background: 'rgba(26, 29, 39, 0.8)' }}
          >
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {descText || revision.description}
            </p>
            {detailPaths.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-bg-border/40">
                <span className="text-[10px] text-text-secondary/60 font-medium uppercase tracking-wider">경로</span>
                {detailPaths.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => window.electronAPI?.shellShowItem?.(p)}
                    className="flex items-center gap-1.5 text-xs font-mono rounded-lg px-2.5 py-1.5 text-left cursor-pointer transition-all hover:brightness-125"
                    style={revision.status === 'resolved'
                      ? { color: '#6B7280', backgroundColor: 'rgba(107, 114, 128, 0.08)', border: '1px solid rgba(107, 114, 128, 0.15)' }
                      : { color: '#74B9FF', backgroundColor: 'rgba(116, 185, 255, 0.08)', border: '1px solid rgba(116, 185, 255, 0.15)' }
                    }
                    title={`${p}\n(클릭하면 파일탐색기에서 열기)`}
                  >
                    <FolderOpen size={12} className="shrink-0" />
                    <span className="break-all">{p}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 이미지 */}
          {revision.imageUrl && (
            <div className="mb-5">
              <img
                src={revision.imageUrl}
                alt="첨부"
                className="rounded-xl max-h-48 w-full object-contain border border-bg-border/40"
              />
            </div>
          )}

          {/* 메타 정보 */}
          <div className="space-y-3 mb-5">
            {revision.frameNo && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">프레임</span>
                <span className="text-xs font-bold text-text-primary font-mono">{revision.frameNo}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">씬</span>
              <span className="text-xs font-bold text-text-primary">{sceneInfo?.sceneId || sceneId}</span>
            </div>
            {revision.department && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">파트</span>
                <span className="text-xs text-text-primary">{revision.department === 'bg' ? 'BG' : '액팅'}</span>
              </div>
            )}
            {revision.assignee && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">담당</span>
                <span className="text-xs text-text-primary">{revision.assignee}</span>
              </div>
            )}
          </div>

          {/* 해결 정보 */}
          {revision.status === 'resolved' && (
            <div
              className="rounded-xl p-4 mb-5 border"
              style={{ borderColor: STATUS_CONFIG.resolved.color + '40', backgroundColor: STATUS_CONFIG.resolved.bg }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Check size={14} style={{ color: STATUS_CONFIG.resolved.color }} />
                  <span className="text-xs font-medium" style={{ color: STATUS_CONFIG.resolved.color }}>해결됨</span>
                </div>
                <button
                  onClick={() => onStatusChange('open')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary hover:text-accent rounded-md hover:bg-accent/10 transition-all cursor-pointer"
                  title="되돌리기"
                >
                  <Undo2 size={11} />
                  되돌리기
                </button>
              </div>
              {revision.resolvedBy && (
                <p className="text-xs text-text-secondary mb-1">
                  {revision.resolvedBy} · {revision.resolvedAt ? formatDateTime(revision.resolvedAt) : ''}
                </p>
              )}
              {revision.resolvedNote && (
                <p className="text-xs text-text-primary">{revision.resolvedNote}</p>
              )}
            </div>
          )}

          {/* 해결 메모 입력 */}
          <AnimatePresence>
            {showResolveNote && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <textarea
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleResolve(); }
                    if (e.key === 'Escape') { setShowResolveNote(false); setResolveNote(''); }
                  }}
                  placeholder="해결 메모 (선택, Enter로 전송)"
                  className="w-full px-3 py-2 text-sm bg-bg-primary rounded-xl border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                  rows={2}
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setShowResolveNote(false); setResolveNote(''); }}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleResolve}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg text-white cursor-pointer"
                    style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                  >
                    해결
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 상태 변경 버튼 */}
          {revision.status !== 'resolved' && !showResolveNote && (
            <button
              onClick={() => handleStatusSelect('resolved')}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-xl text-white transition-all cursor-pointer hover:opacity-90"
              style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
            >
              <Check size={16} />
              해결 완료로 변경
            </button>
          )}
          {revision.status === 'open' && (
            <button
              onClick={() => handleStatusSelect('in_progress')}
              className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 text-xs font-medium rounded-xl border transition-all cursor-pointer"
              style={{ borderColor: STATUS_CONFIG.in_progress.color + '40', color: STATUS_CONFIG.in_progress.color }}
            >
              <Clock size={14} />
              진행 시작
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── 메인 뷰 ─────────────────────────────────

export default function CompositingView() {
  const { currentUser } = useAuthStore();
  const dataConnected = useAppStore((s) => s.dataConnected);
  const episodes = useDataStore((s) => s.episodes);
  const { revisions, loadRevisions, updateStatus, isLoading } = useRevisionStore();

  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RevisionStatus>('all');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);

  // 선택된 리비전 객체
  const selectedRevision = useMemo(
    () => selectedRevisionId ? revisions.find(r => r.id === selectedRevisionId) ?? null : null,
    [revisions, selectedRevisionId],
  );

  useEffect(() => {
    setRevisionsSheetsMode(dataConnected);
    loadRevisions();
  }, [dataConnected, loadRevisions]);

  // 씬 정보 맵 빌드 (에피소드 데이터 + 리비전 sceneKey 매칭)
  const sceneInfoMap = useMemo(() => {
    const map = new Map<string, SceneInfo>();
    for (const ep of episodes) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const sceneKey = buildSceneKey(part.sheetName, scene.sceneId);
          const nextInfo = {
            sceneKey,
            sceneId: scene.sceneId,
            sceneNo: scene.no,
            sceneName: scene.memo,
            sheetName: part.sheetName,
            part: part.partId,
            department: part.department as 'bg' | 'acting',
            assignee: scene.assignee,
          };
          const existing = map.get(sceneKey);
          if (!existing || (existing.department !== 'bg' && nextInfo.department === 'bg')) {
            map.set(sceneKey, nextInfo);
          }
        }
      }
    }
    return map;
  }, [episodes]);

  // 선택된 리비전의 씬 정보
  const selectedRevisionSceneInfo = useMemo(
    () => selectedRevision ? sceneInfoMap.get(selectedRevision.sceneKey) ?? null : null,
    [selectedRevision, sceneInfoMap],
  );

  // 씬 그룹 빌드
  const sceneGroups = useMemo(() => {
    // 에피소드 필터링
    const filteredEps = selectedEp
      ? episodes.filter(ep => ep.episodeNumber === selectedEp)
      : episodes;

    // 에피소드별 씬 목록 수집
    const allSceneKeys: string[] = [];
    for (const ep of filteredEps) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const key = buildSceneKey(part.sheetName, scene.sceneId);
          allSceneKeys.push(key);
        }
      }
    }

    // 리비전을 sceneKey로 그룹핑
    const revByScene = new Map<string, CompRevision[]>();
    for (const rev of revisions) {
      const list = revByScene.get(rev.sceneKey) || [];
      list.push(rev);
      revByScene.set(rev.sceneKey, list);
    }

    // 그룹 빌드 (리비전이 있는 씬만)
    const groups: SceneGroup[] = [];
    const seen = new Set<string>();

    for (const key of allSceneKeys) {
      if (seen.has(key)) continue;
      seen.add(key);

      let sceneRevisions = revByScene.get(key) || [];
      if (sceneRevisions.length === 0) continue;

      // 상태 필터
      if (statusFilter !== 'all') {
        sceneRevisions = sceneRevisions.filter(r => r.status === statusFilter);
        if (sceneRevisions.length === 0) continue;
      }

      // 내 할 일 필터
      if (myTasksOnly && currentUser) {
        sceneRevisions = sceneRevisions.filter(
          r => r.assignee === currentUser.name || r.requesterName === currentUser.name,
        );
        if (sceneRevisions.length === 0) continue;
      }

      const info = sceneInfoMap.get(key);
      if (!info) {
        // sceneKey에 매칭되는 씬 데이터가 없는 경우 (삭제됐거나 다른 에피소드)
        const { ep, part, sceneId } = parseSceneKey(key);
        groups.push({
          sceneKey: key,
          info: {
            sceneKey: key,
            sceneId,
            sceneNo: 0,
            sceneName: `${ep} ${part}파트 #${sceneId}`,
            sheetName: '',
            part,
            department: 'bg',
            assignee: '',
          },
          revisions: sceneRevisions,
          openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
          uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
        });
        continue;
      }

      groups.push({
        sceneKey: key,
        info,
        revisions: sceneRevisions,
        openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
        uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
      });
    }

    // 또한, 선택된 에피소드에 속하지 않는 리비전도 표시 (selectedEp가 null일 때)
    if (selectedEp === null) {
      for (const [key, revs] of revByScene) {
        if (seen.has(key)) continue;
        seen.add(key);
        let sceneRevisions = [...revs];
        if (statusFilter !== 'all') {
          sceneRevisions = sceneRevisions.filter(r => r.status === statusFilter);
        }
        if (myTasksOnly && currentUser) {
          sceneRevisions = sceneRevisions.filter(
            r => r.assignee === currentUser.name || r.requesterName === currentUser.name,
          );
        }
        if (sceneRevisions.length === 0) continue;

        const { ep, part, sceneId } = parseSceneKey(key);
        groups.push({
          sceneKey: key,
          info: {
            sceneKey: key,
            sceneId,
            sceneNo: 0,
            sceneName: `${ep} ${part}파트 #${sceneId}`,
            sheetName: '',
            part,
            department: 'bg',
            assignee: '',
          },
          revisions: sceneRevisions,
          openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
          uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
        });
      }
    }

    // 씬 번호 순 정렬 (미해결 많은 순 → 씬 번호 순)
    groups.sort((a, b) => {
      // 미해결 있는 것 먼저
      if (a.openCount > 0 && b.openCount === 0) return -1;
      if (a.openCount === 0 && b.openCount > 0) return 1;
      // 씬 번호 순
      return a.info.sceneNo - b.info.sceneNo;
    });

    return groups;
  }, [episodes, revisions, selectedEp, statusFilter, myTasksOnly, currentUser, sceneInfoMap]);

  // 통계
  const stats = useMemo(() => {
    const totalScenes = sceneGroups.length;
    const totalRevisions = sceneGroups.reduce((acc, g) => acc + g.revisions.length, 0);
    const totalOpen = revisions.filter(r => r.status !== 'resolved').length;
    return { totalScenes, totalRevisions, totalOpen };
  }, [sceneGroups, revisions]);

  // 씬 토글
  const toggleScene = useCallback((sceneKey: string) => {
    setExpandedScenes(prev => {
      const next = new Set(prev);
      if (next.has(sceneKey)) next.delete(sceneKey);
      else next.add(sceneKey);
      return next;
    });
  }, []);

  // 모두 펼치기/접기
  const toggleAll = useCallback(() => {
    if (expandedScenes.size > 0) {
      setExpandedScenes(new Set());
    } else {
      setExpandedScenes(new Set(sceneGroups.filter(g => g.openCount > 0).map(g => g.sceneKey)));
    }
  }, [expandedScenes.size, sceneGroups]);

  // 리비전 선택
  const handleSelectRevision = useCallback((rev: CompRevision) => {
    setSelectedRevisionId(prev => prev === rev.id ? null : rev.id);
  }, []);

  // 상태 변경
  const handleStatusChange = async (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => {
    await updateStatus(revId, sceneKey, status, {
      resolvedBy: currentUser?.name,
      resolvedNote: note,
    });
  };

  return (
    <div className="h-full flex">
      {/* 좌측: 씬 타임라인 */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* 헤더 */}
        <div className="shrink-0 px-6 pt-6 pb-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-text-primary">씬 타임라인</h1>
              <span className="text-xs text-text-secondary">
                {stats.totalScenes}개 씬 &middot; {stats.totalRevisions}개 피드백
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAll}
                className="px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors cursor-pointer"
              >
                {expandedScenes.size > 0 ? '모두 접기' : '모두 펼치기'}
              </button>
            </div>
          </div>

          {/* 에피소드 필터 */}
          <EpisodeFilter episodes={episodes} selected={selectedEp} onSelect={setSelectedEp} />

          {/* 필터 바 */}
          <div className="flex items-center gap-3">
            {/* 상태 필터 */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary/50">
              {([
                { key: 'all' as const, label: '전체' },
                { key: 'open' as const, label: '대기' },
                { key: 'in_progress' as const, label: '진행중' },
                { key: 'resolved' as const, label: '해결' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    statusFilter === key
                      ? 'bg-accent/20 text-accent shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 내 할 일 */}
            <button
              onClick={() => setMyTasksOnly(!myTasksOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border transition-all cursor-pointer ${
                myTasksOnly
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-bg-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <ListFilter size={12} />
              내 할 일
            </button>

            {stats.totalOpen > 0 && (
              <span
                className="text-[11px] font-medium rounded-full px-2.5 py-1"
                style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.12)' }}
              >
                {stats.totalOpen}건 미해결
              </span>
            )}
          </div>
        </div>

        {/* 씬 타임라인 목록 */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && revisions.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-text-secondary/50 text-sm">
              로딩 중...
            </div>
          ) : sceneGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary/50">
              <Filter size={32} className="mb-3" />
              <p className="text-sm">피드백이 있는 씬이 없습니다</p>
              <p className="text-xs mt-1">씬 상세에서 수정 요청을 등록해보세요</p>
            </div>
          ) : (
            <div className="divide-y divide-bg-border/20">
              {sceneGroups.map((group) => (
                <SceneRow
                  key={group.sceneKey}
                  group={group}
                  expanded={expandedScenes.has(group.sceneKey)}
                  selectedRevisionId={selectedRevisionId}
                  onToggle={() => toggleScene(group.sceneKey)}
                  onSelectRevision={handleSelectRevision}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 우측: 피드백 상세 패널 */}
      <AnimatePresence>
        {selectedRevision && (
          <DetailPanel
            key={selectedRevision.id}
            revision={selectedRevision}
            sceneInfo={selectedRevisionSceneInfo}
            onClose={() => setSelectedRevisionId(null)}
            onStatusChange={(status, note) =>
              handleStatusChange(selectedRevision.id, selectedRevision.sceneKey, status, note)
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}
