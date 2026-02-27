import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  User, Calendar, Briefcase, KeyRound, AlertTriangle, Clock,
  CheckCircle2, ListTodo, ChevronRight, Palmtree, CircleDashed,
  LayoutDashboard, Bell, Volume2,
} from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { sceneProgress, isFullyDone } from '@/utils/calcStats';
import { cn } from '@/utils/cn';

/* ───────────── helpers ───────────── */

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/** 'MM-DD' → '1월 1일' */
function formatBirthday(bd?: string): string | null {
  if (!bd) return null;
  const parts = bd.split('-').map(Number);
  if (parts.length < 2) return null;
  return `${parts[0]}월 ${parts[1]}일`;
}

/** ISO → '2025년 1월' */
function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / 86_400_000) + 1);
}

/* ───────────── sub-components ───────────── */

function InfoChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-text-secondary/45 leading-none mb-0.5">{label}</p>
        <p className="text-[13px] font-medium text-text-primary truncate">{value}</p>
      </div>
    </div>
  );
}

/** 작은 수치 블록 */
function StatBlock({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-center flex-1">
      <p className={cn('text-xl font-bold', accent || 'text-text-primary')}>{value}</p>
      <p className="text-[10px] text-text-secondary/50 mt-0.5">{label}</p>
    </div>
  );
}

/** 알림 토글 행 */
function NotiToggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-text-primary">{label}</p>
        <p className="text-[10px] text-text-secondary/40">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer shrink-0 ml-3',
          checked ? 'bg-accent' : 'bg-bg-border/50',
        )}
      >
        <div className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )} />
      </button>
    </div>
  );
}

/* ───────────── main ───────────── */

export function ProfileSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setShowPasswordChange = useAuthStore((s) => s.setShowPasswordChange);
  const episodes = useDataStore((s) => s.episodes);
  const setView = useAppStore((s) => s.setView);

  const initial = useMemo(() => getInitial(currentUser?.name ?? '?'), [currentUser?.name]);
  const birthday = useMemo(() => formatBirthday(currentUser?.birthday), [currentUser?.birthday]);
  const hireDate = useMemo(() => formatDate(currentUser?.hireDate), [currentUser?.hireDate]);
  const days = useMemo(() => daysSince(currentUser?.hireDate), [currentUser?.hireDate]);
  const isAdmin = currentUser?.role === 'admin';
  const isInitPw = currentUser?.isInitialPassword ?? false;

  // ─ 나의 할 일 통계 ─
  const taskStats = useMemo(() => {
    if (!currentUser) return { total: 0, completed: 0, inProgress: 0, pct: 0 };
    const myScenes = episodes
      .flatMap((ep) => ep.parts.flatMap((p) => p.scenes))
      .filter((s) => s.assignee === currentUser.name);
    const total = myScenes.length;
    const completed = myScenes.filter(isFullyDone).length;
    const inProgress = total - completed;
    const pct = total > 0
      ? Math.round(myScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / total)
      : 0;
    return { total, completed, inProgress, pct };
  }, [episodes, currentUser]);

  // ─ 잔여 휴가 계산 (연차 15일 기준 · 입사 1년 미만은 월 1일) ─
  const vacationStats = useMemo(() => {
    if (!currentUser?.hireDate) return null;
    const hire = new Date(currentUser.hireDate);
    if (isNaN(hire.getTime())) return null;
    const yearsDiff = (Date.now() - hire.getTime()) / (365.25 * 86_400_000);
    // 근속 연수에 따른 총 연차
    let totalDays: number;
    if (yearsDiff < 1) {
      // 1년 미만: 만근 월 수 × 1일
      totalDays = Math.min(11, Math.floor(yearsDiff * 12));
    } else {
      // 1년 이상: 15일 + 2년마다 1일 추가 (최대 25일)
      totalDays = Math.min(25, 15 + Math.floor(Math.max(0, yearsDiff - 1) / 2));
    }
    // 사용 일수는 로컬 저장소에서 가져오거나 기본 0
    const key = `bflow_vacation_used_${currentUser.id}_${new Date().getFullYear()}`;
    const used = Number(localStorage.getItem(key) || '0');
    return { total: totalDays, used, remaining: totalDays - used };
  }, [currentUser]);

  // ─ 기본 시작 뷰 / 알림 설정 ─
  const [defaultViewState, setDefaultViewState] = useState<string>('dashboard');
  const [notiSceneChange, setNotiSceneChange] = useState(true);
  const [notiSyncComplete, setNotiSyncComplete] = useState(false);
  const [notiSound, setNotiSound] = useState(true);
  const prefsLoaded = useRef(false);

  useEffect(() => {
    if (prefsLoaded.current) return;
    prefsLoaded.current = true;
    loadPreferences().then((prefs) => {
      if (prefs?.defaultView) setDefaultViewState(prefs.defaultView);
      if (prefs?.notifications) {
        setNotiSceneChange(prefs.notifications.sceneChange ?? true);
        setNotiSyncComplete(prefs.notifications.syncComplete ?? false);
        setNotiSound(prefs.notifications.sound ?? true);
      }
    });
  }, []);

  const persistPref = useCallback(async (patch: Record<string, unknown>) => {
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, ...patch });
  }, []);

  const handleDefaultViewChange = useCallback((view: string) => {
    setDefaultViewState(view);
    persistPref({ defaultView: view });
  }, [persistPref]);

  const handleNotiToggle = useCallback((key: 'sceneChange' | 'syncComplete' | 'sound', value: boolean) => {
    if (key === 'sceneChange') setNotiSceneChange(value);
    else if (key === 'syncComplete') setNotiSyncComplete(value);
    else setNotiSound(value);
    const next = { sceneChange: notiSceneChange, syncComplete: notiSyncComplete, sound: notiSound, [key]: value };
    persistPref({ notifications: next });
  }, [persistPref, notiSceneChange, notiSyncComplete, notiSound]);

  if (!currentUser) return null;

  const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
    { value: 'dashboard', label: '대시보드' },
    { value: 'episode', label: '에피소드' },
    { value: 'scenes', label: '씬 목록' },
    { value: 'assignee', label: '인원별' },
    { value: 'team', label: '팀원' },
    { value: 'calendar', label: '타임라인' },
    { value: 'schedule', label: '캘린더' },
  ];

  return (
    <SettingsSection
      icon={<User size={18} className="text-accent" />}
      title="내 프로필"
    >
      {/* ════════════ 프로필 히어로 ════════════ */}
      <div className="flex items-start gap-5 mb-5">
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
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-[2.5px] border-bg-card" />
        </div>

        {/* 이름 · 역할 · 날짜 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-text-primary truncate">{currentUser.name}</h3>
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0',
              isAdmin
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                : 'bg-accent/10 text-accent/80 border border-accent/15',
            )}>
              {isAdmin ? '관리자' : '팀원'}
            </span>
          </div>

          {/* 생일 · 입사일 한 줄 */}
          <p className="text-[12px] text-text-secondary/60 mt-1 truncate">
            {[birthday, hireDate && `입사 ${hireDate}`].filter(Boolean).join('  ·  ') || '정보 미등록'}
          </p>

          {/* 함께한 지 + 비밀번호 변경 */}
          <div className="flex items-center gap-3 mt-2">
            {days && (
              <span className="text-[11px] text-text-secondary/50 flex items-center gap-1">
                <Clock size={11} />
                함께한 지 <strong className="text-text-primary/80">{days.toLocaleString()}</strong>일 째
              </span>
            )}
            <button
              onClick={() => setShowPasswordChange(true)}
              className={cn(
                'ml-auto text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all duration-200 cursor-pointer flex items-center gap-1',
                isInitPw
                  ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20'
                  : 'bg-bg-border/30 text-text-secondary/70 hover:text-text-primary hover:bg-bg-border/50 border border-bg-border/30',
              )}
            >
              <KeyRound size={11} />
              비밀번호 변경
            </button>
          </div>
        </div>
      </div>

      {/* 초기 비밀번호 경고 */}
      {isInitPw && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/15 mb-4">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-amber-300">초기 비밀번호를 사용 중입니다</p>
            <p className="text-[11px] text-amber-400/60 mt-0.5">보안을 위해 비밀번호를 변경해 주세요.</p>
          </div>
        </div>
      )}

      {/* ════════════ 나의 할 일 관리 ════════════ */}
      <button
        onClick={() => setView('assignee')}
        className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3 transition-all duration-200 hover:border-accent/30 hover:bg-bg-primary/60 cursor-pointer text-left group"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListTodo size={15} className="text-accent" />
            <span className="text-[13px] font-semibold text-text-primary">나의 할 일 관리</span>
          </div>
          <ChevronRight size={14} className="text-text-secondary/30 group-hover:text-accent transition-colors" />
        </div>

        {taskStats.total > 0 ? (
          <>
            {/* 진행률 바 */}
            <div className="w-full h-1.5 rounded-full bg-bg-border/40 mb-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${taskStats.pct}%`,
                  background: 'linear-gradient(90deg, rgb(var(--color-accent)), #00B894)',
                }}
              />
            </div>
            {/* 수치 */}
            <div className="flex items-center divide-x divide-bg-border/20">
              <StatBlock label="배정된 씬" value={taskStats.total} />
              <StatBlock label="완료" value={taskStats.completed} accent="text-emerald-400" />
              <StatBlock label="진행중" value={taskStats.inProgress} accent="text-accent" />
              <StatBlock label="진행률" value={`${taskStats.pct}%`} accent="text-amber-400" />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <CheckCircle2 size={14} className="text-emerald-400/60" />
            <p className="text-xs text-text-secondary/50">배정된 씬이 없습니다</p>
          </div>
        )}
      </button>

      {/* ════════════ 나의 잔여 휴가 확인 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Palmtree size={15} className="text-emerald-400" />
          <span className="text-[13px] font-semibold text-text-primary">나의 잔여 휴가 확인</span>
        </div>

        {vacationStats ? (
          <div className="flex items-center divide-x divide-bg-border/20">
            <StatBlock label="총 연차" value={`${vacationStats.total}일`} />
            <StatBlock label="사용" value={`${vacationStats.used}일`} accent="text-text-secondary/70" />
            <StatBlock
              label="잔여"
              value={`${vacationStats.remaining}일`}
              accent={vacationStats.remaining <= 3 ? 'text-amber-400' : 'text-emerald-400'}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <CircleDashed size={14} className="text-text-secondary/40" />
            <p className="text-xs text-text-secondary/50">입사일 등록 후 확인할 수 있습니다</p>
          </div>
        )}
      </div>

      {/* ════════════ 기본 시작 뷰 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <LayoutDashboard size={15} className="text-accent" />
          <span className="text-[13px] font-semibold text-text-primary">기본 시작 뷰</span>
        </div>
        <p className="text-[11px] text-text-secondary/50 mb-2.5">로그인 후 처음 표시할 화면을 선택하세요</p>
        <div className="flex flex-wrap gap-1.5">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleDefaultViewChange(opt.value)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer border',
                defaultViewState === opt.value
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'bg-bg-border/20 text-text-secondary/60 border-bg-border/30 hover:text-text-primary hover:bg-bg-border/40',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════ 알림 설정 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Bell size={15} className="text-amber-400" />
          <span className="text-[13px] font-semibold text-text-primary">알림 설정</span>
        </div>
        <div className="space-y-2.5">
          <NotiToggle
            label="내 씬 변경 알림"
            description="배정된 씬이 변경되면 알려줍니다"
            checked={notiSceneChange}
            onChange={(v) => handleNotiToggle('sceneChange', v)}
          />
          <NotiToggle
            label="동기화 완료 알림"
            description="데이터 동기화가 완료되면 알려줍니다"
            checked={notiSyncComplete}
            onChange={(v) => handleNotiToggle('syncComplete', v)}
          />
          <div className="flex items-center justify-between pt-1 border-t border-bg-border/15">
            <div className="flex items-center gap-2">
              <Volume2 size={13} className="text-text-secondary/50" />
              <span className="text-[12px] text-text-secondary/70">알림 소리</span>
            </div>
            <button
              onClick={() => handleNotiToggle('sound', !notiSound)}
              className={cn(
                'relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer',
                notiSound ? 'bg-accent' : 'bg-bg-border/50',
              )}
            >
              <div className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                notiSound ? 'translate-x-4' : 'translate-x-0.5',
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* ════════════ 추가 정보 카드 ════════════ */}
      {currentUser.slackId && (
        <div className="bg-bg-primary/40 rounded-xl border border-bg-border/30 px-4 mb-3">
          <InfoChip
            icon={<svg viewBox="0 0 24 24" className="w-[14px] h-[14px]" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z"/></svg>}
            label="Slack"
            value={currentUser.slackId}
          />
        </div>
      )}

      <p className="text-[10px] text-text-secondary/30 mt-4 text-center">
        프로필 정보 수정은 관리자에게 문의하세요
      </p>
    </SettingsSection>
  );
}
