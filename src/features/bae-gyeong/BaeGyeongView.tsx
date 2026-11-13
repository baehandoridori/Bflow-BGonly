/**
 * BAE경 (Bflow 사이드바의 별도 메뉴, 景). 위쪽 탭: 작업대 · 기록 · 비용(검수자) · 설정 (14e 1장: '만들기' 탭은 뺐다).
 * 이 화면에 들어오는 길은 `canAccessBaeGyeong`(featureFlag.ts)을 거치고, 실제로 막는 것은 서버 함수다.
 */
import { useEffect } from 'react';
import { AlertTriangle, MonitorCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import { useBaeStore, type BaeTab } from './useBaeStore';
import { Workbench, type BaeStartKind } from './home/Workbench';
import { BaeSettingsTab } from './settings/BaeSettingsTab';
import './bae-gyeong.css';

const START_LABEL: Record<BaeStartKind, string> = { new: '새 배경 만들기', same: '같은 장소 다른 컷', layers: '레이어로 나누기', angle: '다른 각도로', upscale: '4K로 키우기', denoise: '노이즈 제거' };

export default function BaeGyeongView() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { access, loading, error, tab, setTab, start, keyStatus } = useBaeStore();
  useEffect(() => { void start(currentUser?.id ?? null); }, [currentUser?.id, start]);

  const tabs: Array<{ id: BaeTab; label: string; show: boolean }> = [
    { id: 'bench', label: '작업대', show: true },
    { id: 'records', label: '기록', show: true },
    { id: 'costs', label: '비용', show: access.canReview },
    { id: 'settings', label: '설정', show: true },
  ];
  const active = tabs.find((t) => t.id === tab && t.show)?.id ?? 'bench';
  const onStart = (kind: BaeStartKind) => toast.message(`${START_LABEL[kind]} 창은 다음 단계에서 열려요.`);

  if (error) {
    return (
      <div className="bae-root">
        <div className="bae-msg" role="alert">
          <p className="bae-msg-title">BAE경을 불러오지 못했어요</p>
          <p className="bae-msg-text">{error}</p>
          <button type="button" className="bae-btn bae-btn-s" onClick={() => void useBaeStore.getState().refresh()}>다시 시도</button>
        </div>
      </div>
    );
  }
  if (!loading && !access.canUse) {
    return (
      <div className="bae-root">
        <div className="bae-msg">
          <p className="bae-msg-title">BAE경을 쓸 권한이 없어요</p>
          <p className="bae-msg-text">관리자에게 'BAE경 사용자'로 지정해 달라고 요청해 주세요.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="bae-root" data-bae-tab={active}>
      <nav className="bae-tabs" aria-label="BAE경 안의 화면">
        <div className="bae-tablist">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} type="button" className="bae-tab" aria-current={active === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="bae-usage">
          <dl className="bae-month"><dt>이번 달 내 사용</dt><dd className="bae-num">0장</dd><dd className="bae-num">0원</dd></dl>
          <button type="button" className={`bae-btn bae-btn-ghost bae-btn-s bae-pc${keyStatus?.hasKey ? '' : ' is-not-ready'}`} onClick={() => setTab('settings')}>
            {keyStatus?.hasKey ? <MonitorCheck size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
            {keyStatus?.hasKey ? '이 PC 준비됨' : '키가 아직 없어요'}
          </button>
        </div>
      </nav>
      {active === 'bench' && <Workbench onStart={onStart} />}
      {active === 'records' && (
        <section className="bae-log" aria-label="기록">
          <div className="bae-log-msg"><p className="bae-msg-title">아직 만든 그림이 없어요</p><p className="bae-msg-text">작업대의 새 배경 만들기로 시작하면 여기에 쌓여요.</p></div>
        </section>
      )}
      {active === 'costs' && (
        <section className="bae-log" aria-label="비용">
          <div className="bae-log-msg"><p className="bae-msg-title">이번 달 쓴 돈이 아직 없어요</p><p className="bae-msg-text">그림을 만들 때마다 누가 · 무엇에 · 얼마를 썼는지 여기에 모여요.</p></div>
        </section>
      )}
      {active === 'settings' && <BaeSettingsTab />}
    </div>
  );
}
