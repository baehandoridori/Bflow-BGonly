import { useState, useRef, useEffect } from 'react';
import { User, LogOut, KeyRound, AlertTriangle } from 'lucide-react';
import { logout } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

export function UserMenu() {
  const { currentUser, setCurrentUser, setShowPasswordChange } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setOpen(false);
  };

  const isInitial = currentUser?.isInitialPassword;

  if (!currentUser) {
    return (
      <span className="text-xs text-text-secondary/60 italic">비로그인 상태</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-bg-border/50 transition-colors text-sm text-text-primary"
      >
        <User size={14} />
        <span>{currentUser.name}</span>
        {isInitial && <AlertTriangle size={12} className="text-status-mid" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-bg-card border border-bg-border rounded-xl shadow-2xl overflow-hidden z-[100]">
          {/* 사용자 정보 */}
          <div className="px-3 py-2.5 border-b border-bg-border">
            <p className="text-sm text-text-primary font-medium">{currentUser.name}</p>
            {currentUser.slackId && (
              <p className="text-xs text-text-secondary">{currentUser.slackId}</p>
            )}
            {isInitial && (
              <p className="text-xs text-status-mid mt-1 flex items-center gap-1">
                <AlertTriangle size={10} /> 초기비밀번호 사용 중 — 변경 권장
              </p>
            )}
          </div>

          {/* 메뉴 항목 */}
          <button
            onClick={() => { setShowPasswordChange(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-border/50 transition-colors"
          >
            <KeyRound size={14} /> 비밀번호 변경
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-status-none hover:bg-bg-border/50 transition-colors"
          >
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
