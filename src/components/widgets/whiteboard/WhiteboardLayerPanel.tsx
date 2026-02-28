import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Plus, Trash2, ChevronUp, ChevronDown, GripHorizontal, ArrowUp, ArrowDown } from 'lucide-react';
import { useFloatingPanel } from './useFloatingPanel';
import type { WhiteboardLayer } from '@/types/whiteboard';
import { cn } from '@/utils/cn';

interface WhiteboardLayerPanelProps {
  layers: WhiteboardLayer[];
  activeLayerId: string;
  onSelectLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export function WhiteboardLayerPanel({
  layers, activeLayerId,
  onSelectLayer, onToggleVisibility, onAddLayer, onRemoveLayer,
  onRenameLayer, onMoveUp, onMoveDown,
}: WhiteboardLayerPanelProps) {
  const { position, isCollapsed, toggleCollapse, dragHandlers } = useFloatingPanel({ x: 16, y: -200 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sortedLayers = [...layers].sort((a, b) => b.order - a.order); // 높은 order가 위

  const startRename = (layer: WhiteboardLayer) => {
    setEditingId(layer.id);
    setEditName(layer.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      onRenameLayer(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId);

  return (
    <motion.div
      className="absolute z-50 select-none"
      style={{ left: position.x, bottom: -position.y }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="bg-bg-card/80 backdrop-blur-md rounded-xl border border-bg-border/30 shadow-xl overflow-hidden">
        {/* 드래그 핸들 */}
        <div
          {...dragHandlers}
          className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing border-b border-bg-border/20"
        >
          <GripHorizontal size={14} className="text-text-secondary/40" />
          <span className="text-[10px] text-text-secondary/60 mx-2">레이어</span>
          <button
            onClick={toggleCollapse}
            className="p-0.5 rounded text-text-secondary/60 hover:text-text-primary transition-colors"
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {isCollapsed ? (
            <motion.div
              key="collapsed"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="px-3 py-2"
            >
              <span className="text-xs text-text-primary/70">{activeLayer?.name ?? '—'}</span>
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-[200px]"
            >
              {/* 레이어 목록 */}
              <div className="max-h-[200px] overflow-y-auto">
                {sortedLayers.map((layer) => (
                  <div
                    key={layer.id}
                    onClick={() => onSelectLayer(layer.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors',
                      layer.id === activeLayerId ? 'bg-accent/10' : 'hover:bg-bg-border/10',
                    )}
                  >
                    {/* 가시성 토글 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}
                      className="p-0.5 text-text-secondary/50 hover:text-text-primary transition-colors"
                    >
                      {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-40" />}
                    </button>

                    {/* 레이어 이름 */}
                    {editingId === layer.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                        className="flex-1 text-xs bg-transparent border-b border-accent/50 text-text-primary outline-none px-1"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="flex-1 text-xs text-text-primary/80 truncate"
                        onDoubleClick={(e) => { e.stopPropagation(); startRename(layer); }}
                      >
                        {layer.name}
                      </span>
                    )}

                    {/* 순서 변경 */}
                    <div className="flex flex-col">
                      <button
                        onClick={(e) => { e.stopPropagation(); onMoveUp(layer.id); }}
                        className="text-text-secondary/30 hover:text-text-primary transition-colors"
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onMoveDown(layer.id); }}
                        className="text-text-secondary/30 hover:text-text-primary transition-colors"
                      >
                        <ArrowDown size={10} />
                      </button>
                    </div>

                    {/* 삭제 */}
                    {layers.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }}
                        className="p-0.5 text-text-secondary/30 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 추가 버튼 */}
              <div className="border-t border-bg-border/20 px-3 py-2">
                <button
                  onClick={onAddLayer}
                  className="flex items-center gap-1.5 text-xs text-text-secondary/60 hover:text-accent transition-colors cursor-pointer"
                >
                  <Plus size={12} />
                  <span>레이어 추가</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
