import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import {
  loadSheetsConfig,
  saveSheetsConfig,
  connectSheets,
  checkConnection,
} from '@/services/sheetsService';

export function SettingsView() {
  const { isTestMode, sheetsConnected, sheetsConfig, setSheetsConnected, setSheetsConfig } = useAppStore();

  const [webAppUrl, setWebAppUrl] = useState(sheetsConfig?.webAppUrl ?? '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 설정 로드
  useEffect(() => {
    async function load() {
      const config = await loadSheetsConfig();
      if (config) {
        setWebAppUrl(config.webAppUrl);
      }
      // 현재 연결 상태 확인
      const connected = await checkConnection();
      setSheetsConnected(connected);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto py-6">
      <h2 className="text-xl font-bold text-text-primary">설정</h2>

      {/* 모드 표시 */}
      <div className="bg-bg-card border border-bg-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-secondary mb-3">앱 모드</h3>
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              isTestMode
                ? 'bg-status-low/20 text-status-low'
                : 'bg-stage-png/20 text-stage-png'
            }`}
          >
            {isTestMode ? '테스트 모드' : '라이브 모드'}
          </span>
          <span className="text-xs text-text-secondary">
            {isTestMode
              ? '로컬 JSON 파일을 사용합니다. (start-dev.bat으로 실행)'
              : 'Apps Script 웹 앱을 통해 Google Sheets와 연동합니다.'}
          </span>
        </div>
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
