/**
 * v1.20.0: 글꼴(서체) 선택 + 사용자 폰트 추가/삭제 + 드래그앤드롭
 *
 * - 기본 글꼴: 큐레이션 9종 (FONT_FAMILIES)
 * - 내 글꼴: 사용자가 추가한 OTF/TTF/WOFF/WOFF2 (preferences.customFonts)
 * - 추가 방법: '+ 글꼴 추가' 버튼 (탐색기) 또는 드래그앤드롭
 * - 한글 미지원 폰트는 추가하되 토스트 경고
 */
import { useState, useCallback, useEffect } from 'react';
import { CaseSensitive, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY,
  applyFontFamily,
  ensureCustomFontsLoaded,
  escapeFontFamilyName,
  type CustomFont,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';

export function FontFamilySection() {
  const [fontFamily, setFontFamily] = useState<string>(DEFAULT_FONT_FAMILY);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // 저장된 설정 로드
  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      const customs = (prefs?.customFonts ?? []) as CustomFont[];
      ensureCustomFontsLoaded(customs);
      setCustomFonts(customs);
      setFontFamily(prefs?.fontFamily ?? DEFAULT_FONT_FAMILY);
      setHasLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // 변경 후 저장 + 적용 + 다른 창 동기화 (낙관적 업데이트 패턴)
  const persistAndApply = useCallback(async (familyId: string, nextCustomFonts: CustomFont[]) => {
    applyFontFamily(familyId, nextCustomFonts);
    setFontFamily(familyId);
    setCustomFonts(nextCustomFonts);
    try {
      const prev = (await loadPreferences()) ?? {};
      await savePreferences({ ...prev, fontFamily: familyId, customFonts: nextCustomFonts });
      window.electronAPI?.preferencesBroadcastChange?.({ fontFamily: familyId, customFonts: nextCustomFonts });
    } catch (err) {
      console.error('[글꼴] 설정 저장 실패:', err);
    }
  }, []);

  const handleSelect = useCallback((id: string) => {
    persistAndApply(id, customFonts);
  }, [customFonts, persistAndApply]);

  // 폰트 추가 결과 처리 (Add 버튼/DnD 공통)
  const processAddResults = useCallback((
    results: Array<CustomFont | { error: string }>,
  ): CustomFont[] => {
    const added: CustomFont[] = [];
    for (const r of results) {
      if (!r) continue;
      if ('error' in r) {
        toast.error(`폰트 추가 실패: ${r.error}`);
      } else {
        added.push(r);
        if (!r.hasKorean) {
          toast.warning(`"${r.name}" 글꼴은 한글 글리프가 없어 영문/숫자만 표시됩니다.`);
        }
      }
    }
    if (added.length > 0) {
      toast.success(`${added.length}개 폰트 추가됨`);
    }
    return added;
  }, []);

  const handleAddViaButton = useCallback(async () => {
    if (!window.electronAPI?.fontAdd) {
      toast.error('Electron API를 사용할 수 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const results = await window.electronAPI.fontAdd();
      const added = processAddResults(results);
      if (added.length > 0) {
        const next = [...customFonts, ...added];
        ensureCustomFontsLoaded(added); // 새로 추가된 것만 inject
        await persistAndApply(fontFamily, next);
      }
    } finally {
      setBusy(false);
    }
  }, [customFonts, fontFamily, persistAndApply, processAddResults]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (!window.electronAPI?.fontAddByPath || !window.electronAPI?.fontGetPathForFile) {
      toast.error('Electron API를 사용할 수 없습니다.');
      return;
    }
    // Electron 32+에선 File.path가 제거됨 → webUtils.getPathForFile 사용 (preload 경유)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.electronAPI!.fontGetPathForFile(f))
      .filter(Boolean);
    if (paths.length === 0) {
      toast.error('드롭된 파일에서 경로를 읽을 수 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const results = await window.electronAPI.fontAddByPath(paths);
      const added = processAddResults(results);
      if (added.length > 0) {
        const next = [...customFonts, ...added];
        ensureCustomFontsLoaded(added);
        await persistAndApply(fontFamily, next);
      }
    } finally {
      setBusy(false);
    }
  }, [customFonts, fontFamily, persistAndApply, processAddResults]);

  const handleDelete = useCallback(async (font: CustomFont) => {
    if (!confirm(`"${font.name}" 글꼴을 삭제하시겠습니까?`)) return;
    if (!window.electronAPI?.fontDelete) return;
    await window.electronAPI.fontDelete({ id: font.id, filename: font.filename });
    const next = customFonts.filter((f) => f.id !== font.id);
    // 삭제 중이던 폰트가 현재 적용 중이면 → DEFAULT_FONT_FAMILY로 폴백
    const fallbackId = fontFamily === font.id ? DEFAULT_FONT_FAMILY : fontFamily;
    // <head>에서 @font-face 제거
    document.querySelector(`style[data-font-id="${font.id}"]`)?.remove();
    await persistAndApply(fallbackId, next);
  }, [customFonts, fontFamily, persistAndApply]);

  if (!hasLoaded) return null;

  return (
    <SettingsSection
      icon={<CaseSensitive size={18} className="text-accent" />}
      title="글꼴 (서체)"
    >
      <div
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragLeave={(e) => {
          // currentTarget을 떠나는 경우만 (자식 간 이동은 무시)
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          'transition-all rounded-lg -mx-2 px-2 py-2',
          dragging && 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card bg-accent/8',
        )}
      >
        {/* 기본 글꼴 그룹 */}
        <p className="text-xs text-text-secondary mb-2">기본 글꼴</p>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {FONT_FAMILIES.map((meta) => {
            const active = fontFamily === meta.id;
            return (
              <button
                key={meta.id}
                onClick={() => handleSelect(meta.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium border transition-all cursor-pointer',
                  active
                    ? 'bg-accent/15 border-accent text-accent'
                    : 'border-bg-border text-text-primary hover:bg-bg-border/30',
                )}
                style={{ fontFamily: meta.cssStack }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* 내 글꼴 그룹 */}
        {customFonts.length > 0 && (
          <>
            <p className="text-xs text-text-secondary mb-2">내 글꼴</p>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {customFonts.map((font) => {
                const active = fontFamily === font.id;
                return (
                  <span
                    key={font.id}
                    className={cn(
                      'inline-flex items-center gap-0.5 pl-3 pr-1 py-0.5 rounded-md text-xs font-medium border transition-all',
                      active
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'border-bg-border text-text-primary hover:bg-bg-border/30',
                    )}
                  >
                    <button
                      onClick={() => handleSelect(font.id)}
                      className="cursor-pointer py-1 pr-1"
                      style={{ fontFamily: `'${escapeFontFamilyName(font.name)}', system-ui, sans-serif` }}
                      title={font.hasKorean ? font.name : `${font.name} (영문/숫자만 지원)`}
                    >
                      {font.name}
                      {!font.hasKorean && <span className="ml-1 text-[9px] opacity-60">EN</span>}
                    </button>
                    <button
                      onClick={() => handleDelete(font)}
                      className="w-5 h-5 inline-flex items-center justify-center rounded text-text-secondary/60 hover:bg-red-500/15 hover:text-red-400 cursor-pointer transition-colors"
                      title="삭제"
                      aria-label={`${font.name} 삭제`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          </>
        )}

        {/* + 글꼴 추가 버튼 */}
        <button
          onClick={handleAddViaButton}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-dashed transition-all',
            busy
              ? 'opacity-50 cursor-wait border-bg-border text-text-secondary'
              : 'border-bg-border text-accent-sub cursor-pointer hover:border-accent hover:bg-accent/8 hover:border-solid',
          )}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          글꼴 추가
        </button>

        {/* 라이선스 안내 */}
        <p className="mt-3 text-[10px] text-text-secondary/60 flex items-start gap-1.5 leading-relaxed">
          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span>
            추가하시는 글꼴의 라이선스는 본인이 확인해주세요. 추가된 글꼴은 본인 PC에만 저장됩니다 (다른 팀원에게는 안 보임). 드래그 앤 드롭으로도 추가할 수 있습니다.
          </span>
        </p>
      </div>
    </SettingsSection>
  );
}
