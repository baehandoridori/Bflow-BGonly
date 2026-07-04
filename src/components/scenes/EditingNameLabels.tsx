// src/components/scenes/EditingNameLabels.tsx
// 실시간 편집 프레즌스 — 무지개 이름표(최대 2 + +N). 카드/시트 코너에 표시.
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/types';
import { formatEditorLabels } from '@/utils/editingPresence';

export function EditingNameLabels({
  editors,
  max = 2,
  className,
}: {
  editors: EditingUser[];
  max?: number;
  className?: string;
}) {
  if (!editors.length) return null;
  const { shown, overflow } = formatEditorLabels(editors, max);
  const aria = `${editors.map((u) => u.username).join(', ')} 편집 중`;
  return (
    <div className={cn('inline-flex items-center gap-1', className)} aria-label={aria}>
      {shown.map((u) => (
        <span key={u.userId} className="editing-namelabel">
          <span className="editing-namelabel__inner">
            <span className="editing-namelabel__dot" aria-hidden />
            {u.username}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="editing-namelabel">
          <span className="editing-namelabel__inner">+{overflow}</span>
        </span>
      )}
    </div>
  );
}
