import { cn } from '@/utils/cn';
import { useMotionPref } from '@/hooks/useMotionPref';

interface ShortcutHelpOverlayProps {
  onClose(): void;
}

const SHORTCUTS = [
  { keys: 'T', action: '오늘로 이동' },
  { keys: 'W', action: '주 보기' },
  { keys: 'M', action: '월 보기' },
  { keys: 'C', action: '새 일정' },
  { keys: '←  →', action: '이전·다음 기간' },
  { keys: 'Esc', action: '닫기·취소' },
  { keys: '?', action: '단축키 도움말' },
] as const;

export function ShortcutHelpOverlay({ onClose }: ShortcutHelpOverlayProps) {
  const { reduce } = useMotionPref();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/55 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="캘린더 단축키"
        className={cn(
          'w-full max-w-sm rounded-2xl border border-white/10 bg-bg-card/95 p-5 shadow-2xl shadow-black/40',
          !reduce && 'animate-[char-modal-in_200ms_ease-out]',
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">캘린더 단축키</h2>
            <p className="mt-1 text-[11px] text-text-secondary">자주 쓰는 동작을 빠르게 열 수 있어요.</p>
          </div>
          <button
            type="button"
            aria-label="단축키 도움말 닫기"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            닫기
          </button>
        </div>

        <dl className="space-y-1.5">
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
              <dt className="text-xs text-text-secondary">{action}</dt>
              <dd>
                <kbd className="inline-flex min-w-8 justify-center rounded-md border border-white/10 bg-bg-primary/70 px-2 py-1 font-mono text-[11px] font-semibold text-text-primary shadow-sm">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
