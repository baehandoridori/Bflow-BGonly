import type { BackgroundImageRevision, BackgroundVariant, BackgroundView } from './types.ts';

export function backgroundWorkFilePath(variant: BackgroundVariant): string {
  // An explicit empty string means the user disconnected the legacy path.
  return variant.workFilePath ?? variant.revisions.find(item => item.id === variant.activeRevisionId)?.filePath ?? '';
}

export function prepareBackgroundFileLinks(view: BackgroundView): BackgroundView {
  return { ...view, variants: view.variants.map(variant => ({ ...variant, workFilePath: backgroundWorkFilePath(variant) })) };
}

export function assertBackgroundImageCapacity(variant: BackgroundVariant): void {
  if (variant.revisions.length >= 100) {
    throw new Error('수정본은 변형당 100개까지 등록할 수 있습니다. 새 변형을 만든 뒤 이미지를 연결해 주세요.');
  }
}

export function appendBackgroundImage(view: BackgroundView, variantId: string, image: BackgroundImageRevision): BackgroundView {
  const target = view.variants.find(variant => variant.id === variantId);
  if (target) assertBackgroundImageCapacity(target);
  return { ...view, variants: view.variants.map(variant => variant.id === variantId ? {
    ...variant, workFilePath: backgroundWorkFilePath(variant),
    revisions: [...variant.revisions, image], activeRevisionId: image.id,
  } : variant) };
}

export function disconnectBackgroundImage(view: BackgroundView, variantId: string, revisionId: string): BackgroundView {
  return { ...view, variants: view.variants.map(variant => variant.id === variantId ? {
    ...variant, revisions: variant.revisions.map(revision => revision.id === revisionId ? { ...revision, sourceImagePath: '' } : revision),
  } : variant) };
}

export function backgroundFileName(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).pop() || '연결된 파일 없음';
}
