/**
 * v1.26.0 — 댓글 이모지 피커.
 *
 * 기본 노출: 빠른 7개 (✅ 👍 ❤️ 👀 🎉 🙏 🔥)
 * "더 많은 이모지" 누르면 70여 개로 확장.
 *
 * 움직임 폴리싱 19번(comments-send-react): 스마일 버튼 쪽에서 피어나고(0.92배 → 제자리, 140ms),
 * '더 많은 이모지'는 버튼 쪽 가장자리를 붙인 채 반대쪽으로만 펼쳐진다(위로 열렸으면 아래 가장자리 고정 → 위로).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { emojiPickerPlacement } from '@/utils/commentSendReact';

export const QUICK_EMOJIS = ['✅', '👍', '❤️', '👀', '🎉', '🙏', '🔥'] as const;

/** 창 너비 — 빠른 7개 / '더 많은 이모지'로 펼친 뒤. */
const COLLAPSED_WIDTH = 220;
const EXPANDED_WIDTH = 280;

// 확장 이모지 — 핵심 + 추가 카테고리. v1.27 에서 emoji-mart 등 라이브러리 도입 검토.
const EXTRA_EMOJIS = [
  '😀', '😂', '🤔', '😅', '😭', '😎', '🤝', '👏',
  '🤗', '🙌', '💯', '✨', '⭐', '💡', '⚠️', '❌',
  '❓', '❗', '🚀', '⏳', '🆗', '🎨', '📝', '📌',
  '📎', '💬', '🔖', '🔔', '☑️', '✏️', '🖍️', '🎯',
  '⚡', '🔧', '🔨', '🏆', '🎪', '🎬', '🎭', '🎨',
  '🌟', '🌈', '☀️', '🌙', '🍀', '🌹', '☕', '🍵',
  '🎁', '🎀', '💌', '💝', '💖', '💕', '😊', '😇',
  '🤣', '😉', '😋', '😘', '🥰', '🤩', '🤓', '😐',
];

interface EmojiPickerProps {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** 피커 위치 기준 anchor (피커가 anchor 근처에서 열림) */
  anchorEl: HTMLElement | null;
}

export function EmojiPicker({ open, onPick, onClose, anchorEl }: EmojiPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setShowAll(false);
      return;
    }
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorEl?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorEl]);

  if (!open) return null;

  // v1.26.1: Portal + anchor 기준 위치 계산 — 댓글 패널 overflow 에 잘리지 않게.
  // 위·아래는 접힌 높이로 한 번 정하고 버튼 쪽 가장자리를 고정한다 — 펼쳐도 반대쪽으로 튀지 않는다.
  // 가로도 펼친 너비(280) 기준으로 처음부터 자리를 잡는다 — 오른쪽 끝 가까이서 펼쳐도 왼쪽으로 튀지 않는다.
  const width = showAll ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const rect = anchorEl?.getBoundingClientRect() ?? null;
  const placement = emojiPickerPlacement({
    anchor: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } : null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    width,
    expandedWidth: EXPANDED_WIDTH,
  });

  return createPortal(
    <div
      ref={ref}
      className="emoji-picker-pop fixed z-[10001] bg-bg-card border border-bg-border rounded-xl p-2 shadow-2xl overflow-y-auto"
      style={{
        width,
        left: placement.left,
        ...(placement.side === 'above' ? { bottom: placement.bottom } : { top: placement.top }),
        maxHeight: placement.maxHeight,
        transformOrigin: `${placement.originX}px ${placement.side === 'above' ? '100%' : '0%'}`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-7 gap-1">
        {QUICK_EMOJIS.map((emoji, i) => (
          <EmojiButton key={`${emoji}-${i}`} emoji={emoji} onPick={onPick} onClose={onClose} />
        ))}
      </div>
      {/* 펼친 이모지는 한 덩어리로 옅게 들어온다(빠른 7개는 제자리). */}
      {showAll && (
        <div className="emoji-picker-extra mt-1 grid grid-cols-7 gap-1">
          {EXTRA_EMOJIS.map((emoji, i) => (
            <EmojiButton key={`${emoji}-${i}`} emoji={emoji} onPick={onPick} onClose={onClose} />
          ))}
        </div>
      )}
      {!showAll && (
        <button
          type="button"
          className="w-full mt-1.5 pt-1.5 border-t border-bg-border text-[11px] text-text-secondary hover:text-accent-sub"
          onClick={() => setShowAll(true)}
        >
          + 더 많은 이모지
        </button>
      )}
    </div>,
    document.body,
  );
}

function EmojiButton({ emoji, onPick, onClose }: { emoji: string; onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <button
      type="button"
      className="w-7 h-7 hover:bg-bg-border/60 rounded text-lg leading-none flex items-center justify-center"
      onClick={() => {
        onPick(emoji);
        onClose();
      }}
      aria-label={`${emoji} 추가`}
    >
      {emoji}
    </button>
  );
}
