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

  // Google Calendar 자격증명 상태 (clientId/clientSecret 입력 폼)
  const [gcalHasCreds, setGcalHasCreds] = useState<boolean>(false);
  const [gcalClientId, setGcalClientId] = useState('');
  const [gcalClientSecret, setGcalClientSecret] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsMessage, setCredsMessage] = useState<string | null>(null);

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
        const hasCreds = await gcalService.hasCredentials();
        setGcalHasCreds(hasCreds);
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
  const handleSaveGcalCredentials = async () => {
    setCredsSaving(true);
    setCredsMessage(null);
    setGcalError(null);
    try {
      await gcalService.saveCredentials(gcalClientId.trim(), gcalClientSecret.trim());
      setGcalHasCreds(true);
      setShowCredsForm(false);
      setGcalClientId('');
      setGcalClientSecret('');
      setCredsMessage('자격 증명 저장 완료. 이제 Google 계정 연결을 눌러 주세요.');
      setTimeout(() => setCredsMessage(null), 4000);
    } catch (err) {
      setGcalError((err as Error).message || String(err));
    } finally {
      setCredsSaving(false);
    }
  };

  const handleGcalConnect = async () => {
    setGcalConnecting(true);
    setGcalError(null);
    try {
      // 입력 폼에 값이 있지만 아직 "자격 증명 저장" 을 누르지 않은 상태라면 자동 저장 후 진행
      let hasCreds = gcalHasCreds;
      const pendingId = gcalClientId.trim();
      const pendingSecret = gcalClientSecret.trim();
      if (!hasCreds && pendingId && pendingSecret) {
        await gcalService.saveCredentials(pendingId, pendingSecret);
        hasCreds = true;
        setGcalHasCreds(true);
        setShowCredsForm(false);
        setGcalClientId('');
        setGcalClientSecret('');
        setCredsMessage('자격 증명 저장됨');
        setTimeout(() => setCredsMessage(null), 3000);
      }
      if (!hasCreds) {
        // 자격증명이 없으면 입력 폼을 자동으로 펼침
        setShowCredsForm(true);
        setGcalError('먼저 Google Cloud Console 에서 발급받은 OAuth 2.0 clientId / clientSecret 을 입력해 주세요.');
        return;
      }
      await gcalService.startAuth();
      const authed = await gcalService.isAuthenticated();
      setGcalAuth(authed); localStorage.setItem('bflow_gcal_authed', String(authed));
      if (authed) {
        const cals = await gcalService.listCalendars();
        setCalendars(cals);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unauthorized')) {
        try { await gcalService.signOut(); } catch { /* 무시 */ }
        setGcalAuth(false);
        localStorage.setItem('bflow_gcal_authed', 'false');
        setGcalError(
          'OAuth 인증이 거절되었습니다. 다음을 확인해 주세요:\n' +
          '1) Google Cloud Console 에서 Calendar API 가 활성화되어 있는지\n' +
          '2) OAuth 동의 화면의 "테스트 사용자" 에 본인 계정이 추가되어 있는지\n' +
          '3) 자격 증명(clientId/Secret) 이 "데스크톱 앱" 유형으로 만들어졌는지\n' +
          '위 항목 확인 후 자격 증명을 다시 저장하고 재시도해 주세요.'
        );
      } else if (msg.includes('EADDRINUSE')) {
        setGcalError('포트 8089 가 사용 중입니다. 다른 앱(이전 인증 창 포함) 을 닫고 다시 시도해 주세요.');
      } else if (msg.includes('timed out')) {
        setGcalError('인증 대기 시간이 초과되었습니다. 브라우저에서 Google 로그인을 완료한 뒤 즉시 다시 시도해 주세요.');
      } else {
        setGcalError(msg);
      }
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
      const msg = String(err);
      // invalid_request / invalid_grant → 토큰이 만료되거나 OAuth 설정이 꼬인 상태.
      // 토큰을 자동 정리하고 사용자에게 재연결 안내.
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unauthorized')) {
        try { await gcalService.signOut(); } catch { /* 무시 */ }
        setGcalAuth(false);
        localStorage.setItem('bflow_gcal_authed', 'false');
        setCalendars([]);
        setGcalError(
          '인증 토큰이 유효하지 않습니다. 아래 단계를 확인해 주세요:\n' +
          '1) Google Cloud Console 에서 Calendar API 가 활성화되어 있는지\n' +
          '2) OAuth 동의 화면에서 이 앱이 "테스트 사용자" 에 등록되어 있는지\n' +
          '3) 자격 증명(clientId/Secret) 이 올바른지 확인\n' +
          '그 다음 "Google 계정 연결" 버튼을 다시 눌러 재인증 해주세요.'
        );
      } else if (msg.includes('EADDRINUSE') || msg.includes('timed out')) {
        setGcalError('OAuth 인증에 실패했습니다. 창을 닫거나 다른 앱이 포트 8089 를 쓰고 있지 않은지 확인 후 재시도해 주세요.');
      } else {
        setGcalError(msg);
      }
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

        {/* 자격증명 설정 — 미연결일 때만 노출. 설정 여부를 칩으로 표시 */}
        {!gcalAuth && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setShowCredsForm((v) => !v)}
              className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
            >
              <span>자격 증명 (clientId / clientSecret)</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${gcalHasCreds ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {gcalHasCreds ? '설정됨' : '미설정'}
              </span>
              <span className="text-text-secondary/50">{showCredsForm ? '▲' : '▼'}</span>
            </button>

            {showCredsForm && (
              <div className="mt-2 p-3 bg-bg-primary/40 border border-bg-border/40 rounded-lg">
                <p className="text-[11px] text-text-secondary/70 mb-2 leading-relaxed">
                  Google Cloud Console 에서 OAuth 2.0 <b>데스크톱 앱</b> 유형의 클라이언트를 만들고, 발급받은 clientId / clientSecret 을 아래에 붙여넣으세요. 입력 값은 로컬 파일(<code className="text-text-secondary">%APPDATA%/Bflow-BGonly/gcal-credentials.json</code>) 에만 저장됩니다.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">Client ID</label>
                    <input
                      type="text"
                      value={gcalClientId}
                      onChange={(e) => setGcalClientId(e.target.value)}
                      placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                      className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-blue-400"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={gcalClientSecret}
                      onChange={(e) => setGcalClientSecret(e.target.value)}
                      placeholder="GOCSPX-..."
                      className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-blue-400"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={handleSaveGcalCredentials}
                    disabled={credsSaving || !gcalClientId.trim() || !gcalClientSecret.trim()}
                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-500/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-xs text-white font-medium transition-colors cursor-pointer"
                  >
                    {credsSaving ? '저장 중...' : '자격 증명 저장'}
                  </button>
                  <button
                    onClick={() => { setShowCredsForm(false); setGcalClientId(''); setGcalClientSecret(''); }}
                    className="px-3 py-1.5 bg-bg-border/40 hover:bg-bg-border/60 rounded-md text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    취소
                  </button>
                  {credsMessage && (
                    <span className="text-xs text-emerald-400">{credsMessage}</span>
                  )}
                </div>
              </div>
            )}
            {!showCredsForm && credsMessage && (
              <p className="mt-2 text-xs text-emerald-400">{credsMessage}</p>
            )}
          </div>
        )}

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
            {/* 연결된 계정의 기본(primary) Google Calendar 를 자동 사용한다.
                별도 '팀 캘린더 / 개인 캘린더' 선택은 사용하지 않음 — 공유 일정은 동료가 본인 계정으로 구독,
                비공개 일정은 Supabase 에만 저장해 Google Calendar 에 올라가지 않는다. */}
            <div className="mb-4 rounded-lg border border-bg-border/50 bg-bg-primary/40 px-3 py-2.5">
              <p className="text-[11px] text-text-secondary leading-relaxed">
                공개 일정은 로그인하신 Google 계정(<span className="text-text-primary">@studiojbbj.com</span>) 의 <b>기본 캘린더</b>
                에 저장되어 동료와 공유됩니다.
                <br />
                <b>🔒 나만 보기</b> 체크한 일정은 Google Calendar 에 올라가지 않고 이 앱에만 저장되어 동료에게 전혀 노출되지 않아요.
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
          <div className="mt-3 px-3 py-2 bg-status-none/10 border border-status-none/30 rounded-lg text-xs text-status-none whitespace-pre-line leading-relaxed">
            {gcalError}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
