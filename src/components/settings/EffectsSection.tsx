import { useCallback } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAppStore } from '@/stores/useAppStore';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

const DEFAULTS = {
  loginEnabled: true,
  loginParticleCount: 666,
  dashboardEnabled: true,
  dashboardParticleCount: 120,
};

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

async function persistPlexus(plexus: typeof DEFAULTS) {
  const existing = await loadPreferences() ?? {};
  await savePreferences({ ...existing, plexus });
}

export function EffectsSection() {
  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const setPlexusSettings = useAppStore((s) => s.setPlexusSettings);

  const update = useCallback((partial: Partial<typeof DEFAULTS>) => {
    setPlexusSettings(partial);
    persistPlexus({ ...plexusSettings, ...partial });
  }, [plexusSettings, setPlexusSettings]);

  const handleReset = useCallback(() => {
    setPlexusSettings(DEFAULTS);
    persistPlexus(DEFAULTS);
  }, [setPlexusSettings]);

  return (
    <SettingsSection
      icon={<Sparkles size={18} className="text-accent" />}
      title="효과"
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
      {/* 로그인 플렉서스 */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <p className="text-sm font-medium text-text-primary">로그인 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">로그인 화면의 플렉서스 파티클 효과</p>
          </div>
          <Toggle
            checked={plexusSettings.loginEnabled}
            onChange={(v) => update({ loginEnabled: v })}
          />
        </div>
        {plexusSettings.loginEnabled && (
          <div className="flex items-center gap-3 ml-1">
            <span className="text-xs text-text-secondary/60 w-16 shrink-0">파티클 수</span>
            <input
              type="range"
              min={100}
              max={1500}
              step={50}
              value={plexusSettings.loginParticleCount}
              onChange={(e) => update({ loginParticleCount: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-bg-border rounded-full appearance-none cursor-pointer accent-accent"
            />
            <span className={cn(
              'text-xs font-mono w-12 text-right',
              plexusSettings.loginParticleCount !== DEFAULTS.loginParticleCount
                ? 'text-accent' : 'text-text-secondary/60',
            )}>
              {plexusSettings.loginParticleCount}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-bg-border/30 pt-5">
        {/* 대시보드 플렉서스 */}
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <p className="text-sm font-medium text-text-primary">대시보드 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">대시보드의 은은한 파티클 효과</p>
          </div>
          <Toggle
            checked={plexusSettings.dashboardEnabled}
            onChange={(v) => update({ dashboardEnabled: v })}
          />
        </div>
        {plexusSettings.dashboardEnabled && (
          <div className="flex items-center gap-3 ml-1">
            <span className="text-xs text-text-secondary/60 w-16 shrink-0">파티클 수</span>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={plexusSettings.dashboardParticleCount}
              onChange={(e) => update({ dashboardParticleCount: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-bg-border rounded-full appearance-none cursor-pointer accent-accent"
            />
            <span className={cn(
              'text-xs font-mono w-12 text-right',
              plexusSettings.dashboardParticleCount !== DEFAULTS.dashboardParticleCount
                ? 'text-accent' : 'text-text-secondary/60',
            )}>
              {plexusSettings.dashboardParticleCount}
            </span>
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-secondary/40 mt-4">
        * 파티클 수가 많으면 성능에 영향을 줄 수 있습니다
      </p>
    </SettingsSection>
  );
}
