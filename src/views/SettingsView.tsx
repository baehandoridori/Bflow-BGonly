import { lazy, Suspense, useState, useEffect } from 'react';
import { SettingsSidebar, type SettingsTabId } from '@/components/settings/SettingsSidebar';
// 설정 섹션 lazy 로딩 — 활성 탭 진입 시에만 로드
const ThemeSection = lazy(() => import('@/components/settings/ThemeSection').then(m => ({ default: m.ThemeSection })));
// v1.20.0: 글꼴(서체) + 간격
const FontFamilySection = lazy(() => import('@/components/settings/FontFamilySection').then(m => ({ default: m.FontFamilySection })));
const FontSizeSection = lazy(() => import('@/components/settings/FontSizeSection').then(m => ({ default: m.FontSizeSection })));
const FontColorSection = lazy(() => import('@/components/settings/FontColorSection').then(m => ({ default: m.FontColorSection })));
const SpacingSection = lazy(() => import('@/components/settings/SpacingSection').then(m => ({ default: m.SpacingSection })));
const SheetsSection = lazy(() => import('@/components/settings/SheetsSection').then(m => ({ default: m.SheetsSection })));
const GuideSection = lazy(() => import('@/components/settings/GuideSection').then(m => ({ default: m.GuideSection })));
const StartupSection = lazy(() => import('@/components/settings/StartupSection').then(m => ({ default: m.StartupSection })));
const EffectsSection = lazy(() => import('@/components/settings/EffectsSection').then(m => ({ default: m.EffectsSection })));
const LoginSection = lazy(() => import('@/components/settings/LoginSection').then(m => ({ default: m.LoginSection })));
const ProfileSection = lazy(() => import('@/components/settings/ProfileSection').then(m => ({ default: m.ProfileSection })));
const NotificationSection = lazy(() => import('@/components/settings/NotificationSection').then(m => ({ default: m.NotificationSection })));
const ShortcutsSection = lazy(() => import('@/components/settings/ShortcutsSection').then(m => ({ default: m.ShortcutsSection })));
// v1.18.0: 어드민 전용 컴포지터 지정 섹션
const CompositorSection = lazy(() => import('@/components/settings/CompositorSection').then(m => ({ default: m.CompositorSection })));
// v1.25.0~: 어드민 전용 액팅 검수자(애니메이팅 수퍼바이저) 지정 섹션
const ActingSupervisorSection = lazy(() => import('@/components/settings/ActingSupervisorSection').then(m => ({ default: m.ActingSupervisorSection })));
import { loadPreferences } from '@/services/settingsService';
import {
  type FontScale,
  type FontCategoryScales,
  DEFAULT_FONT_SCALE,
  DEFAULT_CATEGORY_SCALES,
} from '@/utils/typography';

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');

  // 글꼴 크기 상태
  const [fontScale, setFontScale] = useState<FontScale>(DEFAULT_FONT_SCALE);
  const [categoryScales, setCategoryScales] = useState<FontCategoryScales>({ ...DEFAULT_CATEGORY_SCALES });

  // 저장된 설정 로드
  useEffect(() => {
    async function loadFontSettings() {
      const prefs = await loadPreferences();
      if (prefs?.fontScale) setFontScale(prefs.fontScale as FontScale);
      if (prefs?.fontCategoryScales) {
        setCategoryScales({
          ...DEFAULT_CATEGORY_SCALES,
          ...prefs.fontCategoryScales,
        });
      }
    }
    loadFontSettings();
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileSection />;
      case 'notification':
        return <NotificationSection />;
      case 'theme':
        return <ThemeSection />;
      case 'font':
        return (
          <div className="flex flex-col gap-6">
            {/* v1.20.0: 글꼴(서체) — 큐레이션 9종 + 사용자 추가 */}
            <FontFamilySection />
            <FontSizeSection
              fontScale={fontScale}
              categoryScales={categoryScales}
              onFontScaleChange={setFontScale}
              onCategoryScalesChange={setCategoryScales}
            />
            <FontColorSection />
            {/* v1.20.0: 간격 (줄간격 + 자간) */}
            <SpacingSection />
          </div>
        );
      case 'sheets':
        return <SheetsSection />;
      case 'guide':
        return <GuideSection />;
      case 'effects':
        return <EffectsSection />;
      case 'startup':
        return <StartupSection />;
      case 'login':
        return <LoginSection />;
      case 'shortcuts':
        return <ShortcutsSection />;
      case 'compositor':
        return (
          <div className="flex flex-col gap-6">
            <CompositorSection />
            <ActingSupervisorSection />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex gap-6 max-w-3xl mx-auto py-6 px-4">
      <SettingsSidebar active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 flex flex-col gap-6 min-w-0">
        <h2 className="text-xl font-bold text-text-primary">설정</h2>
        <Suspense fallback={null}>
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
}
