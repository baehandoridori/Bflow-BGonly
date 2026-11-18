// 그림 한 장마다 고르는 품질 · 그림 모델 (HTML 의 '품질' · '그림 모델' 고르기 그대로). 화면 · 메인 · 테스트 모드가 같이 쓴다.
// 메인은 화면이 보낸 값을 이 목록으로만 받는다 (목록 밖이면 설정 책장의 값). DOM · Electron · '@/' 없이.

export interface BaeImageChoice { id: string; label: string }

/** HTML #quality 의 네 가지. 처음 값은 '최고' (한솔 결정 2026-11-18: 품질은 최고로). */
export const BAE_IMAGE_QUALITIES: readonly BaeImageChoice[] = [
  { id: 'medium', label: '중간 (빠르고 저렴)' },
  { id: 'high', label: '높음' },
  { id: 'xhigh', label: '아주 높음' },
  { id: 'max', label: '최고 (비쌈)' },
];
export const BAE_DEFAULT_QUALITY = 'max';

/** HTML #imgModel 의 네 가지. */
export const BAE_IMAGE_MODELS: readonly BaeImageChoice[] = [
  { id: 'gpt-image-2.5-sunburst', label: '2.5 Sunburst (정교함)' },
  { id: 'gpt-image-2.5-flare', label: '2.5 Flare (빠름)' },
  { id: 'gpt-image-2.6-sunburst', label: '2.6 Sunburst (새 모델 · 시험 중)' },
  { id: 'gpt-image-2.6-flare', label: '2.6 Flare (새 모델 · 빠름 · 시험 중)' },
];

const has = (list: readonly BaeImageChoice[], v: unknown): v is string => typeof v === 'string' && list.some((c) => c.id === v);

/** 화면이 보낸 품질: 목록 안이면 그 값, 아니면 설정 책장 값(teamQuality). */
export function baePickQuality(asked: unknown, teamQuality: string): string {
  return has(BAE_IMAGE_QUALITIES, asked) ? asked : teamQuality;
}

/** 화면이 보낸 그림 모델: 목록 안이거나 설정 책장 모델과 같으면 그 값, 아니면 설정 책장 값(teamModel). */
export function baePickModel(asked: unknown, teamModel: string): string {
  return has(BAE_IMAGE_MODELS, asked) || (typeof asked === 'string' && asked === teamModel) ? asked : teamModel;
}

/** 고르기 칸에 보일 모델 목록: 설정 책장의 모델이 목록에 없으면 맨 앞에 더한다 (관리자가 바꾼 모델도 고를 수 있게). */
export function baeModelChoices(teamModel: string, teamLabel: string): BaeImageChoice[] {
  const list = BAE_IMAGE_MODELS.slice();
  if (teamModel && !has(list, teamModel)) list.unshift({ id: teamModel, label: teamLabel || teamModel });
  return list;
}

export const baeQualityLabel = (id: string) => BAE_IMAGE_QUALITIES.find((q) => q.id === id)?.label.replace(/\s*\(.*\)$/, '') ?? id;
