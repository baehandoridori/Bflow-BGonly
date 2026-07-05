// src/components/scenes/EditingPresenceBanner.tsx
// 실시간 편집 프레즌스 — 상세 모달 배너(전원 나열 + 경고 톤). 링 없이 배너만.
import { cn } from '@/utils/cn';
import type { PresenceEditor } from '@/utils/editingPresence';
import { isWarnPresence, editorDisplayName } from '@/utils/editingPresence';

export function EditingPresenceBanner({ editors }: { editors: PresenceEditor[] }) {
  if (!editors.length) return null;
  const names = editors.map(editorDisplayName).join(', ');
  return (
    <div
      className={cn('editing-banner', isWarnPresence(editors) && 'editing-banner--warn')}
      aria-label={`${names} 지금 작업 중`}
    >
      <span className="editing-namelabel">
        <span className="editing-namelabel__inner">
          <span className="editing-namelabel__dot" aria-hidden />
          {names}
        </span>
      </span>
      <span className="editing-banner__text">지금 작업 중 · 파일 열려 있음</span>
    </div>
  );
}
