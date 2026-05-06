/**
 * v1.18.1 — 어드민 전용 리비전 컴포지터 지정 섹션.
 *
 * 한솔 정정: 컴포지터는 BG/ACT 부서로 나뉘지 않는다 (단일 역할).
 * 컴포지터로 지정된 사용자는 모든 씬에 새 리비전이 등록되면 자동으로 알림을 받는다
 * (RevisionRecipientPicker 자동 대상자).
 *
 * `users.is_compositor` 컬럼: BOOLEAN NOT NULL DEFAULT false.
 *
 * 어드민 (currentUser.role === 'admin') 만 노출 — 일반 사용자에겐 null 반환.
 */

import { useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { setIsCompositor, loadUsers } from '@/services/userService';
import { cn } from '@/utils/cn';

export function CompositorSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const setUsers = useAuthStore((s) => s.setUsers);

  // 어드민 게이트 — 일반 사용자에겐 섹션 자체를 숨김
  const isAdmin = currentUser?.role === 'admin';

  // 현재 DB 상태에서 컴포지터 set 초기화
  const initial = useMemo(
    () => new Set(allUsers.filter((u) => u.isCompositor === true).map((u) => u.id)),
    [allUsers],
  );

  const [compositorIds, setCompositorIds] = useState<Set<string>>(initial);
  const [saving, setSaving] = useState(false);

  // 외부 사용자 목록 변경 시 (다른 어드민이 동시 변경했거나 reload 한 경우) 로컬 set 동기화
  useEffect(() => {
    setCompositorIds(initial);
  }, [initial]);

  if (!isAdmin) return null;

  // 변경 사항 계산 — 저장 버튼 활성/비활성 + 변경된 사용자만 PATCH
  const dirtyUsers = allUsers.filter(
    (u) => (u.isCompositor === true) !== compositorIds.has(u.id),
  );
  const hasChanges = dirtyUsers.length > 0;

  function toggle(id: string) {
    const next = new Set(compositorIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCompositorIds(next);
  }

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      // 변경된 사용자만 일괄 업데이트
      await Promise.all(
        dirtyUsers.map((u) => setIsCompositor(u.id, compositorIds.has(u.id))),
      );
      // store 새로고침 — App.tsx 의 useEffect 와 동일 패턴 (loadUsers → setUsers)
      const fresh = await loadUsers();
      setUsers(fresh);
      toast.success(`${dirtyUsers.length}명의 컴포지터 정보를 저장했습니다.`);
    } catch (err) {
      console.error('[CompositorSection] 저장 실패:', err);
      toast.error('컴포지터 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // 저장 가능한 사용자 목록 — 이름 오름차순 정렬
  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return (
    <SettingsSection
      icon={<Layers size={14} className="text-accent" />}
      title="리비전 컴포지터 지정"
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
        컴포지터로 지정된 사람은 새 리비전이 등록되면 자동으로 알림을 받습니다.
      </p>

      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider mb-2 text-accent">
          컴포지터
          <span className="ml-1.5 text-text-secondary/60 normal-case tracking-normal">
            ({compositorIds.size})
          </span>
        </div>
        <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pr-1">
          {sortedUsers.length === 0 && (
            <div className="text-[11px] text-text-secondary/50 px-2 py-3 text-center">
              등록된 사용자가 없습니다.
            </div>
          )}
          {sortedUsers.map((u) => {
            const isSelected = compositorIds.has(u.id);
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
