// 노이즈 제거 창 (계획 14d 3-5, 시안 WinDenoise): 불러온 그림을 이 PC 에서 지우고(0원) 원래 그림과 손잡이로 닦아 가며 견준다.
// 처음 누르면 지우고 도구 작업 한 건으로 남긴다. 다시 누르면 원래 그림으로 (그 작업의 결과도 따라간다). 창을 닫아도 켠 상태 그대로.
import { useRef, useState } from 'react';
import { Check, Eraser, FolderOpen, Loader2, MoveHorizontal } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import './bae-stage3.css';

export interface DenoiseWindowProps {
  label: string;               // 그림 이름 (불러온 파일 · 원래 작업)
  w: number; h: number;
  sourceSrc: string;           // 원래 그림
  cleanSrc: string | null;     // 지운 그림 (아직 안 지웠으면 null)
  on: boolean;                 // 지금 지운 그림이 결과
  busy: string;                // 하는 중이면 그 글 ('색 읽기' · '칠하기' …), 아니면 ''
  sec: number | null;          // 지우는 데 걸린 초
  onToggle(): void;            // 이 그림의 노이즈 지우기 ↔ 원래 그림
  onReplace(file: File): void; // 다른 그림 불러오기
  onClose(): void;
}

export function DenoiseWindow(p: DenoiseWindowProps) {
  const [wipe, setWipe] = useState(50);
  const fileRef = useRef<HTMLInputElement>(null);
  const ar = (p.w || 16) / (p.h || 9);
  const compare = !!p.cleanSrc;
  const status = p.busy ? `${p.busy}…` : compare ? `손잡이를 끌어 원래 그림(왼쪽)과 지운 그림(오른쪽)을 견줘요.${p.sec != null ? ` 지우는 데 ${p.sec}초 걸렸어요.` : ''}` : '지우기 전 그림이에요. 아래 버튼을 누르면 이 PC에서 지워요.';

  return (
    <BaeWindow
      tool="denoise"
      icon={<Eraser size={18} aria-hidden="true" />}
      title="노이즈 제거"
      sub={`그림: ${p.label} (${p.w}×${p.h})`}
      headActions={(
        <>
          <button type="button" className="bae-btn bae-btn-s" disabled={!!p.busy} onClick={() => fileRef.current?.click()}><FolderOpen size={14} aria-hidden="true" />다른 그림 불러오기</button>
          <input ref={fileRef} className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onReplace(f); }} />
        </>
      )}
      footNote="이 PC에서 지워요. 0원이에요."
      footActions={(
        <button type="button" className={`bae-btn ${p.on ? 'bae-btn-tint' : 'bae-btn-primary'}`} aria-pressed={p.on} disabled={!!p.busy} aria-busy={!!p.busy || undefined} onClick={p.onToggle}>
          {p.busy ? <Loader2 size={16} className="bae-spin" aria-hidden="true" /> : <Eraser size={16} aria-hidden="true" />}
          {p.busy ? '지우는 중' : p.on ? '노이즈 제거 켬' : '이 그림의 노이즈 지우기'}
        </button>
      )}
      onClose={p.onClose}
    >
      <div className="bw-cols">
        <div className="bw-main">
          <div className="bw-board bae-dn-board">
            <div className="bae-dn-fit" style={{ ['--ar' as string]: String(ar) }}>
              {compare ? (
                <>
                  <img className="bae-dn-img" src={p.cleanSrc!} alt="노이즈를 지운 그림" />
                  <img className="bae-dn-img" src={p.sourceSrc} alt="" style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }} />
                  <span className="bae-tag bae-tag-l">원래 그림</span>
                  <span className="bae-tag bae-tag-r">노이즈 제거</span>
                  <input className="bae-wipe" type="range" min={0} max={100} step={1} value={wipe} onChange={(e) => setWipe(Number(e.target.value))} aria-label="원래 그림과 노이즈를 지운 그림 견주기" />
                  <span className="bae-handle" style={{ left: `${wipe}%` }} aria-hidden="true"><span className="bae-grip"><MoveHorizontal size={14} /></span></span>
                </>
              ) : (
                <>
                  <img className="bae-dn-img" src={p.sourceSrc} alt="원래 그림" />
                  <span className="bae-tag bae-tag-l">원래 그림</span>
                </>
              )}
            </div>
          </div>
          <p className="bae-hint" role="status">{status}</p>
        </div>
        <div className="bw-side">
          <div className="bae-field">
            <p className="bae-label">정리하는 것</p>
            <ul className="bae-dn-list">
              <li><Eraser size={14} aria-hidden="true" /><span>얼룩덜룩한 번짐</span></li>
              <li><Eraser size={14} aria-hidden="true" /><span>붓 자국 같은 덩어리</span></li>
            </ul>
            <p className="bae-hint">한 면이 한 색이 되게 정리해요.</p>
          </div>
          <div className="bae-field">
            <p className="bae-label">그대로 두는 것</p>
            <ul className="bae-dn-list">
              <li><Check size={14} aria-hidden="true" /><span>또렷한 윤곽과 그린 선</span></li>
              <li><Check size={14} aria-hidden="true" /><span>주름과 바닥 줄</span></li>
              <li><Check size={14} aria-hidden="true" /><span>일부러 넣은 밝고 어두운 톤</span></li>
            </ul>
          </div>
          <dl className="bae-dl bae-dn-dl">
            <div className="bae-fact"><dt>비용</dt><dd className="bae-num">0원</dd></div>
            <div className="bae-fact"><dt>계산하는 곳</dt><dd>이 PC</dd></div>
          </dl>
          <p className="bae-hint">다시 누르면 원래 그림으로 돌아가요. 지우기 전 그림은 이 PC에 그대로 남아요.</p>
        </div>
      </div>
    </BaeWindow>
  );
}
