import { useState, useEffect } from 'react';
import { Palette, Check, Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import {
  loadSheetsConfig,
  saveSheetsConfig,
  connectSheets,
  checkConnection,
} from '@/services/sheetsService';
import { THEME_PRESETS, rgbToHex, hexToRgb, getPreset, getLightColors } from '@/themes';
import type { ThemeColors } from '@/themes';
import { cn } from '@/utils/cn';
import { DEFAULT_WEB_APP_URL } from '@/config';

export function SettingsView() {
  const {
    sheetsConnected, sheetsConfig,
    setSheetsConnected, setSheetsConfig,
    themeId, customThemeColors, colorMode,
    setThemeId, setCustomThemeColors, setColorMode,
  } = useAppStore();

  const [webAppUrl, setWebAppUrl] = useState(sheetsConfig?.webAppUrl || DEFAULT_WEB_APP_URL || '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 커스텀 테마 편집 상태
  const [editingCustom, setEditingCustom] = useState(false);
  const [customAccent, setCustomAccent] = useState('#6C5CE7');
  const [customSub, setCustomSub] = useState('#A29BFE');

  // 설정 로드
  useEffect(() => {
    async function load() {
      const config = await loadSheetsConfig();
      if (config) {
        setWebAppUrl(config.webAppUrl);
      }
      const connected = await checkConnection();
      setSheetsConnected(connected);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 커스텀 색상 초기값
  useEffect(() => {
    if (customThemeColors) {
      setCustomAccent(rgbToHex(customThemeColors.accent));
      setCustomSub(rgbToHex(customThemeColors.accentSub));
    }
  }, [customThemeColors]);

  // 연결 테스트
  const handleConnect = async () => {
    if (!webAppUrl) {
      setConnectError('Apps Script 웹 앱 URL을 입력해주세요.');
      return;
    }
    setIsConnecting(true);
    setConnectError(null);
    try {
      const result = await connectSheets(webAppUrl);
      if (result.ok) {
        setSheetsConnected(true);
        setConnectError(null);
      } else {
        setSheetsConnected(false);
        setConnectError(result.error ?? '연결 실패');
      }
    } catch (err) {
      setConnectError(String(err));
      setSheetsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  // 설정 저장
  const handleSave = async () => {
    const config = { webAppUrl };
    await saveSheetsConfig(config);
    setSheetsConfig(config);
    setSaveMessage('저장 완료');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  // 프리셋 선택
  const handlePresetSelect = (presetId: string) => {
    setEditingCustom(false);
    setThemeId(presetId);
    setCustomThemeColors(null);
  };

  // 커스텀 테마 적용
  const handleCustomApply = () => {
    // accent, accentSub만 커스텀. 나머지는 현재 프리셋(또는 violet) 기반
    const base = getPreset(themeId === 'custom' ? 'violet' : themeId)?.colors
      ?? THEME_PRESETS[0].colors;
    const colors: ThemeColors = {
      ...base,
      accent: hexToRgb(customAccent),
      accentSub: hexToRgb(customSub),
    };
    setThemeId('custom');
    setCustomThemeColors(colors);
    setEditingCustom(false);
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto py-6">
      <h2 className="text-xl font-bold text-text-primary">설정</h2>

      {/* ─── 테마 설정 ─── */}
      <div className="bg-bg-card border border-bg-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette size={18} className="text-accent" />
          <h3 className="text-sm font-semibold text-text-secondary">색상 테마</h3>
        </div>

        {/* 다크/라이트 모드 세그먼트 */}
        <div className="flex items-center gap-1 p-1 bg-bg-primary rounded-lg mb-4 w-fit">
          <button
            onClick={() => setColorMode('dark')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              colorMode === 'dark'
                ? 'bg-bg-card text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Moon size={13} />
            다크
          </button>
          <button
            onClick={() => setColorMode('light')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              colorMode === 'light'
                ? 'bg-bg-card text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Sun size={13} />
            라이트
          </button>
        </div>

        {/* 프리셋 그리드 */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {THEME_PRESETS.map((preset) => {
            const isActive = themeId === preset.id;
            const displayColors = colorMode === 'light' ? getLightColors(preset.id) : preset.colors;
            const accent = rgbToHex(displayColors.accent);
            const sub = rgbToHex(displayColors.accentSub);
            const bg = rgbToHex(displayColors.bgCard);
            return (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.id)}
                className={cn(
                  'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer',
                  isActive
                    ? 'border-accent bg-accent/10'
                    : 'border-bg-border hover:border-accent/40 hover:bg-bg-border/30',
                )}
              >
                {/* 컬러 프리뷰 */}
                <div
                  className="w-full h-10 rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, ${bg} 0%, ${accent} 50%, ${sub} 100%)`,
                  }}
                />
                <span className="text-xs text-text-primary font-medium">{preset.nameKo}</span>
                <span className="text-[11px] text-text-secondary">{preset.name}</span>
                {isActive && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}
              </button>
            );
          })}

          {/* 커스텀 버튼 */}
          <button
            onClick={() => setEditingCustom(true)}
            className={cn(
              'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer',
              themeId === 'custom'
                ? 'border-accent bg-accent/10'
                : 'border-bg-border hover:border-accent/40 hover:bg-bg-border/30 border-dashed',
            )}
          >
            <div className="w-full h-10 rounded-lg flex items-center justify-center bg-bg-border/50">
              <Palette size={20} className="text-text-secondary" />
            </div>
            <span className="text-xs text-text-primary font-medium">커스텀</span>
            <span className="text-[11px] text-text-secondary">Custom</span>
            {themeId === 'custom' && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <Check size={12} className="text-white" />
              </div>
            )}
          </button>
        </div>

        {/* 커스텀 색상 편집 패널 */}
        {editingCustom && (
          <div className="border border-bg-border rounded-lg p-4 bg-bg-primary/50 space-y-3">
            <p className="text-xs text-text-secondary">메인/서브 액센트 컬러를 직접 선택하세요.</p>
            <div className="flex gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">메인 액센트</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={customAccent}
                    onChange={(e) => setCustomAccent(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-xs font-mono text-text-secondary">{customAccent.toUpperCase()}</span>
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">서브 액센트</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={customSub}
                    onChange={(e) => setCustomSub(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-xs font-mono text-text-secondary">{customSub.toUpperCase()}</span>
                </div>
              </label>
            </div>
            {/* 프리뷰 */}
            <div
              className="h-8 rounded-lg"
              style={{ background: `linear-gradient(135deg, ${customAccent}, ${customSub})` }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCustomApply}
                className="px-4 py-1.5 bg-accent hover:bg-accent/80 rounded-lg text-xs text-white font-medium transition-colors cursor-pointer"
              >
                적용
              </button>
              <button
                onClick={() => setEditingCustom(false)}
                className="px-4 py-1.5 bg-bg-border hover:bg-bg-border/80 rounded-lg text-xs text-text-secondary font-medium transition-colors cursor-pointer"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Google Sheets 연동 설정 */}
      <div className="bg-bg-card border border-bg-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-secondary">Google Sheets 연동</h3>
          <span
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${
              sheetsConnected
                ? 'bg-stage-png/20 text-stage-png'
                : 'bg-bg-primary text-text-secondary'
            }`}
          >
            {sheetsConnected ? '연결됨' : '미연결'}
          </span>
        </div>

        {/* Apps Script 웹 앱 URL */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1.5">
            Apps Script 웹 앱 URL
          </label>
          <input
            type="text"
            value={webAppUrl}
            onChange={(e) => setWebAppUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-text-secondary/60 mt-1">
            스프레드시트의 Apps Script를 배포한 후 받은 URL을 입력하세요
          </p>
        </div>

        {/* 에러 메시지 */}
        {connectError && (
          <div className="mb-4 px-3 py-2 bg-status-none/10 border border-status-none/30 rounded-lg text-xs text-status-none">
            {connectError}
          </div>
        )}

        {/* 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={handleConnect}
            disabled={isConnecting || !webAppUrl}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
          >
            {isConnecting ? '연결 중...' : '연결 테스트'}
          </button>
          <button
            onClick={handleSave}
            disabled={!webAppUrl}
            className="px-4 py-2 bg-stage-png hover:bg-stage-png/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-bg-primary font-medium transition-colors"
          >
            설정 저장
          </button>
          {saveMessage && (
            <span className="self-center text-xs text-stage-png">{saveMessage}</span>
          )}
        </div>
      </div>

      {/* 사용 안내 */}
      <div className="bg-bg-card border border-bg-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-secondary mb-3">사용 안내</h3>
        <ol className="text-xs text-text-secondary space-y-2 list-decimal list-inside">
          <li>대상 Google 스프레드시트를 엽니다.</li>
          <li>메뉴 → <strong>확장 프로그램</strong> → <strong>Apps Script</strong>를 클릭합니다.</li>
          <li>프로젝트 관리자가 제공한 스크립트 코드를 붙여넣고 저장합니다.</li>
          <li><strong>배포</strong> → <strong>새 배포</strong> → 유형: <strong>웹 앱</strong>을 선택합니다.</li>
          <li>실행 주체: <strong>본인</strong>, 액세스 권한: <strong>모든 사용자</strong>로 설정합니다.</li>
          <li>배포 후 나오는 URL을 복사해서 위에 입력하고 연결 테스트를 클릭합니다.</li>
          <li>연결 성공 후 설정을 저장하면 다음 실행부터 자동으로 연결됩니다.</li>
        </ol>
        <div className="mt-3 p-3 bg-bg-primary rounded-lg">
          <p className="text-[11px] text-text-secondary/60">
            시트 탭 이름은 <code className="text-accent">EP01_A</code>, <code className="text-accent">EP01_B</code>, <code className="text-accent">EP02_A</code> 형식이어야 합니다.
            <br />
            열 구조: A(No) B(씬번호) C(메모) D(스토리보드URL) E(가이드URL) F(담당자) G(LO) H(완료) I(검수) J(PNG)
          </p>
        </div>
      </div>
    </div>
  );
}
