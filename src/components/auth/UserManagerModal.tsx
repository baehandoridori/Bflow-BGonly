import { useState, useCallback } from 'react';
import { X, UserPlus, Trash2 } from 'lucide-react';
import { addUser, deleteUser, loadUsers } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

/** 날짜 문자열을 YYYY.MM.DD 형식으로 변환 */
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr.replace(/-/g, '.');
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
}

/** 생일 문자열을 MM.DD 형식으로 변환 (MM-DD, raw Date 등 대응) */
function formatBirthday(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    // MM-DD 형식
    if (/^\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr.replace(/-/g, '.');
    }
    // YYYY-MM-DD 형식 → MM.DD만 추출
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr.slice(5).replace(/-/g, '.');
    }
    // raw Date 문자열 (Tue Feb 03 2026 ... 등)
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
}

export function UserManagerModal() {
  const { users, setUsers, setShowUserManager } = useAuthStore();
  const [name, setName] = useState('');
  const [slackId, setSlackId] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [birthday, setBirthday] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (users.some((u) => u.name === name.trim())) {
      setError('이미 존재하는 이름입니다.');
      return;
    }
    setError('');
    setLoading(true);

    // 낙관적: 즉시 UI에 추가
    const tempId = `temp-${Date.now()}`;
    const tempUser = { id: tempId, name: name.trim(), role: 'user' as const, slackId: slackId.trim(), password: '', createdAt: new Date().toISOString(), hireDate: hireDate.trim() || undefined, birthday: birthday.trim() || undefined, isInitialPassword: true };
    const prevUsers = [...users];
    setUsers([...users, tempUser]);
    setName('');
    setSlackId('');
    setHireDate('');
    setBirthday('');

    try {
      await addUser(tempUser.name, tempUser.slackId, tempUser.hireDate, tempUser.birthday);
      const updated = await loadUsers();
      setUsers(updated);
    } catch (err) {
      setUsers(prevUsers); // 롤백
      setError(`추가 실패: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [name, slackId, hireDate, birthday, users, setUsers]);

  const handleDelete = useCallback(async (userId: string) => {
    setDeletingId(userId);

    // 낙관적: 즉시 UI에서 제거
    const prevUsers = [...users];
    setUsers(users.filter((u) => u.id !== userId));

    try {
      await deleteUser(userId);
      const updated = await loadUsers();
      setUsers(updated);
    } catch (err) {
      setUsers(prevUsers); // 롤백
      setError(`삭제 실패: ${err}`);
    } finally {
      setDeletingId(null);
    }
  }, [users, setUsers]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60">
      <div className="w-[480px] max-h-[80vh] bg-bg-card border border-bg-border rounded-2xl p-6 flex flex-col gap-4 shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">사용자 관리 (관리자)</h2>
          <button
            onClick={() => setShowUserManager(false)}
            className="p-1 rounded hover:bg-bg-border/50 text-text-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {/* 사용자 추가 폼 */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              value={slackId}
              onChange={(e) => setSlackId(e.target.value)}
              placeholder="Slack ID"
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              placeholder="입사일"
              title="입사일"
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              placeholder="생일 (MM-DD)"
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleAdd}
              disabled={loading}
              className="flex items-center gap-1 bg-accent text-on-accent text-xs rounded-lg px-3 py-1.5 hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  추가 중...
                </>
              ) : (
                <><UserPlus size={14} /> 추가</>
              )}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-status-none">{error}</p>}

        {/* 사용자 목록 */}
        <div className="flex-1 overflow-auto flex flex-col gap-1">
          {users.length === 0 && (
            <p className="text-sm text-text-secondary text-center py-4">등록된 사용자가 없습니다.</p>
          )}
          {users.map((u, idx) => (
            <div
              key={u.id || `user-${idx}`}
              className="flex items-center justify-between bg-bg-primary rounded-lg px-3 py-2 border border-bg-border"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary font-medium">{u.name}</span>
                  {u.role === 'admin' && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent leading-none">관리자</span>
                  )}
                  {u.isInitialPassword && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500 leading-none">초기비밀번호</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  {u.slackId && <span>{u.slackId}</span>}
                  {u.hireDate && <span>입사 {formatDate(u.hireDate)}</span>}
                  {u.birthday && <span>생일 {formatBirthday(u.birthday)}</span>}
                  {!u.slackId && !u.hireDate && !u.birthday && <span>—</span>}
                </div>
              </div>
              <button
                onClick={() => handleDelete(u.id)}
                disabled={deletingId === u.id}
                className="p-1.5 rounded hover:bg-status-none/20 text-text-secondary hover:text-status-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="사용자 삭제"
              >
                {deletingId === u.id ? (
                  <div className="w-3.5 h-3.5 border-2 border-text-secondary/30 border-t-text-secondary rounded-full animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-text-secondary/60 text-center">
          새 사용자의 초기 비밀번호는 1234 입니다
        </p>
      </div>
    </div>
  );
}
