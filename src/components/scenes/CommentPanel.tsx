import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, Paperclip, X, ImagePlus, ArrowUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import {
  getComments,
  addComment,
  updateComment,
  deleteComment,
  extractMentions,
} from '@/services/commentService';
import type { SceneComment } from '@/services/commentService';
import { sendMentionWebhook } from '@/services/slackWebhookService';
import { formatTimeShort } from '@/utils/formatTime';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import * as storageService from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { RevisionCommentBadge } from './RevisionCommentBadge';
import '@/styles/comment-panel.css';

// ─── 타입 ───────────────────────────────────

/** 시스템 이벤트 — 댓글 사이사이에 작은 줄로 인라인 표시 (씬 생성/완료/리비전 등) */
export interface CommentInlineEvent {
  id: string;
  at: string;       // ISO 8601
  text: string;     // 한 줄 텍스트 (예: "이다은이 BG 모든 단계를 완료했습니다")
}

interface CommentPanelProps {
  /** 기본 sceneKey. 새 댓글은 항상 이 키에 저장된다 */
  sceneKey: string;
  /** 통합 뷰 전용 — 이 키의 댓글도 함께 보여주되, 저장은 primary(sceneKey)에만 한다 */
  secondarySceneKey?: string;
  onCountChange?: (count: number) => void;
  /** 댓글 사이에 시간순으로 끼어들어가는 시스템 이벤트 (씬 생성/완료/리비전 등) */
  inlineEvents?: CommentInlineEvent[];
}

/** 내부 렌더링용 — 원본이 어느 sceneKey 에서 왔는지 추적 */
type SceneCommentWithSource = SceneComment & { _sourceKey?: string };

/** 첨부 진행 중인 이미지 — 업로드 완료 시 uploadedUrl 채워짐 */
interface AttachedImage {
  id: string;
  previewUrl: string;       // blob URL — 즉시 미리보기
  uploadedUrl?: string;     // CDN URL — 업로드 완료 후
  uploading: boolean;
  error?: string;
}

// ─── sceneKey 분해 ─────────────────────────
function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
}

// ─── 메인 컴포넌트 ──────────────────────────

export function CommentPanel({ sceneKey, secondarySceneKey, onCountChange, inlineEvents }: CommentPanelProps) {
  const { currentUser, users } = useAuthStore();
  const { setView, setHighlightUserName } = useAppStore();

  const { sheetName, sceneId } = useMemo(() => parseSceneKey(sceneKey), [sceneKey]);

  // 댓글 상태
  const [comments, setComments] = useState<SceneCommentWithSource[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // 입력 상태
  const [input, setInput] = useState('');
  const [taHeight, setTaHeight] = useState(40);
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // 멘션 자동완성
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  // v1.18.0: "re만" 필터 — 리비전 맥락 댓글(revisionId 있음)만 표시.
  // 한솔 결정 (spec 2026-05-03): 댓글 패널에서 "리비전 댓글만" 빠르게 가려보고 싶을 때 토글.
  // onCountChange 는 전체 카운트로 유지(외부 배지 표기 일관성), 시각 필터만 패널 내부 적용.
  const [reOnly, setReOnly] = useState(false);

  // 드래그 + 라이트박스
  const [draggingOver, setDraggingOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // 패널 높이 측정 — 입력 카드 35% 한계 계산
  const [panelHeight, setPanelHeight] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // ── 입력 카드 + textarea 한계 계산 ──
  // 패널 전체 높이의 30% 까지 입력 카드가 자란다. 그 이상은 textarea 안에서 스크롤.
  // textarea 가 hard cap (taMaxPx) 을 넘지 않게 막아 toolbar 영역이 카드 maxHeight 안에 항상 보이게 보장.
  // v1.23.2 (#3): v1.23.1 의 cap 320px 으로도 부족 — 입력 wrapper 가 shrink-0 없어 grow 무제한.
  //   wrapper 에 shrink-0 추가 + cap 을 220px 으로 더 단단히. 두 변경이 같이 가야 회귀 완전 해소.
  const inputCardMaxPx = Math.min(220, Math.max(120, Math.floor(panelHeight * 0.30)));
  const imageRowHeight = attachedImages.length > 0 ? 88 : 0;       // 썸네일 64 + 위아래 여백 + pb-1
  const FOOTER_H = 56;                                              // toolbar(h-7) + mt-1.5 + border + pt-1.5 + 카드 padding(pt-2 + pb-1.5)
  const taMaxPx = Math.max(40, inputCardMaxPx - imageRowHeight - FOOTER_H);

  // 패널 ResizeObserver — 부모 높이 변화 추적
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => setPanelHeight(panel.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel);
    return () => ro.disconnect();
  }, []);

  // textarea 부드러운 자라기 — 측정 시 'auto' 잠깐 → 이전 px 복원 → setState (px → px transition)
  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = 'auto';
    const sh = ta.scrollHeight;
    ta.style.height = prev;
    setTaHeight(Math.max(40, Math.min(sh, taMaxPx)));
  }, [input, taMaxPx]);

  // 댓글 로드 — primary + optional secondary 시간순 병합 (기존 로직)
  const loadComments = useCallback(() => {
    const primaryPromise = getComments(sceneKey).then((list) =>
      list.map<SceneCommentWithSource>((c) => ({ ...c, _sourceKey: sceneKey })),
    );
    const secondaryPromise = secondarySceneKey
      ? getComments(secondarySceneKey).then((list) =>
          list.map<SceneCommentWithSource>((c) => ({ ...c, _sourceKey: secondarySceneKey })),
        )
      : Promise.resolve([] as SceneCommentWithSource[]);

    Promise.all([primaryPromise, secondaryPromise]).then(([a, b]) => {
      const merged = [...a, ...b].sort(
        (x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
      );
      const seen = new Set<string>();
      const deduped = merged.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      setComments(deduped);
      onCountChange?.(deduped.length);
    });
  }, [sceneKey, secondarySceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadComments(); }, [loadComments]);

  // 다른 PC 변경 시 자동 리로드 (300ms 디바운스)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadComments(); }, 300);
    };
    window.addEventListener('bflow:comments-invalidated', handler);
    return () => {
      window.removeEventListener('bflow:comments-invalidated', handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadComments]);

  // 새 댓글 시 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    // Codex R3 P2 (2026-05-03): inlineEvents 도 watch — system 활동만 도착해도 스크롤 따라가게.
  }, [comments.length, inlineEvents?.length]);

  // 멘션 드롭다운 활성 항목 스크롤
  useEffect(() => {
    if (!showMentions) return;
    const container = mentionDropdownRef.current;
    if (!container) return;
    const items = container.querySelectorAll('button');
    items[mentionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, showMentions]);

  // 라이트박스 ESC 닫기
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  // Codex P2(2026-04-29): cleanup + in-flight 롤백 정확도를 위한 latest 값 ref 추적.
  // 빈 deps 의 cleanup 은 초기 렌더 값만 capture 하므로 ref 가 필수.
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  useEffect(() => { attachedImagesRef.current = attachedImages; }, [attachedImages]);
  const inputValueRef = useRef('');
  useEffect(() => { inputValueRef.current = input; }, [input]);
  // Codex P2 8차(2026-04-29): unmount 후 upload 완료 race 처리 — React 가 unmounted component 의 setState 를
  // drop 하므로 setAttachedImages updater 안의 side-effect (deleteImage) 도 실행 안 됨 → orphan.
  // mountedRef 로 unmount 여부를 직접 확인해 그 케이스에서 storage 즉시 정리.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // 컴포넌트 언마운트 시 blob URL 정리.
  // Codex P2 5차(2026-04-29): unmount 시점에 attachedImages 에 남아있는 항목은 모두 *전송 안 된 draft* 다
  // (성공 시 setAttachedImages([]) 으로 비워지므로). 업로드 완료된 draft 의 uploadedUrl 도 storage 에서 삭제 →
  // "이미지 첨부 → 업로드 완료 → 패널 닫고 떠남" 같은 정상 사용자 행동에서 발생하던 storage leak 방지.
  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(a => {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
        if (a.uploadedUrl) {
          storageService.deleteImage(a.uploadedUrl).catch(err => {
            console.warn('[댓글 패널 unmount] draft Storage 정리 실패:', err);
          });
        }
      });
    };
  }, []);

  // ── 이미지 업로드 ──
  const uploadAttachedImage = useCallback(async (id: string, file: File | Blob) => {
    try {
      const base64 = await resizeBlob(file, 800, 0.8);
      const result = await storageService.uploadImage(sheetName, sceneId, 'comment', base64);
      if (result.ok && result.url) {
        const url = result.url;
        // Codex P2 8차(2026-04-29): unmount 후 upload 완료 시 React 가 setState drop → orphan.
        if (!mountedRef.current) {
          storageService.deleteImage(url).catch(err => {
            console.warn('[댓글 이미지 unmount race] 정리 실패:', err);
          });
          return;
        }
        // Codex P2 13차(2026-04-30): attachedImagesRef 가 useEffect 로 동기화되어 한 렌더 늦을 수 있어 race —
        // 사용자 X 클릭 직후 ref 가 stale 한 상태에서 도착한 upload 가 stillExists=true 로 인식되면
        // 이후 setAttachedImages.map 이 no-op 이 되어 uploadedUrl 이 어디에도 안 남고 orphan 발생.
        // 해결: setAttachedImages functional updater 안에서 latest prev 로 직접 검사 (React 가 latest state 보장).
        setAttachedImages(prev => {
          const exists = prev.some(a => a.id === id);
          if (!exists) {
            // 사용자 X 클릭으로 이미 제거 → 도착한 upload 객체 정리
            storageService.deleteImage(url).catch(err => {
              console.warn('[댓글 이미지 race] 사용자 제거 후 도착한 업로드 객체 정리 실패:', err);
            });
            return prev;
          }
          return prev.map(a =>
            a.id === id ? { ...a, uploadedUrl: url, uploading: false } : a
          );
        });
      } else {
        throw new Error(result.error || '업로드 실패');
      }
    } catch (err) {
      console.error('[댓글 이미지 업로드 실패]', err);
      if (!mountedRef.current) return;       // unmount 후 setState drop 방지
      const msg = err instanceof Error ? err.message : String(err);
      setAttachedImages(prev => prev.map(a =>
        a.id === id ? { ...a, uploading: false, error: msg } : a
      ));
    }
  }, [sheetName, sceneId]);

  const addAttachedImageFromBlob = useCallback((file: File | Blob) => {
    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    setAttachedImages(prev => [...prev, { id, previewUrl, uploading: true }]);
    void uploadAttachedImage(id, file);
  }, [uploadAttachedImage]);

  const removeAttachedImage = (id: string) => {
    setAttachedImages(prev => {
      const target = prev.find(a => a.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      // Codex P2 4차(2026-04-29): 백그라운드 업로드가 이미 완료된 항목을 사용자가 X 로 제거하면
      // Storage 의 객체도 함께 삭제 (orphan 파일 방지). fire-and-forget — 실패해도 UI 흐름 안 막음.
      if (target?.uploadedUrl) {
        storageService.deleteImage(target.uploadedUrl).catch(err => {
          console.warn('[댓글 첨부 제거] Storage 삭제 실패:', err);
        });
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // 클립보드 paste
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(it => it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(it => {
      const f = it.getAsFile();
      if (f) addAttachedImageFromBlob(f);
    });
  };

  // 드래그 카운터 패턴 — 자식 위 이동 시 깜빡임 방지
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDraggingOver(true);
    }
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDraggingOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(addAttachedImageFromBlob);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(addAttachedImageFromBlob);
    e.target.value = '';
  };

  // ── 전송 ──
  const hasUploadingImage = attachedImages.some(a => a.uploading);
  const uploadedImageUrls = attachedImages.map(a => a.uploadedUrl).filter((u): u is string => !!u);
  const canSubmit = !submitting
    && !hasUploadingImage
    && (input.trim().length > 0 || uploadedImageUrls.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || !currentUser) return;
    setSubmitting(true);

    const mentions = extractMentions(input, users.map(u => u.name));
    const comment: SceneCommentWithSource = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      text: input.trim(),
      mentions,
      images: uploadedImageUrls,
      createdAt: new Date().toISOString(),
      _sourceKey: sceneKey,
    };

    // 낙관적 UI
    const next = [...comments, comment];
    setComments(next);
    onCountChange?.(next.length);

    // Codex P2(2026-04-29): blob URL revoke 와 attachedImages 초기화는 전송 성공 *후* 에 수행.
    // 실패 시 사용자가 같은 페이로드(텍스트 + 첨부)로 재시도할 수 있어야 새 이미지 첨부 흐름의 신뢰성이 보장된다.
    // Codex P1 6차(2026-04-29): ref sync useEffect 가 한 렌더 늦을 수 있어, setState 직후 unmount 가 일어나면
    // unmount cleanup 이 pre-submit 첨부물을 보고 in-flight 댓글의 이미지를 삭제하는 race 발생 가능.
    // setState 와 동시에 ref 도 즉시 동기화하여 cleanup 이 항상 최신 상태(빈 배열) 를 본다.
    const prevInput = input;
    const prevAttached = attachedImages;
    setInput('');
    inputValueRef.current = '';
    setShowMentions(false);
    setAttachedImages([]);
    attachedImagesRef.current = [];

    try {
      await addComment(sceneKey, comment);

      // 성공 — 이전 미리보기 blob URL revoke (메모리 정리)
      prevAttached.forEach(a => {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
      });

      // 슬랙 멘션 웹훅 (기존 로직 보존)
      if (mentions.length > 0 && currentUser.slackId) {
        const parts = sheetName.match(/^EP(\d+)_([A-Z])_/);
        const epLabel = parts ? `EP.${parts[1].padStart(2, '0')}` : sheetName;
        const partLabel = parts ? `${parts[2]}파트` : '';
        for (const mentionedName of mentions) {
          const target = users.find(u => u.name === mentionedName);
          if (target?.slackId && target.slackId !== currentUser.slackId) {
            sendMentionWebhook({
              commentText: comment.text,
              episodeLabel: epLabel,
              sceneId,
              partLabel,
              sheetName,
              authorSlackId: currentUser.slackId,
              targetSlackId: target.slackId,
            });
          }
        }
      }
    } catch (err) {
      console.error('[댓글 추가 실패]', err);

      // Codex P2 9차(2026-04-29): addComment 실패 + panel 이 그 동안 unmount 된 케이스 (slow request 중 close).
      // setState 가 unmounted component 에서 drop 되어 prevAttached 의 uploadedUrl 정리 안 됨 → orphan.
      // mountedRef 체크 후 state 복원 대신 storage 직접 정리.
      if (!mountedRef.current) {
        prevAttached.forEach(a => {
          try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
          if (a.uploadedUrl) {
            storageService.deleteImage(a.uploadedUrl).catch(err2 => {
              console.warn('[댓글 전송 실패 + unmount] storage 정리 실패:', err2);
            });
          }
        });
        return;
      }

      // 롤백 — 댓글 리스트는 항상 복원.
      setComments(comments);
      onCountChange?.(comments.length);

      // Codex P2 4차(2026-04-29): in-flight 동안 사용자가 새 텍스트 *또는* 새 이미지 첨부를 시작했는지
      // 두 ref 로 함께 확인. 둘 중 하나라도 새 작업이 있으면 prev 복원하면 stale draft 와 섞임 → 덮어쓰지 않고
      // prev blob URL 만 revoke 해 leak 방지. 새 작업이 전혀 없을 때만 prev 복원해 단순 재시도.
      const userStartedNew =
        inputValueRef.current.length > 0 || attachedImagesRef.current.length > 0;
      if (userStartedNew) {
        // Codex P2 7차(2026-04-29): 사용자가 새 드래프트 시작했고 prev 를 버리는 분기 →
        // previewUrl 뿐 아니라 *이미 업로드 완료된* uploadedUrl 도 storage 에서 삭제 (orphan 방지).
        prevAttached.forEach(a => {
          try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
          if (a.uploadedUrl) {
            storageService.deleteImage(a.uploadedUrl).catch(err => {
              console.warn('[댓글 전송 실패 롤백] 버려진 업로드 객체 정리 실패:', err);
            });
          }
        });
      } else {
        setInput(prevInput);
        setAttachedImages(prevAttached);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 댓글 수정 (낙관적) — 이미지는 기존 그대로 유지 (수정은 텍스트만).
  // Codex P1(2026-04-29): target.images 가 undefined (Sheets fallback) 면 그대로 undefined 전달 →
  // updateComment 가 supabase update payload 에서 images 컬럼을 제외해 실 이미지 URL 들이 보존된다.
  const handleEdit = async (commentId: string) => {
    if (!editText.trim()) return;
    const target = comments.find((c) => c.id === commentId);
    const targetKey = target?._sourceKey ?? sceneKey;
    const mentions = extractMentions(editText, users.map(u => u.name));
    const existingImages = target?.images;
    const prevComments = [...comments];

    setComments(prev =>
      prev.map(c =>
        c.id === commentId
          ? { ...c, text: editText.trim(), mentions, editedAt: new Date().toISOString() }
          : c
      )
    );
    setEditingId(null);

    try {
      await updateComment(targetKey, commentId, editText.trim(), mentions, existingImages);
    } catch (err) {
      console.error('[댓글 수정 실패]', err);
      setComments(prevComments);
    }
  };

  // 댓글 삭제 (낙관적)
  const handleDelete = async (commentId: string) => {
    const target = comments.find((c) => c.id === commentId);
    const targetKey = target?._sourceKey ?? sceneKey;
    const prevComments = [...comments];
    const next = comments.filter(c => c.id !== commentId);

    setComments(next);
    onCountChange?.(next.length);

    try {
      await deleteComment(targetKey, commentId);
    } catch (err) {
      console.error('[댓글 삭제 실패]', err);
      setComments(prevComments);
      onCountChange?.(prevComments.length);
    }
  };

  // @멘션 입력 추적 (자라기 동작은 useLayoutEffect 가 담당)
  const handleInputChange = (text: string) => {
    setInput(text);
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = text.slice(lastAt + 1);
      if (!afterAt.includes(' ') && afterAt.length < 20) {
        setShowMentions(true);
        setMentionFilter(afterAt.toLowerCase());
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = (userName: string) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(`${before}@${userName} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(mentionFilter)
  );

  // v1.18.0: re만 필터 — 토글 켜져 있으면 revisionId 있는 댓글만 노출.
  const visibleComments = useMemo(
    () => (reOnly ? comments.filter((c) => !!c.revisionId) : comments),
    [comments, reOnly],
  );

  const handleMentionClick = (userName: string) => {
    setHighlightUserName(userName);
    setView('team');
  };

  const renderMentionInSegment = (segment: string, baseIdx: number) => {
    const parts = segment.split(/(@\S+)/g);
    return parts.map((part, i) => {
      const key = `${baseIdx}-${i}`;
      if (part.startsWith('@')) {
        const name = part.slice(1);
        const isUser = users.some(u => u.name === name);
        if (isUser) {
          return (
            <span
              key={key}
              className="text-accent font-bold bg-accent/10 rounded px-0.5 cursor-pointer hover:bg-accent/20 transition-colors"
              onClick={() => handleMentionClick(name)}
              title={`${name} 팀원 보기`}
            >
              {part}
            </span>
          );
        }
      }
      return <span key={key}>{part}</span>;
    });
  };

  const renderText = (text: string) => (
    <PathLinkifiedText text={text} renderTextSegment={renderMentionInSegment} />
  );

  // ─── 렌더링 ────────────────────────────────

  return (
    <div
      ref={panelRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-full relative"
    >
      {/* v1.18.0: 상단 미니 툴바 — "re만" 필터 토글 (한솔 결정 spec 2026-05-03).
          댓글 패널에서 리비전 맥락 댓글만 빠르게 골라보기 위함. */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-end shrink-0">
        <button
          type="button"
          onClick={() => setReOnly((v) => !v)}
          title={reOnly ? '리비전 댓글만 표시중 — 클릭해 전체 보기' : '리비전 댓글만 보기'}
          className={cn(
            'text-[10px] px-2 py-1 rounded transition-colors cursor-pointer font-bold',
            reOnly
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50',
          )}
        >
          re만
        </button>
      </div>

      {/* 댓글 목록 — 시스템 이벤트(inlineEvents)와 시간순 머지 + 새 항목 슬라이드 인 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0 select-text">
        {/* 코덱스 P3 fix (9차, 2026-05-05): reOnly 시 inlineEvents 는 어차피 mergeFeed 에서 drop 되므로
            empty-state 판정에서도 inlineEvents 무시 → 리비전 댓글 0 + inline 만 있을 때 빈 영역 방지. */}
        {visibleComments.length === 0 && (reOnly || !inlineEvents || inlineEvents.length === 0) ? (
          <div className="text-center py-10">
            <p className="text-text-secondary text-xs">
              {reOnly ? '리비전 댓글이 없습니다' : '아직 의견이 없습니다'}
            </p>
            <p className="text-text-secondary/40 text-[11px] mt-1">
              {reOnly ? '"re만" 토글을 끄면 일반 댓글이 보입니다' : '첫 의견을 남겨보세요'}
            </p>
          </div>
        ) : (
        <AnimatePresence initial={false}>
          {mergeFeed(visibleComments, reOnly ? [] : (inlineEvents ?? [])).map((node) => {
            if (node.kind === 'event') {
              return (
                <motion.div
                  key={`evt:${node.event.id}`}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-2 text-[10.5px] text-text-secondary/55 py-0.5"
                >
                  <span className="inline-block w-1 h-1 rounded-full bg-text-secondary/40" aria-hidden />
                  <span className="flex-1 truncate">{node.event.text}</span>
                  <span className="tabular-nums shrink-0">{formatTimeShort(node.event.at)}</span>
                </motion.div>
              );
            }
            const comment = node.comment;
            const isOwn = currentUser?.id === comment.userId;
            const isEditing = editingId === comment.id;
            const hasImages = (comment.images?.length ?? 0) > 0;
            // 멘션 강조 — @나 가 mentions 에 들어있으면 좌측 4px accent 스트라이프 (한솔 결정 2026-05-02)
            const mentionsMe = !!currentUser && (comment.mentions ?? []).includes(currentUser.name);
            return (
              <motion.div
                key={comment.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={cn('group relative', mentionsMe && 'pl-2')}
                style={mentionsMe ? { borderLeft: '4px solid rgb(var(--color-accent))', borderRadius: 4 } : undefined}
              >
                {/* 메타 */}
                <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  {isOwn ? (
                    <>
                      <span className="text-[11px] text-text-secondary/50">
                        {formatTimeShort(comment.createdAt)}
                      </span>
                      <span className="text-xs font-semibold text-text-primary">
                        {comment.userName}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-semibold text-text-primary">
                        {comment.userName}
                      </span>
                      <span className="text-[11px] text-text-secondary/50">
                        {formatTimeShort(comment.createdAt)}
                      </span>
                    </>
                  )}
                  {/* v1.18.0: 리비전 맥락 댓글은 [re#] 칩 → 클릭 시 모달이 리비전 탭/카드로 점프 */}
                  {comment.revisionId && (
                    <RevisionCommentBadge
                      revisionId={comment.revisionId}
                      onJump={(revId) => {
                        window.dispatchEvent(new CustomEvent('bflow:jump-to-revision', { detail: { revisionId: revId } }));
                      }}
                    />
                  )}
                  {comment.editedAt && (
                    <span className="text-[11px] text-text-secondary/30 italic">수정됨</span>
                  )}
                </div>

                {/* 말풍선 */}
                <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] relative group/bubble">
                    {isEditing ? (
                      <div>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary resize-none focus:outline-none focus:border-accent min-w-[200px]"
                          rows={2}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleEdit(comment.id);
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div className="flex gap-2 mt-1 justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 text-[11px] text-text-secondary border border-bg-border rounded-md hover:bg-bg-border/50 transition-colors cursor-pointer"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => handleEdit(comment.id)}
                            className="px-2.5 py-1 text-[11px] text-white bg-accent rounded-md hover:bg-accent/80 transition-colors cursor-pointer"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed break-words text-text-primary ${
                          isOwn ? 'bg-accent/20 border border-accent/30' : 'bg-bg-border/70'
                        }`}
                      >
                        {comment.text && <div>{renderText(comment.text)}</div>}
                        {hasImages && (
                          <div
                            className={`grid gap-1 ${comment.text ? 'mt-2' : ''} ${
                              comment.images!.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                            }`}
                          >
                            {comment.images!.map((url, i) => (
                              <img
                                key={i}
                                src={url}
                                alt=""
                                className="rounded-md w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                style={{ maxHeight: 160 }}
                                onClick={() => setLightboxUrl(url)}
                                loading="lazy"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 수정/삭제 (자기 댓글만) */}
                    {isOwn && !isEditing && (
                      <div className="absolute top-0 -left-14 flex gap-0.5 opacity-0 group-hover/bubble:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingId(comment.id); setEditText(comment.text); }}
                          className="p-1 rounded hover:bg-bg-border/50 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                          title="수정"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(comment.id)}
                          className="p-1 rounded hover:bg-status-none/20 text-text-secondary hover:text-status-none transition-colors cursor-pointer"
                          title="삭제"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        )}
      </div>

      {/* 입력 영역 — 떠있는 카드 (위 댓글 영역과 시각적 분리)
          v1.23.2 (#3): shrink-0 명시 — 부모 column flex 안에서 압축 안 되도록 하되,
          반대로 자식 카드의 maxHeight cap (inputCardMaxPx) 으로 wrapper 가 넘쳐 grow 하는 것도 방지. */}
      <div className="px-3 pb-3 pt-3 relative shrink-0">
        {/* @멘션 자동완성 */}
        {showMentions && filteredUsers.length > 0 && (
          <div ref={mentionDropdownRef} className="absolute bottom-full left-3 right-3 mb-1 bg-bg-card border border-bg-border rounded-lg shadow-lg max-h-32 overflow-y-auto z-30">
            {filteredUsers.map((user, i) => (
              <button
                key={user.id}
                onClick={() => insertMention(user.name)}
                className={`w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
                  i === mentionIndex ? 'bg-accent/15' : 'hover:bg-accent/10'
                }`}
              >
                <span className="text-accent text-[11px]">@</span>
                <span>{user.name}</span>
              </button>
            ))}
          </div>
        )}

        <div
          onPaste={handlePaste}
          className={`comment-input-card rounded-xl border px-2.5 pt-2 pb-1.5 ${focused && !draggingOver ? 'focused' : ''} ${draggingOver ? 'dragover' : ''}`}
          style={{
            background: 'rgb(var(--comment-card-elev-rgb))',
            // 한솔 피드백(2026-05-02): focus 시 accent-sub(보라)가 박혀서 "보라색 고정"으로 보임 → 중립 흰색 알파로 변경
            borderColor: draggingOver
              ? 'rgb(var(--color-accent))'
              : (focused ? 'rgba(255,255,255,0.16)' : 'rgb(var(--color-bg-border))'),
            maxHeight: inputCardMaxPx,
          }}
        >
          {/* 이미지 썸네일 줄 */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1" style={{ height: 76 }}>
              {attachedImages.map(img => (
                <div key={img.id} className="relative flex-shrink-0">
                  <img
                    src={img.previewUrl}
                    className="w-16 h-16 object-cover rounded-lg border border-bg-border"
                    alt=""
                  />
                  {img.uploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  {img.error && (
                    <div className="absolute inset-0 bg-red-500/40 rounded-lg flex items-center justify-center" title={`업로드 실패: ${img.error}`}>
                      <X size={20} className="text-white" />
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachedImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
                    style={{ border: '2px solid rgb(var(--comment-card-elev-rgb))' }}
                    title="제거"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* textarea — 풀 너비 */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="댓글 입력... (Ctrl+V / 드래그로 이미지)"
            rows={1}
            className="comment-input-textarea block w-full px-2 py-1.5 text-xs resize-none outline-none bg-transparent leading-relaxed text-text-primary placeholder:text-text-secondary/40 overflow-y-auto"
            style={{ height: taHeight, maxHeight: taMaxPx, boxSizing: 'border-box' }}
            onKeyDown={(e) => {
              // @멘션 키보드 탐색
              if (showMentions && filteredUsers.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  insertMention(filteredUsers[mentionIndex].name);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowMentions(false);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleFileChange}
          />
          {/* 하단 toolbar — 좌측 첨부, 우측 전송 (cowork 스타일) */}
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-bg-border/40">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-card hover:text-text-primary transition-colors cursor-pointer"
              title="이미지 첨부"
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-7 h-7 rounded-md flex items-center justify-center bg-accent hover:bg-accent-sub text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={hasUploadingImage ? '이미지 업로드 중...' : '전송 (Enter)'}
            >
              {submitting ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ArrowUp size={14} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 드래그 오버레이 */}
      {draggingOver && (
        <div className="comment-drop-overlay">
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <div className="comment-drop-icon text-accent">
              <ImagePlus size={48} strokeWidth={1.6} />
            </div>
            <div className="text-sm font-semibold text-accent-sub">
              이미지를 여기에 놓으세요
            </div>
            <div className="text-[11px] text-text-secondary">
              여러 장을 한 번에 첨부할 수 있어요
            </div>
          </div>
        </div>
      )}

      {/* 라이트박스 (이미지 클릭 시 확대) */}
      {lightboxUrl && (
        <div
          className="comment-lightbox-backdrop cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={lightboxUrl}
            alt=""
            className="comment-lightbox-image cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
            title="닫기 (ESC)"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 시스템 이벤트 + 댓글 시간순 머지 ─────────────────

type FeedNode =
  | { kind: 'comment'; comment: SceneCommentWithSource }
  | { kind: 'event'; event: CommentInlineEvent };

/** 댓글과 시스템 이벤트를 createdAt 시간순으로 합쳐 단일 피드 노드 배열로 변환. */
function mergeFeed(
  comments: SceneCommentWithSource[],
  events: CommentInlineEvent[],
): FeedNode[] {
  const nodes: FeedNode[] = [
    ...comments.map<FeedNode>((c) => ({ kind: 'comment', comment: c })),
    ...events.map<FeedNode>((e) => ({ kind: 'event', event: e })),
  ];
  nodes.sort((a, b) => {
    const ta = a.kind === 'comment' ? a.comment.createdAt : a.event.at;
    const tb = b.kind === 'comment' ? b.comment.createdAt : b.event.at;
    return new Date(ta).getTime() - new Date(tb).getTime();
  });
  return nodes;
}
