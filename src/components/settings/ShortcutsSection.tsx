import { useState, useEffect, useCallback, useRef } from 'react';
import { Keyboard, RotateCcw, Search } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

/* ── 단축키 정의 ── */

interface ShortcutDef {
  id: string;
  label: string;
  description: string;
  defaultKeys: string;
  category: '탐색' | '뷰 전환' | '편집' | '시스템';
}

const SHORTCUTS: ShortcutDef[] = [
  // 탐색
  { id: 'spotlight',     label: '스포트라이트 검색',   description: '어디서든 빠른 검색',            defaultKeys: 'Ctrl+Space',   category: '탐색' },
  { id: 'escape',       label: '닫기 / 취소',         description: '모달, 검색창 등 닫기',          defaultKeys: 'Escape',       category: '탐색' },
  // 뷰 전환
  { id: 'nav-dashboard', label: '대시보드',             description: '대시보드 뷰로 이동',            defaultKeys: 'Ctrl+1',       category: '뷰 전환' },
  { id: 'nav-episode',   label: '에피소드',             description: '에피소드 뷰로 이동',            defaultKeys: 'Ctrl+2',       category: '뷰 전환' },
  { id: 'nav-scenes',    label: '씬 목록',              description: '씬 목록 뷰로 이동',             defaultKeys: 'Ctrl+3',       category: '뷰 전환' },
  { id: 'nav-assignee',  label: '인원별',               description: '인원별 뷰로 이동',              defaultKeys: 'Ctrl+4',       category: '뷰 전환' },
  { id: 'nav-team',      label: '팀원',                 description: '팀원 뷰로 이동',                defaultKeys: 'Ctrl+5',       category: '뷰 전환' },
  { id: 'nav-timeline',  label: '타임라인',             description: '타임라인 뷰로 이동',            defaultKeys: 'Ctrl+6',       category: '뷰 전환' },
  { id: 'nav-calendar',  label: '캘린더',               description: '캘린더 뷰로 이동',              defaultKeys: 'Ctrl+7',       category: '뷰 전환' },
  { id: 'nav-settings',  label: '설정',                 description: '설정 뷰로 이동',                defaultKeys: 'Ctrl+8',       category: '뷰 전환' },
  // 편집
  { id: 'edit-mode',     label: '레이아웃 편집 토글',   description: '대시보드 위젯 편집 모드',        defaultKeys: 'Ctrl+E',       category: '편집' },
  { id: 'sidebar-toggle', label: '사이드바 토글',       description: '사이드바 펼치기/접기',           defaultKeys: 'Ctrl+B',       category: '편집' },
  // 시스템
  { id: 'admin-mode',    label: '관리자 모드',          description: '관리자 모드 토글',               defaultKeys: 'Ctrl+Alt+U',   category: '시스템' },
  { id: 'reload',        label: '새로고침',             description: '현재 데이터 새로 불러오기',      defaultKeys: 'Ctrl+R',       category: '시스템' },
  { id: 'fullscreen',    label: '전체 화면',            description: '전체 화면 토글',                 defaultKeys: 'F11',          category: '시스템' },
];

const CATEGORY_ORDER = ['탐색', '뷰 전환', '편집', '시스템'] as const;

type CustomBindings = Record<string, string>;

/* ── 키 이벤트 → 문자열 변환 ── */

function eventToKeyString(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  // 수식 키만 누른 경우 무시
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null;

  if (key === ' ') parts.push('Space');
  else if (key === 'Escape') parts.push('Escape');
  else if (key.length === 1) parts.push(key.toUpperCase());
  else parts.push(key); // F1, F11, ArrowDown, etc.

  return parts.join('+');
}

/* ── 키 뱃지 렌더링 ── */

function KeyBadge({ keyStr, active }: { keyStr: string; active?: boolean }) {
  const keys = keyStr.split('+');
  return (
    <div className="flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="text-text-secondary/30 mx-0.5 text-[10px]">+</span>}
          <kbd
            className={cn(
              'inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md text-[11px] font-mono font-medium border',
              active
                ? 'bg-accent/15 text-accent border-accent/30 shadow-sm shadow-accent/10'
                : 'bg-bg-primary/60 text-text-secondary/70 border-bg-border/50',
            )}
          >
            {k === 'Escape' ? 'Esc' : k}
          </kbd>
        </span>
      ))}
    </div>
  );
}

/* ── 단축키 행 ── */

function ShortcutRow({ def, customKeys, onRecord, conflict }: {
  def: ShortcutDef;
  customKeys?: string;
  onRecord: (id: string) => void;
  conflict?: string;
}) {
  const current = customKeys || def.defaultKeys;
  const isModified = !!customKeys && customKeys !== def.defaultKeys;

  return (
    <div className="flex items-center gap-3 py-2.5 group">
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', isModified ? 'text-accent' : 'text-text-primary')}>
          {def.label}
        </p>
        <p className="text-[10px] text-text-secondary/40 mt-0.5">{def.description}</p>
      </div>
      <button
        onClick={() => onRecord(def.id)}
        className="shrink-0 cursor-pointer group/btn rounded-lg px-2 py-1 hover:bg-bg-border/30 transition-colors"
        title="클릭하여 단축키 변경"
      >
        <KeyBadge keyStr={current} />
      </button>
      {conflict && (
        <span className="text-[10px] text-amber-400 shrink-0">충돌</span>
      )}
    </div>
  );
}

/* ── 녹음 모달 (인라인 오버레이) ── */

function RecordOverlay({ shortcutId, onDone, onCancel, existingBindings, shortcuts }: {
  shortcutId: string;
  onDone: (id: string, keys: string) => void;
  onCancel: () => void;
  existingBindings: CustomBindings;
  shortcuts: ShortcutDef[];
}) {
  const [captured, setCaptured] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const def = shortcuts.find(s => s.id === shortcutId)!;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        onCancel();
        return;
      }

      const keyStr = eventToKeyString(e);
      if (!keyStr) return;

      setCaptured(keyStr);

      // 충돌 감지
      const conflictWith = shortcuts.find(s => {
        if (s.id === shortcutId) return false;
        const binding = existingBindings[s.id] || s.defaultKeys;
        return binding === keyStr;
      });
      setConflict(conflictWith ? conflictWith.label : null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [shortcutId, existingBindings, shortcuts, onCancel]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-[360px] rounded-2xl p-6 border border-bg-border/50"
        style={{
          background: 'rgb(var(--color-bg-card) / 0.95)',
          boxShadow: '0 24px 48px rgb(0 0 0 / 0.4)',
        }}
      >
        <p className="text-sm font-medium text-text-primary mb-1">
          단축키 변경: <span className="text-accent">{def.label}</span>
        </p>
        <p className="text-[11px] text-text-secondary/50 mb-5">
          원하는 키 조합을 누르세요
        </p>

        <div className="flex items-center justify-center h-16 rounded-xl bg-bg-primary/60 border border-bg-border/30 mb-4">
          {captured ? (
            <KeyBadge keyStr={captured} active />
          ) : (
            <span className="text-xs text-text-secondary/40 animate-pulse">키 입력 대기중...</span>
          )}
        </div>

        {conflict && (
          <p className="text-[11px] text-amber-400 mb-3 text-center">
            "{conflict}"과(와) 충돌합니다
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-xs font-medium text-text-secondary bg-bg-border/30 hover:bg-bg-border/50 transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={() => captured && onDone(shortcutId, captured)}
            disabled={!captured}
            className={cn(
              'flex-1 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer',
              captured
                ? 'bg-accent text-white hover:bg-accent/80'
                : 'bg-bg-border/20 text-text-secondary/30 cursor-not-allowed',
            )}
          >
            적용
          </button>
        </div>

        <p className="text-[10px] text-text-secondary/30 mt-3 text-center">
          ESC를 누르면 취소됩니다
        </p>
      </div>
    </div>
  );
}

/* ── 메인 섹션 ── */

export function ShortcutsSection() {
  const [customBindings, setCustomBindings] = useState<CustomBindings>({});
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadPreferences().then((prefs) => {
      if (prefs?.shortcuts) setCustomBindings(prefs.shortcuts as CustomBindings);
    });
  }, []);

  const persist = useCallback(async (bindings: CustomBindings) => {
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, shortcuts: bindings });
  }, []);

  const handleRecord = useCallback((id: string) => {
    setRecordingId(id);
  }, []);

  const handleDone = useCallback((id: string, keys: string) => {
    const def = SHORTCUTS.find(s => s.id === id);
    const next = { ...customBindings };
    // 기본값이면 커스텀에서 제거
    if (def && keys === def.defaultKeys) {
      delete next[id];
    } else {
      next[id] = keys;
    }
    setCustomBindings(next);
    persist(next);
    setRecordingId(null);
  }, [customBindings, persist]);

  const handleReset = useCallback(() => {
    setCustomBindings({});
    persist({});
  }, [persist]);

  const modifiedCount = Object.keys(customBindings).length;

  // 충돌 맵 구축
  const conflictMap = new Map<string, string>();
  const allBindings = SHORTCUTS.map(s => ({
    id: s.id,
    keys: customBindings[s.id] || s.defaultKeys,
  }));
  for (let i = 0; i < allBindings.length; i++) {
    for (let j = i + 1; j < allBindings.length; j++) {
      if (allBindings[i].keys === allBindings[j].keys) {
        conflictMap.set(allBindings[i].id, allBindings[j].id);
        conflictMap.set(allBindings[j].id, allBindings[i].id);
      }
    }
  }

  // 필터링
  const filtered = filter
    ? SHORTCUTS.filter(s =>
        s.label.includes(filter) || s.description.includes(filter) ||
        (customBindings[s.id] || s.defaultKeys).toLowerCase().includes(filter.toLowerCase())
      )
    : SHORTCUTS;

  return (
    <SettingsSection
      icon={<Keyboard size={18} className="text-accent" />}
      title="단축키"
      action={
        <button
          onClick={handleReset}
          disabled={modifiedCount === 0}
          className={cn(
            'flex items-center gap-1 text-[11px] transition-colors cursor-pointer',
            modifiedCount > 0
              ? 'text-text-secondary/50 hover:text-text-primary'
              : 'text-text-secondary/20 cursor-not-allowed',
          )}
        >
          <RotateCcw size={12} />
          기본값 복원{modifiedCount > 0 && ` (${modifiedCount})`}
        </button>
      }
    >
      {/* 검색 */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/40" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="단축키 검색..."
          className="w-full pl-9 pr-3 py-2 rounded-lg text-xs bg-bg-primary/50 border border-bg-border/30 text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent/30 transition-colors"
        />
      </div>

      {/* 카테고리별 목록 */}
      {CATEGORY_ORDER.map((cat) => {
        const items = filtered.filter(s => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="mb-4 last:mb-0">
            <p className="text-[10px] text-text-secondary/40 uppercase tracking-wider font-medium mb-1 px-1">{cat}</p>
            <div className="bg-bg-primary/40 rounded-xl border border-bg-border/30 px-4 divide-y divide-bg-border/15">
              {items.map((def) => (
                <ShortcutRow
                  key={def.id}
                  def={def}
                  customKeys={customBindings[def.id]}
                  onRecord={handleRecord}
                  conflict={conflictMap.has(def.id) ? conflictMap.get(def.id) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-xs text-text-secondary/40">검색 결과 없음</p>
        </div>
      )}

      <p className="text-[10px] text-text-secondary/30 mt-3">
        * 클릭하면 새 키 조합을 녹음할 수 있습니다. 일부 시스템 단축키는 변경할 수 없습니다.
      </p>

      {/* 녹음 오버레이 */}
      {recordingId && (
        <RecordOverlay
          shortcutId={recordingId}
          onDone={handleDone}
          onCancel={() => setRecordingId(null)}
          existingBindings={customBindings}
          shortcuts={SHORTCUTS}
        />
      )}
    </SettingsSection>
  );
}
