/**
 * 댓글 첨부 그림 훅 — 본문 입력칸·스레드 창·리테이크 카드 입력칸이 같이 쓴다(씬 댓글 B안 §8, v1.146.1).
 * 목록 상태는 쓰는 쪽이 들고(보내기·되돌리기가 같이 쓴다), 이 훅은 넣기·빼기·올리기만 맡는다.
 * 규칙은 utils/imageAttachments.ts(순수, node --test).
 */

import { useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as storageService from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { createUuid } from '@/utils/createUuid';
import { createImageAttachmentActions, type AttachedImage, type ImageAttachmentActions } from '@/utils/imageAttachments';

export type { AttachedImage } from '@/utils/imageAttachments';

export interface UseImageAttachmentsOptions {
  setImages: Dispatch<SetStateAction<AttachedImage[]>>;
  /** 저장소 폴더(시트·씬). */
  sheetName: string;
  sceneId: string;
  mountedRef: MutableRefObject<boolean>;
  /** 한 장만(빠른 리테이크) — 새로 넣으면 앞의 것을 바꾼다. */
  single?: boolean;
  label: string;
}

export function useImageAttachments({
  setImages,
  sheetName,
  sceneId,
  mountedRef,
  single = false,
  label,
}: UseImageAttachmentsOptions): ImageAttachmentActions {
  const singleRef = useRef(single);
  singleRef.current = single;
  return useMemo(() => createImageAttachmentActions({
    setImages,
    upload: async (file) => {
      const base64 = await resizeBlob(file, 800, 0.8);
      const result = await storageService.uploadImage(sheetName, sceneId, 'comment', base64);
      if (result.ok && result.url) return result.url;
      throw new Error(result.error || '업로드 실패');
    },
    deleteRemote: (url) => storageService.deleteImage(url),
    createPreviewUrl: (file) => URL.createObjectURL(file),
    revokePreviewUrl: (url) => URL.revokeObjectURL(url),
    createId: createUuid,
    isMounted: () => mountedRef.current,
    single: () => singleRef.current,
    label,
  }), [setImages, sheetName, sceneId, mountedRef, label]);
}
