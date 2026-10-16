/**
 * v1.142.0~ — 어드민 전용 배경 편집자 지정 섹션.
 *
 * 체크한 사람은 배경 화면에서 관리자와 똑같이 도면·장소·배경 이미지·시점 묶음을 고칠 수 있다. 다른 관리자 권한은 주지 않는다.
 * 명단은 서버(background_editors)에 있고 관리자 세션으로만 읽고 바꾼다(IPC → 메인 → 세션 래퍼). 한 사람씩 바로 저장한다:
 * 즉시 화면 반영 → 저장 → 실패하면 되돌림. 저장되면 서버가 배경 화면들에 다시 읽으라는 신호를 보낸다.
 * 관리자는 명단과 관계없이 늘 고칠 수 있어 체크 칸 대신 '관리자'로 보인다.
 */

import { useEffect, useState } from 'react';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';

const errorText = (error: unknown) => error instanceof Error && error.message ? error.message : '배경 편집자 명단을 불러오지 못했어요.';

export function BackgroundEditorSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const isAdmin = currentUser?.role === 'admin';
  const [editorIds, setEditorIds] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    window.electronAPI.backgroundEditorsList()
      .then((ids) => { if (alive) { setEditorIds(new Set(ids)); setLoadError(''); } })
      .catch((error: unknown) => { if (alive) setLoadError(errorText(error)); });
    return () => { alive = false; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function toggle(id: string, name: string) {
    if (savingId || !editorIds) return;
    const before = editorIds, editor = !before.has(id), next = new Set(before);
    if (editor) next.add(id); else next.delete(id);
    setEditorIds(next);
    setSavingId(id);
    try {
      const saved = await window.electronAPI.backgroundEditorsSet(id, editor);
      setEditorIds(new Set(saved));
      toast.success(editor ? `${name} 님이 이제 배경을 고칠 수 있어요.` : `${name} 님은 이제 배경을 보기만 해요.`);
    } catch (error) {
      setEditorIds(before);
      toast.error(`저장하지 못했어요: ${errorText(error)}`);
    } finally {
      setSavingId(null);
    }
  }

  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const count = editorIds ? sortedUsers.filter((u) => u.role !== 'admin' && editorIds.has(u.id)).length : 0;

  return (
    <SettingsSection icon={<MapIcon size={14} className="text-accent" />} title="배경 편집자 지정">
      <p className="text-[11px] text-text-secondary/70 mb-4 leading-relaxed">
        배경 메뉴는 팀 모두가 볼 수 있어요. 여기서 체크한 사람은 관리자처럼 도면·장소·배경 이미지·시점 묶음을 고칠 수 있고,
        다른 관리자 권한은 생기지 않아요. 체크하면 바로 저장돼요.
      </p>
      <div className="rounded-lg border border-bg-border/60 bg-bg-primary/30 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider mb-2 text-accent">
          배경 편집자
          {editorIds && <span className="ml-1.5 text-text-secondary/60 normal-case tracking-normal">({count})</span>}
        </div>
        {loadError ? (
          <div className="text-[11px] text-red-400 px-2 py-3" role="alert">{loadError}</div>
        ) : !editorIds ? (
          <div className="flex items-center gap-2 text-[11px] text-text-secondary/60 px-2 py-3"><Loader2 size={12} className="animate-spin" />불러오는 중…</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pr-1">
            {sortedUsers.map((u) => {
              const admin = u.role === 'admin', checked = admin || editorIds.has(u.id);
              return (
                <label
                  key={u.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
                    admin ? 'cursor-default' : 'cursor-pointer',
                    checked ? 'bg-accent/10' : 'hover:bg-bg-primary/50',
                  )}
                  title={admin ? '관리자는 늘 배경을 고칠 수 있어요' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={admin || savingId !== null}
                    onChange={() => { void toggle(u.id, u.name); }}
                    className="accent-accent w-3.5 h-3.5 cursor-pointer disabled:cursor-default"
                  />
                  <span className="text-[12px] text-text-primary truncate flex-1">{u.name}</span>
                  {savingId === u.id && <Loader2 size={12} className="animate-spin text-text-secondary/60" />}
                  {admin && <span className="text-[10px] text-accent-sub">관리자</span>}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
