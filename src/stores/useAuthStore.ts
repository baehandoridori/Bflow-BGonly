import { create } from 'zustand';
import type { AppUser } from '@/types';

interface AuthState {
  // 현재 로그인 사용자
  currentUser: AppUser | null;
  setCurrentUser: (user: AppUser | null) => void;

  // 등록된 사용자 목록 (공유 파일에서 로드)
  users: AppUser[];
  setUsers: (users: AppUser[]) => void;

  // 인증 초기화 완료 여부
  authReady: boolean;
  setAuthReady: (v: boolean) => void;

  // 관리자 모드
  isAdminMode: boolean;
  setAdminMode: (v: boolean) => void;

  // 비밀번호 변경 모달
  showPasswordChange: boolean;
  setShowPasswordChange: (v: boolean) => void;

  // 관리자 사용자 관리 모달
  showUserManager: boolean;
  setShowUserManager: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  users: [],
  setUsers: (users) => set({ users }),

  authReady: false,
  setAuthReady: (v) => set({ authReady: v }),

  isAdminMode: false,
  setAdminMode: (v) => set({ isAdminMode: v }),

  showPasswordChange: false,
  setShowPasswordChange: (v) => set({ showPasswordChange: v }),

  showUserManager: false,
  setShowUserManager: (v) => set({ showUserManager: v }),
}));
