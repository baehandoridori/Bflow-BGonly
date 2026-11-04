/**
 * 댓글 첨부 그림 — 붙이기·끌어 놓기·파일 고르기·빼기·올리기 (씬 댓글 B안 §8, v1.146.1).
 *
 * 예전엔 본문 입력칸·스레드 창·리테이크 카드 입력칸에 같은 코드가 세 벌 있었다. 이제 이 순수 모듈 하나를
 * useImageAttachments 훅이 감싸 셋이 같이 쓴다. 바깥(줄여 올리기·지우기·미리보기 주소)은 deps 로 받아
 * node --test 로 바로 검사한다(@/ 별칭·DOM 없음).
 *
 * 지켜 온 규칙(예전 코덱스 지적들):
 *  - 올리는 중에 사용자가 빼면, 올라온 파일은 바로 지운다(주인 없는 파일 방지).
 *  - 화면이 닫힌 뒤 올라온 파일도 지운다.
 *  - 올라온 뒤 빼면 저장소의 파일도 지운다. 실패해도 화면 흐름은 막지 않는다.
 *  - '한 장만'(빠른 리테이크)이면 새로 넣을 때 앞의 것을 정리하고 바꾼다.
 */

export interface AttachedImage {
  id: string;
  /** 바로 보이는 미리보기(blob 주소). */
  previewUrl: string;
  /** 올린 뒤 주소. */
  uploadedUrl?: string;
  uploading: boolean;
  error?: string;
}

export interface ImageAttachmentDeps {
  setImages(updater: (prev: AttachedImage[]) => AttachedImage[]): void;
  /** 줄여서 올리고 주소를 돌려준다. 실패하면 던진다. */
  upload(file: Blob): Promise<string>;
  deleteRemote(url: string): Promise<unknown>;
  createPreviewUrl(file: Blob): string;
  revokePreviewUrl(url: string): void;
  createId(): string;
  isMounted(): boolean;
  /** 한 장만 받나(빠른 리테이크). 넣는 순간의 값을 읽는다. */
  single(): boolean;
  /** 로그 앞말 — 예 '[스레드 댓글 이미지]'. */
  label: string;
}

/** 미리보기 주소를 풀고, 올린 파일이 있으면 저장소에서 지운다(기다리지 않는다). */
export function discardAttachedImages(
  images: readonly AttachedImage[],
  deps: Pick<ImageAttachmentDeps, 'deleteRemote' | 'revokePreviewUrl'>,
  context: string,
): void {
  for (const item of images) {
    try { deps.revokePreviewUrl(item.previewUrl); } catch { /* 이미 풀림 */ }
    if (item.uploadedUrl) {
      deps.deleteRemote(item.uploadedUrl).catch((err) => {
        console.warn(`${context} 저장소 정리 실패:`, err);
      });
    }
  }
}

/** 그림 파일만, '한 장만'이면 첫 장만. */
export function pickImageFiles<T extends { type: string }>(
  files: ArrayLike<T> | Iterable<T> | null | undefined,
  single: boolean,
): T[] {
  const images = Array.from(files ?? []).filter((file) => typeof file.type === 'string' && file.type.startsWith('image/'));
  return single ? images.slice(0, 1) : images;
}

/** 붙여 넣은 항목 중 그림 파일만. */
export function clipboardImageFiles<F>(
  items: ArrayLike<{ type: string; getAsFile(): F | null }> | null | undefined,
  single: boolean,
): F[] {
  const files: F[] = [];
  for (const item of pickImageFiles(items, single)) {
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export interface ImageAttachmentActions {
  add(file: Blob): void;
  remove(id: string): void;
  /** 고른 파일·끌어 놓은 파일 — 그림만, '한 장만'이면 첫 장만. */
  addFiles(files: ArrayLike<Blob & { type: string }> | Iterable<Blob & { type: string }> | null | undefined): void;
  /** 붙여 넣기 — 그림이 있으면 넣고 true(호출자가 기본 붙여 넣기를 막는다). */
  addFromClipboard(items: ArrayLike<{ type: string; getAsFile(): Blob | null }> | null | undefined): boolean;
}

export function createImageAttachmentActions(deps: ImageAttachmentDeps): ImageAttachmentActions {
  const deleteQuietly = (url: string, context: string) => {
    deps.deleteRemote(url).catch((err) => console.warn(`${deps.label} ${context} 정리 실패:`, err));
  };

  const uploadInto = async (id: string, file: Blob) => {
    try {
      const url = await deps.upload(file);
      if (!deps.isMounted()) {
        deleteQuietly(url, '화면이 닫힌 뒤 올라온 파일');
        return;
      }
      // 최신 목록으로 직접 확인한다 — 빼자마자 올라온 파일이 어디에도 안 남는 일이 없게.
      deps.setImages((prev) => {
        if (!prev.some((item) => item.id === id)) {
          deleteQuietly(url, '뺀 뒤 올라온 파일');
          return prev;
        }
        return prev.map((item) => (item.id === id ? { ...item, uploadedUrl: url, uploading: false } : item));
      });
    } catch (err) {
      console.error(`${deps.label} 업로드 실패`, err);
      if (!deps.isMounted()) return;
      const message = err instanceof Error ? err.message : String(err);
      deps.setImages((prev) => prev.map((item) => (item.id === id ? { ...item, uploading: false, error: message } : item)));
    }
  };

  const add = (file: Blob) => {
    const next: AttachedImage = { id: deps.createId(), previewUrl: deps.createPreviewUrl(file), uploading: true };
    const single = deps.single();
    deps.setImages((prev) => {
      if (!single) return [...prev, next];
      discardAttachedImages(prev, deps, `${deps.label} 한 장 바꾸기`);
      return [next];
    });
    void uploadInto(next.id, file);
  };

  const remove = (id: string) => {
    deps.setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) discardAttachedImages([target], deps, `${deps.label} 빼기`);
      return prev.filter((item) => item.id !== id);
    });
  };

  return {
    add,
    remove,
    addFiles: (files) => { pickImageFiles(files, deps.single()).forEach(add); },
    addFromClipboard: (items) => {
      const files = clipboardImageFiles(items, deps.single());
      files.forEach(add);
      return files.length > 0;
    },
  };
}
