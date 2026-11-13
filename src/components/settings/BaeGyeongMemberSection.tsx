/**
 * 어드민 전용 — BAE경 사용자 · 검수자 지정 (계획 14의 7장, 배경 편집자 지정 섹션을 본보기로).
 *
 * 사용자: BAE경 메뉴를 쓰고 자기 기록을 본다. 검수자: 팀 기록 · 비용을 보고 확인 도장 · 코멘트를 남긴다(사용자 권리도 포함).
 * 명단은 서버(bae_gyeong_members)에 있고 관리자 세션으로만 읽고 바꾼다(화면 → 메인 → 세션 래퍼). 한 사람씩 바로 저장:
 * 화면에 먼저 반영 → 저장 → 실패하면 되돌림. 관리자는 명단과 관계없이 늘 둘 다 할 수 있어 '관리자'로 보인다.
 * 이 화면을 여는 것만으로 BAE경 메뉴가 보이지는 않는다 — 옮기는 동안 메뉴는 시험 계정에만 있다(featureFlag.ts).
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { baeGateway } from '@/features/bae-gyeong/gateway';
import { BaeGyeongIcon } from '@/features/bae-gyeong/icons/BaeGyeongIcon';
import type { BaeMember, BaeMemberRole } from '@/shared/bae/access';

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'BAE경 명단을 불러오지 못했어요.');
const ROLE_LABEL: Record<'none' | BaeMemberRole, string> = { none: '쓰지 않음', user: '사용자', reviewer: '검수자' };

export function BaeGyeongMemberSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const isAdmin = currentUser?.role === 'admin';
  const [members, setMembers] = useState<Map<string, BaeMemberRole> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const toMap = (list: BaeMember[]) => new Map(list.map((m) => [m.userId, m.role] as const));
    baeGateway().membersList()
      .then((list) => { if (alive) { setMembers(toMap(list)); setLoadError(''); } })
      .catch((error: unknown) => { if (alive) setLoadError(errorText(error)); });
    return () => { alive = false; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function change(id: string, name: string, role: BaeMemberRole | null) {
    if (savingId || !members) return;
    const before = members; const next = new Map(before);
    if (role) next.set(id, role); else next.delete(id);
    setMembers(next); setSavingId(id);
    try {
      const saved = await baeGateway().membersSet(id, role);
      setMembers(new Map(saved.map((m) => [m.userId, m.role] as const)));
      toast.success(role ? `${name} 님이 이제 BAE경 ${ROLE_LABEL[role]}예요.` : `${name} 님은 이제 BAE경을 쓰지 않아요.`);
    } catch (error) {
      setMembers(before);
      toast.error(`저장하지 못했어요: ${errorText(error)}`);
    } finally { setSavingId(null); }
  }

  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const count = members ? sortedUsers.filter((u) => u.role !== 'admin' && members.has(u.id)).length : 0;

  return (
    <SettingsSection icon={<BaeGyeongIcon size={14} className="text-accent" />} title="BAE경 사용자 · 검수자 지정">
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        사용자는 BAE경으로 배경을 만들고 자기 기록을 봐요. 검수자는 팀 기록과 비용을 보고 확인 도장을 남겨요.
        고르면 바로 저장돼요. BAE경 설정의 '모두에게 열기'를 켜면 로그인한 팀원 모두가 사용자가 돼요.
      </p>
      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
        <div className="text-[11px] font-bold mb-2 text-accent">
          BAE경 명단{members && <span className="ml-1.5 text-text-secondary/60 font-normal">({count})</span>}
        </div>
        {loadError ? (
          <div className="text-[11px] text-red-400 px-2 py-3" role="alert">{loadError}</div>
        ) : !members ? (
          <div className="flex items-center gap-2 text-[11px] text-text-secondary/60 px-2 py-3"><Loader2 size={12} className="animate-spin" />불러오는 중…</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pr-1">
            {sortedUsers.map((u) => {
              const admin = u.role === 'admin'; const role = members.get(u.id);
              return (
                <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded">
                  <span className="text-[12px] text-text-primary truncate flex-1">{u.name}</span>
                  {savingId === u.id && <Loader2 size={12} className="animate-spin text-text-secondary/60" />}
                  {admin ? <span className="text-[10px] text-accent-sub">관리자</span> : (
                    <select
                      aria-label={`${u.name} 님의 BAE경 역할`}
                      className="text-[12px] bg-bg-card border border-bg-border rounded px-1.5 py-0.5 text-text-primary"
                      value={role ?? 'none'}
                      disabled={savingId !== null}
                      onChange={(e) => { const v = e.target.value; void change(u.id, u.name, v === 'none' ? null : (v as BaeMemberRole)); }}
                    >
                      {(['none', 'user', 'reviewer'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
