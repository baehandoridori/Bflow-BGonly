/**
 * 스레드 팔로우·알림 끄기 (씬 댓글 B안 §6.4, v1.148.0) — 이 PC·이 계정에만(서버 없음, §12-2 기본값).
 *
 * 파일: %APPDATA%\Bflow-BGonly\comment-thread-follow.{계정}.json — preferences.json 은 PC 전체가 같이 쓰고
 * 여러 곳이 통째로 덮어써서, 계정이 바뀌면 끄기가 다른 사람에게 번지고 동시에 쓰면 서로 지울 수 있었다.
 * 바꾸기는 낙관적으로 → 한 줄로 차례 저장(마지막 값) → 실패하면 되돌리고 알린다(CLAUDE.md 규칙 3).
 * 판정은 utils/commentThreadFollow(순수), 알림 연결부(services/sceneCommentNotifier)가 getState() 로 읽는다.
 */

import { create } from 'zustand';
import { toast as sonnerToast } from 'sonner';
import {
  sanitizeThreadPreferences,
  setThreadPreference,
  threadPreferenceFileName,
  type ThreadPreference,
  type ThreadPreferenceMap,
} from '@/utils/commentThreadFollow';

interface CommentThreadFollowState {
  userId: string | null;
  prefs: ThreadPreferenceMap;
  loaded: boolean;
  /** 로그인한 계정의 파일을 읽는다(null 이면 비운다). */
  hydrate: (userId: string | null) => Promise<void>;
  /** 하나 바꾸기(null = 기본으로). 저장되면 true. */
  setPreference: (key: string, value: ThreadPreference | null) => Promise<boolean>;
}

let saveChain: Promise<unknown> = Promise.resolve();
let hydrateSeq = 0;

export const useCommentThreadFollowStore = create<CommentThreadFollowState>((set, get) => ({
  userId: null,
  prefs: {},
  loaded: false,

  hydrate: async (userId) => {
    const seq = ++hydrateSeq;
    if (!userId) {
      set({ userId: null, prefs: {}, loaded: false });
      return;
    }
    set({ userId, prefs: {}, loaded: false });
    let raw: unknown = null;
    try {
      raw = await window.electronAPI?.readSettings?.(threadPreferenceFileName(userId));
    } catch (err) {
      console.warn('[스레드 팔로우] 설정을 읽지 못했어요:', err);
    }
    if (seq !== hydrateSeq || get().userId !== userId) return;
    set({ prefs: sanitizeThreadPreferences(raw), loaded: true });
  },

  setPreference: async (key, value) => {
    const userId = get().userId;
    if (!userId || !key) return false;
    const before = get().prefs[key] ?? null;
    set({ prefs: setThreadPreference(get().prefs, key, value) });
    const job = saveChain.then(async () => {
      if (get().userId !== userId) return true; // 계정이 바뀌었으면 쓰지 않는다
      try {
        await window.electronAPI?.writeSettings?.(threadPreferenceFileName(userId), get().prefs);
        return true;
      } catch (err) {
        console.warn('[스레드 팔로우] 저장 실패:', err);
        return false;
      }
    });
    saveChain = job.catch(() => undefined);
    const ok = await job;
    if (!ok && get().userId === userId) {
      // 되돌리기 — 그 사이 같은 키를 또 바꿨으면(값이 달라졌으면) 건드리지 않는다.
      if ((get().prefs[key] ?? null) === value) set({ prefs: setThreadPreference(get().prefs, key, before) });
      sonnerToast.error('알림 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    return ok;
  },
}));
