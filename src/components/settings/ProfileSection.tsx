import { useMemo } from 'react';
import { User, Calendar, Briefcase, KeyRound, AlertTriangle, Clock } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';

/** 이름 첫 글자 (한글: 첫 음절, 영문: 첫 대문자) */
function getInitial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch.toUpperCase();
}

/** 'MM-DD' → '1월 1일' */
function formatBirthday(bd?: string): string | null {
  if (!bd) return null;
  const parts = bd.split('-').map(Number);
  if (parts.length < 2) return null;
  return `${parts[0]}월 ${parts[1]}일`;
}

/** ISO 날짜 → '2025년 1월' */
function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/** 입사일로부터 며칠째인지 계산 */
function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24)) + 1);
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-text-secondary/50 leading-none mb-0.5">{label}</p>
        <p className="text-sm font-medium text-text-primary truncate">{value}</p>
      </div>
    </div>
  );
}

export function ProfileSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setShowPasswordChange = useAuthStore((s) => s.setShowPasswordChange);

  const initial = useMemo(() => getInitial(currentUser?.name ?? '?'), [currentUser?.name]);
  const birthday = useMemo(() => formatBirthday(currentUser?.birthday), [currentUser?.birthday]);
  const hireDate = useMemo(() => formatDate(currentUser?.hireDate), [currentUser?.hireDate]);
  const days = useMemo(() => daysSince(currentUser?.hireDate), [currentUser?.hireDate]);
  const isAdmin = currentUser?.role === 'admin';
  const isInitPw = currentUser?.isInitialPassword ?? false;

  if (!currentUser) return null;

  return (
    <SettingsSection
      icon={<User size={18} className="text-accent" />}
      title="내 프로필"
    >
      {/* ─ 프로필 히어로 ─ */}
      <div className="flex items-center gap-5 mb-6">
        {/* 아바타 */}
        <div className="relative shrink-0">
          <div
            className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg"
            style={{
              background: 'linear-gradient(135deg, rgb(var(--color-accent)), rgb(var(--color-accent-sub)))',
              boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.25)',
            }}
          >
            {initial}
          </div>
          {/* 온라인 인디케이터 */}
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-[2.5px] border-bg-card" />
        </div>

        {/* 이름 + 역할 */}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-text-primary truncate">{currentUser.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded-full font-medium',
              isAdmin
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                : 'bg-accent/10 text-accent/80 border border-accent/15',
            )}>
              {isAdmin ? '관리자' : '팀원'}
            </span>
            {days && (
              <span className="text-[11px] text-text-secondary/50 flex items-center gap-1">
                <Clock size={11} />
                함께한 지 {days.toLocaleString()}일
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─ 초기 비밀번호 경고 ─ */}
      {isInitPw && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/15 mb-5">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-amber-300">초기 비밀번호를 사용 중입니다</p>
            <p className="text-[11px] text-amber-400/60 mt-0.5">보안을 위해 비밀번호를 변경해 주세요.</p>
          </div>
        </div>
      )}

      {/* ─ 정보 카드 ─ */}
      <div className="bg-bg-primary/40 rounded-xl border border-bg-border/30 px-4 divide-y divide-bg-border/20">
        {birthday && (
          <InfoItem icon={<Calendar size={15} />} label="생일" value={birthday} />
        )}
        {hireDate && (
          <InfoItem icon={<Briefcase size={15} />} label="입사일" value={hireDate} />
        )}
        {currentUser.slackId && (
          <InfoItem
            icon={<svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z"/></svg>}
            label="Slack"
            value={currentUser.slackId}
          />
        )}
        {!birthday && !hireDate && !currentUser.slackId && (
          <div className="py-4 text-center">
            <p className="text-xs text-text-secondary/40">등록된 정보가 없습니다</p>
            <p className="text-[10px] text-text-secondary/30 mt-0.5">관리자에게 정보 등록을 요청하세요</p>
          </div>
        )}
      </div>

      {/* ─ 비밀번호 변경 ─ */}
      <div className="mt-5">
        <button
          onClick={() => setShowPasswordChange(true)}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer',
            isInitPw
              ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/20'
              : 'bg-bg-border/30 text-text-secondary hover:text-text-primary hover:bg-bg-border/50 border border-bg-border/30',
          )}
        >
          <KeyRound size={15} />
          비밀번호 변경
        </button>
      </div>

      <p className="text-[10px] text-text-secondary/30 mt-4 text-center">
        프로필 정보 수정은 관리자에게 문의하세요
      </p>
    </SettingsSection>
  );
}
