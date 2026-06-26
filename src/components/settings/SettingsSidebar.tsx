import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Type, Keyboard, Sparkles, Monitor,
  KeyRound, Database, HelpCircle, UserCircle, Bell,
  Layers, ShieldCheck,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { useAuthStore } from '@/stores/useAuthStore';

export type SettingsTabId =
  | 'profile'
  | 'notification'
  | 'theme'
  | 'font'
  | 'shortcuts'
  | 'effects'
  | 'startup'
  | 'login'
  | 'sheets'
  | 'guide'
  // v1.18.0: 어드민 전용 — 부서별 컴포지터 지정
  | 'compositor'
  // 어드민 전용 — 권한/기능 노출 관리
  | 'admin-access';

interface Tab {
  id: SettingsTabId;
  label: string;
  icon: React.ReactNode;
}

interface Group {
  id: string;
  label: string;
  tabs: Tab[];
}

const BASE_GROUPS: Group[] = [
  {
    id: 'account',
    label: '계정',
    tabs: [
      { id: 'profile', label: '내 정보', icon: <UserCircle size={16} /> },
      { id: 'login',   label: '로그인', icon: <KeyRound size={16} /> },
    ],
  },
  {
    id: 'display',
    label: '표시',
    tabs: [
      { id: 'theme',   label: '외관',   icon: <Palette size={16} /> },
      { id: 'font',    label: '글꼴',   icon: <Type size={16} /> },
      { id: 'effects', label: '효과',   icon: <Sparkles size={16} /> },
    ],
  },
  {
    id: 'workspace',
    label: '작업 환경',
    tabs: [
      { id: 'startup',      label: '시작',     icon: <Monitor size={16} /> },
      { id: 'notification', label: '알림',     icon: <Bell size={16} /> },
      { id: 'shortcuts',    label: '단축키',   icon: <Keyboard size={16} /> },
    ],
  },
  {
    id: 'system',
    label: '시스템',
    tabs: [
      { id: 'sheets', label: '연동', icon: <Database size={16} /> },
      { id: 'guide',  label: '안내', icon: <HelpCircle size={16} /> },
    ],
  },
];

// v1.18.0: 어드민 전용 — 컴포지터 지정 그룹
const ADMIN_GROUP: Group = {
  id: 'admin',
  label: '관리자',
  tabs: [
    { id: 'admin-access', label: '권한·노출', icon: <ShieldCheck size={16} /> },
    { id: 'compositor', label: '컴포지터', icon: <Layers size={16} /> },
  ],
};

interface SettingsSidebarProps {
  active: SettingsTabId;
  onChange: (id: SettingsTabId) => void;
}

export function SettingsSidebar({ active, onChange }: SettingsSidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // v1.18.0: 어드민에게만 컴포지터 그룹 노출
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const groups = useMemo(() => (isAdmin ? [...BASE_GROUPS, ADMIN_GROUP] : BASE_GROUPS), [isAdmin]);

  // 탭 ID → 소속 그룹 ID 역인덱스 (선택된 탭이 접힌 그룹에 있으면 자동 펼침)
  const tabToGroup = useMemo<Record<SettingsTabId, string>>(() => {
    return groups.reduce(
      (acc, g) => {
        g.tabs.forEach((t) => { acc[t.id] = g.id; });
        return acc;
      },
      {} as Record<SettingsTabId, string>,
    );
  }, [groups]);

  // 초기 로드: preferences 에서 접힘 상태 복원
  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      if (Array.isArray(prefs?.settingsCollapsedGroups)) {
        setCollapsed(new Set(prefs!.settingsCollapsedGroups));
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 선택된 탭이 접힌 그룹에 속하면 자동 펼침 + preferences 동기화
  // Codex 리뷰 #2 P2: deps 에 collapsed 포함 — preferences 하이드레이트 이후 로드된
  // 접힘 상태에 대해서도 펼침이 실행되어야 함. (collapsed 에서 owningGroup 제거 후
  // 재실행 시 early return 으로 무한 루프 없음.)
  useEffect(() => {
    const owningGroup = tabToGroup[active];
    if (!owningGroup || !collapsed.has(owningGroup)) return;
    const next = new Set(collapsed);
    next.delete(owningGroup);
    setCollapsed(next);
    persist(next);
  }, [active, collapsed, tabToGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: Set<string>) => {
    loadPreferences().then((prefs) => {
      savePreferences({ ...(prefs ?? {}), settingsCollapsedGroups: [...next] });
    });
  };

  const toggle = (groupId: string) => {
    const next = new Set(collapsed);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setCollapsed(next);
    persist(next);
  };

  return (
    <nav className="w-[120px] shrink-0 sticky top-0 self-start flex flex-col gap-0.5">
      {groups.map((group, gi) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <div key={group.id}>
            {gi > 0 && <div className="border-t border-bg-border/20 my-1.5 mx-2" />}
            <button
              onClick={() => toggle(group.id)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 hover:text-text-secondary transition-colors cursor-pointer"
            >
              <span>{group.label}</span>
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-0.5">
                    {group.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => onChange(tab.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer text-left',
                          active === tab.id
                            ? 'bg-accent/15 text-accent'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/30',
                        )}
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </nav>
  );
}
