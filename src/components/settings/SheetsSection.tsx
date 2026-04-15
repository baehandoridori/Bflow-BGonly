import { useState, useEffect } from 'react';
import { Database, Palmtree, Calendar } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import {
  loadGasConfig,
  saveGasConfig,
  connectGas,
  checkGasConnection,
} from '@/services/gasConfigService';
import {
  loadVacationConfig,
  saveVacationConfig,
  connectVacation,
  checkVacationConnection,
} from '@/services/vacationService';
import * as gcalService from '@/services/googleCalendarService';
import { getGCalSettings, saveGCalSettings, saveLocalGCalSettings, saveTeamCalendarId, syncAll } from '@/services/calendarService';
import type { GCalSettings } from '@/types/calendar';
import { DEFAULT_GAS_IMAGE_URL, DEFAULT_VACATION_URL } from '@/config';
import { SettingsSection } from './SettingsSection';

export function SheetsSection() {
  const {
    dataConnected, setDataConnected, setGasConfig,
    vacationConnected, setVacationConnected, setVacationConfig,
  } = useAppStore();

  const [webAppUrl, setWebAppUrl] = useState(DEFAULT_GAS_IMAGE_URL || '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 휴가 API 상태
  const [vacationUrl, setVacationUrl] = useState(DEFAULT_VACATION_URL || '');
  const [vacationError, setVacationError] = useState<string | null>(null);
  const [isVacationConnecting, setIsVacationConnecting] = useState(false);
  const [vacationSaveMessage, setVacationSaveMessage] = useState<string | null>(null);

  // Google Calendar 상태 (localStorage 캐시로 깜빡임 방지)
  const [gcalAuth, setGcalAuth] = useState(() => localStorage.getItem('bflow_gcal_authed') === 'true');
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const [gcalError, setGcalError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Array<{ id: string; summary: string; primary: boolean }>>([]);
  const [gcalSettings, setGcalSettingsState] = useState<GCalSettings>({ teamCalendarId: null, personalCalendarId: null, lastSyncAt: null });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const config = await loadGasConfig();
      if (config) {
        setWebAppUrl(config.webAppUrl);
      }
      const connected = await checkGasConnection();
      setDataConnected(connected);

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

      // Google Calendar 설정 로드
      try {
        const authed = await gcalService.isAuthenticated();
        setGcalAuth(authed); localStorage.setItem('bflow_gcal_authed', String(authed));
        if (authed) {
          const cals = await gcalService.listCalendars();
          setCalendars(cals);
        }
        setGcalSettingsState(await getGCalSettings());
      } catch { /* GCal not configured yet */ }
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
      const result = await connectGas(webAppUrl);
      if (result.ok) {
        setDataConnected(true);
        setConnectError(null);
      } else {
        setDataConnected(false);
        setConnectError(result.error ?? '연결 실패');
      }
    } catch (err) {
      setConnectError(String(err));
      setDataConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSave = async () => {
    const config = { webAppUrl };
    await saveGasConfig(config);
    setGasConfig(config);
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

  // ─── Google Calendar 핸들러 ─────
  const handleGcalConnect = async () => {
    setGcalConnecting(true);
    setGcalError(null);
    try {
      await gcalService.startAuth();
      const authed = await gcalService.isAuthenticated();
      setGcalAuth(authed); localStorage.setItem('bflow_gcal_authed', String(authed));
      if (authed) {
        const cals = await gcalService.listCalendars();
        setCalendars(cals);
      }
    } catch (err) {
      setGcalError(String(err));
    } finally {
      setGcalConnecting(false);
    }
  };

  const handleGcalDisconnect = async () => {
    try {
      await gcalService.signOut();
      setGcalAuth(false); localStorage.setItem('bflow_gcal_authed', 'false');
      setCalendars([]);
      // 로컬 전용 값만 초기화 — teamCalendarId는 Supabase 공유 값이므로 건드리지 않음
      // (다른 팀원의 팀 캘린더 설정을 날리지 않도록)
      saveLocalGCalSettings({ personalCalendarId: null, lastSyncAt: null });
      setGcalSettingsState((prev) => ({ ...prev, personalCalendarId: null, lastSyncAt: null }));
    } catch (err) {
      setGcalError(String(err));
    }
  };

  const handleCalendarSelect = (field: 'teamCalendarId' | 'personalCalendarId', calId: string) => {
    const updated: GCalSettings = { ...gcalSettings, [field]: calId || null };
    if (field === 'teamCalendarId') {
      saveTeamCalendarId(calId || null).catch(console.error);
      setGcalSettingsState(updated);
    } else {
      saveGCalSettings(updated);
      setGcalSettingsState(updated);
    }
    // Watch 채널 등록 (실시간 동기화용)
    if (calId) {
      gcalService.ensureWatch(calId, 'bflow').catch(() => {})
    }
  };

  const handleGcalSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      await syncAll();
      const updated: GCalSettings = { ...gcalSettings, lastSyncAt: new Date().toISOString() };
      saveGCalSettings(updated);
      setGcalSettingsState(updated);
      setSyncMessage('동기화 완료');
      setTimeout(() => setSyncMessage(null), 2000);
    } catch (err) {
      setGcalError(String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SettingsSection
      icon={<Database size={18} className="text-accent" />}
      title="데이터 서버 연동"
      action={
        <span
          className={`px-2.5 py-1 rounded-md text-xs font-medium ${
            dataConnected
              ? 'bg-stage-png/20 text-stage-png'
              : 'bg-bg-primary text-text-secondary'
          }`}
        >
          {dataConnected ? '연결됨' : '미연결'}
        </span>
      }
    >
      {/* 이미지 업로드 서버 URL */}
      <div className="mb-4">
        <label className="block text-xs text-text-secondary mb-1.5">
          이미지 업로드 서버 URL
        </label>
        <input
          type="text"
          value={webAppUrl}
          onChange={(e) => setWebAppUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/.../exec"
          className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent"
        />
        <p className="text-[11px] text-text-secondary/60 mt-1">
          이미지 업로드용 Apps Script 웹 앱 URL을 입력하세요
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

      {/* ═══════ Google Calendar 연동 ═══════ */}
      <div className="border-t border-bg-border/20 mt-5 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={15} className="text-blue-400" />
          <span className="text-[13px] font-semibold text-text-primary">Google Calendar</span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-md text-[10px] font-medium ${
              gcalAuth
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-bg-primary text-text-secondary/50'
            }`}
          >
            {gcalAuth ? '연결됨' : '미연결'}
          </span>
        </div>

        {!gcalAuth ? (
          <button
            onClick={handleGcalConnect}
            disabled={gcalConnecting}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-500/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors cursor-pointer"
          >
            {gcalConnecting ? '연결 중...' : 'Google 계정 연결'}
          </button>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1.5">팀 캘린더</label>
              <select
                value={gcalSettings.teamCalendarId || ''}
                onChange={(e) => handleCalendarSelect('teamCalendarId', e.target.value)}
                className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-400"
              >
                <option value="">캘린더를 선택하세요</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-secondary/60 mt-1">
                에피소드·파트·씬·휴가 일정이 저장될 캘린더
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1.5">개인 캘린더</label>
              <select
                value={gcalSettings.personalCalendarId || ''}
                onChange={(e) => handleCalendarSelect('personalCalendarId', e.target.value)}
                className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-400"
              >
                <option value="">기본 캘린더 (primary)</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-secondary/60 mt-1">
                개인 할일 일정이 저장될 캘린더 (미선택 시 Google 기본 캘린더)
              </p>
            </div>

            {gcalSettings.lastSyncAt && (
              <p className="text-[11px] text-text-secondary/60 mb-3">
                마지막 동기화: {new Date(gcalSettings.lastSyncAt).toLocaleString('ko-KR')}
              </p>
            )}

            <div className="flex gap-2 flex-wrap items-center">
              <button
                onClick={handleGcalSync}
                disabled={isSyncing}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-500/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors cursor-pointer"
              >
                {isSyncing ? '동기화 중...' : '지금 동기화'}
              </button>
              <button
                onClick={handleGcalDisconnect}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-sm text-red-400 font-medium transition-colors cursor-pointer"
              >
                연결 해제
              </button>
              {syncMessage && (
                <span className="self-center text-xs text-blue-400">{syncMessage}</span>
              )}
            </div>
          </>
        )}

        {gcalError && (
          <div className="mt-3 px-3 py-2 bg-status-none/10 border border-status-none/30 rounded-lg text-xs text-status-none">
            {gcalError}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
