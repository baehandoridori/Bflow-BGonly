// ─── 씬 모달 점프 버튼 (v1.19.0, 코덱스 P1 fix 2026-05-05) ──────────
//
// store-based pending modal request → ScenesView 마운트 후 안정 처리.
// 컴포지팅 뷰처럼 ScenesView 가 미마운트인 상태에서도 setView('scenes') 후 자동 처리.
// (이전 CustomEvent 패턴은 listener 등록 race 로 이벤트 손실 가능했음)

import { ExternalLink } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { parseSceneKey } from './utils';

interface Props {
  sceneKey: string;
  variant?: 'icon' | 'link' | 'chip';
  episodeNumber?: number;
  partId?: string;
  sceneUuid?: string;
}

export function SceneJumpButton({
  sceneKey,
  variant = 'icon',
  episodeNumber,
  partId,
  sceneUuid,
}: Props) {
  const setView = useAppStore((s) => s.setView);
  const setPendingSceneModalRequest = useAppStore((s) => s.setPendingSceneModalRequest);

  function handleJump(e: React.MouseEvent) {
    e.stopPropagation();
    const parsed = parseSceneKey(sceneKey);
    // ep 토큰은 보통 "EP01_A_BG" 같은 sheetName 인 경우가 많아 숫자만 파싱.
    const epNum = episodeNumber ?? (parseInt(parsed.ep.replace(/\D/g, ''), 10) || 0);
    // store 에 먼저 request 저장 → setView('scenes') → ScenesView 마운트 후 useEffect 가 처리.
    setPendingSceneModalRequest({
      episodeNumber: epNum,
      partId: partId ?? parsed.part,
      sceneUuid,
      sceneName: parsed.sceneId,
      initialTab: 'revisions',
    });
    setView('scenes');
  }

  if (variant === 'link') {
    return (
      <button
        onClick={handleJump}
        className="text-[10px] text-accent-sub hover:underline flex items-center gap-1 cursor-pointer"
      >
        <ExternalLink className="w-2.5 h-2.5" />
        씬 상세
      </button>
    );
  }

  if (variant === 'chip') {
    return (
      <button
        onClick={handleJump}
        title="씬 상세 모달 열기"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-accent/35 bg-accent/10 text-[11px] font-bold text-accent-sub hover:bg-accent/18 transition-colors cursor-pointer"
      >
        <ExternalLink className="w-3 h-3" />
        씬 상세
      </button>
    );
  }

  return (
    <button
      onClick={handleJump}
      title="씬 상세 모달 열기"
      className="p-1 rounded hover:bg-accent/15 text-text-secondary hover:text-accent-sub transition-colors cursor-pointer"
    >
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  );
}
