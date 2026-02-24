import { useState, useCallback } from 'react';
import { X, Check } from 'lucide-react';
import { changePassword, loadUsers } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

export function PasswordChangeModal() {
  const { currentUser, setCurrentUser, setShowPasswordChange, setUsers } = useAuthStore();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordsMatch = newPw.length > 0 && newPw === confirmPw;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!currentPw) { setError('현재 비밀번호를 입력해주세요.'); return; }
    if (!newPw) { setError('새 비밀번호를 입력해주세요.'); return; }
    if (newPw !== confirmPw) { setError('비밀번호가 일치하지 않습니다.'); return; }
    if (newPw === currentPw) { setError('현재 비밀번호와 같습니다.'); return; }

    setLoading(true);
    setError('');
    const result = await changePassword(currentUser.id, currentPw, newPw);
    setLoading(false);

    if (result.ok) {
      // 로컬 유저 정보 갱신
      setCurrentUser({ ...currentUser, password: newPw, isInitialPassword: false });
      const updated = await loadUsers();
      setUsers(updated);
      setShowPasswordChange(false);
    } else {
      setError(result.error ?? '변경에 실패했습니다.');
    }
  }, [currentUser, currentPw, newPw, confirmPw, setCurrentUser, setUsers, setShowPasswordChange]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60">
      <form
        onSubmit={handleSubmit}
        className="w-80 bg-bg-card border border-bg-border rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">비밀번호 변경</h2>
          <button
            type="button"
            onClick={() => setShowPasswordChange(false)}
            className="p-1 rounded hover:bg-bg-border/50 text-text-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {/* 현재 비밀번호 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">현재 비밀번호</label>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoFocus
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* 새 비밀번호 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">새 비밀번호</label>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* 비밀번호 확인 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">비밀번호 확인</label>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
          {passwordsMatch && (
            <span className="flex items-center gap-1 text-xs text-status-high mt-0.5">
              <Check size={12} /> 비밀번호 일치
            </span>
          )}
          {confirmPw.length > 0 && !passwordsMatch && (
            <span className="text-xs text-status-none mt-0.5">
              비밀번호가 일치하지 않습니다
            </span>
          )}
        </div>

        {error && (
          <p className="text-xs text-status-none text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !passwordsMatch}
          className="bg-accent text-on-accent text-sm font-medium rounded-lg px-4 py-2 hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? '변경 중...' : '변경'}
        </button>
      </form>
    </div>
  );
}
