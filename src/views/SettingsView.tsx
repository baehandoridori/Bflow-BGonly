import { useState, useEffect } from 'react';
import { SettingsSidebar, type SettingsTabId } from '@/components/settings/SettingsSidebar';
import { ThemeSection } from '@/components/settings/ThemeSection';
import { FontSizeSection } from '@/components/settings/FontSizeSection';
import { SheetsSection } from '@/components/settings/SheetsSection';
import { GuideSection } from '@/components/settings/GuideSection';
import { StartupSection } from '@/components/settings/StartupSection';
import { EffectsSection } from '@/components/settings/EffectsSection';
import { LoginSection } from '@/components/settings/LoginSection';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { ShortcutsSection } from '@/components/settings/ShortcutsSection';
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
      case 'theme':
        return <ThemeSection />;
      case 'font':
        return (
          <FontSizeSection
            fontScale={fontScale}
            categoryScales={categoryScales}
            onFontScaleChange={setFontScale}
            onCategoryScalesChange={setCategoryScales}
          />
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
      default:
        return null;
    }
  };

  return (
    <div className="flex gap-6 max-w-3xl mx-auto py-6 px-4">
      <SettingsSidebar active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 flex flex-col gap-6 min-w-0">
        <h2 className="text-xl font-bold text-text-primary">설정</h2>
        {renderContent()}
      </div>
    </div>
  );
}
