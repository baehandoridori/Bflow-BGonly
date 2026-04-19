import { useState, useEffect } from 'react';
import { Palette, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  FONT_CATEGORIES,
  FONT_COLOR_PRESETS,
  applyTextColors,
  type FontColorPreset,
  type FontCategoryColors,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { useAppStore } from '@/stores/useAppStore';
import { getPreset, getLightColors } from '@/themes';

// ─── 헬퍼 ──────────────────────────────────────

function parseTriplet(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(' ').map(Number);
  return [r || 0, g || 0, b || 0];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

// ─── 컴포넌트 ──────────────────────────────────

export function FontColorSection() {
  const themeId = useAppStore((s) => s.themeId);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const colorMode = useAppStore((s) => s.colorMode);

  const [preset, setPreset] = useState<FontColorPreset>('theme');
  const [colors, setColors] = useState<FontCategoryColors>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // 테마 기반 폴백 색상 (사용자 커스텀 > 라이트 > 다크 프리셋 > 기본값)
  const themeColors =
    customThemeColors ??
    (colorMode === 'light' ? getLightColors(themeId) : getPreset(themeId)?.colors);
  const primary = themeColors?.textPrimary ?? '232 232 238';
  const secondary = themeColors?.textSecondary ?? '139 141 163';
  const accentSub = themeColors?.accentSub ?? '162 155 254';

  // 저장된 설정 로드
  useEffect(() => {
    (async () => {
      const prefs = await loadPreferences();
      if (prefs?.fontColorPreset) setPreset(prefs.fontColorPreset);
      if (prefs?.fontCategoryColors) setColors(prefs.fontCategoryColors);
      setHasLoaded(true);
    })();
  }, []);

  // 테마/컬러모드/커스텀 색상이 변경되면 현재 preset 기준으로 카테고리 색 재계산·적용
  // loadPreferences 완료 전에는 skip → 저장된 custom 색이 기본값으로 플래시되는 것 방지
  useEffect(() => {
    if (!hasLoaded) return;
    if (preset === 'custom') return; // custom은 사용자가 직접 지정한 값 유지
    const nextColors = FONT_COLOR_PRESETS[preset].getColors(primary, secondary, accentSub);
    setColors(nextColors);
    applyTextColors(nextColors);
    // 재계산된 색상을 디스크에 영속화 — 앱 재시작 후에도 현재 테마 기준 색상 유지
    // (이전에는 session-only 였기 때문에 재시작 시 stale 색상으로 되돌아감)
    (async () => {
      try {
        const prev = (await loadPreferences()) ?? {};
        await savePreferences({
          ...prev,
          fontColorPreset: preset,
          fontCategoryColors: nextColors,
        });
        window.electronAPI?.preferencesBroadcastChange?.({
          fontColorPreset: preset,
          fontCategoryColors: nextColors,
        });
      } catch (err) {
        console.warn('[font-color] 재계산 색상 저장 실패:', err);
      }
    })();
  }, [hasLoaded, preset, primary, secondary, accentSub]);

  // 프리셋 변경
  const handlePresetChange = async (p: FontColorPreset) => {
    setPreset(p);
    const nextColors =
      p === 'custom'
        ? colors
        : FONT_COLOR_PRESETS[p].getColors(primary, secondary, accentSub);
    setColors(nextColors);
    applyTextColors(nextColors);
    try {
      const prev = (await loadPreferences()) ?? {};
      await savePreferences({
        ...prev,
        fontColorPreset: p,
        fontCategoryColors: nextColors,
      });
      window.electronAPI?.preferencesBroadcastChange?.({
        fontColorPreset: p,
        fontCategoryColors: nextColors,
      });
    } catch (err) {
      console.error('[설정] 글자 색상 프리셋 저장 실패:', err);
    }
  };

  // 카테고리별 색상 변경
  const handleCategoryColor = async (cat: keyof FontCategoryColors, hex: string) => {
    const next: FontCategoryColors = { ...colors, [cat]: fromHex(hex) };
    setColors(next);
    setPreset('custom');
    applyTextColors(next);
    try {
      const prev = (await loadPreferences()) ?? {};
      await savePreferences({
        ...prev,
        fontColorPreset: 'custom',
        fontCategoryColors: next,
      });
      window.electronAPI?.preferencesBroadcastChange?.({
        fontColorPreset: 'custom',
        fontCategoryColors: next,
      });
    } catch (err) {
      console.error('[설정] 글자 카테고리 색상 저장 실패:', err);
    }
  };

  return (
    <SettingsSection
      icon={<Palette size={18} className="text-accent" />}
      title="글자 색상"
    >
      <p className="text-xs text-text-secondary mb-3">
        카테고리별 색상을 프리셋 또는 사용자 지정으로 변경합니다.
      </p>

      {/* 프리셋 버튼 */}
      <div className="flex gap-2 flex-wrap mb-4">
        {(Object.keys(FONT_COLOR_PRESETS) as FontColorPreset[]).map((p) => (
          <button
            key={p}
            onClick={() => handlePresetChange(p)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium border transition-all cursor-pointer',
              preset === p
                ? 'bg-accent text-on-accent border-accent'
                : 'border-bg-border text-text-primary hover:bg-bg-border/30',
            )}
          >
            {FONT_COLOR_PRESETS[p].label}
          </button>
        ))}
      </div>

      {/* 고급 설정 토글 */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer mb-3"
      >
        {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        고급 설정
        <span className="text-[10px] text-text-secondary/40">카테고리별 색상 개별 지정</span>
      </button>

      {showAdvanced && (
        <div className="space-y-3">
          {FONT_CATEGORIES.map((cat) => {
            const current =
              colors[cat.id] ??
              (preset !== 'custom'
                ? FONT_COLOR_PRESETS[preset].getColors(primary, secondary, accentSub)[cat.id]
                : undefined) ??
              primary;
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <div className="w-20 shrink-0">
                  <span className="text-xs font-medium text-text-primary">{cat.label}</span>
                  <p className="text-[10px] text-text-secondary/50">{cat.description}</p>
                </div>
                <input
                  type="color"
                  value={toHex(parseTriplet(current))}
                  onChange={(e) => handleCategoryColor(cat.id, e.target.value)}
                  className="w-10 h-8 rounded cursor-pointer bg-transparent"
                />
                <span className={cn(cat.cssClass, 'flex-1 truncate')}>{cat.previewText}</span>
              </div>
            );
          })}
          <p className="text-[10px] text-text-secondary/40 mt-2">
            * 고급 설정을 변경하면 프리셋이 &apos;사용자 지정&apos;으로 전환됩니다
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
