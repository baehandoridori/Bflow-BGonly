/**
 * v1.26.0 — 드로잉 주석 모드 툴바.
 *
 * 상단 도구바: 펜/직선/화살표/사각형/원/텍스트/지우개 + Undo + 모두 지우기
 * 옵션바: 색상 7개 + 굵기 3단 (S/M/L) + 투명도 슬라이더
 */

import { Pencil, Minus, ArrowRight, Square, Circle as CircleIcon, Type, Eraser, Undo2, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export type DrawTool = 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'erase';

export const COLORS = ['#EB5757', '#FDCB6E', '#00B894', '#74B9FF', '#A29BFE', '#FFFFFF', '#0F1117'] as const;
export const STROKE_WIDTHS = [2, 4, 8] as const;

interface AnnotationToolbarProps {
  tool: DrawTool;
  color: string;
  strokeWidth: number;
  opacity: number;
  onToolChange: (t: DrawTool) => void;
  onColorChange: (c: string) => void;
  onStrokeChange: (w: number) => void;
  onOpacityChange: (o: number) => void;
  onUndo: () => void;
  onClear: () => void;
}

export function AnnotationToolbar({
  tool,
  color,
  strokeWidth,
  opacity,
  onToolChange,
  onColorChange,
  onStrokeChange,
  onOpacityChange,
  onUndo,
  onClear,
}: AnnotationToolbarProps) {
  const ToolBtn = ({ name, label, Icon }: { name: DrawTool; label: string; Icon: typeof Pencil }) => (
    <button
      type="button"
      className={cn(
        'w-9 h-9 rounded-md flex items-center justify-center transition-colors',
        tool === name ? 'bg-accent/25 text-accent-sub' : 'text-text-secondary hover:bg-bg-border/50 hover:text-text-primary',
      )}
      onClick={() => onToolChange(name)}
      title={label}
      aria-label={label}
    >
      <Icon size={18} />
    </button>
  );

  return (
    <>
      {/* 상단 도구 툴바 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-bg-card/95 backdrop-blur border border-bg-border/60 rounded-xl p-1.5 flex gap-1 items-center shadow-2xl z-20">
        <ToolBtn name="pen" label="펜 (하이라이터)" Icon={Pencil} />
        <ToolBtn name="line" label="직선" Icon={Minus} />
        <ToolBtn name="arrow" label="화살표" Icon={ArrowRight} />
        <ToolBtn name="rect" label="사각형" Icon={Square} />
        <ToolBtn name="circle" label="원" Icon={CircleIcon} />
        <div className="w-px h-6 bg-bg-border mx-1" />
        <ToolBtn name="text" label="텍스트" Icon={Type} />
        <ToolBtn name="erase" label="지우개" Icon={Eraser} />
        <div className="w-px h-6 bg-bg-border mx-1" />
        <button
          type="button"
          className="w-9 h-9 rounded-md text-text-secondary hover:bg-bg-border/50 hover:text-text-primary flex items-center justify-center"
          onClick={onUndo}
          title="실행 취소 (Ctrl+Z)"
          aria-label="실행 취소"
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="w-9 h-9 rounded-md text-text-secondary hover:bg-bg-border/50 hover:text-text-primary flex items-center justify-center"
          onClick={() => {
            if (confirm('주석을 모두 지울까요?')) onClear();
          }}
          title="모두 지우기"
          aria-label="모두 지우기"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* 옵션바 */}
      <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-bg-card/95 backdrop-blur border border-bg-border/60 rounded-lg px-3.5 py-2.5 flex gap-3.5 items-center text-xs z-20">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary/70 text-[11px] font-semibold">색상</span>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColorChange(c)}
                className={cn(
                  'w-5 h-5 rounded-full transition-transform border-2',
                  color === c
                    ? 'border-white ring-2 ring-accent'
                    : 'border-transparent hover:scale-110',
                  c === '#FFFFFF' && 'border-bg-border',
                )}
                style={{ background: c }}
                aria-label={`색상 ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-secondary/70 text-[11px] font-semibold">굵기</span>
          {[
            { w: 2, label: 'S' },
            { w: 4, label: 'M' },
            { w: 8, label: 'L' },
          ].map(({ w, label }) => (
            <button
              key={w}
              type="button"
              onClick={() => onStrokeChange(w)}
              className={cn(
                'w-7 h-7 rounded-md border text-[11px] font-semibold',
                strokeWidth === w
                  ? 'bg-accent/20 text-accent-sub border-accent/50'
                  : 'border-bg-border text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary/70 text-[11px] font-semibold">투명도</span>
          <input
            type="range"
            min={20}
            max={100}
            value={opacity}
            onChange={(e) => onOpacityChange(parseInt(e.target.value, 10))}
            className="w-20 accent-accent-sub"
          />
          <span className="text-text-primary tabular-nums w-9 text-right">{opacity}%</span>
        </div>
      </div>
    </>
  );
}
