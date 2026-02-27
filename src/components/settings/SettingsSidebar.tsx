import {
  Palette, Type, Keyboard, Sparkles, Monitor,
  KeyRound, Database, HelpCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export type SettingsTabId =
  | 'theme'
  | 'font'
  | 'shortcuts'
  | 'effects'
  | 'startup'
  | 'login'
  | 'sheets'
  | 'guide';

interface Tab {
  id: SettingsTabId;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const TABS: Tab[] = [
  { id: 'theme',     label: '외관',   icon: <Palette size={16} /> },
  { id: 'font',      label: '글꼴',   icon: <Type size={16} /> },
  { id: 'shortcuts',  label: '단축키', icon: <Keyboard size={16} />, disabled: true },
  { id: 'effects',   label: '효과',   icon: <Sparkles size={16} /> },
  { id: 'startup',   label: '시작',   icon: <Monitor size={16} /> },
  { id: 'login',     label: '로그인', icon: <KeyRound size={16} /> },
  { id: 'sheets',    label: '연동',   icon: <Database size={16} /> },
  { id: 'guide',     label: '안내',   icon: <HelpCircle size={16} /> },
];

interface SettingsSidebarProps {
  active: SettingsTabId;
  onChange: (id: SettingsTabId) => void;
}

export function SettingsSidebar({ active, onChange }: SettingsSidebarProps) {
  return (
    <nav className="w-[120px] shrink-0 sticky top-0 self-start flex flex-col gap-0.5">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onChange(tab.id)}
          disabled={tab.disabled}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer text-left',
            active === tab.id
              ? 'bg-accent/15 text-accent'
              : tab.disabled
                ? 'text-text-secondary/30 cursor-not-allowed'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/30',
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.disabled && (
            <span className="ml-auto text-[9px] text-text-secondary/30 font-normal">예정</span>
          )}
        </button>
      ))}
    </nav>
  );
}
