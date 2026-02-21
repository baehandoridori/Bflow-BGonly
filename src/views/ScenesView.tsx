import { useState, useCallback, useRef, useMemo } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { SortKey, StatusFilter } from '@/stores/useAppStore';
import { STAGES, DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department } from '@/types';
import { sceneProgress, isFullyDone, isNotStarted } from '@/utils/calcStats';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, LayoutGrid, Table2, Layers, List, ChevronUp, ChevronDown, ClipboardPaste, ImagePlus, Sparkles } from 'lucide-react';

/* ── 진행률 기반 그라데이션 (중간값 추가로 밴딩 방지) ── */
function progressGradient(pct: number): string {
  if (pct >= 100) return 'linear-gradient(90deg, rgba(0,184,148,1) 0%, rgba(46,213,174,1) 40%, rgba(85,239,196,1) 100%)';
  if (pct >= 75) return 'linear-gradient(90deg, rgba(253,203,110,1) 0%, rgba(129,194,129,1) 50%, rgba(0,184,148,1) 100%)';
  if (pct >= 50) return 'linear-gradient(90deg, rgba(225,112,85,1) 0%, rgba(239,158,98,1) 50%, rgba(253,203,110,1) 100%)';
  if (pct >= 25) return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 35%, rgba(225,112,85,1) 65%, rgba(253,203,110,1) 100%)';
  return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 50%, rgba(225,112,85,1) 100%)';
}

/*
 * 보케 RGB 팔레트 — rgba() 사용으로 밴딩 방지
 * UI/UX Pro Max: Dark OLED + Financial Dashboard 팔레트 기반
 * 성취감 → 초록(#22C55E) + 골드(#CA8A04) + 프로젝트 액센트(#6C5CE7)
 */
const BOKEH_PALETTE = [
  [0, 184, 148],   // emerald
  [34, 197, 94],    // green-500 (CTA)
  [108, 92, 231],   // accent (프로젝트)
  [162, 155, 254],  // lavender
  [202, 138, 4],    // gold (achievement)
  [116, 185, 255],  // sky
  [253, 203, 110],  // amber
] as const;

/* ── 보케 오브 (rgba 기반, 밴딩 없음) ── */
function BokehOrbs({ count, minR, maxR, baseAlpha, drift, speed }: {
  count: number; minR: number; maxR: number; baseAlpha: number; drift: number; speed: number;
}) {
  const orbs = useMemo(() =>
    Array.from({ length: count }, (_, i) => {
      const r = minR + Math.random() * (maxR - minR);
      const [cr, cg, cb] = BOKEH_PALETTE[i % BOKEH_PALETTE.length];
      return {
        id: i, r, cr, cg, cb,
        x: Math.random() * 100,
        y: Math.random() * 100,
        dur: speed * (0.8 + Math.random() * 0.6),
        delay: Math.random() * speed * 0.5,
        path: Array.from({ length: 3 }, () => [(Math.random() - 0.5) * drift, (Math.random() - 0.5) * drift] as const),
      };
    }), [count, minR, maxR, baseAlpha, drift, speed]
  );

  return (
    <>
      {orbs.map((o) => (
        <motion.div
          key={o.id}
          className="absolute rounded-full will-change-transform"
          style={{
            width: o.r, height: o.r,
            left: `${o.x}%`, top: `${o.y}%`,
            /* radial-gradient with rgba → 부드러운 8비트 이상 블렌딩 */
            background: `radial-gradient(circle at 38% 38%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha}) 0%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha * 0.5}) 35%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha * 0.15}) 60%,
              rgba(${o.cr},${o.cg},${o.cb},0) 80%)`,
            filter: o.r > 30 ? `blur(${Math.round(o.r / 10)}px)` : 'none',
          }}
          animate={{
            x: [0, o.path[0][0], o.path[1][0], o.path[2][0], 0],
            y: [0, o.path[0][1], o.path[1][1], o.path[2][1], 0],
            scale: [1, 1.08, 0.96, 1.04, 1],
          }}
          transition={{ duration: o.dur, delay: o.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </>
  );
}

/* ── 오로라 메시 (conic-gradient → radial 다중 레이어로 밴딩 제거) ── */
function AuroraMesh() {
  return (
    <>
      {/* 부드러운 radial 워시 2개 — conic보다 밴딩 없음 */}
      <motion.div
        className="absolute will-change-transform"
        style={{
          width: '140%', height: '140%', left: '-20%', top: '-20%',
          background: `radial-gradient(ellipse at 30% 40%,
            rgba(0,184,148,0.06) 0%, rgba(108,92,231,0.04) 40%, transparent 70%),
            radial-gradient(ellipse at 70% 60%,
            rgba(202,138,4,0.05) 0%, rgba(162,155,254,0.03) 40%, transparent 70%)`,
        }}
        animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute will-change-transform"
        style={{
          width: '120%', height: '120%', left: '-10%', top: '-10%',
          background: `radial-gradient(ellipse at 60% 30%,
            rgba(34,197,94,0.05) 0%, rgba(116,185,255,0.03) 40%, transparent 65%),
            radial-gradient(ellipse at 40% 70%,
            rgba(253,203,110,0.04) 0%, rgba(0,184,148,0.03) 40%, transparent 65%)`,
        }}
        animate={{ x: [0, -25, 20, 0], y: [0, 20, -15, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
    </>
  );
}

/* ── 파트 완료 오버레이 ── */
function PartCompleteOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-xl"
    >
      {/* 레이어 0: 오로라 메시 (부드러운 radial, 밴딩 없음) */}
      <AuroraMesh />

      {/* 레이어 1: 대형 소프트 보케 — 깊이감 */}
      <BokehOrbs count={5} minR={50} maxR={100} baseAlpha={0.12} drift={50} speed={10} />

      {/* 레이어 2: 중형 보케 */}
      <BokehOrbs count={8} minR={15} maxR={40} baseAlpha={0.2} drift={40} speed={7} />

      {/* 레이어 3: 소형 샤프 보케 — 전경 */}
      <BokehOrbs count={12} minR={4} maxR={12} baseAlpha={0.45} drift={25} speed={5} />

      {/* 완료 뱃지 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 160, damping: 12 }}
          className="relative"
        >
          {/* 뱃지 글로우 링 */}
          <motion.div
            className="absolute -inset-4 rounded-2xl"
            style={{
              background: 'radial-gradient(ellipse, rgba(0,184,148,0.15) 0%, rgba(0,184,148,0.05) 40%, transparent 70%)',
              filter: 'blur(10px)',
            }}
            animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.97, 1.03, 0.97] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* 뱃지 본체 */}
          <div
            className="relative flex items-center gap-3 px-7 py-3.5 rounded-xl backdrop-blur-md"
            style={{
              background: 'rgba(26,29,39,0.92)',
              border: '1px solid rgba(0,184,148,0.35)',
              boxShadow: '0 8px 32px rgba(0,184,148,0.12), 0 0 1px rgba(0,184,148,0.4)',
            }}
          >
            <motion.div
              animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.1, 1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles size={18} style={{ color: '#22C55E', filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.5))' }} />
            </motion.div>
            <span
              className="text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, rgba(34,197,94,1) 0%, rgba(0,184,148,1) 50%, rgba(202,138,4,1) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              이 파트는 완료되었습니다!
            </span>
            <motion.div
              animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.1, 1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <Sparkles size={18} style={{ color: '#CA8A04', filter: 'drop-shadow(0 0 4px rgba(202,138,4,0.5))' }} />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
import {
  toggleTestSceneStage,
  addTestEpisode,
  addTestPart,
  addTestScene,
  deleteTestScene,
  updateTestSceneField,
} from '@/services/testSheetService';
import {
  updateSheetCell,
  addEpisodeToSheets,
  addPartToSheets,
  addSceneToSheets,
  deleteSceneFromSheets,
  updateSceneFieldInSheets,
} from '@/services/sheetsService';
import { cn } from '@/utils/cn';
import { Confetti } from '@/components/ui/Confetti';
import { SceneDetailModal } from '@/components/scenes/SceneDetailModal';

// ─── 씬 카드 (요약 카드 — 클릭으로 상세 모달 열기) ──────────────

interface SceneCardProps {
  scene: Scene;
  sceneIndex: number;
  celebrating: boolean;
  department: Department;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: () => void;
  onCelebrationEnd: () => void;
}

function SceneCard({ scene, sceneIndex, celebrating, department, onToggle, onDelete, onOpenDetail, onCelebrationEnd }: SceneCardProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  const pct = sceneProgress(scene);
  const hasImages = !!(scene.storyboardUrl || scene.guideUrl);

  const borderColor = pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct > 0 ? '#E17055' : '#2D3041';

  return (
    <div
      className="bg-bg-card border border-bg-border rounded-lg flex flex-col group relative cursor-pointer hover:border-text-secondary/30 transition-colors overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
      onClick={onOpenDetail}
    >
      {/* ── 상단: 씬 정보 ── */}
      <div className="px-2.5 pt-2 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-mono font-bold text-accent shrink-0">
            #{scene.no}
          </span>
          <span className="text-xs text-text-primary truncate">
            {scene.sceneId || '(씬번호 없음)'}
          </span>
          {scene.layoutId && (
            <span className="text-[10px] italic text-text-secondary/70 shrink-0">
              - L#{scene.layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium text-text-primary truncate max-w-[80px]">
            {scene.assignee || ''}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(sceneIndex); }}
            className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400 transition-opacity"
            title="씬 삭제"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── 가운데: 이미지 썸네일 ── */}
      {hasImages ? (
        <div className="flex gap-px bg-bg-border">
          {scene.storyboardUrl && (
            <img
              src={scene.storyboardUrl}
              alt="SB"
              className="flex-1 h-28 object-cover bg-bg-primary"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {scene.guideUrl && (
            <img
              src={scene.guideUrl}
              alt="Guide"
              className="flex-1 h-28 object-cover bg-bg-primary"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* ── 하단: 체크박스 + 진행 바 ── */}
      <div className="px-2.5 pt-1.5 pb-2 flex flex-col gap-1.5 mt-auto">
        <div className="flex gap-1">
          {STAGES.map((stage) => (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
              className={cn(
                'flex-1 py-0.5 rounded text-[10px] font-medium transition-all text-center',
                scene[stage]
                  ? 'text-bg-primary'
                  : 'bg-bg-primary text-text-secondary border border-bg-border hover:border-text-secondary'
              )}
              style={
                scene[stage]
                  ? { backgroundColor: deptConfig.stageColors[stage] }
                  : undefined
              }
            >
              {scene[stage] ? '✓' : ''}{deptConfig.stageLabels[stage]}
            </button>
          ))}
        </div>

        <div className="relative h-1 bg-bg-primary rounded-full overflow-visible">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: progressGradient(pct),
            }}
          />
          <Confetti active={celebrating} onComplete={onCelebrationEnd} />
        </div>
      </div>
    </div>
  );
}

// ─── 테이블 뷰 ──────────────────────────────────────────────────

interface SceneTableProps {
  scenes: Scene[];
  allScenes: Scene[];
  department: Department;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: (sceneIndex: number) => void;
}

function SceneTable({ scenes, allScenes, department, onToggle, onDelete, onOpenDetail }: SceneTableProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  return (
    <div className="overflow-auto rounded-lg border border-bg-border">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="bg-bg-card border-b border-bg-border text-text-secondary text-xs">
            <th className="w-14 px-2 py-2 text-left font-medium">No</th>
            <th className="w-24 px-2 py-2 text-left font-medium">씬번호</th>
            <th className="w-20 px-2 py-2 text-left font-medium">담당자</th>
            <th className="w-20 px-2 py-2 text-left font-medium">레이아웃</th>
            <th className="px-2 py-2 text-left font-medium">메모</th>
            {STAGES.map((s) => (
              <th key={s} className="w-14 px-1 py-2 text-center font-medium">{deptConfig.stageLabels[s]}</th>
            ))}
            <th className="w-14 px-2 py-2 text-center font-medium">진행</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => {
            const pct = sceneProgress(scene);
            const idx = allScenes.indexOf(scene);
            return (
              <tr key={`${scene.sceneId}-${idx}`} className="border-b border-bg-border/50 hover:bg-bg-card/50 group cursor-pointer" onClick={() => onOpenDetail(idx)}>
                <td className="px-2 py-2 font-mono text-accent text-xs">#{scene.no}</td>
                <td className="px-2 py-2 text-text-primary text-xs truncate">{scene.sceneId || '-'}</td>
                <td className="px-2 py-2 text-text-secondary text-xs truncate">{scene.assignee || '-'}</td>
                <td className="px-2 py-2 text-text-secondary font-mono text-xs truncate">{scene.layoutId ? `#${scene.layoutId}` : '-'}</td>
                <td className="px-2 py-2 text-text-secondary text-xs truncate">{scene.memo || '-'}</td>
                {STAGES.map((stage) => (
                  <td key={stage} className="px-1 py-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
                      className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
                      style={
                        scene[stage]
                          ? { backgroundColor: deptConfig.stageColors[stage], color: '#0F1117' }
                          : { border: '1px solid #2D3041' }
                      }
                    >
                      {scene[stage] ? '✓' : ''}
                    </button>
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  <span className={cn(
                    'text-xs font-mono',
                    pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary'
                  )}>
                    {Math.round(pct)}%
                  </span>
                </td>
                <td className="px-1 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 씬 추가 폼 ────────────────────────────────────────────────

const ALPHABET_PREFIXES = 'abcdefghijklmnopqrstuvwx'.split('');

type PrefixMode = 'alphabet' | 'sc' | 'custom';

function suggestNextNumber(prefix: string, existingIds: string[]): string {
  const lp = prefix.toLowerCase();
  const nums = existingIds
    .filter((id) => id.toLowerCase().startsWith(lp))
    .map((id) => parseInt(id.slice(lp.length), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (nums.length === 0) return '001';

  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) return String(i + 1).padStart(3, '0');
  }
  return String(nums[nums.length - 1] + 1).padStart(3, '0');
}

/** 이미지 붙여넣기/파일선택 슬롯 (씬 추가 폼용) */
function AddFormImageSlot({
  label,
  base64,
  onSetBase64,
}: {
  label: string;
  base64: string;
  onSetBase64: (v: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'paste-hint'>('idle');
  const slotRef = useRef<HTMLDivElement>(null);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const { resizeBlob: rb } = await import('@/utils/imageUtils');
        const b64 = await rb(blob);
        onSetBase64(b64);
        setPhase('idle');
        return;
      }
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const { pasteImageFromClipboard: pic } = await import('@/utils/imageUtils');
      // 로컬 붙여넣기 (base64만 가져오기)
      const w = window as unknown as { electronAPI?: { readClipboardImage?: () => Promise<string> } };
      if (w.electronAPI?.readClipboardImage) {
        const raw = await w.electronAPI.readClipboardImage();
        if (raw) {
          const { resizeBlob: rb } = await import('@/utils/imageUtils');
          // raw is data URL
          const res = await fetch(raw);
          const blob = await res.blob();
          const b64 = await rb(blob);
          onSetBase64(b64);
          setPhase('idle');
          return;
        }
      }
      alert('클립보드에 이미지가 없습니다.');
    } catch {
      alert('클립보드 읽기 실패');
    }
  };

  const handleClick = () => {
    if (base64) return; // 이미 있으면 무시
    if (phase === 'idle') {
      setPhase('paste-hint');
      slotRef.current?.focus();
    } else {
      // 두번째 클릭 → 파일 선택
      setPhase('idle');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const { resizeBlob: rb } = await import('@/utils/imageUtils');
        const b64 = await rb(file);
        onSetBase64(b64);
      };
      input.click();
    }
  };

  if (base64) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-text-secondary">{label}</span>
        <div className="relative group">
          <img src={base64} alt={label} className="h-20 rounded border border-bg-border object-cover" draggable={false} />
          <button
            onClick={() => onSetBase64('')}
            className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-text-secondary">{label}</span>
      <div
        ref={slotRef}
        tabIndex={0}
        onClick={handleClick}
        onPaste={handlePaste}
        onBlur={() => setPhase('idle')}
        className={cn(
          'flex flex-col items-center justify-center gap-1 h-20 w-28 rounded-lg border-2 border-dashed cursor-pointer outline-none transition-all text-center',
          phase === 'paste-hint'
            ? 'border-accent bg-accent/10'
            : 'border-bg-border hover:border-text-secondary/30',
        )}
      >
        {phase === 'paste-hint' ? (
          <>
            <ClipboardPaste size={16} className="text-accent" />
            <p className="text-[9px] text-accent leading-tight">Ctrl+V 붙여넣기</p>
            <button
              onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard(); }}
              className="text-[9px] text-accent/70 underline hover:text-accent"
            >
              붙여넣기
            </button>
            <p className="text-[8px] text-text-secondary/40">한번 더 클릭 → 파일선택</p>
          </>
        ) : (
          <>
            <ImagePlus size={14} className="text-text-secondary/30" />
            <p className="text-[9px] text-text-secondary/40">클릭하여 추가</p>
          </>
        )}
      </div>
    </div>
  );
}

interface AddSceneFormProps {
  existingSceneIds: string[];
  sheetName: string;
  isLiveMode: boolean;
  onSubmit: (sceneId: string, assignee: string, memo: string, images?: { storyboard?: string; guide?: string }) => void;
  onCancel: () => void;
}

function AddSceneForm({ existingSceneIds, sheetName, isLiveMode, onSubmit, onCancel }: AddSceneFormProps) {
  const [prefixMode, setPrefixMode] = useState<PrefixMode>('alphabet');
  const [alphaPrefix, setAlphaPrefix] = useState('a');
  const [customPrefix, setCustomPrefix] = useState('');
  const [number, setNumber] = useState(() => suggestNextNumber('a', existingSceneIds));
  const [assignee, setAssignee] = useState('');
  const [memo, setMemo] = useState('');
  const [sbImage, setSbImage] = useState('');
  const [guideImage, setGuideImage] = useState('');

  const prefix = prefixMode === 'alphabet' ? alphaPrefix : prefixMode === 'sc' ? 'sc' : customPrefix;
  const sceneId = `${prefix}${number}`;
  const isDuplicate = existingSceneIds.includes(sceneId);

  const updatePrefix = (mode: PrefixMode, value?: string) => {
    setPrefixMode(mode);
    let newP = prefix;
    if (mode === 'alphabet') { newP = value ?? alphaPrefix; if (value) setAlphaPrefix(value); }
    else if (mode === 'sc') newP = 'sc';
    else if (mode === 'custom') newP = value ?? customPrefix;
    setNumber(suggestNextNumber(newP, existingSceneIds));
  };

  const stepNumber = (dir: 1 | -1) => {
    const n = parseInt(number, 10);
    if (isNaN(n)) return;
    const next = Math.max(1, n + dir);
    setNumber(String(next).padStart(3, '0'));
  };

  const handleSubmit = () => {
    if (isDuplicate || !prefix) return;
    const imgs = (sbImage || guideImage)
      ? { storyboard: sbImage || undefined, guide: guideImage || undefined }
      : undefined;
    onSubmit(sceneId, assignee, memo, imgs);
    const updatedIds = [...existingSceneIds, sceneId];
    setNumber(suggestNextNumber(prefix, updatedIds));
    setAssignee('');
    setMemo('');
    setSbImage('');
    setGuideImage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isDuplicate) handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="bg-bg-card border border-bg-border rounded-xl p-4 flex flex-col gap-4 shadow-lg shadow-accent/5">
      {/* ── 접두사 세그먼트 컨트롤 ── */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-text-secondary/60 font-medium w-14 shrink-0">접두사</span>
        <div className="flex items-center gap-2">
          {/* 세그먼트 라디오 (pill 스타일) */}
          <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
            {(['alphabet', 'sc', 'custom'] as PrefixMode[]).map((mode) => {
              const labels: Record<PrefixMode, string> = { alphabet: 'A-X', sc: 'SC', custom: '커스텀' };
              const isActive = prefixMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => updatePrefix(mode)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md transition-all duration-200 font-medium',
                    isActive
                      ? 'bg-accent text-white shadow-sm shadow-accent/30'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {labels[mode]}
                </button>
              );
            })}
          </div>

          {/* 접두사 값 선택/입력 */}
          {prefixMode === 'alphabet' && (
            <div className="relative">
              <select
                value={alphaPrefix}
                onChange={(e) => { setAlphaPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
                className="appearance-none bg-bg-primary border border-bg-border rounded-lg pl-3 pr-7 py-1 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all w-14"
              >
                {ALPHABET_PREFIXES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/40 pointer-events-none" />
            </div>
          )}
          {prefixMode === 'sc' && (
            <span className="px-3 py-1 text-sm text-accent font-mono font-bold bg-accent/10 rounded-lg border border-accent/20">sc</span>
          )}
          {prefixMode === 'custom' && (
            <input
              autoFocus
              value={customPrefix}
              onChange={(e) => { setCustomPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
              onKeyDown={handleKeyDown}
              placeholder="접두사 입력"
              className="w-24 bg-bg-primary border border-bg-border rounded-lg px-3 py-1 text-sm text-text-primary font-mono placeholder:text-text-secondary/30 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
          )}

          {/* 미리보기 뱃지 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-lg">
            <span className="text-[10px] text-accent/60">ID</span>
            <span className="text-xs text-accent font-mono font-bold">{sceneId}</span>
            {isDuplicate && (
              <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 rounded">중복</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 번호 + 담당자 + 메모 ── */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-secondary/60 font-medium w-14 shrink-0">번호</span>
        <div className="relative flex items-center">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="001"
            className={cn(
              'w-20 bg-bg-primary border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/30 pr-8 focus:ring-1 focus:ring-accent/20 outline-none transition-all',
              isDuplicate ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-bg-border focus:border-accent'
            )}
          />
          <div className="absolute right-1 top-1 bottom-1 flex flex-col gap-px">
            <button onClick={() => stepNumber(1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/40 hover:text-accent hover:bg-accent/10 transition-all" tabIndex={-1}>
              <ChevronUp size={10} />
            </button>
            <button onClick={() => stepNumber(-1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/40 hover:text-accent hover:bg-accent/10 transition-all" tabIndex={-1}>
              <ChevronDown size={10} />
            </button>
          </div>
        </div>

        <div className="w-px h-6 bg-bg-border" />

        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="담당자"
          className="w-24 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
        />
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메모 (선택)"
          className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
        />
      </div>

      {/* ── 이미지 슬롯 + 하단 버튼 ── */}
      <div className="flex items-end gap-3">
        <AddFormImageSlot label="스토리보드" base64={sbImage} onSetBase64={setSbImage} />
        <AddFormImageSlot label="가이드" base64={guideImage} onSetBase64={setGuideImage} />

        <div className="flex gap-2 ml-auto items-center">
          <span className="text-[10px] text-text-secondary/40">
            Enter 추가 · Esc 취소
          </span>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border hover:border-text-secondary/30 rounded-lg transition-all"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isDuplicate || !prefix}
            className={cn(
              'px-5 py-1.5 text-white text-xs font-medium rounded-lg transition-all',
              isDuplicate || !prefix
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30',
            )}
          >
            + 추가
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 메인 뷰 ──────────────────────────────────────────────────

export function ScenesView() {
  const episodes = useDataStore((s) => s.episodes);
  const toggleSceneStage = useDataStore((s) => s.toggleSceneStage);
  const addEpisodeOptimistic = useDataStore((s) => s.addEpisodeOptimistic);
  const addPartOptimistic = useDataStore((s) => s.addPartOptimistic);
  const addSceneOptimistic = useDataStore((s) => s.addSceneOptimistic);
  const deleteSceneOptimistic = useDataStore((s) => s.deleteSceneOptimistic);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const { sheetsConnected } = useAppStore();
  const { selectedEpisode, selectedPart, selectedAssignee, searchQuery, selectedDepartment } = useAppStore();
  const { sortKey, sortDir, statusFilter, sceneViewMode, sceneGroupMode } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery, setSelectedDepartment } = useAppStore();
  const { setSortKey, setSortDir, setStatusFilter, setSceneViewMode, setSceneGroupMode } = useAppStore();

  const deptConfig = DEPARTMENT_CONFIGS[selectedDepartment];

  const [showAddScene, setShowAddScene] = useState(false);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const clearCelebration = useCallback(() => setCelebratingId(null), []);
  const [detailSceneIndex, setDetailSceneIndex] = useState<number | null>(null);

  // 백그라운드 동기화: 낙관적 업데이트 후 서버/파일과 싱크
  const syncInBackground = async () => {
    try {
      if (sheetsConnected) {
        const { readAllFromSheets } = await import('@/services/sheetsService');
        const eps = await readAllFromSheets();
        setEpisodes(eps);
      }
      // 테스트 모드: 파일 쓰기는 이미 test 함수에서 처리됨
    } catch (err) {
      console.error('[백그라운드 동기화 실패]', err);
    }
  };

  // 에피소드 목록
  const episodeOptions = episodes.map((ep) => ({
    value: ep.episodeNumber,
    label: ep.title,
  }));

  // 선택된 에피소드 + 부서별 파트 필터링
  const currentEp = episodes.find((ep) => ep.episodeNumber === selectedEpisode) ?? episodes[0];
  const allParts = currentEp?.parts ?? [];
  const parts = allParts.filter((p) => p.department === selectedDepartment);
  const currentPart = parts.find((p) => p.partId === selectedPart) ?? parts[0];

  // 상세 모달에 표시할 씬 (스토어 업데이트 시 자동 갱신)
  const detailScene = detailSceneIndex !== null
    ? (currentPart?.scenes[detailSceneIndex] ?? null)
    : null;

  // 필터링
  let scenes = currentPart?.scenes ?? [];
  if (selectedAssignee) {
    scenes = scenes.filter((s) => s.assignee === selectedAssignee);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    scenes = scenes.filter(
      (s) =>
        s.sceneId.toLowerCase().includes(q) ||
        s.memo.toLowerCase().includes(q)
    );
  }
  // 상태 필터
  if (statusFilter === 'done') {
    scenes = scenes.filter(isFullyDone);
  } else if (statusFilter === 'not-started') {
    scenes = scenes.filter(isNotStarted);
  } else if (statusFilter === 'in-progress') {
    scenes = scenes.filter((s) => !isFullyDone(s) && !isNotStarted(s));
  }
  // 정렬
  scenes = [...scenes].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'no': cmp = a.no - b.no; break;
      case 'assignee': cmp = (a.assignee || '').localeCompare(b.assignee || ''); break;
      case 'progress': cmp = sceneProgress(a) - sceneProgress(b); break;
      case 'incomplete': {
        const aLeft = 4 - [a.lo, a.done, a.review, a.png].filter(Boolean).length;
        const bLeft = 4 - [b.lo, b.done, b.review, b.png].filter(Boolean).length;
        cmp = bLeft - aLeft; // 미완료 많은 것 먼저
        break;
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // 레이아웃별 그룹핑 (P1-4)
  const layoutGroups = (() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, Scene[]>();
    for (const scene of scenes) {
      const lid = (scene.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(scene);
      groups.set(key, arr);
    }
    // 정렬: 미분류를 맨 뒤로, 나머지는 번호순
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  })();

  // 담당자 목록 (현재 파트 기준)
  const assignees = Array.from(
    new Set((currentPart?.scenes ?? []).map((s) => s.assignee).filter(Boolean))
  );

  // 전체 진행도 (필터 기준)
  const totalChecks = scenes.length * 4;
  const doneChecks = scenes.reduce(
    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length,
    0
  );
  const overallPct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

  // 다음 에피소드 번호 계산
  const nextEpisodeNumber = episodes.length > 0
    ? Math.max(...episodes.map((ep) => ep.episodeNumber)) + 1
    : 1;

  // 다음 파트 ID 계산 (현재 부서의 파트 기준)
  const nextPartId = currentEp && parts.length > 0
    ? String.fromCharCode(
        Math.max(...parts.map((p) => p.partId.charCodeAt(0))) + 1
      )
    : 'A';

  // ─── 핸들러들 ─────────────────────────────────

  const handleToggle = async (sceneId: string, stage: Stage) => {
    if (!currentEp || !currentPart) return;

    const scene = currentPart.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;

    const newValue = !scene[stage];
    const sceneIndex = currentPart.scenes.findIndex((s) => s.sceneId === sceneId);

    toggleSceneStage(currentPart.sheetName, sceneId, stage);

    // 완료 축하 애니메이션: 방금 토글로 4단계 모두 완료 시
    if (newValue) {
      const afterToggle = { ...scene, [stage]: true };
      if (afterToggle.lo && afterToggle.done && afterToggle.review && afterToggle.png) {
        setCelebratingId(sceneId);
      }
    }

    try {
      if (sheetsConnected) {
        await updateSheetCell(currentPart.sheetName, sceneIndex, stage, newValue);
      } else {
        await toggleTestSceneStage(
          episodes, currentPart.sheetName, sceneId, stage
        );
      }
    } catch (err) {
      console.error('[토글 실패]', err);
      toggleSceneStage(currentPart.sheetName, sceneId, stage);
    }
  };

  const handleAddEpisode = async () => {
    // 낙관적 업데이트: UI 즉시 반영
    addEpisodeOptimistic(nextEpisodeNumber, selectedDepartment);
    setSelectedEpisode(nextEpisodeNumber);

    // 백그라운드에서 서버/파일에 저장
    try {
      if (sheetsConnected) {
        await addEpisodeToSheets(nextEpisodeNumber, selectedDepartment);
        syncInBackground();
      } else {
        await addTestEpisode(episodes, nextEpisodeNumber, selectedDepartment);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`에피소드 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`에피소드 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  const handleAddPart = async () => {
    if (!currentEp) return;
    if (nextPartId > 'Z') {
      alert('파트는 Z까지만 가능합니다');
      return;
    }

    // 낙관적 업데이트
    addPartOptimistic(currentEp.episodeNumber, nextPartId, selectedDepartment);
    setSelectedPart(nextPartId);

    try {
      if (sheetsConnected) {
        await addPartToSheets(currentEp.episodeNumber, nextPartId, selectedDepartment);
        syncInBackground();
      } else {
        await addTestPart(episodes, currentEp.episodeNumber, nextPartId, selectedDepartment);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`파트 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`파트 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  const handleAddScene = async (sceneId: string, assignee: string, memo: string, images?: { storyboard?: string; guide?: string }) => {
    if (!currentPart) return;

    const sceneIndex = currentPart.scenes.length; // 새 씬의 인덱스

    // 낙관적 업데이트 (폼은 닫지 않음 — 연속 입력 지원)
    addSceneOptimistic(currentPart.sheetName, sceneId, assignee, memo);

    try {
      if (sheetsConnected) {
        await addSceneToSheets(currentPart.sheetName, sceneId, assignee, memo);
        syncInBackground();
      } else {
        await addTestScene(episodes, currentPart.sheetName, sceneId, assignee, memo);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`씬 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`씬 추가 실패: ${err}`);
      }
      syncInBackground();
    }

    // 이미지가 있으면 백그라운드에서 업로드
    if (images?.storyboard || images?.guide) {
      (async () => {
        try {
          const { saveImage } = await import('@/utils/imageUtils');
          if (images.storyboard) {
            const url = await saveImage(images.storyboard, currentPart.sheetName, sceneId, 'storyboard', sheetsConnected);
            handleFieldUpdate(sceneIndex, 'storyboardUrl', url);
          }
          if (images.guide) {
            const url = await saveImage(images.guide, currentPart.sheetName, sceneId, 'guide', sheetsConnected);
            handleFieldUpdate(sceneIndex, 'guideUrl', url);
          }
        } catch (err) {
          console.error('[씬 추가 이미지 업로드 실패]', err);
        }
      })();
    }
  };

  const handleDeleteScene = async (sceneIndex: number) => {
    if (!currentPart) return;
    if (!confirm('이 씬을 삭제하시겠습니까?')) return;

    // 낙관적 업데이트
    deleteSceneOptimistic(currentPart.sheetName, sceneIndex);

    try {
      if (sheetsConnected) {
        await deleteSceneFromSheets(currentPart.sheetName, sceneIndex);
        syncInBackground();
      } else {
        await deleteTestScene(episodes, currentPart.sheetName, sceneIndex);
      }
    } catch (err) {
      alert(`씬 삭제 실패: ${err}`);
      syncInBackground();
    }
  };

  const handleFieldUpdate = async (sceneIndex: number, field: string, value: string) => {
    if (!currentPart) return;

    // 낙관적 업데이트
    updateSceneFieldOptimistic(currentPart.sheetName, sceneIndex, field, value);

    try {
      if (sheetsConnected) {
        await updateSceneFieldInSheets(currentPart.sheetName, sceneIndex, field, value);
        syncInBackground();
      } else {
        await updateTestSceneField(episodes, currentPart.sheetName, sceneIndex, field, value);
      }
    } catch (err) {
      alert(`수정 실패: ${err}`);
      syncInBackground();
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 bg-bg-card border border-bg-border rounded-xl p-3">
        {/* 부서 탭 */}
        <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
          {DEPARTMENTS.map((dept) => {
            const cfg = DEPARTMENT_CONFIGS[dept];
            const isActive = selectedDepartment === dept;
            return (
              <button
                key={dept}
                onClick={() => { setSelectedDepartment(dept); setSelectedPart(null); }}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-all duration-200 font-medium',
                  isActive
                    ? 'text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
                style={isActive ? { backgroundColor: cfg.color } : undefined}
              >
                {cfg.shortLabel}
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-bg-border" />

        {/* 에피소드 선택 */}
        <select
          value={selectedEpisode ?? currentEp?.episodeNumber ?? ''}
          onChange={(e) => setSelectedEpisode(Number(e.target.value))}
          className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
        >
          {episodeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* 에피소드 추가 */}
        <button
          onClick={handleAddEpisode}

          className="px-2.5 py-1.5 bg-accent/20 text-accent text-xs rounded-lg hover:bg-accent/30 transition-colors"
          title={`EP.${String(nextEpisodeNumber).padStart(2, '0')} 추가`}
        >
          + EP
        </button>

        {/* 파트 탭 */}
        <div className="flex gap-1">
          {parts.map((part) => (
            <button
              key={part.partId}
              onClick={() => setSelectedPart(part.partId)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors',
                (selectedPart ?? parts[0]?.partId) === part.partId
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary'
              )}
            >
              {part.partId}파트
            </button>
          ))}
          {/* 파트 추가 */}
          {currentEp && (
            <button
              onClick={handleAddPart}
    
              className="px-2.5 py-1.5 bg-bg-primary text-text-secondary text-sm rounded-lg hover:text-accent hover:border-accent border border-bg-border transition-colors"
              title={`${nextPartId}파트 추가`}
            >
              +
            </button>
          )}
        </div>

        {/* 담당자 필터 */}
        <div className="flex gap-1">
          <button
            onClick={() => setSelectedAssignee(null)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs transition-colors',
              !selectedAssignee
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            전체
          </button>
          {assignees.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedAssignee(name)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                selectedAssignee === name
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {/* 구분선 */}
        <div className="w-px h-6 bg-bg-border" />

        {/* 상태 필터 */}
        {(['all', 'not-started', 'in-progress', 'done'] as StatusFilter[]).map((f) => {
          const labels: Record<StatusFilter, string> = {
            all: '전체', 'not-started': '미착수', 'in-progress': '진행중', done: '완료',
          };
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2 py-1 rounded-md text-xs transition-colors',
                statusFilter === f
                  ? f === 'done' ? 'bg-green-500/20 text-green-400'
                    : f === 'not-started' ? 'bg-red-500/20 text-red-400'
                    : f === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {labels[f]}
            </button>
          );
        })}

        {/* 오른쪽 그룹: 정렬 + 뷰모드 + 검색 */}
        <div className="flex items-center gap-2 ml-auto">
          {/* 정렬 */}
          <div className="flex items-center gap-1">
            <ArrowUpDown size={14} className="text-text-secondary" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-bg-primary border border-bg-border rounded px-2 py-1 text-xs text-text-primary"
            >
              <option value="no">번호순</option>
              <option value="assignee">담당자순</option>
              <option value="progress">진행률순</option>
              <option value="incomplete">미완료 우선</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="px-1.5 py-1 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-bg-border/50"
              title={sortDir === 'asc' ? '오름차순' : '내림차순'}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/* 그룹 모드 토글 */}
          <div className="flex border border-bg-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSceneGroupMode('flat')}
              className={cn(
                'p-1.5 transition-colors',
                sceneGroupMode === 'flat' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="씬번호별"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setSceneGroupMode('layout')}
              className={cn(
                'p-1.5 transition-colors',
                sceneGroupMode === 'layout' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="레이아웃별"
            >
              <Layers size={14} />
            </button>
          </div>

          {/* 뷰 모드 토글 */}
          <div className="flex border border-bg-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSceneViewMode('card')}
              className={cn(
                'p-1.5 transition-colors',
                sceneViewMode === 'card' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="카드 뷰"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setSceneViewMode('table')}
              className={cn(
                'p-1.5 transition-colors',
                sceneViewMode === 'table' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="테이블 뷰"
            >
              <Table2 size={14} />
            </button>
          </div>

          {/* 검색 */}
          <input
            type="text"
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 w-36"
          />
        </div>
      </div>

      {/* 상단 고정 진행도 */}
      <div className="flex items-center gap-3 bg-bg-card border border-bg-border rounded-xl px-4 py-2">
        <span className="text-sm text-text-secondary">
          {scenes.length}씬 표시 중
        </span>
        <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${overallPct}%`, background: progressGradient(overallPct) }}
          />
        </div>
        <span className="text-sm font-bold text-accent">{overallPct}%</span>
        {/* 씬 추가 버튼 */}
        {currentPart && (
          <button
            onClick={() => setShowAddScene(true)}
  
            className="px-3 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent/80 transition-colors"
          >
            + 씬 추가
          </button>
        )}
      </div>

      {/* 씬 추가 폼 */}
      {showAddScene && (
        <AddSceneForm
          existingSceneIds={(currentPart?.scenes ?? []).map((s) => s.sceneId)}
          sheetName={currentPart?.sheetName ?? ''}
          isLiveMode={sheetsConnected}
          onSubmit={handleAddScene}
          onCancel={() => setShowAddScene(false)}
        />
      )}

      {/* 씬 목록 */}
      <div className="relative flex-1">
        {/* 파트 완료 보케 오버레이 */}
        <AnimatePresence>
          {scenes.length > 0 && overallPct >= 100 && <PartCompleteOverlay />}
        </AnimatePresence>

      {scenes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary h-full">
          표시할 씬이 없습니다.
        </div>
      ) : sceneGroupMode === 'layout' && layoutGroups ? (
        /* ── 레이아웃별 그룹 뷰 (P1-4) ── */
        <div className="flex-1 overflow-auto flex flex-col gap-4">
          {layoutGroups.map(([layoutKey, groupScenes]) => {
            const groupTotal = groupScenes.length * 4;
            const groupDone = groupScenes.reduce(
              (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length, 0
            );
            const groupPct = groupTotal > 0 ? Math.round((groupDone / groupTotal) * 100) : 0;
            const sceneIds = groupScenes.map((s) => s.sceneId).join(', ');

            return (
              <div key={layoutKey} className="flex flex-col gap-2">
                {/* 레이아웃 그룹 헤더 */}
                <div className="flex items-center gap-3 bg-bg-card/50 border border-bg-border rounded-lg px-4 py-2">
                  <Layers size={14} className="text-accent" />
                  <span className="text-sm font-bold text-text-primary">
                    레이아웃 #{layoutKey}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {sceneIds}
                  </span>
                  <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden ml-2">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${groupPct}%`,
                        background: progressGradient(groupPct),
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-secondary">{groupPct}%</span>
                </div>

                {/* 그룹 내 씬들 */}
                {sceneViewMode === 'table' ? (
                  <SceneTable
                    scenes={groupScenes}
                    allScenes={currentPart?.scenes ?? []}
                    department={selectedDepartment}
                    onToggle={handleToggle}
                    onDelete={handleDeleteScene}
                    onOpenDetail={(idx) => setDetailSceneIndex(idx)}
                  />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                    {groupScenes.map((scene, idx) => {
                      const sIdx = currentPart?.scenes.indexOf(scene) ?? idx;
                      return (
                        <SceneCard
                          key={`${scene.sceneId}-${idx}`}
                          scene={scene}
                          sceneIndex={sIdx}
                          celebrating={celebratingId === scene.sceneId}
                          department={selectedDepartment}
                          onToggle={handleToggle}
                          onDelete={handleDeleteScene}
                          onOpenDetail={() => setDetailSceneIndex(sIdx)}
                          onCelebrationEnd={clearCelebration}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : sceneViewMode === 'table' ? (
        /* ── 테이블 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto">
          <SceneTable
            scenes={scenes}
            allScenes={currentPart?.scenes ?? []}
            department={selectedDepartment}
            onToggle={handleToggle}
            onDelete={handleDeleteScene}
            onOpenDetail={(idx) => setDetailSceneIndex(idx)}
          />
        </div>
      ) : (
        /* ── 카드 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 content-start">
          {scenes.map((scene, idx) => {
            const sIdx = currentPart?.scenes.indexOf(scene) ?? idx;
            return (
              <SceneCard
                key={`${scene.sceneId}-${idx}`}
                scene={scene}
                sceneIndex={sIdx}
                celebrating={celebratingId === scene.sceneId}
                department={selectedDepartment}
                onToggle={handleToggle}
                onDelete={handleDeleteScene}
                onOpenDetail={() => setDetailSceneIndex(sIdx)}
                onCelebrationEnd={clearCelebration}
              />
            );
          })}
        </div>
      )}
      </div>

      {/* 씬 상세 모달 */}
      {detailScene && detailSceneIndex !== null && (
        <SceneDetailModal
          scene={detailScene}
          sceneIndex={detailSceneIndex}
          sheetName={currentPart?.sheetName ?? ''}
          isLiveMode={sheetsConnected}
          department={selectedDepartment}
          onFieldUpdate={handleFieldUpdate}
          onToggle={handleToggle}
          onClose={() => setDetailSceneIndex(null)}
        />
      )}
    </div>
  );
}
