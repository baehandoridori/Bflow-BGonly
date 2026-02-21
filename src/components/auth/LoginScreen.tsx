import { useState, useCallback } from 'react';
import { LogIn } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

export function LoginScreen() {
  const { setCurrentUser } = useAuthStore();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!password) { setError('비밀번호를 입력해주세요.'); return; }

    setLoading(true);
    setError('');
    const result = await login(name.trim(), password);
    setLoading(false);

    if (result.ok && result.user) {
      setCurrentUser(result.user);
    } else {
      setError(result.error ?? '로그인에 실패했습니다.');
    }
  }, [name, password, setCurrentUser]);

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-bg-primary">
      <form
        onSubmit={handleSubmit}
        className="w-80 bg-bg-card border border-bg-border rounded-2xl p-8 flex flex-col gap-5 shadow-2xl"
      >
        {/* 타이틀 */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-text-primary">BG 진행 현황판</h1>
          <p className="text-sm text-text-secondary mt-1">로그인</p>
        </div>

        {/* 이름 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-text-secondary">이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="사용자 이름"
            autoFocus
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* 비밀번호 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-text-secondary">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 입력"
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
          />
          <p className="text-xs text-text-secondary/60">최초 비밀번호는 1234 입니다</p>
        </div>

        {/* 에러 */}
        {error && (
          <p className="text-xs text-status-none text-center">{error}</p>
        )}

        {/* 로그인 버튼 */}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-accent text-white text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          <LogIn size={16} />
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
