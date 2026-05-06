/**
 * v1.20.0: 줄간격·자간 슬라이더
 *
 * - 줄간격: 1.2 ~ 2.0 (step 0.05), 기본 1.55
 * - 자간: -0.05 ~ 0.10 em (step 0.005), 기본 0
 * - "기본값 복원" 버튼 (다른 섹션과 일관)
 * - 즉시 적용 + savePreferences + 다른 창 동기화
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { AlignVerticalSpaceAround, RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  applySpacing,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LETTER_SPACING,
  LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, LINE_HEIGHT_STEP,
  LETTER_SPACING_MIN, LETTER_SPACING_MAX, LETTER_SPACING_STEP,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';

export function SpacingSection() {
  const [lineHeight, setLineHeight] = useState<number>(DEFAULT_LINE_HEIGHT);
  const [letterSpacing, setLetterSpacing] = useState<number>(DEFAULT_LETTER_SPACING);
  // Codex 1차 P2: 슬라이더 빠른 드래그 시 read-modify-write race로 stale 값이 디스크에 영구 저장될 수 있음.
  // 해결: 저장만 디바운스(200ms) + 마지막 값을 ref로 잡아 정확히 한 번만 발화 → last-write-wins 보장.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValuesRef = useRef<{ lh: number; ls: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      setLineHeight(prefs?.lineHeight ?? DEFAULT_LINE_HEIGHT);
      setLetterSpacing(prefs?.letterSpacing ?? DEFAULT_LETTER_SPACING);
    });
    return () => { cancelled = true; };
  }, []);

  // Unmount 시 pending 저장 즉시 flush — 슬라이더 조작 직후 탭 이동해도 손실 X
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const pending = pendingValuesRef.current;
        if (pending) {
          // Codex 5차 P2: save 완료 전에 broadcast하면 다른 창이 stale 값을 읽을 수 있음
          // → await 흐름으로 변경. async IIFE로 fire-and-forget but 내부 순서는 보장.
          (async () => {
            try {
              const prev = (await loadPreferences()) ?? {};
              await savePreferences({ ...prev, lineHeight: pending.lh, letterSpacing: pending.ls });
              window.electronAPI?.preferencesBroadcastChange?.({ lineHeight: pending.lh, letterSpacing: pending.ls });
            } catch (err) {
              console.error('[간격] flush 실패:', err);
            }
          })();
        }
      }
    };
  }, []);

  const persist = useCallback((lh: number, ls: number) => {
    // 즉시 적용 (UI 반응성)
    applySpacing(lh, ls);
    setLineHeight(lh);
    setLetterSpacing(ls);
    // 저장은 디바운스 — 마지막 값만 디스크에 (last-write-wins)
    pendingValuesRef.current = { lh, ls };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const target = pendingValuesRef.current;
      pendingValuesRef.current = null;
      saveTimerRef.current = null;
      if (!target) return;
      try {
        const prev = (await loadPreferences()) ?? {};
        await savePreferences({ ...prev, lineHeight: target.lh, letterSpacing: target.ls });
        window.electronAPI?.preferencesBroadcastChange?.({ lineHeight: target.lh, letterSpacing: target.ls });
      } catch (err) {
        console.error('[간격] 설정 저장 실패:', err);
      }
    }, 200);
  }, []);

  const handleReset = useCallback(() => {
    persist(DEFAULT_LINE_HEIGHT, DEFAULT_LETTER_SPACING);
  }, [persist]);

  const isCustom =
    lineHeight !== DEFAULT_LINE_HEIGHT
    || letterSpacing !== DEFAULT_LETTER_SPACING;

  return (
    <SettingsSection
      icon={<AlignVerticalSpaceAround size={18} className="text-accent" />}
      title="간격"
      action={
        isCustom ? (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-border/30 transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
            기본값 복원
          </button>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* 줄간격 */}
        <div className="flex items-center gap-3">
          <div className="w-16 shrink-0">
            <span className="text-xs font-medium text-text-primary">줄간격</span>
            <p className="text-[10px] text-text-secondary/50">위·아래 여백</p>
          </div>
          <input
            type="range"
            min={LINE_HEIGHT_MIN} max={LINE_HEIGHT_MAX} step={LINE_HEIGHT_STEP}
            value={lineHeight}
            onChange={(e) => persist(parseFloat(e.target.value), letterSpacing)}
            className="flex-1 h-1.5 cursor-pointer"
          />
          <span className={cn(
            'w-12 text-right text-xs font-mono tabular-nums',
            lineHeight === DEFAULT_LINE_HEIGHT ? 'text-text-secondary/50' : 'text-accent',
          )}>
            {lineHeight.toFixed(2)}
          </span>
        </div>

        {/* 자간 */}
        <div className="flex items-center gap-3">
          <div className="w-16 shrink-0">
            <span className="text-xs font-medium text-text-primary">자간</span>
            <p className="text-[10px] text-text-secondary/50">글자 사이</p>
          </div>
          <input
            type="range"
            min={LETTER_SPACING_MIN} max={LETTER_SPACING_MAX} step={LETTER_SPACING_STEP}
            value={letterSpacing}
            onChange={(e) => persist(lineHeight, parseFloat(e.target.value))}
            className="flex-1 h-1.5 cursor-pointer"
          />
          <span className={cn(
            'w-12 text-right text-xs font-mono tabular-nums',
            letterSpacing === DEFAULT_LETTER_SPACING ? 'text-text-secondary/50' : 'text-accent',
          )}>
            {letterSpacing >= 0 ? '+' : ''}{letterSpacing.toFixed(3)}
          </span>
        </div>

        <p className="text-[10px] text-text-secondary/40 mt-1">
          긴 메모·댓글·씬 설명 영역에서 가독성 효과가 가장 큽니다.
        </p>
      </div>
    </SettingsSection>
  );
}
