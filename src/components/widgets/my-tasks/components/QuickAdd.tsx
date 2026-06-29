/**
 * QuickAdd — '내 할일' 위젯 빠른 추가 (시안15).
 *
 * + 버튼으로 열리는 인라인 입력칸. 씬 이름/번호를 치면 자동완성 드롭다운에서 골라 추가하고,
 * 매칭되는 씬이 없는 일반 텍스트는 개인 할일로(일정 없이) 추가한다.
 *
 * 드롭다운은 앵커드 포털(AssigneeMultiSelect + GlassDropdown 패턴):
 *  - createPortal(document.body) + position:fixed + 입력칸 getBoundingClientRect 기준 배치
 *  - 아래 공간 부족 시 위로 플립 + maxHeight + 내부 스크롤 (작은 팝업 창 경계 클리핑 방지)
 *  - scroll/resize 재계산(capture), 외부 클릭 닫힘
 * 한글 IME 조합 중 Enter/방향키 중복 입력은 isComposing/keyCode 229 가드로 막는다.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Plus, X, CornerDownLeft, Layers } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEPARTMENT_CONFIGS } from '@/types';
import { filterSceneCandidates } from '../quickAddUtils';
import type { SceneKey, FlatScene } from '../types';

interface DropdownPos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxH: number;
}

interface QuickAddProps {
  open: boolean;
  onClose: () => void;
  /** 전체 씬 후보 (부모가 useAllEpisodesFlat 로 한 번만 구독해 내려줌 — 재구독 회피) */
  candidates: FlatScene[];
  episodeTitles: Record<number, string>;
  existingKeys: Set<SceneKey>;
  currentUserName: string;
  onAddScene: (key: SceneKey) => void;
  /** 일반 텍스트 → 개인 할일(부모가 PersonalTodo 객체로 변환) */
  onAddPersonalTodo: (title: string) => void;
  /** '여러 씬 한번에 추가' → 다중 선택 모달 */
  onOpenFullPicker: () => void;
}

export function QuickAdd({
  open,
  onClose,
  candidates,
  episodeTitles,
  existingKeys,
  currentUserName,
  onAddScene,
  onAddPersonalTodo,
  onOpenFullPicker,
}: QuickAddProps) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<DropdownPos | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterSceneCandidates(candidates, value, currentUserName, existingKeys),
    [candidates, value, currentUserName, existingKeys],
  );

  const query = value.trim();
  const showDropdown = open && query.length > 0;

  // 열릴 때 포커스 + 초기화
  useEffect(() => {
    if (open) {
      setValue('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // 활성 인덱스는 첫 '추가 가능' 후보로 초기화 — 이미 추가된(비활성) 항목에 하이라이트/Enter가 갇히지 않게.
  useEffect(() => {
    const i = filtered.findIndex((c) => !c.alreadyAdded);
    setActive(i >= 0 ? i : 0);
  }, [filtered]);

  // 드롭다운 위치 계산 (아래 공간 부족 시 위로 플립)
  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const pad = 8;
    const spaceBelow = vh - rect.bottom - pad;
    const spaceAbove = rect.top - pad;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxH = Math.min(300, Math.max(96, openUp ? spaceAbove : spaceBelow));
    const width = rect.width;
    const left = Math.max(pad, Math.min(rect.left, vw - width - pad));
    setPos(
      openUp
        ? { left, width, bottom: vh - rect.top + 6, maxH }
        : { left, width, top: rect.bottom + 6, maxH },
    );
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    updatePos();
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [showDropdown, value, filtered.length, updatePos]);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      // 헤더의 +(토글) 버튼 클릭은 그 버튼의 onClick(토글 닫기)에 맡긴다 — 외부클릭으로 먼저 닫으면
      // 곧이은 click 이 다시 열어 토글이 먹통이 된다.
      if (el.closest?.('[data-quickadd-toggle]')) return;
      const t = e.target as Node;
      if (
        wrapRef.current && !wrapRef.current.contains(t) &&
        (!listRef.current || !listRef.current.contains(t))
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const commitScene = useCallback((cand: { flat: FlatScene; alreadyAdded: boolean }) => {
    if (cand.alreadyAdded) return;
    onAddScene(cand.flat.key);
    setValue('');
    setActive(0);
    inputRef.current?.focus();
  }, [onAddScene]);

  const commitPersonal = useCallback(() => {
    if (!query) return;
    onAddPersonalTodo(query);
    setValue('');
    setActive(0);
    inputRef.current?.focus();
  }, [query, onAddPersonalTodo]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글 IME 조합 중 Enter/방향키 중복 발화 방지
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (filtered.length > 0) {
        e.preventDefault();
        setActive((a) => (a + 1) % filtered.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (filtered.length > 0) {
        e.preventDefault();
        setActive((a) => (a - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        // 활성 항목이 추가 가능하면 그걸, 아니면 첫 추가 가능 항목을 추가.
        // 매칭이 전부 '추가됨'이면 no-op('추가됨' 라벨이 피드백) — 개인할일로 오삽입하지 않는다.
        const target = filtered[active] && !filtered[active].alreadyAdded
          ? filtered[active]
          : filtered.find((c) => !c.alreadyAdded);
        if (target) commitScene(target);
      } else if (query) {
        commitPersonal();
      }
      return;
    }
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-visible px-1 pb-1"
    >
      <div ref={wrapRef} className="flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-bg-primary border border-accent/40 rounded-lg px-2 py-1.5 focus-within:border-accent transition-colors">
          <Plus size={13} className="text-accent shrink-0" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="a001 입력 또는 메모…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-secondary/35"
            aria-label="씬 또는 개인 할일 빠른 추가"
          />
        </div>
        {/* 상시 보조: 여러 씬 한번에 추가 */}
        <button
          onClick={onOpenFullPicker}
          className="p-1.5 text-text-secondary/45 hover:text-accent hover:bg-accent/8 rounded-lg cursor-pointer transition-colors shrink-0"
          title="여러 씬 한번에 추가"
          aria-label="여러 씬 한번에 추가"
        >
          <Layers size={14} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-text-secondary/40 hover:text-text-secondary hover:bg-bg-border/20 rounded-lg cursor-pointer transition-colors shrink-0"
          title="닫기"
          aria-label="빠른 추가 닫기"
        >
          <X size={14} />
        </button>
      </div>

      {/* 자동완성 드롭다운 (앵커드 포털) */}
      {showDropdown && pos && createPortal(
        <div
          ref={listRef}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[10000] bg-bg-card border border-bg-border rounded-lg shadow-2xl overflow-y-auto py-1"
          style={{
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: pos.maxH,
          }}
          role="listbox"
          aria-label="씬 자동완성"
        >
          {filtered.length > 0 ? (
            filtered.map((cand, i) => {
              const f = cand.flat;
              const s = f.scene;
              const deptCfg = DEPARTMENT_CONFIGS[f.department];
              const epLabel = episodeTitles[f.episodeNumber] || `EP.${String(f.episodeNumber).padStart(2, '0')}`;
              const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no ?? '');
              const prevEp = i > 0 ? filtered[i - 1].flat.episodeNumber : null;
              const showDivider = i > 0 && prevEp !== f.episodeNumber;
              return (
                <div key={f.key}>
                  {showDivider && <div className="my-1 mx-2 border-t border-bg-border/30" />}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    disabled={cand.alreadyAdded}
                    onClick={() => commitScene(cand)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                      cand.alreadyAdded
                        ? 'opacity-40 cursor-not-allowed'
                        : i === active
                        ? 'bg-accent/12 cursor-pointer'
                        : 'hover:bg-accent/8 cursor-pointer',
                    )}
                  >
                    {/* 내 담당 펄스 점 */}
                    <span className="w-1.5 shrink-0 flex justify-center">
                      {cand.isMine && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
                          aria-label="내 담당"
                        />
                      )}
                    </span>
                    {/* 부서(BG/ACT) — 같은 파트·번호에 BG/ACT 행이 공존할 수 있어 부서로 구분(P2) */}
                    <span
                      className="text-[9px] font-semibold px-1 rounded shrink-0"
                      style={{ color: deptCfg.stageColors.png, backgroundColor: `${deptCfg.stageColors.png}1f` }}
                    >
                      {deptCfg.shortLabel}
                    </span>
                    <span className="text-[10px] text-text-secondary/45 shrink-0">{epLabel} &gt; {f.partId}</span>
                    <span className="text-[11px] font-mono text-accent shrink-0">#{sceneNum}</span>
                    <span className="text-xs text-text-primary truncate flex-1">{s.sceneId}</span>
                    {cand.alreadyAdded && (
                      <span className="text-[10px] text-text-secondary/50 shrink-0">추가됨</span>
                    )}
                  </button>
                </div>
              );
            })
          ) : (
            <button
              type="button"
              onClick={commitPersonal}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/8 cursor-pointer transition-colors"
            >
              <CornerDownLeft size={13} className="text-accent shrink-0" />
              <span className="text-xs text-text-secondary/80 truncate">
                <span className="text-text-primary font-medium">‘{query}’</span> 개인 할일로 추가
              </span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </motion.div>
  );
}
