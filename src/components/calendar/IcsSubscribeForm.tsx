import { useState } from 'react';
import { EVENT_COLORS } from '@/types/calendar';
import { cleanIpcErrorMessage } from '@/utils/ipcErrorMessage';

interface IcsSubscribeFormProps {
  /** 있으면 기존 구독 편집 모드. 주소는 바꿀 수 없다(주소 변경은 다시 구독하는 것과 같다). */
  initial?: { name: string; url: string; color: string };
  onSubmit: (input: { name: string; url: string; color: string }) => Promise<void>;
  onCancel: () => void;
}

/**
 * 주소 형식 1차 확인. 최종 판정은 메인 프로세스가 하고, 여기서는 눌러 보기 전에
 * 흔한 실수(빈 값·webcal 외 프로토콜)를 인라인으로 알려 주기만 한다.
 */
function describeUrlProblem(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed === '') return '캘린더 주소를 붙여넣어 주세요';
  const normalized = /^webcal:\/\//i.test(trimmed)
    ? `https://${trimmed.slice('webcal://'.length)}`
    : trimmed;
  if (!/^https?:\/\/.+/i.test(normalized)) return '주소는 http, https, webcal로 시작해야 합니다';
  return null;
}

export function IcsSubscribeForm({ initial, onSubmit, onCancel }: IcsSubscribeFormProps) {
  const isEditing = initial !== undefined;
  const [url, setUrl] = useState(initial?.url ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? EVENT_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    const problem = describeUrlProblem(url);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), url: url.trim(), color });
      // 성공하면 부모가 폼을 닫는다. 닫힌 뒤 상태를 건드리지 않도록 여기서 끝낸다.
      onCancel();
      return;
    } catch (submitError) {
      setError(cleanIpcErrorMessage(submitError, '구독을 추가하지 못했습니다'));
    }
    setSubmitting(false);
  };

  return (
    <div
      role="group"
      aria-label={isEditing ? '구독 이름·색 바꾸기' : '주소로 구독 추가'}
      className="mt-1 flex flex-col gap-1.5 rounded-md border border-bg-border/60 bg-bg-primary/40 p-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        aria-label="캘린더 주소"
        type="text"
        value={url}
        autoFocus={!isEditing}
        readOnly={isEditing}
        placeholder="https://... 또는 webcal://..."
        onChange={(event) => { setUrl(event.target.value); setError(null); }}
        className="w-full rounded border border-bg-border/70 bg-bg-primary/85 px-1.5 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-secondary/45 focus:border-accent/50 read-only:text-text-secondary"
      />
      <input
        aria-label="구독 이름"
        type="text"
        value={name}
        autoFocus={isEditing}
        placeholder="이름 (비우면 주소를 씁니다)"
        onChange={(event) => setName(event.target.value)}
        className="w-full rounded border border-bg-border/70 bg-bg-primary/85 px-1.5 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-secondary/45 focus:border-accent/50"
      />
      <div className="flex flex-wrap gap-1">
        {EVENT_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`색 ${option}`}
            aria-pressed={color === option}
            onClick={() => setColor(option)}
            className="h-4 w-4 rounded-[4px] cursor-pointer"
            style={{
              backgroundColor: option,
              outline: color === option ? '2px solid rgb(var(--color-text-primary))' : 'none',
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-[10px] font-medium text-red-400">{error}</p>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded px-1.5 py-1 text-[11px] text-text-secondary hover:bg-bg-border/50 hover:text-text-primary cursor-pointer"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={submitting}
          className="flex-1 rounded bg-accent/20 px-1.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? '저장 중…' : isEditing ? '저장' : '추가'}
        </button>
      </div>
    </div>
  );
}
