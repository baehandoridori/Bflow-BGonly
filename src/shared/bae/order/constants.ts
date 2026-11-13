// BAE경 HTML v0.4.11 의 상수를 글자 그대로 옮긴 것 (script 13~60줄). 값을 바꾸면 'HTML과 같은 요청' 시험이 깨진다.
// 화면과 메인이 같이 쓴다. DOM · Electron · '@/' 경로를 쓰지 않는다 (메인 묶음과 node 시험이 그대로 읽는다).

export const ORDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary_ko', 'notes_ko', 'style_picks', 'style_reason_ko', 'prompt'],
  properties: {
    summary_ko: { type: 'string' },
    notes_ko: { type: 'array', items: { type: 'string' } },
    style_picks: { type: 'array', items: { type: 'string' } },
    style_reason_ko: { type: 'string' },
    prompt: { type: 'string' },
  },
} as const;

export const PLACE_KO: Record<string, string> = { interior: '실내', exterior: '실외' };
export const TOD_KO: Record<string, string> = { day: '낮', sunset: '노을', night: '밤', any: '상관없음' };
/** 백만 토큰당 달러 [입력, 출력]. Bflow에서는 설정 책장 `prices`가 이긴다 (이 값은 HTML 기본값). */
export const PD_PRICE: Record<string, [number, number]> = { 'gpt-6.1-sol': [2, 10], 'gpt-6-astra': [10, 50], 'gpt-6-luna': [0.1, 0.5] };
export const IMG_PRICE = { text: 5, image: 8, out: 30 };

export type RatioId = '16:9' | '2:1' | '3:1' | '3:2' | '4:3' | '1:1' | '9:16';
export type TierId = 's' | 'm' | 'l' | 'x';
export interface RatioInfo { hint: string; sizes: Record<TierId, [number, number]>; fhd?: [number, number] }

// Every size is a multiple of 16 and within 3:1, as the GPT Image 2.5 models require.
export const RATIOS: Record<RatioId, RatioInfo> = {
  '16:9': { hint: '유튜브 화면', sizes: { s: [1536, 864], m: [2048, 1152], l: [2560, 1440], x: [3840, 2160] }, fhd: [1920, 1080] },
  '2:1': { hint: '옆으로 긴 팬', sizes: { s: [1536, 768], m: [2048, 1024], l: [2560, 1280], x: [3584, 1792] } },
  '3:1': { hint: '아주 긴 팬', sizes: { s: [1536, 512], m: [2304, 768], l: [3072, 1024], x: [3840, 1280] } },
  '3:2': { hint: '지금까지 쓰던 비율', sizes: { s: [1152, 768], m: [1536, 1024], l: [2160, 1440], x: [3456, 2304] } },
  '4:3': { hint: '', sizes: { s: [1152, 864], m: [1536, 1152], l: [1920, 1440], x: [3072, 2304] } },
  '1:1': { hint: '', sizes: { s: [1024, 1024], m: [1536, 1536], l: [1920, 1920], x: [2880, 2880] } },
  '9:16': { hint: '쇼츠', sizes: { s: [864, 1536], m: [1152, 2048], l: [1440, 2560], x: [2160, 3840] }, fhd: [1080, 1920] },
};
export const RATIO_ORDER: RatioId[] = ['16:9', '2:1', '3:1', '3:2', '4:3', '1:1', '9:16'];
export const TIERS: [TierId, string, string][] = [['s', '작게', '시안용'], ['m', '보통', ''], ['l', '크게', ''], ['x', '최대', '실험적이라 실패하거나 오래 걸릴 수 있어요']];
export const BASE_PX = 1536 * 1024;

export interface TimeOption { id: string; label: string; pd?: string; desc?: string; user?: boolean }
export const TIMES_BUILTIN: TimeOption[] = [
  { id: 'day', label: '낮', pd: 'day' },
  { id: 'dayflat', label: '그림자 없는 낮', pd: 'day-flat (daytime with no shadows at all)' },
  { id: 'sunset', label: '노을', pd: 'sunset' },
  { id: 'night', label: '밤', pd: 'night' },
  { id: 'nightflat', label: '그림자 없는 밤', pd: 'night-flat (night with no shadows at all)' },
];

export type PerspectiveId = 'auto' | 'flat' | '1p' | 'corridor' | '2p' | '3pu' | '3pd';
export const PERSPECTIVES: { id: PerspectiveId; label: string; hint: string }[] = [
  { id: 'auto', label: '자동', hint: '러프에 그린 투시를 그대로 따라가요.' },
  { id: 'flat', label: '정면', hint: '투시를 거의 안 쓰는 정면 그림이에요. 벽이 화면과 나란해요.' },
  { id: '1p', label: '1점 투시', hint: '깊이 방향 선이 소실점 하나로 모여요. 방 안쪽을 정면으로 볼 때.' },
  { id: 'corridor', label: '복도 (길게)', hint: '복도를 정면으로 길게 뺀 1점 투시예요. 끝이 작을수록 길어 보여요.' },
  { id: '2p', label: '2점 투시', hint: '모서리를 보는 그림이에요. 소실점이 양옆에 하나씩.' },
  { id: '3pu', label: '3점 · 올려다봄', hint: '아래에서 올려다봐서 세로선이 위로 모여요.' },
  { id: '3pd', label: '3점 · 내려다봄', hint: '위에서 내려다봐서 세로선이 아래로 모여요.' },
];
export const PERSP_EN: Record<Exclude<PerspectiveId, 'auto'>, string> = {
  flat: 'flat front view',
  '1p': 'one-point perspective',
  corridor: 'one-point perspective down a long corridor',
  '2p': 'two-point perspective',
  '3pu': 'three-point perspective looking up',
  '3pd': 'three-point perspective looking down',
};
export const GUIDE_DEFAULTS: Record<PerspectiveId, { hy: number; v1?: number; v2?: number; v3?: number; depth?: number; cx?: number; ct?: number; cb?: number }> = {
  auto: { hy: 0.5 },
  flat: { hy: 0.5 },
  '1p': { hy: 0.5, v1: 0.5 },
  corridor: { hy: 0.5, v1: 0.5, depth: 0.16 },
  '2p': { hy: 0.55, v1: -0.6, v2: 1.6, cx: 0.42, ct: 0.14, cb: 0.86 },
  '3pu': { hy: 0.82, v1: -0.6, v2: 1.6, v3: -0.9 },
  '3pd': { hy: 0.16, v1: -0.6, v2: 1.6, v3: 1.9 },
};
export const CORRIDOR_STEPS = [0.42, 0.32, 0.25, 0.2, 0.16, 0.13, 0.1, 0.08, 0.06, 0.045]; // far-end size, short to long

/** HTML `Board`의 `st.guide` 모양 그대로 (`Board.guide()`가 돌려주는 것). hy 는 위에서부터의 비율(0=위). */
export interface GuideState {
  type: PerspectiveId;
  placed: boolean;
  hy: number;
  v1: number;
  v2: number;
  v3: number;
  depth: number;
  cx: number;
  ct: number;
  cb: number;
}
export const GUIDE_INITIAL: GuideState = { type: 'auto', placed: false, hy: 0.5, v1: 0.5, v2: 1.6, v3: -0.9, depth: 0.16, cx: 0.42, ct: 0.14, cb: 0.86 };

export const NOTE_COLOR = '#E5336B';
export const SWATCHES = ['#26251F', '#5E5B54', '#9B978D', '#D9D5CB', '#FFFFFF', '#E9E2D0', '#F4E7A1', '#A9D3EA', '#8FA7B5', '#B7C7A0', '#7E9A5A', '#9A7652', '#C9785B', '#6B6C8A'];
export const FONT = "'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR','Noto Sans CJK KR',sans-serif";
export const SKY: Record<string, string> = { day: '#A9D3EA', sunset: '#F0B7B0', night: '#474A6A' };
/** HTML의 연결 실패 문장. Bflow는 메인이 부르므로 둘째 줄(브라우저가 막는 경우)은 화면에서 쓰지 않는다. */
export const NET_ERR = 'OpenAI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.\n계속 안 되면 브라우저가 직접 연결을 막는 경우라서, 회사 서버를 거치는 방식으로 바꿔야 해요.';

/* ---------- 아래는 주문서 조각(보조)이 더한 것: HTML 글자 그대로 ---------- */
export const BAE_HTML_VER = 'v0.4.11';
export const MANUAL_TAG = '# BAE PD manual v1.7';
export const PLACE_LABEL_KO: Record<'auto' | 'interior' | 'exterior', string> = { auto: '자동', interior: '실내', exterior: '실외' };

export const DIR_RE = /[{｛]([^{}｛｝]*)[}｝]/g;
export const DIR_HEAD = "Director's note for this episode (this wins over everything above, including the drawing style, the time block and the avoid list):";
export const DIR_MARKERS = ['STYLE', 'TREES', 'CARS', 'CARS EYE LEVEL', 'BUILDINGS', 'TIME', 'LIGHT FLAT', 'LIGHT EVEN', 'AVOID'] as const;
export type DirMarker = (typeof DIR_MARKERS)[number];
export const DIR_MARKER_KO: Record<string, string> = { STYLE: '그림체', TREES: '나무', CARS: '차', 'CARS EYE LEVEL': '차 눈높이', BUILDINGS: '큰 건물', TIME: '시간대', 'LIGHT FLAT': '그림자 없는 빛', 'LIGHT EVEN': '고른 빛', AVOID: '금지 목록' };
export const ORDER_SCHEMA_DIR = {
  type: 'object',
  additionalProperties: false,
  required: [...ORDER_SCHEMA.required, 'director_en', 'director_replaced'],
  properties: { ...ORDER_SCHEMA.properties, director_en: { type: 'array', items: { type: 'string' } }, director_replaced: { type: 'array', items: { type: 'string', enum: [...DIR_MARKERS] } } },
};

export const TIME_KEY: Record<string, string> = { day: 'day', dayflat: 'dayflat', sunset: 'sunset', night: 'night', nightflat: 'nightflat' };
export const SHADOW_TXT = ' with a small flat contact shadow';
export const PHR_DRAW = ['러프 따라 구도 잡는 중', '그림체 기준 맞추는 중', '단색 면으로 칠하는 중', '손맛 넣는 중'];
export const BASE_MAX = 3;
export const PART_MAX = 16;

/** 기준 배경 · 부품 시트 · 칠한 러프 문장 (3단계에서 쓴다). HTML 782~808줄을 기계로 옮김. */
export const PLACE_TXT: Record<'base' | 'samePlace' | 'sheet' | 'samePlaceSheet' | 'room' | 'roomSentence', string> = {
  base: `## Base backgrounds (기준 배경)
Sometimes the app sends base backgrounds instead of reference images: finished backgrounds of this same place that our team already made for this episode, each with a short Korean note (for example "소파 쪽"). They are Images 2 to k+1. Image 1 is then a new rough of the same place from another camera: a slightly turned view, another wall of the room, or a closer shot. The new picture must clearly be the same place, as if the same set were filmed from the new camera.
- Image 1 decides the camera, the layout and what is in the picture. Never copy the composition or the camera of a base background.
- Find every object and surface of Image 1 in the base backgrounds and describe it as it looks there: its colors, its shape and two to four key features, and the number of the image that shows it (for example "the wine-red tufted sofa with gold claw feet, as in image 2"). A loose or unclear shape in Image 1 where a base background has an object is that object.
- Name the walls, the floor, the baseboard, the ceiling, the windows and the doors as they look in the base backgrounds, also when Image 1 shows a side of the room that no base background shows: that side keeps the same wallpaper, floor, baseboard, window frames and doors. Objects there that no base background shows are drawn as Image 1 shows them, in the same plain look as the furniture of the base backgrounds.
- Keep the sizes: a sofa or a door is as big compared to the room as in the base backgrounds.
- Never add an object from a base background where Image 1 shows none.
- Write the marker [SAME PLACE] right after the layout rule (item 5); the app replaces it with the team's sentence about the base backgrounds. Item 6 is for reference images only: do not write it for base backgrounds.
- The base backgrounds already show our style for this place, so the app sends no style examples: style_picks must be [] and item 8 is left out.`,
  samePlace: `{SUBJ} of this same place that our team already drew for this episode. This picture shows the same place from the new camera of image 1: every wall, floor, ceiling, window, door and piece of furniture that {OBJ} show{S} keeps exactly the same colors, shapes, materials and details. Only the camera changes: follow image 1 for the camera, the layout and the positions, and never copy the composition of {OBJ}.`,
  sheet: `## Model sheet of the place (기준 배경 부품 시트)
Sometimes the app sends a model sheet of this place instead of base backgrounds: Image 2 shows the furniture and fittings of this place, each cut out from a finished background of it and boxed on a grey sheet, and plain swatches of its colors (wall, side wall, floor, baseboard). Image 1 is a rough of this place.
- Image 1 decides the camera, the layout and what is in the picture. The sheet has no room and no camera: the position, size and angle of every object come only from Image 1. A sofa that Image 1 shows from the side or at an angle is drawn from the side or at that angle, never turned to face the camera like on the sheet.
- Find every object of Image 1 on the sheet and describe it with its design, colors and two to four key features there (for example "the wine-red tufted sofa with gold claw feet from image 2"). Describe the walls, the floor and the baseboard with the swatch colors.
- Objects of Image 1 that are not on the sheet are drawn as Image 1 shows them, in the same plain look as the furniture on the sheet.
- Never add an object from the sheet where Image 1 shows none.
- Write the marker [SAME PLACE] right after the layout rule (item 5); the app replaces it with the team's sentence about the sheet. Item 6 is for reference images only: do not write it for the sheet.
- The sheet already shows our style for this place, so the app sends no style examples: style_picks must be [] and item 8 is left out.`,
  samePlaceSheet: `Image {N} is the model sheet of this place: its furniture and fittings have exactly these designs and colors, and the walls, floor and baseboard use exactly its swatch colors. Image {N} has no camera and no layout: follow image 1 for the camera, the layout and the position, size and angle of every object.`,
  room: `## Painted rough
The artist painted Image 1 with the flat colors of this place. The painted walls, floor and ceiling and the painted window and door openings are the exact room: keep exactly where the floor meets the walls (the floor line and its slope), the corners of the walls and the ceiling, and the position and size of every window and door opening. In the layout, say where these borders run in plain words (for example "the floor line runs from the bottom left up to the right").
- Furniture and other objects, whether painted or drawn only as pencil lines over the room, show only where each object stands, how big it is and how it is turned (for example a sofa seen at an angle). Describe each one at that place, size and angle, but with its real design, shape and proportions from {IMGS}. The rough outline of an object in the sketch is not its shape: never copy it.
- A painted window or door opening holds a complete window or door like the ones of {IMGS}, with its frame along every edge of the opening.
- These colors are the colors of the place: this wins over the color hint rule, so do not make them clearer or more saturated.`,
  roomSentence: `The painted walls, floor, ceiling and openings of image 1 are the exact room: keep the floor line and its slope, the corners of the walls and the ceiling, and every window and door opening exactly where they are. The furniture and objects of image 1 only mark their place, size and angle: draw each one there with its real design, shape and proportions from {IMGS}, never with the rough outline of the sketch.`,
};
export const TILT_SENTENCE = 'Image 1 is the sketch turned level on a larger canvas: its white corners are not part of the layout, so continue the scene there plainly (they are cropped away later).';
