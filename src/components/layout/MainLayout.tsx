import { Sidebar } from './Sidebar';
import { Header } from './Header';
import type { ViewMode } from '@/stores/useAppStore';

interface MainLayoutProps {
  activeView: ViewMode;
  children: React.ReactNode;
  onRefresh: () => void;
}

export function MainLayout({ activeView, children, onRefresh }: MainLayoutProps) {
  const immersive = activeView === 'playground';

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {!immersive && <Header activeView={activeView} onRefresh={onRefresh} />}
        <main className={immersive ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'}>
          {children}
        </main>
      </div>
    </div>
  );
}
