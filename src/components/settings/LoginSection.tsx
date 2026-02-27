import { useState, useEffect, useCallback } from 'react';
import { KeyRound } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer shrink-0',
        checked ? 'bg-accent' : 'bg-bg-border',
      )}
    >
      <div
        className={cn(
          'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function LoginSection() {
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    loadPreferences().then((prefs) => {
      if (prefs?.rememberMe !== undefined) setRememberMe(prefs.rememberMe!);
    });
  }, []);

  const handleToggle = useCallback(async (value: boolean) => {
    setRememberMe(value);
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, rememberMe: value });
  }, []);

  return (
    <SettingsSection
      icon={<KeyRound size={18} className="text-accent" />}
      title="로그인"
    >
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">로그인 유지</p>
          <p className="text-[11px] text-text-secondary/60 mt-0.5">
            활성화 시 앱을 다시 열 때 자동으로 로그인됩니다
          </p>
        </div>
        <Toggle checked={rememberMe} onChange={handleToggle} />
      </div>
      {!rememberMe && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-[11px] text-amber-400/80">
            비활성화 시 앱을 열 때마다 로그인해야 합니다
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
