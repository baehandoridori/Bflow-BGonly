// BAE경 그림체 기준: 기본 스타일 띠와 팀 예시 12장 (HTML v0.4.11 의 STYLE_IMG_DEFAULT · LIBRARY_DEFAULT 를 바이트 그대로
// src/features/bae-gyeong/assets/library/ 에 꺼내 둠). 이름 · 장소 · 시간대는 HTML 값 그대로. 그림 주소는 화면 쪽이 붙인다.

export interface BaeLibraryEntry {
  id: string;            // L1 … L12, 팀원이 더한 것은 U1 …
  name: string;
  place: 'interior' | 'exterior';
  tod: string;           // day · night · any …
  file?: string;         // 팀 예시의 파일 이름
  user?: boolean;
  src?: string;          // 화면에서 쓸 그림 주소 (데이터 주소나 앱 안 파일 주소)
  off?: boolean;
}

export const BAE_STYLE_STRIP_FILE = 'strip.jpg';
export const BAE_LIBRARY_DEFAULT: BaeLibraryEntry[] = [
  { id: 'L1', name: '학교 앞 횡단보도', place: 'exterior', tod: 'day', file: 'L1.jpg' },
  { id: 'L2', name: '아파트 집 안 (현관에서 본 거실)', place: 'interior', tod: 'day', file: 'L2.jpg' },
  { id: 'L3', name: '공원 벤치', place: 'exterior', tod: 'day', file: 'L3.jpg' },
  { id: 'L4', name: '작은 집 방 (소파, 에어컨)', place: 'interior', tod: 'day', file: 'L4.jpg' },
  { id: 'L5', name: '아파트 공동현관 (낮)', place: 'exterior', tod: 'day', file: 'L5.jpg' },
  { id: 'L6', name: '아파트 공동현관 (밤)', place: 'exterior', tod: 'night', file: 'L6.jpg' },
  { id: 'L7', name: '아파트 단지와 거리', place: 'exterior', tod: 'day', file: 'L7.jpg' },
  { id: 'L8', name: '초등학교 교실', place: 'interior', tod: 'day', file: 'L8.jpg' },
  { id: 'L9', name: '나무 아지트 안', place: 'interior', tod: 'any', file: 'L9.jpg' },
  { id: 'L10', name: '공중화장실', place: 'interior', tod: 'any', file: 'L10.jpg' },
  { id: 'L11', name: '공원 정자', place: 'exterior', tod: 'day', file: 'L11.jpg' },
  { id: 'L12', name: '놀이터', place: 'exterior', tod: 'day', file: 'L12.jpg' },
];

/** HTML library(): 팀 예시 + 팀원 예시, 꺼 둔 것 표시. activeLibrary(): 켜 둔 것만 (PD에게 가는 목록). */
export function baeLibrary(off: string[], user: BaeLibraryEntry[]): BaeLibraryEntry[] {
  return BAE_LIBRARY_DEFAULT.concat(user.map((e) => ({ ...e, user: true }))).map((e) => ({ ...e, off: off.includes(e.id) }));
}
export const baeActiveLibrary = (off: string[], user: BaeLibraryEntry[]) => baeLibrary(off, user).filter((e) => !e.off);
