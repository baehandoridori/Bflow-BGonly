/**
 * 담당 컴포지터 지정 팝오버 — 컴포지팅 현황 대시보드 헤더의 '담당 컴포지터' 칩에서 연다.
 *
 * 어드민만 연다(호출부 DashHeader 가 게이트). 여러 명을 동시에 지정할 수 있고,
 * 지정되면 `isCompositorForCompositing` 을 통해 컴포지팅 탭의 단계 변경 권한이 함께 열린다.
 *
 * 저장은 설정 탭의 컴포지터 섹션과 같은 서비스 경로를 쓴다:
 *   setIsCompositor(변경분만) → verifyUserBoolPropAfterSave(재조회·1회 retry) → setUsers(fresh)
 * verify 가 어긋나면 성공으로 말하지 않고 편집 상태를 유지해 재시도할 수 있게 둔다
 * (PostgREST 반영 지연·다른 PC 동시 편집 대응).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import { setIsCompositor, verifyUserBoolPropAfterSave } from '@/services/userService';
import { cn } from '@/utils/cn';

export function CompositorAssignPopover({ onClose }: { onClose: () => void }) {
  const allUsers = useAuthStore((s) => s.users);
  const setUsers = useAuthStore((s) => s.setUsers);

  const initial = useMemo(
    () => new Set(allUsers.filter((u) => u.isCompositor === true).map((u) => u.id)),
    [allUsers],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [saving, setSaving] = useState(false);
  // 편집 중에는 외부 사용자 목록 갱신(다른 PC 저장·주기적 loadUsers)이 입력을 덮어쓰지 않게 한다.
  const [dirty, setDirty] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dirty) return;
    setSelected(initial);
  }, [initial, dirty]);

  // 바깥 클릭 · Esc 로 닫기. 저장 중에는 닫지 않는다(결과 토스트를 놓치지 않도록).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (saving) return;
      const target = e.target as HTMLElement | null;
      // 여는 칩 자체는 바깥으로 치지 않는다 — mousedown 이 click 보다 먼저 와서
      //   여기서 닫고 곧바로 칩의 토글이 다시 여는 탓에 '눌러서 닫기' 가 안 먹는다.
      if (target?.closest('[data-compositor-chip]')) return;
      if (!rootRef.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, saving]);

  const sortedUsers = useMemo(
    () => [...allUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [allUsers],
  );
  const changedUsers = allUsers.filter((u) => (u.isCompositor === true) !== selected.has(u.id));
  const hasChanges = changedUsers.length > 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  };

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    const expectedIds = new Set(selected); // 비동기 전 스냅샷
    try {
      await Promise.all(changedUsers.map((u) => setIsCompositor(u.id, selected.has(u.id))));
      const { fresh, mismatched, diff } = await verifyUserBoolPropAfterSave(expectedIds, 'isCompositor');
      setUsers(fresh);

      if (mismatched) {
        const missing = diff.missing.map((u) => u.name).join(', ');
        const extra = diff.extra.map((u) => u.name).join(', ');
        console.warn('[CompositorAssignPopover] verify mismatch', { missing, extra });
        toast.error(
          missing
            ? `${missing} 은(는) 저장되지 않았어요. 잠시 후 다시 시도해주세요.`
            : `${extra} 이(가) 지정된 채로 남아있어요. 확인 후 다시 저장해주세요.`,
          { duration: 10000 },
        );
        return; // dirty 유지 · 팝오버 유지 → 즉시 재시도
      }

      setDirty(false);
      toast.success(`담당 컴포지터 ${expectedIds.size}명을 저장했어요.`);
      onClose();
    } catch (err) {
      console.error('[CompositorAssignPopover] 저장 실패:', err);
      toast.error('담당 컴포지터 저장에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="담당 컴포지터 지정"
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-xl border border-bg-border bg-bg-card shadow-[0_18px_40px_rgb(var(--color-shadow)/var(--shadow-alpha))]"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bg-border/60">
        <span className="text-[11px] font-bold text-text-primary">담당 컴포지터 지정</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="rounded p-0.5 text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>

      <div className="max-h-[260px] overflow-y-auto py-1">
        {sortedUsers.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-text-secondary/60">등록된 팀원이 없어요.</div>
        )}
        {sortedUsers.map((u) => {
          const on = selected.has(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              aria-pressed={on}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-border/30 cursor-pointer"
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  on ? 'bg-accent border-accent text-white' : 'border-bg-border',
                )}
              >
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className={cn('truncate text-[12px]', on ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                {u.name}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-bg-border/60">
        <span className="text-[10px] text-text-secondary tabular-nums">{selected.size}명 선택</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors',
            hasChanges && !saving
              ? 'bg-accent text-white hover:opacity-90 cursor-pointer'
              : 'bg-bg-border/40 text-text-secondary/60 cursor-not-allowed',
          )}
        >
          {saving ? (<><Loader2 size={12} className="animate-spin" />저장 중</>) : '저장'}
        </button>
      </div>
    </div>
  );
}
