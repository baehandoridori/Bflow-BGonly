import { useState, useEffect } from 'react';
import { Layers, Palmtree, Calendar } from 'lucide-react';
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
import { IntegrationCard, btnStyles } from './IntegrationCard';
import { IntegrationOverview } from './IntegrationOverview';
import { SupabaseStatusCard } from './SupabaseStatusCard';

const GCAL_AUTH_EVENT = 'bflow:gcal-auth-changed';

function publishGcalAuthState(authed: boolean) {
  localStorage.setItem('bflow_gcal_authed', String(authed));
  window.dispatchEvent(new CustomEvent(GCAL_AUTH_EVENT, { detail: { authed } }));
}

export function SheetsSection() {
  const {
    dataConnected, setDataConnected, setGasConfig,
    vacationConnected, setVacationConnected, setVacationConfig,
  } = useAppStore();

  // ─── GAS (이미지 업로드) ─────
  const [webAppUrl, setWebAppUrl] = useState(DEFAULT_GAS_IMAGE_URL || '');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // ─── 휴가 API ─────
  const [vacationUrl, setVacationUrl] = useState(DEFAULT_VACATION_URL || '');
  const [vacationError, setVacationError] = useState<string | null>(null);
  const [isVacationConnecting, setIsVacationConnecting] = useState(false);
  const [vacationSaveMessage, setVacationSaveMessage] = useState<string | null>(null);

  // ─── Google Calendar ─────
  const [gcalAuth, setGcalAuth] = useState(() => localStorage.getItem('bflow_gcal_authed') === 'true');
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const [gcalError, setGcalError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Array<{ id: string; summary: string; primary: boolean }>>([]);
  const [gcalSettings, setGcalSettingsState] = useState<GCalSettings>({ teamCalendarId: null, personalCalendarId: null, lastSyncAt: null });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [gcalHasCreds, setGcalHasCreds] = useState<boolean>(false);
  const [gcalAuthCheckedAt, setGcalAuthCheckedAt] = useState<string | null>(null);
  const [gcalClientId, setGcalClientId] = useState('');
  const [gcalClientSecret, setGcalClientSecret] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsMessage, setCredsMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const config = await loadGasConfig();
      if (config) setWebAppUrl(config.webAppUrl);
      const connected = await checkGasConnection();
      setDataConnected(connected);

      const vacConfig = await loadVacationConfig();
      if (vacConfig) {
        setVacationUrl(vacConfig.webAppUrl);
        const result = await connectVacation(vacConfig.webAppUrl);
        setVacationConnected(result.ok);
      } else {
        const vacConnected = await checkVacationConnection();
        setVacationConnected(vacConnected);
      }

      try {
        const hasCreds = await gcalService.hasCredentials();
        setGcalHasCreds(hasCreds);
        const authed = await gcalService.isAuthenticated();
        setGcalAuthCheckedAt(new Date().toISOString());
        setGcalAuth(authed); publishGcalAuthState(authed);
        if (authed) {
          const cals = await gcalService.listCalendars();
          setCalendars(cals);
        }
        setGcalSettingsState(await getGCalSettings());
      } catch { /* GCal not configured yet */ }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 핸들러 ─────
  const handleConnect = async () => {
    if (!webAppUrl) { setConnectError('Apps Script 웹 앱 URL을 입력해주세요.'); return; }
    setIsConnecting(true); setConnectError(null);
    try {
      const result = await connectGas(webAppUrl);
      if (result.ok) { setDataConnected(true); setConnectError(null); }
      else { setDataConnected(false); setConnectError(result.error ?? '연결 실패'); }
    } catch (err) { setConnectError(String(err)); setDataConnected(false); }
    finally { setIsConnecting(false); }
  };

  const handleSave = async () => {
    const config = { webAppUrl };
    await saveGasConfig(config);
    setGasConfig(config);
    setSaveMessage('저장 완료');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  const handleVacationConnect = async () => {
    if (!vacationUrl) { setVacationError('휴가 관리 Apps Script URL을 입력해주세요.'); return; }
    setIsVacationConnecting(true); setVacationError(null);
    try {
      const result = await connectVacation(vacationUrl);
      if (result.ok) { setVacationConnected(true); setVacationError(null); }
      else { setVacationConnected(false); setVacationError(result.error ?? '연결 실패'); }
    } catch (err) { setVacationError(String(err)); setVacationConnected(false); }
    finally { setIsVacationConnecting(false); }
  };

  const handleVacationSave = async () => {
    const config = { webAppUrl: vacationUrl };
    await saveVacationConfig(config);
    setVacationConfig(config);
    setVacationSaveMessage('저장 완료');
    setTimeout(() => setVacationSaveMessage(null), 2000);
  };

  const handleSaveGcalCredentials = async () => {
    setCredsSaving(true); setCredsMessage(null); setGcalError(null);
    try {
      await gcalService.saveCredentials(gcalClientId.trim(), gcalClientSecret.trim());
      setGcalHasCreds(true); setShowCredsForm(false);
      setGcalClientId(''); setGcalClientSecret('');
      setCredsMessage('자격 증명 저장 완료. 이제 Google 계정 연결을 눌러 주세요.');
      setTimeout(() => setCredsMessage(null), 4000);
    } catch (err) { setGcalError((err as Error).message || String(err)); }
    finally { setCredsSaving(false); }
  };

  const handleGcalConnect = async () => {
    setGcalConnecting(true); setGcalError(null);
    try {
      let hasCreds = gcalHasCreds;
      const pendingId = gcalClientId.trim();
      const pendingSecret = gcalClientSecret.trim();
      if (!hasCreds && pendingId && pendingSecret) {
        await gcalService.saveCredentials(pendingId, pendingSecret);
        hasCreds = true; setGcalHasCreds(true); setShowCredsForm(false);
        setGcalClientId(''); setGcalClientSecret('');
        setCredsMessage('자격 증명 저장됨');
        setTimeout(() => setCredsMessage(null), 3000);
      }
      if (!hasCreds) {
        setShowCredsForm(true);
        setGcalError('먼저 Google Cloud Console 에서 발급받은 OAuth 2.0 clientId / clientSecret 을 입력해 주세요.');
        return;
      }
      await gcalService.startAuth();
      const authed = await gcalService.isAuthenticated();
      setGcalAuthCheckedAt(new Date().toISOString());
      setGcalAuth(authed); publishGcalAuthState(authed);
      if (authed) {
        const cals = await gcalService.listCalendars();
        setCalendars(cals);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unauthorized')) {
        try { await gcalService.signOut(); } catch { /* 무시 */ }
        setGcalAuth(false);
        setGcalAuthCheckedAt(new Date().toISOString());
        publishGcalAuthState(false);
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
    } finally { setGcalConnecting(false); }
  };

  const handleGcalDisconnect = async () => {
    try {
      await gcalService.signOut();
      setGcalAuth(false); publishGcalAuthState(false);
      setGcalAuthCheckedAt(new Date().toISOString());
      setCalendars([]);
      saveLocalGCalSettings({ personalCalendarId: null, lastSyncAt: null });
      setGcalSettingsState((prev) => ({ ...prev, personalCalendarId: null, lastSyncAt: null }));
    } catch (err) { setGcalError(String(err)); }
  };

  const handleGcalSync = async () => {
    setIsSyncing(true); setSyncMessage(null);
    try {
      await syncAll();
      const updated: GCalSettings = { ...gcalSettings, lastSyncAt: new Date().toISOString() };
      saveGCalSettings(updated);
      setGcalSettingsState(updated);
      setSyncMessage('동기화 완료');
      setTimeout(() => setSyncMessage(null), 2000);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unauthorized')) {
        try { await gcalService.signOut(); } catch { /* 무시 */ }
        setGcalAuth(false);
        setGcalAuthCheckedAt(new Date().toISOString());
        publishGcalAuthState(false);
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
    } finally { setIsSyncing(false); }
  };

  // 캘린더 선택 핸들러 (기존 로직 유지 — 현재 UI 에서는 primary 캘린더만 사용하지만 훅 유지)
  void calendars;
  void handleCalendarSelect;
  function handleCalendarSelect(field: 'teamCalendarId' | 'personalCalendarId', calId: string) {
    const updated: GCalSettings = { ...gcalSettings, [field]: calId || null };
    if (field === 'teamCalendarId') {
      saveTeamCalendarId(calId || null).catch(console.error);
      setGcalSettingsState(updated);
    } else {
      saveGCalSettings(updated);
      setGcalSettingsState(updated);
    }
    if (calId) gcalService.ensureWatch(calId, 'bflow').catch(() => {});
  }

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">연동 상태</h2>
        <p className="text-xs text-text-secondary mt-0.5">
          현재 데이터 소스 및 외부 서비스 연결을 관찰·진단합니다.
        </p>
      </div>

      {/* Overview — 한눈 파악 */}
      <IntegrationOverview />

      {/* Supabase 상세 — 메인 데이터 소스 */}
      <SupabaseStatusCard />

      {/* External integrations */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/80 mb-2 px-1">
          EXTERNAL INTEGRATIONS
        </div>
        <div className="space-y-2">

          {/* ── 이미지 업로드 서버 (GAS) ── */}
          <IntegrationCard
            id="gas"
            icon={<Layers size={14} />}
            iconColor="rgb(var(--color-accent))"
            title="이미지 업로드 서버"
            subtitle="Apps Script 웹 앱"
            status={dataConnected ? 'connected' : 'disconnected'}
            defaultCollapsed
          >
            <label className="block text-[11px] text-text-secondary mb-1.5">Web App URL</label>
            <input
              type="text"
              value={webAppUrl}
              onChange={(e) => setWebAppUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-2 text-[12px] font-mono text-text-primary focus:outline-none focus:border-accent mb-3"
            />
            {connectError && (
              <div className="mb-3 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-md text-[11px] text-red-400">
                {connectError}
              </div>
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={handleConnect} disabled={isConnecting || !webAppUrl} className={btnStyles.primary}>
                {isConnecting ? '연결 중...' : '연결 테스트'}
              </button>
              <button onClick={handleSave} disabled={!webAppUrl} className={btnStyles.ghost}>
                설정 저장
              </button>
              {saveMessage && <span className="text-[11px] text-emerald-400">{saveMessage}</span>}
            </div>
          </IntegrationCard>

          {/* ── 휴가 관리 API ── */}
          <IntegrationCard
            id="vacation"
            icon={<Palmtree size={14} />}
            iconColor="rgb(52 211 153)"
            title="휴가 관리 API"
            subtitle="vacation-repo Apps Script"
            status={vacationConnected ? 'connected' : 'disconnected'}
            defaultCollapsed
          >
            <label className="block text-[11px] text-text-secondary mb-1.5">Web App URL</label>
            <input
              type="text"
              value={vacationUrl}
              onChange={(e) => setVacationUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-2 text-[12px] font-mono text-text-primary focus:outline-none focus:border-accent mb-3"
            />
            {vacationError && (
              <div className="mb-3 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-md text-[11px] text-red-400">
                {vacationError}
              </div>
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={handleVacationConnect} disabled={isVacationConnecting || !vacationUrl} className={btnStyles.primary}>
                {isVacationConnecting ? '연결 중...' : '연결 테스트'}
              </button>
              <button onClick={handleVacationSave} disabled={!vacationUrl} className={btnStyles.ghost}>
                설정 저장
              </button>
              {vacationSaveMessage && <span className="text-[11px] text-emerald-400">{vacationSaveMessage}</span>}
            </div>
          </IntegrationCard>

          {/* ── Google Calendar ── */}
          <IntegrationCard
            id="gcal"
            icon={<Calendar size={14} />}
            iconColor="rgb(96 165 250)"
            title="Google Calendar"
            subtitle="OAuth 2.0 · @studiojbbj.com"
            status={gcalAuth ? 'connected' : 'disconnected'}
            defaultCollapsed={!gcalAuth}
          >
            {!gcalAuth && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowCredsForm((v) => !v)}
                  className="inline-flex items-center gap-2 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer"
                >
                  <span>자격 증명 (clientId / clientSecret)</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                    style={{
                      background: gcalHasCreds ? 'rgb(34 197 94 / 0.12)' : 'rgb(245 158 11 / 0.12)',
                      color: gcalHasCreds ? 'rgb(74 222 128)' : 'rgb(251 191 36)',
                    }}
                  >
                    {gcalHasCreds ? '설정됨' : '미설정'}
                  </span>
                </button>

                {showCredsForm && (
                  <div className="mt-2 p-3 bg-bg-primary/40 border border-bg-border/40 rounded-md">
                    <p className="text-[11px] text-text-secondary/70 mb-2 leading-relaxed">
                      Google Cloud Console 에서 OAuth 2.0 <b>데스크톱 앱</b> 유형의 클라이언트를 만들고, 발급받은 clientId / clientSecret 을 아래에 입력하세요.
                      입력 값은 로컬 파일(<code className="text-text-secondary font-mono">%APPDATA%/Bflow-BGonly/gcal-credentials.json</code>)에만 저장됩니다.
                    </p>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-text-secondary mb-1">Client ID</label>
                        <input
                          type="text"
                          value={gcalClientId}
                          onChange={(e) => setGcalClientId(e.target.value)}
                          placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                          className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-1.5 text-[12px] font-mono text-text-primary outline-none focus:border-accent"
                          autoComplete="off" spellCheck={false}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-text-secondary mb-1">Client Secret</label>
                        <input
                          type="password"
                          value={gcalClientSecret}
                          onChange={(e) => setGcalClientSecret(e.target.value)}
                          placeholder="GOCSPX-..."
                          className="w-full bg-bg-primary border border-bg-border rounded-md px-2.5 py-1.5 text-[12px] font-mono text-text-primary outline-none focus:border-accent"
                          autoComplete="off" spellCheck={false}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={handleSaveGcalCredentials}
                        disabled={credsSaving || !gcalClientId.trim() || !gcalClientSecret.trim()}
                        className={btnStyles.primary}
                      >
                        {credsSaving ? '저장 중...' : '자격 증명 저장'}
                      </button>
                      <button
                        onClick={() => { setShowCredsForm(false); setGcalClientId(''); setGcalClientSecret(''); }}
                        className={btnStyles.ghost}
                      >
                        취소
                      </button>
                      {credsMessage && <span className="text-[11px] text-emerald-400">{credsMessage}</span>}
                    </div>
                  </div>
                )}
                {!showCredsForm && credsMessage && (
                  <p className="mt-2 text-[11px] text-emerald-400">{credsMessage}</p>
                )}
              </div>
            )}

            {!gcalAuth ? (
              <button onClick={handleGcalConnect} disabled={gcalConnecting} className={btnStyles.primary}>
                {gcalConnecting ? '연결 중...' : 'Google 계정 연결'}
              </button>
            ) : (
              <>
                <div className="mb-3 rounded-md border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold text-text-secondary">현재 연동 상태</span>
                    <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                      인증 유지됨
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary/75">
                    앱을 다시 열어도 인증이 유지됩니다. 토큰이 만료되거나 Google에서 권한을 거절하면 이 영역이 재인증 필요 상태로 바뀝니다.
                  </p>
                  {gcalAuthCheckedAt && (
                    <p className="mt-1.5 text-[10px] font-mono text-text-secondary/50">
                      마지막 인증 확인: {new Date(gcalAuthCheckedAt).toLocaleString('ko-KR')}
                    </p>
                  )}
                </div>
                <div className="mb-3 rounded-md border border-bg-border/50 bg-bg-primary/40 px-3 py-2.5">
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    공개 일정은 로그인하신 Google 계정(<span className="text-text-primary">@studiojbbj.com</span>) 의 <b>기본 캘린더</b>에
                    저장되어 동료와 공유됩니다.
                    <br />
                    <b>🔒 나만 보기</b> 체크한 일정은 Google Calendar 에 올라가지 않고 이 앱에만 저장되어 동료에게 노출되지 않습니다.
                  </p>
                </div>
                {gcalSettings.lastSyncAt && (
                  <p className="text-[11px] text-text-secondary/60 mb-3 font-mono">
                    마지막 동기화: {new Date(gcalSettings.lastSyncAt).toLocaleString('ko-KR')}
                  </p>
                )}
                <div className="flex gap-2 flex-wrap items-center">
                  <button onClick={handleGcalSync} disabled={isSyncing} className={btnStyles.primary}>
                    {isSyncing ? '동기화 중...' : '지금 동기화'}
                  </button>
                  <button onClick={handleGcalDisconnect} className={btnStyles.danger}>
                    연결 해제
                  </button>
                  {syncMessage && <span className="text-[11px] text-emerald-400">{syncMessage}</span>}
                </div>
              </>
            )}

            {gcalError && (
              <div className="mt-3 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-md text-[11px] text-red-400 whitespace-pre-line leading-relaxed">
                {gcalError}
              </div>
            )}
          </IntegrationCard>

        </div>
      </div>
    </div>
  );
}
