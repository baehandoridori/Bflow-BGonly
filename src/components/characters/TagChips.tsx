import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { tagColor } from '@/utils/tagColor';

/** 태그별 고유색 토글 칩. on 이면 색 채움(틴트), off 면 회색 + 색 점. */
export function TagPill({
  tag,
  on,
  onClick,
}: {
  tag: string;
  on: boolean;
  onClick: () => void;
}) {
  const c = tagColor(tag);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 transition-colors duration-200 ease-out cursor-pointer"
      style={
        on
          ? { background: `${c}26`, borderColor: `${c}99`, color: c }
          : { background: 'transparent', borderColor: 'rgb(var(--color-bg-border))', color: 'rgb(var(--color-text-secondary))' }
      }
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, opacity: on ? 1 : 0.55 }} />
      {tag}
    </button>
  );
}

/** 미리 정의된 토글 칩(태그별 고유색) + 자유 추가. */
export function TagChipSection({
  label,
  palette,
  tags,
  onChange,
}: {
  label: string;
  palette: readonly string[];
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const chips = useMemo(() => {
    const extra = tags.filter((t) => !palette.includes(t));
    return [...palette, ...extra];
  }, [palette, tags]);

  const toggle = (tag: string) => {
    if (tags.includes(tag)) onChange(tags.filter((t) => t !== tag));
    else onChange([...tags, tag]);
  };

  const addCustom = () => {
    const t = input.trim();
    if (!t || tags.includes(t)) { setInput(''); return; }
    onChange([...tags, t]);
    setInput('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((tag) => (
          <TagPill key={tag} tag={tag} on={tags.includes(tag)} onClick={() => toggle(tag)} />
        ))}
        <div className="flex items-center gap-1">
          <Plus size={12} className="text-text-secondary" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            onBlur={addCustom}
            placeholder="직접 추가"
            aria-label={`${label} 직접 추가`}
            className="bg-transparent border border-bg-border rounded-full px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50 w-20"
          />
        </div>
      </div>
    </div>
  );
}
