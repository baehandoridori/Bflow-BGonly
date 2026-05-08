/**
 * v1.23.0: 좌하단 버전 버튼 호버 시 우측에 나타나는 floating 툴팁.
 * 브라우저 기본 title 속성이 좁은 사이드바 영역 밖으로 삐져나오는 문제 해결.
 */
import type { UpdateInfo } from '@/types';

export type VersionHoverState = 'latest' | 'available' | 'failed' | 'suppressed' | 'checking';

interface Props {
  show: boolean;
  state: VersionHoverState;
  currentVersion: string;
  latestVersion: string;
  buildAt?: string;
  message?: string;
}

export function VersionHoverTip({ show, state, currentVersion, latestVersion, buildAt, message }: Props) {
  const labelKey = state === 'latest' ? '최신 상태'
                : state === 'available' ? `새 버전 v${latestVersion} 준비됨`
                : state === 'failed' ? '업데이트 실패'
                : state === 'suppressed' ? '자동 업데이트 중단됨'
                : '확인 중';
  const tone = state === 'available' ? 'text-accent-sub'
             : (state === 'failed' || state === 'suppressed') ? 'text-[#FDCB6E]'
             : 'text-text-secondary';

  return (
    <div
      role="tooltip"
      className={`absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 bg-bg-card/97 border border-bg-border rounded-[10px] px-3.5 py-2.5 min-w-[240px] max-w-[300px] shadow-[0_18px_40px_rgba(0,0,0,0.45)] text-[12px] text-text-primary z-[60] pointer-events-none transition-opacity duration-150 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* 좌측 화살표 */}
      <div
        className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0"
        style={{
          borderTop: '7px solid transparent',
          borderBottom: '7px solid transparent',
          borderRight: '8px solid rgb(var(--color-bg-border))',
        }}
      />

      <div className={`text-[10.5px] uppercase tracking-[0.14em] mb-1 font-semibold ${tone}`}>
        {labelKey}
      </div>
      {message && (
        <div className="text-[12.5px] text-text-primary mb-2 leading-relaxed">{message}</div>
      )}
      <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
        <span>현재 버전</span>
        <b className="text-text-primary font-mono">v{currentVersion}</b>
      </div>
      {state === 'available' && (
        <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
          <span>준비된 버전</span>
          <b className="font-mono text-accent-sub">v{latestVersion}</b>
        </div>
      )}
      {(state === 'failed' || state === 'suppressed') && latestVersion !== currentVersion && (
        <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
          <span>대상 버전</span>
          <b className="font-mono">v{latestVersion}</b>
        </div>
      )}
      {buildAt && (
        <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
          <span>빌드 시각</span>
          <b className="text-text-primary">{buildAt}</b>
        </div>
      )}
    </div>
  );
}

/** UpdateInfo → VersionHoverState 매퍼 */
export function deriveHoverState(updateInfo: UpdateInfo | null | undefined): VersionHoverState {
  if (!updateInfo) return 'checking';
  const hasRemote = updateInfo.latestVersion !== updateInfo.currentVersion
    && updateInfo.status !== 'up-to-date'
    && updateInfo.status !== 'suppressed';
  if (hasRemote) return 'available';
  if (updateInfo.status === 'failed') return 'failed';
  if (updateInfo.status === 'suppressed') return 'suppressed';
  return 'latest';
}
