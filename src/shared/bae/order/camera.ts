// 투시 문장: '지평선 및 투시 참고하게 하기'가 켜져 있으면 그림판 가이드의 위치를 숫자로 (HTML cameraSentence · guideSummaryKo).
import type { GuideState, PerspectiveId } from './constants';
import type { PlaceId } from './types';

export interface CameraInput { persp: PerspectiveId; guide: GuideState; calib: number; place: PlaceId }

export function cameraSentence({ persp: p, guide: G, calib, place }: CameraInput): string {
  if (p === 'auto') return '';
  const use = G.type === p && G.placed;
  const hb = Math.round((1 - G.hy) * 100) - (Number(calib) || 0);
  const H = hb > 100 ? 'above the top edge of the picture' : hb < 0 ? 'below the bottom edge of the picture' : 'at about ' + hb + '% of the image height from the bottom';
  const X = (v: number) => v < -0.5 ? 'far outside the picture on the left' : v < 0 ? 'just outside the picture on the left' : v > 1.5 ? 'far outside the picture on the right' : v > 1 ? 'just outside the picture on the right' : 'at about ' + Math.round(v * 100) + '% of the image width from the left';
  const k = G.v2 - G.v1;
  const strength = !use ? '' : k >= 2.8 ? ' The two vanishing points are far apart, so the perspective is gentle.' : k <= 1.5 ? ' The two vanishing points are close to the picture, so the perspective is strong.' : '';
  if (p === 'flat') return 'Camera: eye level and straight on, a flat frontal view with almost no perspective: the back wall is parallel to the picture, horizontal lines stay horizontal and vertical lines stay vertical.' + (use ? ' The eye level is ' + H + '.' : '');
  if (p === '1p') return 'Camera: eye level, one-point perspective: all depth lines meet at one vanishing point ' + (use ? X(G.v1) + ' and ' + H : 'near the center of the picture') + '; vertical lines stay vertical and horizontal lines stay horizontal.';
  if (p === 'corridor') return 'Camera: eye level, one-point perspective looking straight down a long corridor: the far end is a small opening about ' + Math.round(G.depth * 100) + '% of the picture width, ' + (use ? X(G.v1) + ' and ' + H : 'near the center of the picture') + '; the floor, the ceiling and both walls run toward it, and doors, windows and ceiling lights repeat and get smaller with distance; vertical lines stay vertical and horizontal lines stay horizontal.';
  if (p === '2p') {
    let corner = '';
    if (use) { // 화가가 놓은 모서리: 어디 서 있고 어디까지 닿는지
      const b = Math.round((1 - G.cb) * 100), t = Math.round((1 - G.ct) * 100);
      const what = place === 'interior' ? 'The corner where the two walls meet' : place === 'exterior' ? 'The front corner where the two sides of the building meet' : 'The corner where the two main sides meet';
      corner = ' ' + what + ' is a vertical line ' + X(G.cx) + ', running from ' + (b < 0 ? 'below the bottom edge of the picture' : 'about ' + b + '%') + ' up to ' + (t > 100 ? 'past the top edge of the picture' : 'about ' + t + '% of the image height from the bottom') + '.';
    }
    return 'Camera: two-point perspective looking at a corner: the horizon line is ' + (use ? H : 'at eye level') + ', one vanishing point is ' + (use ? X(G.v1) : 'far to the left, outside the picture') + ' and the other is ' + (use ? X(G.v2) : 'far to the right, outside the picture') + '; vertical lines stay vertical.' + corner + strength;
  }
  if (p === '3pu') return 'Camera: low angle looking up, three-point perspective: the horizon is low' + (use ? ', ' + H : '') + ', and vertical lines lean in toward a third vanishing point high above the picture.' + strength;
  if (p === '3pd') return 'Camera: high angle looking down, three-point perspective: the horizon is high' + (use ? ', ' + H : '') + ', and vertical lines lean in toward a third vanishing point far below the picture.' + strength;
  return '';
}

/** 스위치가 보내는 것을 한국어 몇 마디로 (화면 안내용). */
export function guideSummaryKo(persp: PerspectiveId, G: GuideState): string {
  const p = persp; if (p === 'auto' || G.type !== p) return '';
  const side = (v: number) => v < 0 ? '왼쪽 밖' : v > 1 ? '오른쪽 밖' : Math.round(v * 100) + '%';
  const parts = [(p === 'flat' ? '눈높이 ' : '지평선 ') + Math.round((1 - G.hy) * 100) + '%'];
  if (p === '1p' || p === 'corridor') parts.push('소실점 ' + side(G.v1));
  if (p === '2p' || p === '3pu' || p === '3pd') parts.push('소실점 ' + side(G.v1) + '·' + side(G.v2));
  if (p === '2p') parts.push('모서리 ' + Math.round(G.cx * 100) + '%');
  return parts.join(', ');
}
