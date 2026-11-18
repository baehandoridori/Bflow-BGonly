// 그림을 끌어다 놓는 여섯 칸 (14b 10-2 '놓는 자리', 시안 Dropping): 작업판 자리에 그대로 들어가 높이가 같다.
// 왼쪽 둘 = 재료(새 배경의 러프 · 같은 장소의 기준 배경), 오른쪽 넷 = 도구. 끌고 오면 놓은 칸으로, 붙여 넣었으면 칸을 눌러 고른다.
import { useState, type ReactNode } from 'react';
import { CopyPlus, Eraser, Layers, Plus, Rotate3d, Scaling } from 'lucide-react';
import type { BaeDropView, BaeDropZone } from './benchTypes';

const ZONES: Record<BaeDropZone, { name: string; text: string; icon: ReactNode; tool: string }> = {
  rough: { name: '새 배경의 러프로', text: '그림판에 러프로 올려요.', icon: <Plus size={18} aria-hidden="true" />, tool: '' },
  base: { name: '같은 장소의 기준 배경으로', text: '이 그림과 같은 곳의 다른 컷을 만들어요.', icon: <CopyPlus size={18} aria-hidden="true" />, tool: 'bae-tool-same' },
  layers: { name: '레이어로 나누기', text: '레이어 세 층으로 나눠 PSD로 내보내요.', icon: <Layers size={18} aria-hidden="true" />, tool: 'bae-tool-layers' },
  angle: { name: '다른 각도로', text: '같은 곳을 다른 카메라에서 다시 그려요.', icon: <Rotate3d size={18} aria-hidden="true" />, tool: 'bae-tool-angle' },
  upscale: { name: '4K로 키우기', text: '이 PC에서 키워요. 0원.', icon: <Scaling size={18} aria-hidden="true" />, tool: 'bae-tool-upscale' },
  denoise: { name: '노이즈 제거', text: '이 PC에서 지워요. 0원.', icon: <Eraser size={18} aria-hidden="true" />, tool: 'bae-tool-denoise' },
};

const firstImage = (dt: DataTransfer | null) => Array.from(dt?.files ?? []).find((f) => f.type.startsWith('image/')) ?? null;

export function DropZones({ drop }: { drop: BaeDropView }) {
  const [over, setOver] = useState<BaeDropZone | null>(null);
  const zone = (z: BaeDropZone) => {
    const v = ZONES[z];
    const cls = `bae-zone bae-tool ${v.tool}${over === z ? ' is-over' : ''}`;
    const body = <>{v.icon}<span className="bae-zone-name">{v.name}</span><span className="bae-zone-text">{v.text}</span></>;
    return drop.mode === 'paste' ? (
      <button key={z} type="button" className={cls} onClick={() => drop.onZone(z, null)} onPointerEnter={() => setOver(z)} onPointerLeave={() => setOver(null)}>{body}</button>
    ) : (
      <div
        key={z}
        className={cls}
        onDragEnter={(e) => { e.preventDefault(); setOver(z); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (over !== z) setOver(z); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === z ? null : o)); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); drop.onZone(z, firstImage(e.dataTransfer)); }}
      >{body}</div>
    );
  };
  return (
    <div className="bae-drop" role="group" aria-labelledby="bae-drop-h">
      <div className="bae-drop-head">
        <p className="bae-drop-title" id="bae-drop-h">{drop.mode === 'paste' ? '붙여 넣은 그림을 쓸 곳을 골라 주세요' : '그림을 쓸 곳에 놓아 주세요'}</p>
        {drop.mode === 'paste' ? <button type="button" className="bae-btn bae-btn-s bae-push" onClick={drop.onCancel}>그만두기</button> : null}
      </div>
      <div className="bae-drop-grid">
        <div className="bae-drop-col">{zone('rough')}{zone('base')}</div>
        <div className="bae-drop-tools">{zone('layers')}{zone('angle')}{zone('upscale')}{zone('denoise')}</div>
      </div>
    </div>
  );
}
