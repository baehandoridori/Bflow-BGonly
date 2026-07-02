import { useEffect, useState } from 'react';
import { FolderCog, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { readCharacterWorkFolderRoot, saveCharacterWorkFolderRoot } from '@/services/characterFolderService';

export function CharacterFolderRootSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    readCharacterWorkFolderRoot()
      .then((path) => { if (!cancelled) setRootPath(path); })
      .catch((err) => {
        console.error('[CharacterFolderRootSection] 기준 경로 로드 실패:', err);
        if (!cancelled) toast.error('캐릭터 폴더 기준 경로를 불러오지 못했어요');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function pickAndSave() {
    if (!window.electronAPI?.chooseFolderPath) {
      toast.error('현재 환경에서는 폴더를 선택할 수 없어요');
      return;
    }
    const selected = await window.electronAPI.chooseFolderPath();
    if (!selected) return;

    setSaving(true);
    try {
      await saveCharacterWorkFolderRoot(selected);
      setRootPath(selected);
      toast.success('캐릭터 폴더 기준 경로를 저장했어요');
    } catch (err) {
      console.error('[CharacterFolderRootSection] 기준 경로 저장 실패:', err);
      toast.error('캐릭터 폴더 기준 경로 저장에 실패했어요');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon={<FolderCog size={14} className="text-accent" />}
      title="캐릭터 폴더 기준 경로"
      action={saving ? <Loader2 size={14} className="animate-spin text-text-secondary" /> : null}
    >
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        캐릭터 상세에서 작업 폴더를 바로 만들 때 사용할 팀 공용 위치입니다. 한 번 지정하면 모든 팀원이 같은 기준 경로를 씁니다.
      </p>

      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3 flex flex-col gap-3">
        <div>
          <div className="text-[11px] text-text-secondary mb-1">현재 기준 경로</div>
          <div
            className="min-h-9 rounded-md border border-bg-border bg-bg-card px-3 py-2 text-[12px] text-text-primary break-all"
            title={rootPath ?? undefined}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2 text-text-secondary/70">
                <Loader2 size={12} className="animate-spin" /> 불러오는 중...
              </span>
            ) : rootPath ? rootPath : (
              <span className="text-text-secondary/60">아직 설정되지 않았습니다.</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={pickAndSave}
          disabled={saving || loading}
          className="self-start px-3 py-2 rounded-md border border-bg-border text-[12px] text-text-primary hover:border-accent/60 hover:text-accent disabled:opacity-50"
        >
          폴더 선택
        </button>
      </div>
    </SettingsSection>
  );
}
