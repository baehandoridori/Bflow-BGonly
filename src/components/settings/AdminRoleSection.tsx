/**
 * 관리자 전용 — 팀원 관리자 권한 관리.
 *
 * 각 팀원 행에 관리자(admin) 토글 스위치. 토글 시 users.role 을 'admin'|'user' 로 변경.
 *   - 즉시 로컬 반영(낙관적) → Supabase update → 실패 시 롤백.
 *   - 본인(현재 관리자) 의 권한 회수는 막는다 (혼자 남은 관리자가 자기 권한을 풀어
 *     관리자 영영 0명이 되는 사고 방지).
 *
 * 사용자 목록 소스는 컴포지터 섹션과 동일하게 useAuthStore.users (TeamView 와 공유).
 */

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { updateUserInSupabase } from '@/services/supabaseService';
import { cn } from '@/utils/cn';
import type { AppUser } from '@/types';

export function AdminRoleSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const setUsers = useAuthStore((s) => s.setUsers);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);

  const isAdmin = currentUser?.role === 'admin';
  const [savingId, setSavingId] = useState<string | null>(null);

  if (!isAdmin) return null;

  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  async function toggleAdmin(user: AppUser) {
    if (savingId) return;
    const makeAdmin = user.role !== 'admin';

    // 자기 자신 admin 해제 방지
    if (!makeAdmin && currentUser && user.id === currentUser.id) {
      toast.error('본인의 관리자 권한은 해제할 수 없어요. 다른 관리자가 변경해야 합니다.');
      return;
    }

    const nextRole = makeAdmin ? 'admin' : 'user';
    const prevUsers = allUsers;
    // 낙관적 반영
    setUsers(allUsers.map((u) => (u.id === user.id ? { ...u, role: nextRole } : u)));
    if (currentUser && user.id === currentUser.id) {
      setCurrentUser({ ...currentUser, role: nextRole });
    }
    setSavingId(user.id);
    try {
      await updateUserInSupabase(user.id, { role: nextRole });
      toast.success(`${user.name} 님을 ${makeAdmin ? '관리자로 지정' : '관리자에서 해제'}했어요.`);
    } catch (err) {
      console.error('[AdminRoleSection] role 변경 실패:', err);
      setUsers(prevUsers);
      if (currentUser && user.id === currentUser.id) setCurrentUser(currentUser);
      toast.error('권한 변경에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <SettingsSection
      icon={<ShieldCheck size={14} className="text-accent" />}
      title="관리자 권한 관리"
    >
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        관리자는 이 관리자 페이지(권한 관리·기능 노출)에 들어올 수 있어요. 신중하게 지정해주세요.
      </p>

      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
        <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pr-1">
          {sortedUsers.length === 0 && (
            <div className="text-[11px] text-text-secondary/50 px-2 py-3 text-center">
              등록된 사용자가 없습니다.
            </div>
          )}
          {sortedUsers.map((u) => {
            const userIsAdmin = u.role === 'admin';
            const isSelf = currentUser?.id === u.id;
            return (
              <div
                key={u.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
                  userIsAdmin ? 'bg-accent/10' : 'hover:bg-bg-primary/50',
                )}
              >
                <span className="text-[12px] text-text-primary truncate flex-1">
                  {u.name}
                  {isSelf && <span className="ml-1.5 text-[10px] text-text-secondary/60">(나)</span>}
                </span>
                {userIsAdmin && (
                  <span className="text-[10px] text-accent">관리자</span>
                )}
                <button
                  type="button"
                  onClick={() => toggleAdmin(u)}
                  disabled={savingId === u.id || (userIsAdmin && isSelf)}
                  role="switch"
                  aria-checked={userIsAdmin}
                  aria-label={`${u.name} 관리자 권한`}
                  title={userIsAdmin && isSelf ? '본인 권한은 해제할 수 없어요' : undefined}
                  className={cn(
                    'relative w-9 h-5 rounded-full transition-colors shrink-0',
                    userIsAdmin ? 'bg-accent' : 'bg-bg-border',
                    (savingId === u.id || (userIsAdmin && isSelf)) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                      userIsAdmin && 'translate-x-4',
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}
