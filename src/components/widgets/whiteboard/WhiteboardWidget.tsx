import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Paintbrush } from 'lucide-react';
import { Widget, IsPopupContext } from '../Widget';
import { WhiteboardModal } from './WhiteboardModal';
import { loadLocalWhiteboard, loadSharedWhiteboard } from '@/services/whiteboardService';
import { loadPreferences } from '@/services/settingsService';
import type { WhiteboardTab, WhiteboardData, WhiteboardStroke } from '@/types/whiteboard';
import { cn } from '@/utils/cn';

export function WhiteboardWidget() {
  const isPopup = useContext(IsPopupContext);
  const [tab, setTab] = useState<WhiteboardTab>('local');
  const [modalOpen, setModalOpen] = useState(false);
  const [data, setData] = useState<WhiteboardData | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [bgColor, setBgColor] = useState('#1A1D27');

  useEffect(() => {
    loadPreferences().then((prefs) => {
      setBgColor(prefs?.whiteboardBgColor ?? '#1A1D27');
    });
  }, []);

  // ── 데이터 로드 ──

  const loadPreviewData = useCallback(async () => {
    try {
      if (tab === 'local') {
        setData(await loadLocalWhiteboard());
      } else {
        const shared = await loadSharedWhiteboard();
        setData(shared);
      }
    } catch {
      setData(null);
    }
  }, [tab]);

  useEffect(() => {
    loadPreviewData();
  }, [loadPreviewData]);

  // 모달 닫힐 때 리로드
  useEffect(() => {
    if (!modalOpen) loadPreviewData();
  }, [modalOpen, loadPreviewData]);

  // ── 프리뷰 렌더링 ──

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    const scaleX = rect.width / (data.canvasWidth || 1920);
    const scaleY = rect.height / (data.canvasHeight || 1080);
    const scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.scale(scale, scale);

    const sortedLayers = [...data.layers].sort((a, b) => a.order - b.order);
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;
      const layerStrokes = data.strokes.filter((s) => s.layerId === layer.id);
      for (const stroke of layerStrokes) {
        drawStrokePreview(ctx, stroke);
      }
    }

    ctx.restore();
  }, [data]);

  const tabSelector = (
    <div className="flex gap-0.5 bg-bg-primary/50 rounded p-0.5">
      <button
        onClick={(e) => { e.stopPropagation(); setTab('local'); }}
        className={cn(
          'px-2 py-0.5 rounded text-[10px] transition-all cursor-pointer',
          tab === 'local' ? 'bg-accent/20 text-accent' : 'text-text-secondary/50 hover:text-text-primary',
        )}
      >
        개인
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setTab('public'); }}
        className={cn(
          'px-2 py-0.5 rounded text-[10px] transition-all cursor-pointer',
          tab === 'public' ? 'bg-accent/20 text-accent' : 'text-text-secondary/50 hover:text-text-primary',
        )}
      >
        공유
      </button>
    </div>
  );

  const content = (
    <div
      className="relative w-full h-full min-h-[120px] cursor-pointer rounded-lg overflow-hidden"
      style={{ backgroundColor: bgColor }}
      onClick={() => setModalOpen(true)}
    >
      <canvas ref={previewRef} className="absolute inset-0" />
      {(!data || data.strokes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center text-text-secondary/30 text-xs">
          클릭하여 그리기 시작
        </div>
      )}
    </div>
  );

  // 팝업 모드
  if (isPopup) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border/20">
          <span className="text-xs text-text-primary/70">화이트보드</span>
          {tabSelector}
        </div>
        <div className="flex-1 overflow-hidden p-2">
          {content}
        </div>
        <WhiteboardModal isOpen={modalOpen} onClose={() => setModalOpen(false)} initialTab={tab} />
      </div>
    );
  }

  return (
    <>
      <Widget title="화이트보드" icon={<Paintbrush size={15} />} headerRight={tabSelector}>
        {content}
      </Widget>
      <WhiteboardModal isOpen={modalOpen} onClose={() => setModalOpen(false)} initialTab={tab} />
    </>
  );
}

// ── 프리뷰용 스트로크 렌더링 ──

function drawStrokePreview(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  ctx.restore();
}
