import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { canAccessPlayground } from '@/features/playground/featureFlag';

interface MainLayoutProps {
  children: React.ReactNode;
  onRefresh: () => void;
}

export function MainLayout({ children, onRefresh }: MainLayoutProps) {
  const currentView = useAppStore((state) => state.currentView);
  const currentUser = useAuthStore((state) => state.currentUser);
  const immersive = currentView === 'playground' && canAccessPlayground(currentUser);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {!immersive && <Header onRefresh={onRefresh} />}
        <main className={immersive ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'}>
          {children}
        </main>
      </div>
    </div>
  );
}
