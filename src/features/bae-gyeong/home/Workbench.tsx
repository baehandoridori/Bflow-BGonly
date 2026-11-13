/**
 * 작업대 (BAE경의 메인 화면, 계획 14b 10-2): 시작 줄 → 작업판(1 재료 · 2 주문서 · 3 결과) → 내 기록.
 * 1단계는 빈 작업대: 하던 작업과 기록이 아직 없을 때의 모양 (시안 '작업대, 비어 있음').
 */
import { ClipboardPaste, CopyPlus, Eraser, LayoutGrid, Layers, List, Pencil, Plus, Rotate3d, Scaling, Search, Upload } from 'lucide-react';
import { useState } from 'react';

export type BaeStartKind = 'new' | 'same' | 'layers' | 'angle' | 'upscale' | 'denoise';

export function Workbench({ onStart }: { onStart: (kind: BaeStartKind) => void }) {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [q, setQ] = useState('');
  return (
    <>
      <section className="bae-start" aria-label="시작하기">
        <div className="bae-start-group">
          <button type="button" className="bae-btn bae-btn-primary" onClick={() => onStart('new')}><Plus size={16} aria-hidden="true" />새 배경 만들기</button>
          <button type="button" className="bae-btn bae-btn-tint bae-tool bae-tool-same" onClick={() => onStart('same')}><CopyPlus size={16} aria-hidden="true" />같은 장소 다른 컷</button>
        </div>
        <div className="bae-start-group bae-push" role="group" aria-labelledby="bae-tools-label">
          <span className="bae-group-label" id="bae-tools-label">그림 불러와 도구만</span>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-layers" onClick={() => onStart('layers')}><Layers size={16} aria-hidden="true" />레이어로 나누기</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-angle" onClick={() => onStart('angle')}><Rotate3d size={16} aria-hidden="true" />다른 각도로</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-upscale" onClick={() => onStart('upscale')}><Scaling size={16} aria-hidden="true" />4K로 키우기</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-denoise" onClick={() => onStart('denoise')}><Eraser size={16} aria-hidden="true" />노이즈 제거</button>
        </div>
      </section>

      <section className="bae-bench" aria-labelledby="bae-bench-h">
        <h2 className="bae-vh" id="bae-bench-h">작업판</h2>
        <ol className="bae-panes">
          <li className="bae-pane">
            <div className="bae-pane-head"><h3 className="bae-pane-title">1 재료</h3></div>
            <div className="bae-pane-body">
              <p className="bae-empty-text">러프, 레퍼런스, 기준 배경을 여기에 넣어요.</p>
              <div className="bae-empty-acts">
                <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><Pencil size={16} aria-hidden="true" />러프 그리기</button>
                <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><ClipboardPaste size={16} aria-hidden="true" />그림 붙여넣기</button>
                <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><Upload size={16} aria-hidden="true" />파일 고르기</button>
              </div>
            </div>
          </li>
          <li className="bae-pane">
            <div className="bae-pane-head"><h3 className="bae-pane-title">2 주문서</h3></div>
            <div className="bae-pane-body"><p className="bae-empty-text">재료를 넣으면 PD가 한국어 요약과 주문서를 여기에 써요.</p></div>
          </li>
          <li className="bae-pane">
            <div className="bae-pane-head"><h3 className="bae-pane-title">3 결과</h3></div>
            <div className="bae-pane-body"><div className="bae-well"><p className="bae-empty-text">주문서대로 그린 그림이 여기에 와요.</p></div></div>
          </li>
        </ol>
      </section>

      <section className="bae-log" aria-labelledby="bae-log-h">
        <div className="bae-log-head">
          <h2 className="bae-h2" id="bae-log-h">내 기록</h2>
          <div className="bae-log-tools">
            <div className="bae-seg" role="group" aria-label="내 기록을 보는 방식">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={14} aria-hidden="true" />액자</button>
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} aria-hidden="true" />목록</button>
            </div>
            <span className="bae-search"><Search size={16} aria-hidden="true" /><input className="bae-search-input" type="search" autoComplete="off" aria-label="내 기록에서 찾기" placeholder="이름, 설명에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} /></span>
          </div>
        </div>
        <div className="bae-log-msg">
          <p className="bae-msg-title">아직 만든 그림이 없어요</p>
          <p className="bae-msg-text">위의 새 배경 만들기로 시작하면 여기에 쌓여요.</p>
        </div>
      </section>
    </>
  );
}
