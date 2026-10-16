import { mapDraftChanged, mapDraftSteps } from './mapDocument.ts';
import type { MapDraft } from './mapDocument.ts';

export type MapEditPhase = 'saving' | 'stale' | 'changed' | 'saved' | 'clean';
/** What the editor knows besides the draft: the map was saved or deleted elsewhere first, or its edits could not be kept on this PC. */
export type MapEditNote = 'moved' | 'gone' | 'unkept' | null;
export type MapEditStatus = {
  phase: MapEditPhase;
  /** Something of this map is not saved. */
  changed: boolean;
  /** Finished edits that are not saved. */
  steps: number;
  /** The words beside the label. */
  detail: string;
  /** 도면 저장 can be pressed. */
  canSave: boolean;
  saveLabel: string;
  /** What a screen reader is told as it happens. Empty: nothing to tell. */
  announce: string;
};
/** The label of the strip: it is there in every state. */
export const MAP_EDIT_LABEL = '편집 중';
/** How long "saved" stays on the strip. */
export const MAP_SAVED_NOTICE_MS = 4000;

export function mapEditStatus(draft: MapDraft, saving: boolean, justSaved: boolean, note: MapEditNote = null): MapEditStatus {
  const changed = mapDraftChanged(draft), steps = mapDraftSteps(draft);
  if (saving) return { phase: 'saving', changed, steps, detail: '저장 중…', canSave: false, saveLabel: '저장 중…', announce: '도면을 저장하는 중이에요' };
  // Saved or deleted elsewhere first. 도면 저장 stays on: a press asks what to do with the edits of this PC.
  if (changed && (note === 'moved' || note === 'gone')) return { phase: 'stale', changed, steps, detail: note === 'moved' ? '다른 곳에서 먼저 저장됐어요' : '다른 곳에서 지워졌어요', canSave: true, saveLabel: '도면 저장',
    announce: note === 'moved' ? '이 도면이 다른 곳에서 먼저 저장됐어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' : '이 도면이 다른 곳에서 지워졌어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' };
  if (changed) return { phase: 'changed', changed, steps, detail: note === 'unkept' ? '이 PC에 보관하지 못했어요' : draft.baseRevision === null ? '아직 저장한 적 없는 도면이에요' : `저장 안 한 변경 ${steps}개`, canSave: true, saveLabel: '도면 저장',
    announce: note === 'unkept' ? '저장 안 한 변경을 이 PC에 보관하지 못했어요. 도면 저장을 눌러 주세요' : '' };
  if (justSaved) return { phase: 'saved', changed, steps, detail: '도면을 저장했어요', canSave: false, saveLabel: '도면 저장', announce: '도면을 저장했어요' };
  // Not a sentence that begins like the one for unsaved edits: the two are told apart at the first word.
  return { phase: 'clean', changed, steps, detail: '저장된 그대로예요', canSave: false, saveLabel: '도면 저장', announce: '' };
}
