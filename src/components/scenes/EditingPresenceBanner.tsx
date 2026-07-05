// src/components/scenes/EditingPresenceBanner.tsx
// 실시간 편집 프레즌스 — 상세 모달 배너(전원 나열 + 경고 톤). 링 없이 배너만.
import { cn } from '@/utils/cn';
import type { PresenceEditor } from '@/utils/editingPresence';
import { isWarnPresence, editorDisplayName } from '@/utils/editingPresence';

export function EditingPresenceBanner({
  editors,
  warn,
}: {
  editors: PresenceEditor[];
  /** 경고 톤 강제 지정. 통합 모달처럼 여러 파일 유니온을 받는 경우 파일별 충돌 신호를 넘긴다.
   *  미지정 시 단일 파일 기준(편집자 2명+)으로 판정. */
  warn?: boolean;
}) {
  if (!editors.length) return null;
  const names = editors.map(editorDisplayName).join(', ');
  const isWarn = warn ?? isWarnPresence(editors);
  return (
    <div
      className={cn('editing-banner', isWarn && 'editing-banner--warn')}
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
