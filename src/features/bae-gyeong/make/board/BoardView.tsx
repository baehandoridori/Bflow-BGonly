/**
 * 재료 창 왼쪽 칸의 그림판 (시안 WinNew 왼쪽 칸 배치: 위 줄 · 도구 줄 · 종이 · 비율과 기울기 · 고른 도구 한 줄).
 * 엔진은 Board.ts. 투시 고르기와 '지평선 및 투시 참고하게 하기' 스위치는 재료 창 오른쪽이 board.setGuideType ·
 * board.setGuideParam('use', …) 로 다루고, board.guide() · onGuide 로 읽는다.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  type LucideIcon, ArrowUpRight, Circle, Eraser, Eye, EyeOff, Highlighter, Image as ImageIcon, MousePointer2, Move, PaintBucket, Pencil, Pipette, Redo2, Slash, Square, Trash2, Type, Undo2, Upload,
} from 'lucide-react';
import { RATIOS, RATIO_ORDER, SWATCHES } from '@/shared/bae/order/constants';
import { createBoard, type Board, type BoardOptions, type BoardTool, type PlaceColor } from './Board';
import { guideCtl, tiltLabel } from './guideMath';
import {
  CLEAR_TOAST, COLOR_TOOLS, DRAW_TOOLS, FILLS, GAPS, GUIDE_AUTO_HINT, MODE_HINT, NOTE_FOOT, NOTE_TOOLS, PHOTO_HINT, PHOTO_SWITCH, PHOTO_TOAST, TILT_HINT, TOOL_TEXT, WIDTHS, WIDTH_TOOLS,
} from './boardText';
import './board.css';

const TOOL_ICON: Record<BoardTool, LucideIcon> = {
  pen: Pencil, line: Slash, rect: Square, ellipse: Circle, fill: PaintBucket, eraser: Eraser, picker: Pipette,
  arrow: ArrowUpRight, text: Type, mark: Highlighter, select: MousePointer2, guide: Move,
};

/** 엔진 하나를 부품 수명 동안 붙잡는다. 콜백은 매번 새것으로 바꾼다 (memory 는 처음 것만) */
export function useBoard(options: BoardOptions = {}): Board {
  const ref = useRef<Board | null>(null);
  if (!ref.current) ref.current = createBoard(options);
  const board = ref.current;
  useEffect(() => { board.setCallbacks(options); });
  return board;
}

export interface BoardViewProps {
  /** useBoard() 나 createBoard() 로 만든 엔진. 재료 창을 닫았다 열어도 그림을 지키려면 바깥에서 붙잡는다 */
  board: Board;
  className?: string;
}

export function BoardView({ board, className }: BoardViewProps) {
  const u = useSyncExternalStore(board.subscribe, board.ui, board.ui);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLDivElement>(null), frameRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null), textRef = useRef<HTMLTextAreaElement>(null), selRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    board.attach({ root: rootRef.current!, stage: stageRef.current!, frame: frameRef.current!, guide: guideRef.current!, text: textRef.current!, selBar: selRef.current! });
    return () => board.detach();
  }, [board]);

  const ctl = guideCtl(u.guide);
  const t = TOOL_TEXT[u.tool];
  const toast = (text: string) => board.toast(text);
  const toolBtn = (k: BoardTool, note = false) => {
    const I = TOOL_ICON[k];
    return (
      <button key={k} type="button" className={'bb-ib' + (note ? ' bb-note' : '')} aria-pressed={u.tool === k} aria-label={TOOL_TEXT[k].name} title={TOOL_TEXT[k].title} onClick={() => board.setTool(k)}>
        <I size={16} aria-hidden="true" />
      </button>
    );
  };

  return (
    <div ref={rootRef} className={'bb-root' + (className ? ' ' + className : '')}>
      {/* 위 줄: 레이아웃 고르기 · 가이드 보이기 · 그림 불러오기 */}
      <div className="bb-bar">
        <div className="bae-seg" role="group" aria-label="레이아웃으로 쓸 재료" title="불러온 이미지의 종류">
          <button type="button" className="bae-btn bae-btn-s" aria-pressed={u.mode === 'rough'} title={MODE_HINT.rough} onClick={() => board.setMode('rough')}><Pencil size={14} aria-hidden="true" />러프 스케치</button>
          <button type="button" className="bae-btn bae-btn-s" aria-pressed={u.mode === 'guide'} title={MODE_HINT.guide} onClick={() => board.setMode('guide')}><ImageIcon size={14} aria-hidden="true" />AI 이미지·사진 (흐리게)</button>
        </div>
        <div className="bb-bar-end">
          {u.hasBg && (
            <div className="bae-seg" role="group" aria-label="불러온 이미지를 비율에 맞추는 방법" title="불러온 이미지를 비율에 맞추는 방법">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={u.fit === 'contain'} onClick={() => board.setFit('contain')}>전체 보이기</button>
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={u.fit === 'cover'} onClick={() => board.setFit('cover')}>꽉 채우기</button>
            </div>
          )}
          {u.hasBg && <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={() => board.clearBg()}>불러온 이미지 빼기</button>}
          <button type="button" className="bae-btn bae-btn-s bb-toggle" aria-pressed={u.showGuide} onClick={() => board.setShowGuide(!u.showGuide)}>
            {u.showGuide ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}가이드 보이기
          </button>
          <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" />그림 불러오기</button>
          <input ref={fileRef} className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) void board.loadFile(f); }} />
        </div>
      </div>

      {/* 도구 줄 */}
      <div className="bb-bar">
        <div className="bb-tools" role="group" aria-label="그림판 도구">
          <div className="bb-tgroup" role="group" aria-label="그림">{DRAW_TOOLS.map((k) => toolBtn(k))}</div>
          <span className="bb-sep" aria-hidden="true" />
          <div className="bb-tgroup" role="group" aria-label="메모 · PD만 봐요" title={NOTE_FOOT}>{NOTE_TOOLS.map((k) => toolBtn(k, true))}</div>
          <span className="bb-sep" aria-hidden="true" />
          <div className="bb-tgroup" role="group" aria-labelledby={id + 'mv'}>
            <span className="bb-glabel" id={id + 'mv'}>옮기기</span>
            {(['select', 'guide'] as BoardTool[]).map((k) => {
              const I = TOOL_ICON[k];
              return <button key={k} type="button" className="bb-ib bb-ib-text" aria-pressed={u.tool === k} title={TOOL_TEXT[k].title} onClick={() => board.setTool(k)}><I size={16} aria-hidden="true" />{TOOL_TEXT[k].name}</button>;
            })}
          </div>
          <span className="bb-sep" aria-hidden="true" />
          <button type="button" className="bb-ib" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!u.canUndo} onClick={() => void board.undo()}><Undo2 size={16} aria-hidden="true" /></button>
          <button type="button" className="bb-ib" aria-label="다시 하기" title="다시 하기 (Ctrl+Shift+Z)" disabled={!u.canRedo} onClick={() => void board.redo()}><Redo2 size={16} aria-hidden="true" /></button>
          <button type="button" className="bb-ib" aria-label="모두 지우기" title="모두 지우기" disabled={!u.hasContent && !u.tilt} onClick={() => { board.clearAll(); toast(CLEAR_TOAST); }}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
        <div className="bb-bar-end">
          {u.placeColors.length > 0 && <PlaceColors board={board} id={id} color={u.color} list={u.placeColors} />}
          <ColorPicker board={board} color={u.color} />
        </div>
      </div>

      {/* 그림판: 남는 높이를 다 쓰는 무대 위 흰 종이 */}
      <div ref={stageRef} className="bb-stage" data-tool={u.tool} tabIndex={0} role="group" aria-label="그림판">
        <div ref={frameRef} className="bb-frame" />
        <canvas ref={guideRef} className="bb-guide" aria-hidden="true" />
        <textarea ref={textRef} className="bb-text" spellCheck={false} aria-label="메모 글씨" />
        <div ref={selRef} className="bb-selbar"><button type="button" onClick={() => board.deleteSelected()}>메모 지우기</button></div>
      </div>

      {/* 비율 · 화면 기울기 */}
      <div className="bb-bar">
        <span className="bae-label" id={id + 'ratio'}>비율</span>
        <div className="bb-chips" role="group" aria-labelledby={id + 'ratio'}>
          {RATIO_ORDER.map((r) => (
            <button key={r} type="button" className="bae-btn bae-btn-s bb-chip" aria-pressed={u.ratio === r} title={(RATIOS[r].hint ? RATIOS[r].hint + ' · ' : '') + '그림판과 결과 그림이 이 비율로 맞춰져요.'} onClick={() => board.setRatio(r)}>{r}</button>
          ))}
        </div>
        <div className="bb-bar-end">
          <label className="bae-label" htmlFor={id + 'tilt'} title="화면 기울기 · 러프를 기울여 그렸을 때">화면 기울기</label>
          <input className="bb-range" id={id + 'tilt'} type="range" min={-15} max={15} step={0.5} value={u.tilt} aria-valuetext={tiltLabel(u.tilt)} onChange={(e) => board.setTilt(Number(e.target.value))} />
          <span className="bb-sval bae-num">{tiltLabel(u.tilt)}</span>
          <button type="button" className={'bae-btn bae-btn-ghost bae-btn-s' + (u.tilt ? '' : ' bb-keep')} tabIndex={u.tilt ? 0 : -1} aria-hidden={!u.tilt} onClick={() => board.setTilt(0)}>0°로</button>
        </div>
      </div>

      {/* 고른 도구 한 줄: 설명 + 도구 손잡이 */}
      <div className="bb-bar bb-toolline">
        <p className="bae-hint bb-desc"><b>{t.name}</b>: {u.tool === 'guide' && u.guide.type === 'auto' ? GUIDE_AUTO_HINT : t.desc}</p>
        <div className="bb-bar-end">
          {WIDTH_TOOLS.includes(u.tool) && (
            <Seg label="굵기" items={WIDTHS} value={u.width} onPick={(v) => board.setWidth(v)} />
          )}
          {(u.tool === 'rect' || u.tool === 'ellipse') && <Seg label="네모·동그라미" items={FILLS} value={u.fillMode} onPick={(v) => board.setFillMode(v)} />}
          {u.tool === 'fill' && <Seg label="선 사이 틈" items={GAPS} value={u.gap} onPick={(v) => board.setGap(v)} />}
          {u.tool === 'eraser' && <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!u.painted} onClick={() => board.clearPaint()}>그린 것 다 지우기</button>}
          {(NOTE_TOOLS.includes(u.tool) || u.tool === 'select') && (
            <>
              <label className="bae-switch bb-small"><input type="checkbox" checked={u.showNotes} onChange={(e) => board.setShowNotes(e.target.checked)} />메모 보이기</label>
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!u.noteCount} onClick={() => board.clearNotes()}>메모 다 지우기</button>
            </>
          )}
          {u.tool === 'guide' && ctl.showSpread && (
            <div className="bb-gctl">
              <label htmlFor={id + 'sp'}>소실점 간격</label><span>강하게</span>
              <input className="bb-range" id={id + 'sp'} type="range" min={0.8} max={5} step={0.1} value={ctl.spread} aria-valuetext={ctl.spreadLabel} onChange={(e) => board.setGuideParam('spread', Number(e.target.value))} />
              <span>약하게</span><b>{ctl.spreadLabel}</b>
            </div>
          )}
          {u.tool === 'guide' && ctl.showDepth && (
            <div className="bb-gctl">
              <label htmlFor={id + 'dp'}>복도 길이</label><span>짧게</span>
              <input className="bb-range" id={id + 'dp'} type="range" min={1} max={10} step={1} value={ctl.depthStep} aria-valuetext={ctl.depthLabel} onChange={(e) => board.setGuideParam('depth', Number(e.target.value))} />
              <span>길게</span><b>{ctl.depthLabel}</b>
            </div>
          )}
        </div>
      </div>
      {u.tool === 'guide' && ctl.showLegend && (
        <p className="bae-hint bb-legend">
          <b>지평선은 눈높이예요.</b> 서 있는 사람 눈이나 차 지붕 근처를 지나요. 땅이 끝나는 선과는 달라요.{' '}
          <span className="bb-key-blue">파란 선</span>은 소실점으로 모이는 선이에요.
          {ctl.showCornerKey && <> <span className="bb-key-corner">주황 선</span>은 두 면이 만나는 모서리예요. 선을 끌면 좌우로, 위·아래 점을 끌면 길이가 바뀌어요.</>}
        </p>
      )}
      {u.tilt !== 0 && <p className="bae-hint">{TILT_HINT}</p>}
      {u.photoLike && u.hasBg && u.mode === 'rough' && (
        <p className="bae-hint bb-photo">{PHOTO_HINT} <button type="button" className="bae-btn bae-btn-s" onClick={() => { board.setMode('guide'); toast(PHOTO_TOAST); }}>{PHOTO_SWITCH}</button></p>
      )}
    </div>
  );
}

function Seg<T extends string | number>({ label, items, value, onPick }: { label: string; items: [T, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="bb-seg-row" role="group" aria-label={label}>
      <span className="bae-label">{label}</span>
      <div className="bae-seg">
        {items.map(([v, name]) => <button key={String(v)} type="button" className="bae-btn bae-btn-s" aria-pressed={value === v} onClick={() => onPick(v)}>{name}</button>)}
      </div>
    </div>
  );
}

function PlaceColors({ board, id, color, list }: { board: Board; id: string; color: string; list: PlaceColor[] }) {
  return (
    <div className="bb-place" role="group" aria-labelledby={id + 'pl'}>
      <span className="bae-label" id={id + 'pl'} title="기준 배경 색 · 이 색으로 칠하면 이 장소 색이 돼요">기준 배경 색</span>
      <div className="bb-swatches">
        {list.map((c, i) => (
          <button key={c.hex + i} type="button" className="bb-swatch" style={{ background: c.hex }} aria-pressed={color === c.hex.toUpperCase()} title={(c.name ? c.name + ' ' : '') + c.hex} aria-label={'기준 배경 색 ' + c.hex} onClick={() => board.pickPlaceColor(c.hex)} />
        ))}
      </div>
    </div>
  );
}

function ColorPicker({ board, color }: { board: Board; color: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const w = wrap.current;
    document.addEventListener('pointerdown', onDown, true); w?.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); w?.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="bb-color" ref={wrap}>
      <button ref={btn} type="button" className="bb-ib bb-color-btn" aria-label={'색 ' + color} title="색" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <span className="bb-cur" style={{ background: color }} aria-hidden="true" />
      </button>
      {open && (
        <div className="bb-pop" role="group" aria-label="색">
          <span className="bae-label">색</span>
          <div className="bb-swatches bb-grid">
            {SWATCHES.map((c) => <button key={c} type="button" className="bb-swatch" style={{ background: c }} title={c} aria-label={'색 ' + c} aria-pressed={color === c} onClick={() => { board.setColor(c); setOpen(false); btn.current?.focus(); }} />)}
          </div>
          <label className="bb-custom">직접 고르기 <input type="color" value={color.toLowerCase()} onChange={(e) => board.setColor(e.target.value)} /></label>
        </div>
      )}
    </div>
  );
}
