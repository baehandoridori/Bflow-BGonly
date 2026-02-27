import { useState, useEffect } from 'react';
import { Palette, Check, Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { THEME_PRESETS, rgbToHex, hexToRgb, getPreset, getLightColors } from '@/themes';
import type { ThemeColors } from '@/themes';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';

export function ThemeSection() {
  const {
    themeId, customThemeColors, colorMode,
    setThemeId, setCustomThemeColors, setColorMode,
  } = useAppStore();

  const [editingCustom, setEditingCustom] = useState(false);
  const [customAccent, setCustomAccent] = useState('#6C5CE7');
  const [customSub, setCustomSub] = useState('#A29BFE');

  useEffect(() => {
    if (customThemeColors) {
      setCustomAccent(rgbToHex(customThemeColors.accent));
      setCustomSub(rgbToHex(customThemeColors.accentSub));
    }
  }, [customThemeColors]);

  const handlePresetSelect = (presetId: string) => {
    setEditingCustom(false);
    setThemeId(presetId);
    setCustomThemeColors(null);
  };

  const handleCustomApply = () => {
    const base = getPreset(themeId === 'custom' ? 'violet' : themeId)?.colors
      ?? THEME_PRESETS[0].colors;
    const colors: ThemeColors = {
      ...base,
      accent: hexToRgb(customAccent),
      accentSub: hexToRgb(customSub),
    };
    setThemeId('custom');
    setCustomThemeColors(colors);
    setEditingCustom(false);
  };

  return (
    <SettingsSection
      icon={<Palette size={18} className="text-accent" />}
      title="색상 테마"
    >
      {/* 다크/라이트 모드 세그먼트 */}
      <div className="flex items-center gap-1 p-1 bg-bg-primary rounded-lg mb-4 w-fit">
        <button
          onClick={() => setColorMode('dark')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
            colorMode === 'dark'
              ? 'bg-bg-card text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          <Moon size={13} />
          다크
        </button>
        <button
          onClick={() => setColorMode('light')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
            colorMode === 'light'
              ? 'bg-bg-card text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          <Sun size={13} />
          라이트
        </button>
      </div>

      {/* 프리셋 그리드 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {THEME_PRESETS.map((preset) => {
          const isActive = themeId === preset.id;
          const displayColors = colorMode === 'light' ? getLightColors(preset.id) : preset.colors;
          const accent = rgbToHex(displayColors.accent);
          const sub = rgbToHex(displayColors.accentSub);
          const bg = rgbToHex(displayColors.bgCard);
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetSelect(preset.id)}
              className={cn(
                'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer',
                isActive
                  ? 'border-accent bg-accent/10'
                  : 'border-bg-border hover:border-accent/40 hover:bg-bg-border/30',
              )}
            >
              <div
                className="w-full h-10 rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${bg} 0%, ${accent} 50%, ${sub} 100%)`,
                }}
              />
              <span className="text-xs text-text-primary font-medium">{preset.nameKo}</span>
              <span className="text-[11px] text-text-secondary">{preset.name}</span>
              {isActive && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                  <Check size={12} className="text-white" />
                </div>
              )}
            </button>
          );
        })}

        {/* 커스텀 버튼 */}
        <button
          onClick={() => setEditingCustom(true)}
          className={cn(
            'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer',
            themeId === 'custom'
              ? 'border-accent bg-accent/10'
              : 'border-bg-border hover:border-accent/40 hover:bg-bg-border/30 border-dashed',
          )}
        >
          <div className="w-full h-10 rounded-lg flex items-center justify-center bg-bg-border/50">
            <Palette size={20} className="text-text-secondary" />
          </div>
          <span className="text-xs text-text-primary font-medium">커스텀</span>
          <span className="text-[11px] text-text-secondary">Custom</span>
          {themeId === 'custom' && (
            <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
              <Check size={12} className="text-white" />
            </div>
          )}
        </button>
      </div>

      {/* 커스텀 색상 편집 패널 */}
      {editingCustom && (
        <div className="border border-bg-border rounded-lg p-4 bg-bg-primary/50 space-y-3">
          <p className="text-xs text-text-secondary">메인/서브 액센트 컬러를 직접 선택하세요.</p>
          <div className="flex gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">메인 액센트</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customAccent}
                  onChange={(e) => setCustomAccent(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <span className="text-xs font-mono text-text-secondary">{customAccent.toUpperCase()}</span>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">서브 액센트</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customSub}
                  onChange={(e) => setCustomSub(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <span className="text-xs font-mono text-text-secondary">{customSub.toUpperCase()}</span>
              </div>
            </label>
          </div>
          <div
            className="h-8 rounded-lg"
            style={{ background: `linear-gradient(135deg, ${customAccent}, ${customSub})` }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCustomApply}
              className="px-4 py-1.5 bg-accent hover:bg-accent/80 rounded-lg text-xs text-white font-medium transition-colors cursor-pointer"
            >
              적용
            </button>
            <button
              onClick={() => setEditingCustom(false)}
              className="px-4 py-1.5 bg-bg-border hover:bg-bg-border/80 rounded-lg text-xs text-text-secondary font-medium transition-colors cursor-pointer"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
