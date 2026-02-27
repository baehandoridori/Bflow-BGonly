import { useState, useEffect, useCallback } from 'react';
import { Monitor, RotateCcw } from 'lucide-react';
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

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-[11px] text-text-secondary/60 mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function StartupSection() {
  const [skipLoading, setSkipLoading] = useState(false);
  const [skipLanding, setSkipLanding] = useState(false);

  useEffect(() => {
    loadPreferences().then((prefs) => {
      if (prefs?.skipLoadingSplash) setSkipLoading(true);
      if (prefs?.skipLandingSplash) setSkipLanding(true);
    });
  }, []);

  const persist = useCallback(async (key: string, value: boolean) => {
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, [key]: value });
  }, []);

  const handleReset = useCallback(async () => {
    setSkipLoading(false);
    setSkipLanding(false);
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, skipLoadingSplash: false, skipLandingSplash: false });
  }, []);

  return (
    <SettingsSection
      icon={<Monitor size={18} className="text-accent" />}
      title="시작 화면"
      action={
        <button
          onClick={handleReset}
          className="flex items-center gap-1 text-[11px] text-text-secondary/50 hover:text-text-primary transition-colors cursor-pointer"
        >
          <RotateCcw size={12} />
          기본값 복원
        </button>
      }
    >
      <div className="divide-y divide-bg-border/30">
        <ToggleRow
          label="로딩 스플래시 건너뛰기"
          description="앱 시작 시 로딩 애니메이션을 건너뛰고 바로 진입합니다"
          checked={skipLoading}
          onChange={(v) => { setSkipLoading(v); persist('skipLoadingSplash', v); }}
        />
        <ToggleRow
          label="랜딩 스플래시 건너뛰기"
          description="로그인 후 스플래시 영상을 건너뛰고 바로 대시보드로 이동합니다"
          checked={skipLanding}
          onChange={(v) => { setSkipLanding(v); persist('skipLandingSplash', v); }}
        />
      </div>
      <p className="text-[10px] text-text-secondary/40 mt-3">
        * 변경 사항은 다음 앱 시작 시 적용됩니다
      </p>
    </SettingsSection>
  );
}
