import { useId } from 'react';
import type { JSX } from 'react';
import { MAP_CAMERA_COLORS } from './mapCameraColor';
import type { BackgroundCameraColor } from './types';

/**
 * The colour of a camera in the properties panel: a circle for each colour of the palette and a text button back to
 * the default. It draws what it is given. `disabled` (a locked camera, a save running) switches all of them off.
 */
export function BackgroundMapCameraColor({ color, disabled, onChange }: {
  color: BackgroundCameraColor | undefined; disabled: boolean;
  /** null: back to the default (the key is removed). */
  onChange(color: BackgroundCameraColor | null): void }): JSX.Element {
  const labelId = useId();
  return <div className="bmap-color-field">
    <span className="bmap-eyebrow" id={labelId}>카메라 색</span>
    <div className="bmap-color-swatches" role="group" aria-labelledby={labelId}>
      {MAP_CAMERA_COLORS.map(item => <button key={item.id} type="button" className="bmap-color-swatch" data-camera-color={item.id} aria-pressed={color === item.id} aria-label={item.label} title={item.label} disabled={disabled} onClick={() => onChange(item.id)} />)}
      {/* No circle of its own: the amber is "no colour picked". Not `disabled` when there is nothing to reset: its own click
          would switch it off under the focus, the focus would leave the editor, and the editor's keys would reach nothing. */}
      <button type="button" className="bmap-text-button bmap-color-reset" aria-disabled={color === undefined} title="고른 색을 지우고 원래 색(호박색)으로 돌아가요" disabled={disabled} onClick={() => { if (color !== undefined) onChange(null); }}>기본 색으로</button>
    </div>
  </div>;
}
