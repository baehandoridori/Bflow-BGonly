import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import {
  loadSheetsConfig,
  saveSheetsConfig,
  connectSheets,
  checkConnection,
  pickCredentialsFile,
} from '@/services/sheetsService';

export function SettingsView() {
  const { isTestMode, sheetsConnected, sheetsConfig, setSheetsConnected, setSheetsConfig } = useAppStore();

  const [spreadsheetId, setSpreadsheetId] = useState(sheetsConfig?.spreadsheetId ?? '');
  const [credentialsPath, setCredentialsPath] = useState(sheetsConfig?.credentialsPath ?? '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 설정 로드
  useEffect(() => {
    async function load() {
      const config = await loadSheetsConfig();
      if (config) {
        setSpreadsheetId(config.spreadsheetId);
        setCredentialsPath(config.credentialsPath);
      }
      // 현재 연결 상태 확인
      const connected = await checkConnection();
      setSheetsConnected(connected);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 인증 파일 선택
  const handlePickCredentials = async () => {
    const path = await pickCredentialsFile();
    if (path) {
      setCredentialsPath(path);
      setConnectError(null);
    }
  };

  // 연결 테스트
  const handleConnect = async () => {
    if (!credentialsPath) {
      setConnectError('인증 키 파일을 먼저 선택해주세요.');
      return;
    }
    setIsConnecting(true);
    setConnectError(null);
    try {
      const result = await connectSheets(credentialsPath);
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
    const config = { spreadsheetId, credentialsPath };
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
              : 'Google Sheets API와 연동합니다.'}
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

        {/* 스프레드시트 ID */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1.5">
            스프레드시트 ID
          </label>
          <input
            type="text"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="예: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-text-secondary/60 mt-1">
            Google Sheets URL에서 /d/ 뒤의 문자열
          </p>
        </div>

        {/* 서비스 계정 키 파일 */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1.5">
            서비스 계정 키 파일 (.json)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={credentialsPath}
              onChange={(e) => setCredentialsPath(e.target.value)}
              placeholder="경로를 입력하거나 파일 선택..."
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent"
            />
            <button
              onClick={handlePickCredentials}
              className="px-4 py-2 bg-bg-border hover:bg-bg-border/80 rounded-lg text-sm text-text-primary transition-colors whitespace-nowrap"
            >
              파일 선택
            </button>
          </div>
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
            disabled={isConnecting || !credentialsPath}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
          >
            {isConnecting ? '연결 중...' : '연결 테스트'}
          </button>
          <button
            onClick={handleSave}
            disabled={!spreadsheetId || !credentialsPath}
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
          <li>Google Cloud Console에서 서비스 계정을 생성하고 JSON 키 파일을 다운로드합니다.</li>
          <li>Google Sheets API를 활성화합니다.</li>
          <li>대상 스프레드시트에서 서비스 계정 이메일을 편집자로 공유합니다.</li>
          <li>위에서 스프레드시트 ID와 키 파일 경로를 입력하고 연결 테스트를 클릭합니다.</li>
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
