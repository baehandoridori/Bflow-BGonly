import { motion, AnimatePresence } from 'framer-motion';
import { Paintbrush, Eraser, Undo2, Trash2, ChevronUp, ChevronDown, GripHorizontal } from 'lucide-react';
import { useFloatingPanel } from './useFloatingPanel';
import type { WhiteboardTool } from '@/types/whiteboard';
import { cn } from '@/utils/cn';

const COLOR_PALETTE = [
  '#FFFFFF', '#000000', '#FF6B6B', '#FDCB6E',
  '#00B894', '#74B9FF', '#A29BFE', '#6C5CE7',
];

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  color: string;
  brushWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WhiteboardTool) => void;
  onColorChange: (color: string) => void;
  onBrushWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
}

export function WhiteboardToolbar({
  tool, color, brushWidth, canUndo, canRedo,
  onToolChange, onColorChange, onBrushWidthChange, onUndo, onRedo, onClearAll,
}: WhiteboardToolbarProps) {
  const { position, isCollapsed, toggleCollapse, dragHandlers } = useFloatingPanel({ x: -220, y: 16 });

  return (
    <motion.div
      className="absolute z-50 select-none"
      style={{ right: -position.x, top: position.y }}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="bg-bg-card/80 backdrop-blur-md rounded-xl border border-bg-border/30 shadow-xl overflow-hidden">
        {/* 드래그 핸들 */}
        <div
          {...dragHandlers}
          className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing border-b border-bg-border/20"
        >
          <GripHorizontal size={14} className="text-text-secondary/40" />
          <button
            onClick={toggleCollapse}
            className="p-0.5 rounded text-text-secondary/60 hover:text-text-primary transition-colors"
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {isCollapsed ? (
            /* 접힌 상태: 현재 도구 + 색상 원 */
            <motion.div
              key="collapsed"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2 px-3 py-2"
            >
              {tool === 'brush' ? <Paintbrush size={16} className="text-accent" /> : <Eraser size={16} className="text-accent" />}
              <div className="w-4 h-4 rounded-full border border-bg-border/50" style={{ backgroundColor: color }} />
            </motion.div>
          ) : (
            /* 펼친 상태 */
            <motion.div
              key="expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="px-3 py-3 space-y-3 w-[180px]"
            >
              {/* 도구 선택 */}
              <div className="flex gap-1">
                <ToolButton active={tool === 'brush'} onClick={() => onToolChange('brush')} title="브러시 (B)">
                  <Paintbrush size={16} />
                </ToolButton>
                <ToolButton active={tool === 'eraser'} onClick={() => onToolChange('eraser')} title="지우개 (E)">
                  <Eraser size={16} />
                </ToolButton>
              </div>

              {/* 색상 팔레트 */}
              <div>
                <div className="text-[10px] text-text-secondary/60 mb-1.5">색상</div>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => onColorChange(c)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 transition-all cursor-pointer',
                        color === c ? 'border-accent scale-110' : 'border-bg-border/40 hover:border-bg-border',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  {/* 커스텀 색상 */}
                  <label className="w-5 h-5 rounded-full border-2 border-dashed border-bg-border/40 hover:border-bg-border cursor-pointer flex items-center justify-center overflow-hidden relative">
                    <span className="text-[8px] text-text-secondary/60">+</span>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => onColorChange(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* 크기 슬라이더 */}
              <div>
                <div className="text-[10px] text-text-secondary/60 mb-1.5">크기: {brushWidth}px</div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={brushWidth}
                  onChange={(e) => onBrushWidthChange(Number(e.target.value))}
                  className="w-full h-1 accent-accent cursor-pointer"
                />
              </div>

              {/* 동작 버튼 */}
              <div className="flex gap-1 pt-1 border-t border-bg-border/20">
                <ActionButton onClick={onUndo} disabled={!canUndo} title="실행취소 (Ctrl+Z)">
                  <Undo2 size={14} />
                </ActionButton>
                <ActionButton onClick={onRedo} disabled={!canRedo} title="다시실행 (Ctrl+Shift+Z)">
                  <Undo2 size={14} className="scale-x-[-1]" />
                </ActionButton>
                <ActionButton onClick={onClearAll} title="전체 삭제" className="ml-auto text-red-400/70 hover:text-red-400">
                  <Trash2 size={14} />
                </ActionButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── 서브 컴포넌트 ──────────────────────────────────────────

function ToolButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-2 rounded-lg transition-all cursor-pointer',
        active
          ? 'bg-accent/20 text-accent'
          : 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/20',
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({ onClick, disabled, title, className, children }: {
  onClick: () => void; disabled?: boolean; title: string; className?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 rounded-md transition-all cursor-pointer',
        disabled ? 'opacity-30 cursor-not-allowed' : 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/20',
        className,
      )}
    >
      {children}
    </button>
  );
}
