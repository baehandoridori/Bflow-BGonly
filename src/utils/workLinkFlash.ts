// src/utils/workLinkFlash.ts — 작업 링크 칸을 잠깐 빛나게 하는 신호(가이드 작업 폴더 제안 저장 뒤, 설계 4.7).
// 테스트가 직접 import 한다 — 런타임 import 를 두지 않는다.

export const WORK_LINK_FLASH_EVENT = 'bflow:work-link-flash';

export interface WorkLinkFlashDetail {
  sceneUuid: string;
  department: 'bg' | 'acting';
  kinds: Array<'folder' | 'primary_file'>;
}

/** 이 창의 작업 링크 칸들에 '방금 바뀜'을 알린다. */
export function flashWorkLinks(detail: WorkLinkFlashDetail): void {
  window.dispatchEvent(new CustomEvent<WorkLinkFlashDetail>(WORK_LINK_FLASH_EVENT, { detail }));
}

/** 이 신호가 그 칸(씬·부서·칸 종류)의 것인가. */
export function isWorkLinkFlashFor(
  detail: WorkLinkFlashDetail,
  sceneUuid: string | null | undefined,
  department: string,
  kind: string,
): boolean {
  return !!sceneUuid
    && detail.sceneUuid === sceneUuid
    && detail.department === department
    && (detail.kinds as string[]).includes(kind);
}
