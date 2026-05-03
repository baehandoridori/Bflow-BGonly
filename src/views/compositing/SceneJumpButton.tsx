// ─── 씬 모달 점프 버튼 (v1.19.0) ──────────
//
// 'bflow:open-scene-modal' CustomEvent 발화 → ScenesView 가 listen 하여 모달 자동 오픈.
// 알려진 episodeNumber/partId/sceneUuid 가 있으면 정확하게 전달, 없으면 sceneKey 파싱 폴백.

import { ExternalLink } from 'lucide-react';
import { parseSceneKey } from './utils';

interface Props {
  sceneKey: string;
  variant?: 'icon' | 'link';
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
  function handleJump(e: React.MouseEvent) {
    e.stopPropagation();
    const parsed = parseSceneKey(sceneKey);
    // ep 토큰은 보통 "EP01_A_BG" 같은 sheetName 인 경우가 많아 숫자만 파싱.
    const epNum = episodeNumber ?? (parseInt(parsed.ep.replace(/\D/g, ''), 10) || 0);
    window.dispatchEvent(
      new CustomEvent('bflow:open-scene-modal', {
        detail: {
          episodeNumber: epNum,
          partId: partId ?? parsed.part,
          sceneUuid,
          sceneName: parsed.sceneId,
          initialTab: 'revisions',
        },
      }),
    );
  }

  if (variant === 'link') {
    return (
      <button
        onClick={handleJump}
        className="text-[10px] text-accent-sub hover:underline flex items-center gap-1 cursor-pointer"
      >
        <ExternalLink className="w-2.5 h-2.5" />
        씬 모달 열기
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
