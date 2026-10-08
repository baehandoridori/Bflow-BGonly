import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import type { BackgroundPoint } from './types';

type Props = {
  svgRef: RefObject<SVGSVGElement>; anchor: BackgroundPoint; /** CSS px below the anchor */ drop: number;
  label: string; initial: string; positionKey: string;
  onCommit(text: string, returnFocus: boolean): void; onCancel(): void;
  /** Undo (false) or redo (true) pressed while nothing was typed: the editor closes the box and runs its own history. */
  onHistory(redo: boolean): void;
};

/** CSS pixels the box keeps from the edge of the plan canvas. */
const EDGE_GAP = 4;
const within = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Name entry floating over a node of the plan. It is an HTML input beside the SVG, so it has one size on screen
 * at any zoom. What is typed stays in here until it is committed: the draft is not touched on the way.
 */
export function BackgroundMapNameBox({ svgRef, anchor, drop, label, initial, positionKey, onCommit, onCancel, onHistory }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  /** The name the box opened with. While the text equals it, nothing was typed. */
  const opened = useRef(initial);
  /** The box is being taken down: the blur of an input that is removed is not a commit. */
  const leaving = useRef(false);
  // React runs this cleanup before it detaches the input. The body resets the flag for the effect re-run of development mode.
  useLayoutEffect(() => { leaving.current = false; return () => { leaving.current = true; }; }, []);
  // Placed before the first paint, so the box never shows at another spot. `positionKey` stands for the view and the canvas size.
  useLayoutEffect(() => {
    const input = inputRef.current, svg = svgRef.current, toScreen = svg?.getScreenCTM(), parent = input?.offsetParent;
    if (!input || !svg || !toScreen || !parent) return;
    const at = new DOMPoint(anchor.x, anchor.y).matrixTransform(toScreen);
    const canvas = svg.getBoundingClientRect(), origin = parent.getBoundingClientRect();
    // The CSS centres the box on this point, so it stays inside the canvas by half its own size.
    const halfWidth = input.offsetWidth / 2 + EDGE_GAP, halfHeight = input.offsetHeight / 2 + EDGE_GAP;
    input.style.left = `${within(at.x, canvas.left + halfWidth, canvas.right - halfWidth) - origin.left}px`;
    input.style.top = `${within(at.y + drop, canvas.top + halfHeight, canvas.bottom - halfHeight) - origin.top}px`;
  }, [anchor.x, anchor.y, drop, positionKey]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true }); input.select();
  }, []);

  return <input ref={inputRef} className="bmap-name-box" aria-label={label} maxLength={160} spellCheck={false} autoComplete="off" value={text}
    onChange={event => setText(event.target.value)}
    onKeyDown={event => {
      if (event.key === 'Escape') event.stopPropagation();                    // never reaches the editor's Escape handling, also in the middle of a composition
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;     // an IME composition keeps its own Enter and Escape
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onCommit(text, true); }
      else if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      else if ((event.ctrlKey || event.metaKey) && !event.altKey && text === opened.current) {
        // The history combinations of the editor: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y. Once something was typed they undo the typing instead.
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); onHistory(key === 'y' || event.shiftKey); }
      }
    }}
    onBlur={() => { if (!leaving.current) onCommit(text, false); }} />;
}
