import { useState, useEffect } from 'react';
import { Database, Palmtree } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import {
  loadSheetsConfig,
  saveSheetsConfig,
  connectSheets,
  checkConnection,
} from '@/services/sheetsService';
import {
  loadVacationConfig,
  saveVacationConfig,
  connectVacation,
  checkVacationConnection,
} from '@/services/vacationService';
import { DEFAULT_WEB_APP_URL } from '@/config';
import { SettingsSection } from './SettingsSection';

export function SheetsSection() {
  const {
    sheetsConnected, setSheetsConnected, setSheetsConfig,
    vacationConnected, setVacationConnected, setVacationConfig,
  } = useAppStore();

  const [webAppUrl, setWebAppUrl] = useState(DEFAULT_WEB_APP_URL || '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 휴가 API 상태
  const [vacationUrl, setVacationUrl] = useState('');
  const [vacationError, setVacationError] = useState<string | null>(null);
  const [isVacationConnecting, setIsVacationConnecting] = useState(false);
  const [vacationSaveMessage, setVacationSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const config = await loadSheetsConfig();
      if (config) {
        setWebAppUrl(config.webAppUrl);
      }
      const connected = await checkConnection();
      setSheetsConnected(connected);

      // 휴가 설정 로드 + 자동 연결
      const vacConfig = await loadVacationConfig();
      if (vacConfig) {
        setVacationUrl(vacConfig.webAppUrl);
        // 저장된 URL이 있으면 자동 연결 시도
        const result = await connectVacation(vacConfig.webAppUrl);
        setVacationConnected(result.ok);
      } else {
        const vacConnected = await checkVacationConnection();
        setVacationConnected(vacConnected);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleSave = async () => {
    const config = { webAppUrl };
    await saveSheetsConfig(config);
    setSheetsConfig(config);
    setSaveMessage('저장 완료');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  // ─── 휴가 API 핸들러 ─────
  const handleVacationConnect = async () => {
    if (!vacationUrl) {
      setVacationError('휴가 관리 Apps Script URL을 입력해주세요.');
      return;
    }
    setIsVacationConnecting(true);
    setVacationError(null);
    try {
      const result = await connectVacation(vacationUrl);
      if (result.ok) {
        setVacationConnected(true);
        setVacationError(null);
      } else {
        setVacationConnected(false);
        setVacationError(result.error ?? '연결 실패');
      }
    } catch (err) {
      setVacationError(String(err));
      setVacationConnected(false);
    } finally {
      setIsVacationConnecting(false);
    }
  };

  const handleVacationSave = async () => {
    const config = { webAppUrl: vacationUrl };
    await saveVacationConfig(config);
    setVacationConfig(config);
    setVacationSaveMessage('저장 완료');
    setTimeout(() => setVacationSaveMessage(null), 2000);
  };

  return (
    <SettingsSection
      icon={<Database size={18} className="text-accent" />}
      title="Google Sheets 연동"
      action={
        <span
          className={`px-2.5 py-1 rounded-md text-xs font-medium ${
            sheetsConnected
              ? 'bg-stage-png/20 text-stage-png'
              : 'bg-bg-primary text-text-secondary'
          }`}
        >
          {sheetsConnected ? '연결됨' : '미연결'}
        </span>
      }
    >
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

      {connectError && (
        <div className="mb-4 px-3 py-2 bg-status-none/10 border border-status-none/30 rounded-lg text-xs text-status-none">
          {connectError}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleConnect}
          disabled={isConnecting || !webAppUrl}
          className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors cursor-pointer"
        >
          {isConnecting ? '연결 중...' : '연결 테스트'}
        </button>
        <button
          onClick={handleSave}
          disabled={!webAppUrl}
          className="px-4 py-2 bg-stage-png hover:bg-stage-png/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-bg-primary font-medium transition-colors cursor-pointer"
        >
          설정 저장
        </button>
        {saveMessage && (
          <span className="self-center text-xs text-stage-png">{saveMessage}</span>
        )}
      </div>

      {/* ═══════ 휴가 관리 API 연동 ═══════ */}
      <div className="border-t border-bg-border/20 mt-5 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <Palmtree size={15} className="text-emerald-400" />
          <span className="text-[13px] font-semibold text-text-primary">휴가 관리 API</span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-md text-[10px] font-medium ${
              vacationConnected
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-bg-primary text-text-secondary/50'
            }`}
          >
            {vacationConnected ? '연결됨' : '미연결'}
          </span>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1.5">
            휴가 관리 Apps Script 웹 앱 URL
          </label>
          <input
            type="text"
            value={vacationUrl}
            onChange={(e) => setVacationUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-emerald-400"
          />
          <p className="text-[11px] text-text-secondary/60 mt-1">
            vacation-repo의 WebApi.gs를 배포한 후 받은 URL을 입력하세요
          </p>
        </div>

        {vacationError && (
          <div className="mb-4 px-3 py-2 bg-status-none/10 border border-status-none/30 rounded-lg text-xs text-status-none">
            {vacationError}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleVacationConnect}
            disabled={isVacationConnecting || !vacationUrl}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-500/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors cursor-pointer"
          >
            {isVacationConnecting ? '연결 중...' : '연결 테스트'}
          </button>
          <button
            onClick={handleVacationSave}
            disabled={!vacationUrl}
            className="px-4 py-2 bg-stage-png hover:bg-stage-png/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-bg-primary font-medium transition-colors cursor-pointer"
          >
            설정 저장
          </button>
          {vacationSaveMessage && (
            <span className="self-center text-xs text-stage-png">{vacationSaveMessage}</span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
