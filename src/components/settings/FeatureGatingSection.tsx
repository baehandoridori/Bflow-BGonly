/**
 * 관리자 전용 — 기능 노출 관리 (게이팅).
 *
 * metadata(type='feature-access', key=<기능키>) 의 value(JSON 문자열)에
 *   { userIds: string[], allowAdmin: boolean } 을 저장한다.
 * 사용자가 userIds 에 들어있거나 (allowAdmin && role==='admin') 이면 그 기능이 노출된다.
 *   - 캐릭터 현황판 접근 게이트(useCharacterBoardAccess)가 같은 메타를 읽는다.
 *
 * FEATURES 레지스트리에 항목을 추가하면 자동으로 행이 늘어난다 (확장 가능).
 * 각 기능마다:
 *   - 사용자 멀티선택 (체크박스 목록 드롭다운)
 *   - "관리자 자동 포함" 토글 (allowAdmin)
 * 저장은 즉시 반영(낙관적) — 저장 버튼 없이 변경 시 곧바로 metadata 기록.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, ChevronDown, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { readMetadataFromSupabase, writeMetadataToSupabase } from '@/services/supabaseService';
import { cn } from '@/utils/cn';

/** 게이팅 대상 기능 레지스트리 — 새 기능은 여기에 한 줄 추가. */
const FEATURES: { key: string; label: string }[] = [
  { key: 'character-board', label: '캐릭터 현황판' },
];

interface FeatureAccessConfig {
  userIds: string[];
  allowAdmin: boolean;
}

function parseConfig(raw: unknown): FeatureAccessConfig {
  let value: unknown = raw;
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    value = (raw as Record<string, unknown>).value;
  }
  if (typeof value !== 'string') return { userIds: [], allowAdmin: false };
  try {
    const parsed = JSON.parse(value) as Partial<FeatureAccessConfig>;
    return {
      userIds: Array.isArray(parsed.userIds) ? parsed.userIds : [],
      allowAdmin: parsed.allowAdmin === true,
    };
  } catch {
    return { userIds: [], allowAdmin: false };
  }
}

function FeatureRow({ featureKey, label }: { featureKey: string; label: string }) {
  const allUsers = useAuthStore((s) => s.users);
  const [config, setConfig] = useState<FeatureAccessConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // 메타데이터 쓰기 직렬화 큐 — 빠른 연속 토글이 동시 upsert 로 경합해 옛 요청이 새 목록을 덮는 것 방지.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    readMetadataFromSupabase('feature-access', featureKey)
      .then((row) => { if (!cancelled) setConfig(parseConfig(row)); })
      .catch(() => { if (!cancelled) setConfig({ userIds: [], allowAdmin: false }); });
    return () => { cancelled = true; };
  }, [featureKey]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const sortedUsers = useMemo(
    () => [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [allUsers],
  );

  async function persist(next: FeatureAccessConfig) {
    const prev = config;
    setConfig(next); // 낙관적
    setSaving(true);
    // 직렬화: 이전 쓰기가 끝난 뒤 다음 쓰기를 시작 → 순서 보장(늦게 끝난 옛 요청이 새 목록을 덮어쓰지 않음).
    const run = writeChainRef.current
      .catch(() => { /* 이전 쓰기 실패가 다음 쓰기를 막지 않도록 */ })
      .then(() => writeMetadataToSupabase('feature-access', featureKey, JSON.stringify(next)));
    writeChainRef.current = run;
    try {
      await run;
      // 변경한 본인 클라이언트는 broadcast self-delivery(self:false)가 없어 자기 metadata 이벤트를 못 받음
      //   → 로컬 이벤트로 게이트 hook 을 즉시 갱신(자기를 추가/관리자 포함 켰을 때 메뉴 바로 노출).
      window.dispatchEvent(new Event('bflow:feature-access-changed'));
    } catch (err) {
      console.error('[FeatureGatingSection] 저장 실패:', err);
      setConfig(prev);
      toast.error('기능 노출 설정 저장에 실패했어요');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3 flex items-center gap-2 text-[11px] text-text-secondary/60">
        <Loader2 size={12} className="animate-spin" /> 불러오는 중…
      </div>
    );
  }

  const selectedNames = sortedUsers
    .filter((u) => config.userIds.includes(u.id))
    .map((u) => u.name);
  const summary = selectedNames.length === 0
    ? '선택된 사람 없음'
    : selectedNames.length <= 2
      ? selectedNames.join(', ')
      : `${selectedNames.slice(0, 2).join(', ')} 외 ${selectedNames.length - 2}명`;

  function toggleUser(userId: string) {
    const has = config!.userIds.includes(userId);
    const userIds = has
      ? config!.userIds.filter((id) => id !== userId)
      : [...config!.userIds, userId];
    void persist({ ...config!, userIds });
  }

  function toggleAllowAdmin() {
    void persist({ ...config!, allowAdmin: !config!.allowAdmin });
  }

  return (
    <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold text-text-primary flex items-center gap-1.5">
          {label}
          {saving && <Loader2 size={11} className="animate-spin text-text-secondary/60" />}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={config.allowAdmin}
            onChange={toggleAllowAdmin}
            className="accent-accent w-3.5 h-3.5 cursor-pointer"
          />
          관리자 자동 포함
        </label>
      </div>

      {/* 사용자 멀티선택 드롭다운 */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-bg-border bg-bg-card text-[12px] text-text-primary hover:border-accent/50 transition-colors"
        >
          <span className="truncate text-left">
            {summary}
            <span className="ml-1.5 text-text-secondary/60">({config.userIds.length})</span>
          </span>
          <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-bg-border bg-bg-card shadow-lg max-h-[260px] overflow-y-auto p-1">
            {sortedUsers.length === 0 && (
              <div className="text-[11px] text-text-secondary/50 px-2 py-3 text-center">
                등록된 사용자가 없습니다.
              </div>
            )}
            {sortedUsers.map((u) => {
              const selected = config.userIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left transition-colors',
                    selected ? 'bg-accent/15 text-accent' : 'text-text-primary hover:bg-bg-border/40',
                  )}
                >
                  <span className={cn(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    selected ? 'bg-accent border-accent' : 'border-bg-border',
                  )}>
                    {selected && <Check size={10} className="text-white" />}
                  </span>
                  <span className="truncate flex-1">{u.name}</span>
                  {u.role === 'admin' && (
                    <span className="text-[10px] text-text-secondary/60">관리자</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function FeatureGatingSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  if (!isAdmin) return null;

  return (
    <SettingsSection
      icon={<Eye size={14} className="text-accent" />}
      title="기능 노출 관리"
    >
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        특정 기능을 어떤 팀원에게 보여줄지 정해요. 선택된 사람과 (자동 포함을 켰다면) 관리자만 메뉴가 보입니다.
      </p>
      <div className="flex flex-col gap-3">
        {FEATURES.map((f) => (
          <FeatureRow key={f.key} featureKey={f.key} label={f.label} />
        ))}
      </div>
    </SettingsSection>
  );
}
