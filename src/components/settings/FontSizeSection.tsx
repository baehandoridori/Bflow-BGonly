import { useState, useCallback } from 'react';
import { Type, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  type FontScale,
  type FontCategoryScales,
  FONT_SCALE_PRESETS,
  FONT_SCALE_ORDER,
  DEFAULT_FONT_SCALE,
  DEFAULT_CATEGORY_SCALES,
  FONT_CATEGORIES,
  CATEGORY_SCALE_MIN,
  CATEGORY_SCALE_MAX,
  CATEGORY_SCALE_STEP,
  applyFontSettings,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';

interface FontSizeSectionProps {
  fontScale: FontScale;
  categoryScales: FontCategoryScales;
  onFontScaleChange: (scale: FontScale) => void;
  onCategoryScalesChange: (scales: FontCategoryScales) => void;
}

export function FontSizeSection({
  fontScale,
  categoryScales,
  onFontScaleChange,
  onCategoryScalesChange,
}: FontSizeSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCustom, setIsCustom] = useState(false);

  // 프리셋 변경
  const handlePresetChange = useCallback((scale: FontScale) => {
    setIsCustom(false);
    onFontScaleChange(scale);
    const newScales = { ...DEFAULT_CATEGORY_SCALES };
    onCategoryScalesChange(newScales);
    applyFontSettings({ fontScale: scale, fontCategoryScales: newScales });
    // 저장
    persistSettings(scale, newScales);
  }, [onFontScaleChange, onCategoryScalesChange]);

  // 카테고리별 스케일 변경
  const handleCategoryChange = useCallback((
    categoryId: keyof FontCategoryScales,
    value: number,
  ) => {
    const newScales = { ...categoryScales, [categoryId]: value };
    onCategoryScalesChange(newScales);
    setIsCustom(true);
    applyFontSettings({ fontScale, fontCategoryScales: newScales });
    persistSettings(fontScale, newScales);
  }, [categoryScales, fontScale, onCategoryScalesChange]);

  // 기본값 복원
  const handleReset = useCallback(() => {
    setIsCustom(false);
    setShowAdvanced(false);
    onFontScaleChange(DEFAULT_FONT_SCALE);
    const newScales = { ...DEFAULT_CATEGORY_SCALES };
    onCategoryScalesChange(newScales);
    applyFontSettings({ fontScale: DEFAULT_FONT_SCALE, fontCategoryScales: newScales });
    persistSettings(DEFAULT_FONT_SCALE, newScales);
  }, [onFontScaleChange, onCategoryScalesChange]);

  return (
    <SettingsSection
      icon={<Type size={18} className="text-accent" />}
      title="글꼴 크기"
      action={
        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-border/30 transition-colors cursor-pointer"
        >
          <RotateCcw size={12} />
          기본값 복원
        </button>
      }
    >
      {/* 프리셋 세그먼트 */}
      <div className="mb-5">
        <p className="text-xs text-text-secondary mb-2">빠른 조절</p>
        <div className="flex items-center gap-1 p-1 bg-bg-primary rounded-lg w-fit">
          {FONT_SCALE_ORDER.map((key) => {
            const preset = FONT_SCALE_PRESETS[key];
            const isActive = fontScale === key && !isCustom;
            return (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {preset.label}
              </button>
            );
          })}
          {isCustom && (
            <span className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent">
              커스텀
            </span>
          )}
        </div>
      </div>

      {/* 미리보기 패널 */}
      <div className="mb-5">
        <p className="text-xs text-text-secondary mb-2">미리보기</p>
        <div className="bg-bg-primary border border-bg-border rounded-lg p-4 space-y-3">
          {/* 제목 */}
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-text-primary">페이지 제목 텍스트</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">제목</span>
          </div>
          {/* 서브헤딩 */}
          <div className="flex items-baseline justify-between">
            <span className="text-base font-semibold text-text-primary">위젯 헤더 / 섹션 제목</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">서브제목</span>
          </div>
          {/* 본문 */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-primary">본문 텍스트와 설명입니다. 일반적인 내용이 여기 표시됩니다.</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">본문</span>
          </div>
          {/* 캡션 */}
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-text-secondary">라벨, 도움말 텍스트, 필터 옵션</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">캡션</span>
          </div>
          {/* 마이크로 */}
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-text-secondary/70">뱃지 · 타임스탬프 · 2026-02-27 14:30</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">마이크로</span>
          </div>
          {/* 나노 */}
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-text-secondary/50">최소 크기 인디케이터 · 아카이브 날짜</span>
            <span className="text-[10px] text-text-secondary/40 ml-2 shrink-0">나노</span>
          </div>
        </div>
      </div>

      {/* 고급 설정 토글 */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer mb-3"
      >
        {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        고급 설정
        <span className="text-[10px] text-text-secondary/40">카테고리별 개별 조절</span>
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-1">
          {FONT_CATEGORIES.map((cat) => {
            const value = categoryScales[cat.id];
            const percentage = Math.round(value * 100);
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <div className="w-16 shrink-0">
                  <span className="text-xs font-medium text-text-primary">{cat.label}</span>
                  <p className="text-[10px] text-text-secondary/50">{cat.description}</p>
                </div>
                <input
                  type="range"
                  min={CATEGORY_SCALE_MIN}
                  max={CATEGORY_SCALE_MAX}
                  step={CATEGORY_SCALE_STEP}
                  value={value}
                  onChange={(e) => handleCategoryChange(cat.id, parseFloat(e.target.value))}
                  className="flex-1 h-1.5 cursor-pointer"
                />
                <span className={cn(
                  'w-10 text-right text-xs font-mono',
                  value === 1.0 ? 'text-text-secondary/50' : 'text-accent',
                )}>
                  {percentage}%
                </span>
              </div>
            );
          })}
          <p className="text-[10px] text-text-secondary/40 mt-2">
            * 고급 설정을 변경하면 프리셋이 &apos;커스텀&apos;으로 전환됩니다
          </p>
        </div>
      )}
    </SettingsSection>
  );
}

// ─── 영속화 헬퍼 ─────────────────────────────

async function persistSettings(
  fontScale: FontScale,
  fontCategoryScales: FontCategoryScales,
): Promise<void> {
  try {
    const existing = await loadPreferences() ?? {};
    await savePreferences({
      ...existing,
      fontScale,
      fontCategoryScales,
    });
  } catch (err) {
    console.error('[설정] 글꼴 설정 저장 실패:', err);
  }
}
