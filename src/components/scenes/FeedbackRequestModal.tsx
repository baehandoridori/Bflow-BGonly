/**
 * v1.25.0~ — 피드백 대기 확인 모달.
 *
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 5)
 * mockup: docs/mockups/2026-05-11-feedback-confirm-modal.html
 *
 * 흐름:
 *  - 사용자가 "피드백 대기" 칩 클릭 → 이 모달이 떠야 상태가 바뀜 (잘못 클릭 방지)
 *  - 액팅 검수자 풀 멤버 전원이 기본 체크 (자기 자신 제외)
 *  - 추가 멘션은 비어있음, "+ 다른 팀원 검색" 으로만 추가
 *  - 푸터 3 버튼: 취소 / 알림 없이 상태만 변경 / 알림 보내기 (N명)
 */

import { Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AppUser, Scene } from '@/types';
import { cn } from '@/utils/cn';

export interface FeedbackRequestModalProps {
  /** 모달 표시 여부 */
  open: boolean;
  /** 대상 씬 */
  scene: Scene;
  /** 에피소드 라벨 (헤더 표시용, 예: "EP01") */
  episodeLabel?: string;
  /** 진입 후 표시될 차수 (피드백 대기 N차). 부모가 전이 규칙 적용해 계산해 전달 */
  targetRound: number;
  /** 이전 상태 라벨 (예: "작업중 2차"). 헤더의 ← → 표시용 */
  fromLabel: string;
  /** 모달 닫기 (취소 또는 X) */
  onCancel: () => void;
  /** 확인 — 알림 보내기. 선택된 수신자 user ID 배열을 전달 */
  onSendWithNotification: (recipientIds: string[]) => void;
  /** 확인 — 알림 없이 상태만 변경 */
  onSilentChange: () => void;
}

export function FeedbackRequestModal({
  open,
  scene,
  episodeLabel,
  targetRound,
  fromLabel,
  onCancel,
  onSendWithNotification,
  onSilentChange,
}: FeedbackRequestModalProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);

  // 기본 수퍼바이저 풀 — currentUser 자기 자신 제외
  const supervisors = useMemo(
    () =>
      allUsers
        .filter((u) => u.isActingSupervisor === true && u.id !== currentUser?.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [allUsers, currentUser?.id],
  );

  // 추가 멘션 (검색으로 추가된 사용자) — open 될 때마다 리셋
  const [additional, setAdditional] = useState<AppUser[]>([]);
  // 모달 안에서 체크된 수신자 ID set — open 될 때마다 supervisors 전원 + additional 전원
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // 검색 인풋 표시 여부
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 모달 열릴 때마다 초기화
  useEffect(() => {
    if (!open) return;
    setAdditional([]);
    setCheckedIds(new Set(supervisors.map((u) => u.id)));
    setSearchOpen(false);
    setSearchQuery('');
  }, [open, supervisors]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // 검색 열릴 때 자동 포커스
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  if (!open) return null;

  function toggleCheck(userId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function removeAdditional(userId: string) {
    setAdditional((prev) => prev.filter((u) => u.id !== userId));
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }

  // 검색 결과 — 자기 자신, 이미 수퍼바이저로 있거나 이미 추가된 사람은 제외
  const supervisorIds = new Set(supervisors.map((u) => u.id));
  const additionalIds = new Set(additional.map((u) => u.id));
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return allUsers
      .filter(
        (u) =>
          u.id !== currentUser?.id &&
          !supervisorIds.has(u.id) &&
          !additionalIds.has(u.id) &&
          u.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, allUsers, currentUser?.id, supervisors, additional]);

  function addUser(user: AppUser) {
    setAdditional((prev) => [...prev, user]);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.add(user.id);
      return next;
    });
    setSearchQuery('');
    setSearchOpen(false);
  }

  const checkedCount = checkedIds.size;

  // backdrop 클릭 닫기
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-request-title"
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-bg-border bg-bg-card shadow-2xl flex flex-col max-h-[90vh]"
        style={{
          background: 'linear-gradient(180deg, #1E2030 0%, #181A26 100%)',
        }}
      >
        {/* 헤더 */}
        <div className="px-6 pt-5 pb-4 border-b border-bg-border/70 flex items-start justify-between">
          <div>
            <h2 id="feedback-request-title" className="text-[14px] font-bold text-text-primary">
              피드백 대기로 보내기
            </h2>
            <p className="text-[11px] text-text-secondary/70 mt-1">
              선택된 검수자에게 알림이 발송됩니다.
            </p>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onCancel}
            className="text-text-secondary/70 hover:text-text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 씬 정보 */}
        <div className="px-6 pt-4 pb-3 border-b border-bg-border/40">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-text-secondary/70 mb-1">
            {episodeLabel ? `${episodeLabel} · 액팅` : '액팅'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-text-primary">{scene.sceneId}</span>
            {scene.assignee && (
              <span className="text-[11px] text-text-secondary/70">담당 · {scene.assignee}</span>
            )}
          </div>
          <div className="mt-2.5 flex items-center text-[11px]">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#74B9FF', color: '#0F1117' }}
            >
              {fromLabel}
            </span>
            <span className="mx-2 text-text-secondary/60">→</span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#FDCB6E', color: '#0F1117' }}
            >
              피드백 대기 {targetRound}차
            </span>
          </div>
        </div>

        {/* 수신자 — 액팅 수퍼바이저 */}
        <div className="px-6 pt-4 pb-1 overflow-y-auto flex-1">
          <div className="text-[10.5px] uppercase tracking-wider font-bold text-text-secondary/70 mb-2">
            알림 받을 사람 ({checkedCount}명 선택됨)
          </div>

          {supervisors.length === 0 ? (
            <div className="text-[11.5px] text-text-secondary/60 px-2 py-3 text-center bg-bg-primary/30 rounded-lg">
              등록된 액팅 검수자가 없습니다. 설정 &gt; 사용자 관리에서 추가하세요.
            </div>
          ) : (
            <div className="space-y-1">
              {supervisors.map((u) => {
                const checked = checkedIds.has(u.id);
                return (
                  <RecipientRow
                    key={u.id}
                    user={u}
                    roleLabel="액팅 검수자"
                    roleColor="#FDCB6E"
                    checked={checked}
                    onToggle={() => toggleCheck(u.id)}
                  />
                );
              })}
            </div>
          )}

          {/* 추가 멘션 */}
          {(additional.length > 0 || searchOpen) && (
            <div className="my-3 relative">
              <div className="border-t border-dashed border-bg-border/70" />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-bg-card px-2 text-[10px] uppercase tracking-wider font-bold text-text-secondary/60">
                추가 멘션
              </span>
            </div>
          )}

          {additional.length > 0 && (
            <div className="space-y-1">
              {additional.map((u) => {
                const checked = checkedIds.has(u.id);
                return (
                  <RecipientRow
                    key={u.id}
                    user={u}
                    checked={checked}
                    onToggle={() => toggleCheck(u.id)}
                    onRemove={() => removeAdditional(u.id)}
                  />
                );
              })}
            </div>
          )}

          {/* 검색 */}
          {searchOpen ? (
            <div className="mt-2">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/60" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름으로 검색"
                  className="w-full pl-7 pr-2 py-1.5 text-[12px] rounded-md bg-bg-primary/50 border border-bg-border focus:outline-none focus:border-accent text-text-primary"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="mt-1 space-y-0.5 bg-bg-primary/40 rounded-md p-1 border border-bg-border/50">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addUser(u)}
                      className="w-full text-left px-2 py-1.5 text-[12px] hover:bg-accent/15 rounded transition-colors flex items-center gap-2"
                    >
                      <Avatar name={u.name} />
                      <span>{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery.trim() && searchResults.length === 0 && (
                <div className="mt-1 text-[11px] text-text-secondary/60 px-2 py-1.5">
                  일치하는 사용자가 없습니다.
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="mt-2 text-[11.5px] text-accent hover:underline inline-flex items-center gap-1"
            >
              <Plus size={11} />
              다른 팀원 검색해서 추가
            </button>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3.5 mt-2 border-t border-bg-border/70 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-[12px] font-bold rounded-md text-text-secondary/80 hover:text-text-primary hover:bg-bg-primary/40 transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSilentChange}
            className="px-3 py-2 text-[12px] font-bold rounded-md bg-bg-primary/50 border border-bg-border hover:bg-bg-primary/70 text-text-primary transition-colors"
          >
            알림 없이 상태만 변경
          </button>
          <button
            type="button"
            onClick={() => onSendWithNotification(Array.from(checkedIds))}
            disabled={checkedCount === 0}
            className={cn(
              'px-3 py-2 text-[12px] font-bold rounded-md text-white transition-opacity',
              checkedCount === 0
                ? 'bg-bg-border/40 text-text-secondary/60 cursor-not-allowed'
                : 'bg-accent hover:opacity-90',
            )}
          >
            알림 보내기 ({checkedCount}명)
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

interface RecipientRowProps {
  user: AppUser;
  roleLabel?: string;
  roleColor?: string;
  checked: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}

function RecipientRow({ user, roleLabel, roleColor, checked, onToggle, onRemove }: RecipientRowProps) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer select-none transition-colors',
        checked
          ? 'bg-accent/10 border-accent/35'
          : 'bg-bg-primary/30 border-bg-border/40 hover:bg-bg-primary/50',
      )}
    >
      <div
        className={cn(
          'w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold',
          checked ? 'bg-accent border-accent text-white' : 'border-bg-border bg-bg-primary/40 text-transparent',
        )}
      >
        ✓
      </div>
      <Avatar name={user.name} isSupervisor={!!roleLabel} />
      <span className="flex-1 text-[12.5px] font-semibold text-text-primary truncate">
        {user.name}
      </span>
      {roleLabel && (
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${roleColor}20`, color: roleColor }}
        >
          {roleLabel}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="제거"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-text-secondary/60 hover:text-text-primary"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Avatar({ name, isSupervisor }: { name: string; isSupervisor?: boolean }) {
  const initial = name.charAt(0);
  return (
    <span
      className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10.5px] font-bold flex-shrink-0"
      style={
        isSupervisor
          ? { background: 'linear-gradient(135deg, #FDCB6E 0%, #E17055 100%)', color: '#0F1117' }
          : { background: 'linear-gradient(135deg, #4C5566 0%, #2D3041 100%)', color: '#fff' }
      }
    >
      {initial}
    </span>
  );
}
