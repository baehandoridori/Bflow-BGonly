/**
 * v1.25.0~ — 어드민 전용 액팅 검수자(애니메이팅 수퍼바이저) 지정 섹션.
 *
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 6)
 *
 * - 컴포지터 섹션과 평행 구조 (CompositorSection.tsx 패턴 그대로 복제).
 * - 액팅 검수자로 지정된 사용자는 액팅 씬 "피드백 대기" 전환 시 자동 알림.
 * - 컴포지터와 독립적 — 한 사람이 둘 다 체크 가능.
 *
 * `users.is_acting_supervisor` 컬럼: BOOLEAN NOT NULL DEFAULT false.
 * 어드민 (currentUser.role === 'admin') 만 노출.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { setIsActingSupervisor, loadUsers } from '@/services/userService';
import { cn } from '@/utils/cn';

export function ActingSupervisorSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const setUsers = useAuthStore((s) => s.setUsers);

  const isAdmin = currentUser?.role === 'admin';

  const initial = useMemo(
    () => new Set(allUsers.filter((u) => u.isActingSupervisor === true).map((u) => u.id)),
    [allUsers],
  );

  const [supervisorIds, setSupervisorIds] = useState<Set<string>>(initial);
  const [saving, setSaving] = useState(false);
  // CompositorSection 와 동일 — dirty 일 땐 외부 reload 가 사용자 입력 덮어쓰기 방지
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setSupervisorIds(initial);
  }, [initial, dirty]);

  if (!isAdmin) return null;

  const dirtyUsers = allUsers.filter(
    (u) => (u.isActingSupervisor === true) !== supervisorIds.has(u.id),
  );
  const hasChanges = dirtyUsers.length > 0;

  function toggle(id: string) {
    const next = new Set(supervisorIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSupervisorIds(next);
    setDirty(true);
  }

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    const expectedSize = supervisorIds.size;
    const expectedIds = new Set(supervisorIds);
    try {
      await Promise.all(
        dirtyUsers.map((u) => setIsActingSupervisor(u.id, supervisorIds.has(u.id))),
      );
      const fresh = await loadUsers();
      setUsers(fresh);

      // verify — CompositorSection 와 동일 룰
      const actualIds = new Set(fresh.filter((u) => u.isActingSupervisor === true).map((u) => u.id));
      const mismatched = [...expectedIds].some((id) => !actualIds.has(id))
        || [...actualIds].some((id) => !expectedIds.has(id));
      if (mismatched) {
        toast.error(
          'DB 반영이 확인되지 않았습니다. is_acting_supervisor 컬럼/마이그레이션 또는 권한을 점검해주세요.',
          { duration: 8000 },
        );
      } else {
        setDirty(false);
        toast.success(`${expectedSize}명을 액팅 검수자로 저장했습니다.`);
      }
    } catch (err) {
      console.error('[ActingSupervisorSection] 저장 실패:', err);
      toast.error('액팅 검수자 저장에 실패했습니다. 콘솔에서 상세 오류를 확인하세요.');
    } finally {
      setSaving(false);
    }
  }

  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return (
    <SettingsSection
      icon={<Sparkles size={14} className="text-accent" />}
      title="액팅 검수자 지정"
      action={
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors',
            hasChanges && !saving
              ? 'bg-accent text-white hover:opacity-90 cursor-pointer'
              : 'bg-bg-border/40 text-text-secondary/60 cursor-not-allowed',
          )}
        >
          {saving ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              저장 중
            </>
          ) : (
            <>
              <Check size={12} />
              저장 {hasChanges && `(${dirtyUsers.length})`}
            </>
          )}
        </button>
      }
    >
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        액팅 검수자로 지정된 사람은 액팅 씬이 "피드백 대기" 로 전환될 때 자동으로 알림을 받습니다.
        컴포지터와 독립적이므로 한 사람이 두 역할을 동시에 가질 수 있습니다.
      </p>

      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider mb-2 text-accent">
          액팅 검수자
          <span className="ml-1.5 text-text-secondary/60 normal-case tracking-normal">
            ({supervisorIds.size})
          </span>
        </div>
        <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pr-1">
          {sortedUsers.length === 0 && (
            <div className="text-[11px] text-text-secondary/50 px-2 py-3 text-center">
              등록된 사용자가 없습니다.
            </div>
          )}
          {sortedUsers.map((u) => {
            const isSelected = supervisorIds.has(u.id);
            return (
              <label
                key={u.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer',
                  isSelected ? 'bg-accent/10' : 'hover:bg-bg-primary/50',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(u.id)}
                  className="accent-accent w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-[12px] text-text-primary truncate flex-1">
                  {u.name}
                </span>
                {u.isCompositor && (
                  <span className="text-[10px] text-accent-sub" title="컴포지터 겸임">
                    +컴포지터
                  </span>
                )}
                {u.role === 'admin' && (
                  <span className="text-[10px] text-accent-sub">어드민</span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}
