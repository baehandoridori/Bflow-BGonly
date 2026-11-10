import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

/** 씬 작업 링크 설정 — 가이드 그림을 넣을 때 작업 폴더 제안 켜고 끄기(설계 2026-11-10 4.8). */
export function SceneLinkSection() {
  const [enabled, setEnabled] = useState(true);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadPreferences().then((prefs) => {
      if (!cancelled) setEnabled(prefs?.guideFolderSuggestEnabled ?? true);
    });
    return () => { cancelled = true; };
  }, []);

  const change = async (next: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setEnabled(next);
    try {
      const saved = await savePreferences({ ...(await loadPreferences() ?? {}), guideFolderSuggestEnabled: next });
      if (!saved) {
        setEnabled(!next);
        toast.error('설정을 저장하지 못했어요');
      }
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <SettingsSection icon={<Link2 size={18} className="text-accent" />} title="씬 작업 링크">
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">가이드 그림을 넣을 때 작업 폴더 제안</p>
          <p className="mt-0.5 text-[11px] text-text-secondary/60">
            가이드 칸에 공유 드라이브 그림을 넣으면 그 그림이 있는 폴더를 작업 폴더로 넣을지 물어봐요
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="가이드 그림을 넣을 때 작업 폴더 제안"
          onClick={() => { void change(!enabled); }}
          className={cn(
            'relative h-[22px] w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
            enabled ? 'bg-accent' : 'bg-bg-border',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
              enabled ? 'translate-x-[22px]' : 'translate-x-[3px]',
            )}
          />
        </button>
      </div>
    </SettingsSection>
  );
}
