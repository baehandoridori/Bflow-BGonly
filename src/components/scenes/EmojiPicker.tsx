/**
 * v1.26.0 — 댓글 이모지 피커.
 *
 * 기본 노출: 빠른 7개 (✅ 👍 ❤️ 👀 🎉 🙏 🔥)
 * "더 많은 이모지" 누르면 70여 개로 확장.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const QUICK_EMOJIS = ['✅', '👍', '❤️', '👀', '🎉', '🙏', '🔥'] as const;

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

  const list = showAll ? [...QUICK_EMOJIS, ...EXTRA_EMOJIS] : [...QUICK_EMOJIS];

  // v1.26.1: Portal + anchor 기준 위치 계산 — 댓글 패널 overflow 에 잘리지 않게.
  const width = showAll ? 280 : 220;
  const height = showAll ? 320 : 80;
  let top = 0;
  let left = 0;
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[10001] bg-bg-card border border-bg-border rounded-xl p-2 shadow-2xl"
      style={{ width, top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-7 gap-1">
        {list.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
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
        ))}
      </div>
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
