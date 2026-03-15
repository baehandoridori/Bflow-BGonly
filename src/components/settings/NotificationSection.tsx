import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Volume2, MapPin, Eye, MessageSquare, RefreshCw } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

/** 알림 토글 행 */
function NotiToggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-text-primary">{label}</p>
        <p className="text-[10px] text-text-secondary/40">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer shrink-0 ml-3',
          checked ? 'bg-accent' : 'bg-bg-border/50',
        )}
      >
        <div className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )} />
      </button>
    </div>
  );
}

/** 인라인 토스트 미리보기 (Sonner 랜딩페이지 스타일, 테마 연동) */
function ToastPreviewCard({ title, description, actionLabel }: {
  title: string; description: string; actionLabel?: string;
}) {
  return (
    <div className="rounded-lg px-3.5 py-2.5 flex items-center gap-3 bg-bg-card/90 backdrop-blur-xl border border-bg-border/35 shadow-lg">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-text-primary leading-snug">{title}</p>
        <p className="text-[12px] text-text-secondary mt-0.5 leading-relaxed truncate">{description}</p>
      </div>
      {actionLabel && (
        <span className="shrink-0 text-[12px] font-medium px-3 py-1 rounded-md bg-accent/12 text-accent-sub border border-accent/25">
          {actionLabel}
        </span>
      )}
    </div>
  );
}

export function NotificationSection() {
  const [notiSceneChange, setNotiSceneChange] = useState(true);
  const [notiCommentNotify, setNotiCommentNotify] = useState(true);
  const [notiSyncComplete, setNotiSyncComplete] = useState(false);
  const [notiSound, setNotiSound] = useState(true);
  const [notiOsNotification, setNotiOsNotification] = useState(true);
  const [toastPosition, setToastPosition] = useState<string>('bottom-right');
  const [toastDuration, setToastDuration] = useState<number>(3000);
  const prefsLoaded = useRef(false);

  useEffect(() => {
    if (prefsLoaded.current) return;
    prefsLoaded.current = true;
    loadPreferences().then((prefs) => {
      if (prefs?.notifications) {
        setNotiSceneChange(prefs.notifications.sceneChange ?? true);
        setNotiCommentNotify(prefs.notifications.commentNotify ?? true);
        setNotiSyncComplete(prefs.notifications.syncComplete ?? false);
        setNotiSound(prefs.notifications.sound ?? true);
        setNotiOsNotification(prefs.notifications.osNotification ?? true);
        if (prefs.notifications.toastPosition) setToastPosition(prefs.notifications.toastPosition);
        if (prefs.notifications.toastDuration) setToastDuration(prefs.notifications.toastDuration);
      }
    });
  }, []);

  const persistPref = useCallback(async (patch: Record<string, unknown>) => {
    const existing = await loadPreferences() ?? {};
    await savePreferences({ ...existing, ...patch });
  }, []);

  const persistNoti = useCallback((patch: Record<string, unknown>) => {
    const next = {
      sceneChange: notiSceneChange, commentNotify: notiCommentNotify,
      syncComplete: notiSyncComplete, sound: notiSound,
      osNotification: notiOsNotification, toastPosition, toastDuration,
      ...patch,
    };
    persistPref({ notifications: next });
    // notiSettingsRef 업데이트 이벤트
    window.dispatchEvent(new CustomEvent('bflow:noti-settings-changed', {
      detail: { sceneChange: next.sceneChange, commentNotify: next.commentNotify, osNotification: next.osNotification, sound: next.sound },
    }));
  }, [persistPref, notiSceneChange, notiCommentNotify, notiSyncComplete, notiSound, notiOsNotification, toastPosition, toastDuration]);

  const handleNotiToggle = useCallback((key: string, value: boolean) => {
    if (key === 'sceneChange') setNotiSceneChange(value);
    else if (key === 'commentNotify') setNotiCommentNotify(value);
    else if (key === 'syncComplete') setNotiSyncComplete(value);
    else if (key === 'sound') setNotiSound(value);
    else if (key === 'osNotification') setNotiOsNotification(value);
    persistNoti({ [key]: value });
  }, [persistNoti]);

  return (
    <SettingsSection
      icon={<Bell size={18} className="text-amber-400" />}
      title="알림 설정"
    >
      {/* ════════════ 알림 토글 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Bell size={15} className="text-amber-400" />
          <span className="text-[13px] font-semibold text-text-primary">알림 유형</span>
        </div>
        <div className="space-y-2.5">
          <NotiToggle
            label="내 씬 변경 알림"
            description="배정된 씬의 단계가 변경되면 알려줍니다"
            checked={notiSceneChange}
            onChange={(v) => handleNotiToggle('sceneChange', v)}
          />
          <NotiToggle
            label="내 씬 댓글 알림"
            description="배정된 씬에 댓글이 달리면 알려줍니다"
            checked={notiCommentNotify}
            onChange={(v) => handleNotiToggle('commentNotify', v)}
          />
          <NotiToggle
            label="동기화 완료 알림"
            description="데이터 동기화가 완료되면 알려줍니다"
            checked={notiSyncComplete}
            onChange={(v) => handleNotiToggle('syncComplete', v)}
          />
          <NotiToggle
            label="OS 데스크톱 알림"
            description="앱이 백그라운드일 때 시스템 알림을 표시합니다"
            checked={notiOsNotification}
            onChange={(v) => handleNotiToggle('osNotification', v)}
          />

          {/* 알림 소리 토글 */}
          <div className="flex items-center justify-between pt-1 border-t border-bg-border/15">
            <div className="flex items-center gap-2">
              <Volume2 size={13} className="text-text-secondary/50" />
              <span className="text-[12px] text-text-secondary/70">알림 소리</span>
            </div>
            <button
              onClick={() => handleNotiToggle('sound', !notiSound)}
              className={cn(
                'relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer',
                notiSound ? 'bg-accent' : 'bg-bg-border/50',
              )}
            >
              <div className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                notiSound ? 'translate-x-4' : 'translate-x-0.5',
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* ════════════ 토스트 표시 설정 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <MapPin size={15} className="text-accent" />
          <span className="text-[13px] font-semibold text-text-primary">토스트 표시</span>
        </div>

        {/* 토스트 위치 선택 */}
        <div className="mb-3">
          <span className="text-[11px] text-text-secondary/50 mb-2 block">표시 위치</span>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { value: 'top-left', label: '↖ 좌상' },
              { value: 'top-center', label: '↑ 중상' },
              { value: 'top-right', label: '↗ 우상' },
              { value: 'bottom-left', label: '↙ 좌하' },
              { value: 'bottom-center', label: '↓ 중하' },
              { value: 'bottom-right', label: '↘ 우하' },
            ] as const).map((pos) => (
              <button
                key={pos.value}
                onClick={() => {
                  setToastPosition(pos.value);
                  persistNoti({ toastPosition: pos.value });
                  window.dispatchEvent(new CustomEvent('bflow:toast-settings-changed', { detail: { toastPosition: pos.value } }));
                }}
                className={cn(
                  'text-[10px] px-2 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer',
                  toastPosition === pos.value
                    ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                    : 'bg-bg-card/30 border-bg-border/20 text-text-secondary/60 hover:border-bg-border/40',
                )}
              >
                {pos.label}
              </button>
            ))}
          </div>
        </div>

        {/* 토스트 표시 시간 */}
        <div className="mb-3">
          <span className="text-[11px] text-text-secondary/50 mb-2 block">표시 시간</span>
          <div className="flex gap-1.5">
            {([
              { value: 3000, label: '3초' },
              { value: 5000, label: '5초' },
              { value: 7000, label: '7초' },
              { value: 10000, label: '10초' },
            ] as const).map((dur) => (
              <button
                key={dur.value}
                onClick={() => {
                  setToastDuration(dur.value);
                  persistNoti({ toastDuration: dur.value });
                  window.dispatchEvent(new CustomEvent('bflow:toast-settings-changed', { detail: { toastDuration: dur.value } }));
                }}
                className={cn(
                  'flex-1 text-[11px] px-2 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer',
                  toastDuration === dur.value
                    ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                    : 'bg-bg-card/30 border-bg-border/20 text-text-secondary/60 hover:border-bg-border/40',
                )}
              >
                {dur.label}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ════════════ 미리보기 ════════════ */}
      <div className="w-full bg-bg-primary/40 rounded-xl border border-bg-border/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Eye size={15} className="text-emerald-400" />
          <span className="text-[13px] font-semibold text-text-primary">미리보기</span>
        </div>

        {/* 인라인 토스트 미리보기 */}
        <div className="space-y-2 mb-3">
          <ToastPreviewCard
            title="a001 — PNG ✓"
            description="다른 사용자가 내 씬의 단계를 변경했습니다"
            actionLabel="씬 보기"
          />
          <ToastPreviewCard
            title="김작가님이 댓글을 남겼습니다"
            description="a012 — 수정 부탁드려요~"
          />
        </div>

        {/* 실제 토스트 발사 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              sonnerToast('a001 — PNG ✓', {
                description: '다른 사용자가 내 씬의 단계를 변경했습니다',
                action: { label: '씬 보기', onClick: () => {} },
              });
            }}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-accent hover:text-accent/80 bg-accent/5 hover:bg-accent/10 rounded-lg py-2 transition-colors cursor-pointer border border-accent/10"
          >
            <RefreshCw size={11} />
            씬 변경 알림
          </button>
          <button
            onClick={() => {
              sonnerToast('김작가님이 댓글을 남겼습니다', {
                description: 'a012 — 수정 부탁드려요~',
              });
            }}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-accent hover:text-accent/80 bg-accent/5 hover:bg-accent/10 rounded-lg py-2 transition-colors cursor-pointer border border-accent/10"
          >
            <MessageSquare size={11} />
            댓글 알림
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
