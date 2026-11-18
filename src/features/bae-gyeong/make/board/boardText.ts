/**
 * 그림판 화면 글자. 도구 이름·안내는 HTML v0.4.11 그대로(도구 글쇠 안내 '(P)'·'(G)' 같은 것만 뺌),
 * 도구 설명 한 줄은 시안 WinNew(TOOLS) 그대로, HTML 과 시안 둘 다에 없는 것은 '새 글자'로 표시했다.
 */
import type { BoardTool } from './Board';

/** [이름(단추 aria-label), 단추 풀이(title), 설명 한 줄] */
export const TOOL_TEXT: Record<BoardTool, { name: string; title: string; desc: string }> = {
  pen: { name: '펜', title: '펜', desc: '선을 그려요.' },
  line: { name: '직선', title: '직선', desc: '끌어서 곧은 선을 그려요.' },
  rect: { name: '네모', title: '네모', desc: '끌어서 네모를 그려요.' },
  ellipse: { name: '동그라미', title: '동그라미', desc: '끌어서 동그라미를 그려요.' },
  fill: { name: '페인트통', title: '페인트통', desc: '닫힌 면을 한 색으로 칠해요.' },
  eraser: { name: '지우개', title: '지우개', desc: '그린 것을 지워요.' },
  picker: { name: '스포이드', title: '스포이드', desc: '그림에서 색을 집어요.' },
  arrow: { name: '화살표', title: '화살표', desc: '가리키는 화살표를 그려요.' },
  text: { name: '글씨', title: '글씨', desc: '누른 자리에 글씨를 넣어요.' },
  mark: { name: '메모 펜', title: '메모 펜', desc: '빨간 메모는 PD만 읽어요. 그림 모델에게는 메모 없는 러프가 가요.' },
  // 새 글자: HTML 은 단추 풀이(title)만 있었다
  select: { name: '메모', title: '메모 옮기기·지우기', desc: '메모를 눌러 고른 뒤 끌어서 옮겨요. 고른 메모는 지울 수 있어요.' },
  // HTML bGuideHint (투시를 고른 뒤) 에서 '(G)' 만 뺌
  guide: { name: '가이드', title: '투시 가이드 옮기기', desc: "'가이드' 도구로 지평선과 소실점을 끌어 옮겨요. 화면 밖 소실점은 가장자리의 파란 점을 끌면 돼요. 옮기면 '지평선 및 투시 참고하게 하기'가 켜져요." },
};
/** HTML bGuideHint (투시가 '자동'일 때) */
export const GUIDE_AUTO_HINT = '투시를 고르면 지평선과 소실점 가이드가 나와요.';
export const DRAW_TOOLS: BoardTool[] = ['pen', 'line', 'rect', 'ellipse', 'fill', 'eraser', 'picker'];
export const NOTE_TOOLS: BoardTool[] = ['arrow', 'text', 'mark'];
/** 굵기 단추가 쓰이는 도구 (메모 선 굵기 · 글씨 크기도 따라간다) */
export const WIDTH_TOOLS: BoardTool[] = ['pen', 'line', 'rect', 'ellipse', 'eraser', 'arrow', 'text', 'mark'];
export const COLOR_TOOLS: BoardTool[] = ['pen', 'line', 'rect', 'ellipse', 'fill', 'picker'];

export const WIDTHS: [number, string][] = [[4, '가늘게'], [10, '보통'], [24, '굵게']];
export const FILLS: ['fill' | 'stroke', string][] = [['fill', '채우기'], ['stroke', '테두리만']];
export const GAPS: [number, string][] = [[0, '그대로'], [4, '작은 틈 메우기'], [10, '큰 틈 메우기']];

/** HTML 메인 화면 modeHint */
export const MODE_HINT = {
  rough: '선으로 그린 러프예요. 선과 손글씨는 그리지 않고 배치만 따라가요.',
  guide: '디테일이 많은 AI 이미지나 사진이에요. 흐리게 바꿔서 넣어야 따라 그리지 않고 새로 그려요.',
} as const;
/** HTML 그림판 bfoot */
export const NOTE_FOOT = '빨간 메모(화살표, 글씨, 메모 펜)는 PD만 읽어요. 그림 모델에는 메모를 뗀 그림만 보내요. 색을 칠한 곳은 색 힌트로 전해져요.';
/** HTML gTiltHint */
export const TILT_HINT = '파란 점선이 러프의 지평선과 나란해지게 맞춰 주세요. 앱이 러프를 수평으로 돌려서 그리게 한 뒤, 다 그린 그림을 이 각도로 다시 돌려서 잘라요.';
/** HTML photoHint · photoSwitch · 그 알림 */
export const PHOTO_HINT = '사진이나 AI 그림 같아요. 흐리게 처리해서 보내야 원본 그림체를 덜 따라가요.';
export const PHOTO_SWITCH = 'AI 이미지·사진으로 바꾸기';
export const PHOTO_TOAST = 'AI 이미지·사진 모드로 바꿨어요. 흐리게 처리해서 보내요.';
/** HTML btnRoughClear 의 알림 (모두 지우기) */
export const CLEAR_TOAST = '러프를 비웠어요. 그림판의 되돌리기로 살릴 수 있어요.';
