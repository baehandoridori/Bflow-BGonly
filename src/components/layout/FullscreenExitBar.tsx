/**
 * 전체 화면일 때 위쪽 끝 '전체 화면 끝내기' 띠 (2026-11-27 한솔 '가끔 전체 화면이 되고 최소화/전체/X 가 안 보여').
 * 전체 화면에는 창의 최소화 · 최대화 · 닫기 단추가 없다. 그래서 들어가자마자 잠깐 띠를 보여 주고,
 * 그 뒤에는 마우스를 화면 맨 위에 대면 다시 보여 준다 (브라우저 전체 화면처럼). 띠의 단추나 F11 로 끝낸다.
 */
import { useEffect, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { leaveAppFullscreen } from '@/utils/appFullscreen';
import '@/styles/fullscreen-exit-bar.css';

type FsApi = { isWindowFullscreen?: () => Promise<boolean>; onWindowFullscreen?: (cb: (on: boolean) => void) => () => void } | undefined;
const SHOW_ON_ENTER_MS = 4000;
const HIDE_AFTER_LEAVE_MS = 900;

export function FullscreenExitBar() {
  const [winFs, setWinFs] = useState(false);
  const [docFs, setDocFs] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [shown, setShown] = useState(false);
  const timer = useRef(0);
  const on = winFs || docFs;

  const hideLater = (ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setShown(false), ms); };
  const reveal = (ms: number) => { setShown(true); hideLater(ms); };

  useEffect(() => {
    const a = (window as unknown as { electronAPI?: FsApi }).electronAPI;
    let alive = true;
    void a?.isWindowFullscreen?.().then((v) => { if (alive) setWinFs(v === true); }).catch(() => undefined);
    const off = a?.onWindowFullscreen?.((v) => { if (alive) setWinFs(v); });
    const onDoc = () => setDocFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onDoc);
    return () => { alive = false; off?.(); document.removeEventListener('fullscreenchange', onDoc); window.clearTimeout(timer.current); };
  }, []);
  // 들어가면 잠깐 보여 주고, 나가면 숨긴다
  useEffect(() => {
    if (on) reveal(SHOW_ON_ENTER_MS); else { window.clearTimeout(timer.current); setShown(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  if (!on) return null;
  return (
    <>
      <div className="bf-fsx-edge" aria-hidden="true" onMouseEnter={() => { window.clearTimeout(timer.current); setShown(true); }} onMouseLeave={() => hideLater(HIDE_AFTER_LEAVE_MS)} />
      <div
        className={`bf-fsx${shown ? ' is-shown' : ''}`}
        role="region"
        aria-label="전체 화면"
        onMouseEnter={() => { window.clearTimeout(timer.current); setShown(true); }}
        onMouseLeave={() => hideLater(HIDE_AFTER_LEAVE_MS)}
        onFocus={() => { window.clearTimeout(timer.current); setShown(true); }}
        onBlur={() => hideLater(HIDE_AFTER_LEAVE_MS)}
      >
        <span className="bf-fsx-text">전체 화면이에요</span>
        <button type="button" className="bf-fsx-btn" tabIndex={shown ? 0 : -1} onClick={() => { void leaveAppFullscreen(); }}>
          <Minimize2 size={14} aria-hidden="true" />전체 화면 끝내기<kbd className="bf-fsx-kbd">F11</kbd>
        </button>
      </div>
    </>
  );
}
