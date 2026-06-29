/**
 * SceneDetailModal (위젯 전용) — 내 할일 위젯의 씬 상세/편집 모달 (확정 C)
 *
 * 씬 메모 편집을 메인 리스트 행(읽기 전용)에서 제거하고, 이 모달 안에서만 제공한다.
 * 메인 행은 본문 클릭 시 이 모달을 연다(체크박스/제거/이동 버튼은 독립).
 *
 * ⚠️ 본체 앱의 복잡한 2열 씬 상세(src/components/scenes/SceneDetailModal.tsx)와는
 * 완전히 별개다. 이 모달은 위젯 전용의 단순 1열 모달이며, 본체 모달을 가져다 쓰지 않는다.
 *
 * 동기화: 메모 편집은 blur/Enter 에 onEditField(flat, 'memo', value)로 커밋된다(낙관적 반영).
 * 부모(MyTasksWidget)가 선택된 씬을 key 로 매 렌더 재추출해 다시 내려주므로,
 * 이 모달의 flat prop 은 항상 최신 값을 반영한다(스냅샷 stale 방지).
 */

import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { Stage } from '@/types';
import { cn } from '@/utils/cn';
import type { FlatScene } from '../types';
import { ModalPortal } from './ModalPortal';

export function SceneDetailModal({
  flat,
  onToggle,
  onEditField,
  onNavigateToMain,
  onClose,
}: {
  flat: FlatScene;
  onToggle: (flat: FlatScene, stage: Stage) => void;
  onEditField: (flat: FlatScene, field: string, value: string) => void;
  /** 본체(메인 앱)의 씬 상세로 이동. 대시보드/팝업 분기는 위젯이 소유한다. */
  onNavigateToMain: (flat: FlatScene) => void;
  onClose: () => void;
}) {
  const s = flat.scene;
  const users = useAuthStore((u) => u.users);
  const deptCfg = DEPARTMENT_CONFIGS[flat.department];

  const epLabel = `EP.${String(flat.episodeNumber).padStart(2, '0')}`;
  const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no);

  const imageUrl = s.guideUrl || s.storyboardUrl;

  // 메모는 입력 중 로컬 상태로 두고 blur/Enter 에 커밋(매 키 입력마다 쓰기 방지).
  // flat.scene.memo 가 외부에서 바뀌면(스토어 재추출) 동기화하되, 편집(포커스) 중이면 건너뛴다(클로버 방지).
  const [editMemo, setEditMemo] = useState(s.memo);
  const memoFocusedRef = useRef(false);
  useEffect(() => { if (!memoFocusedRef.current) setEditMemo(s.memo); }, [s.memo]);

  const commitMemo = () => {
    if (editMemo !== s.memo) {
      onEditField(flat, 'memo', editMemo);
    }
  };

  return (
    <ModalPortal onClose={onClose} labelledBy="scene-detail-title" maxWidth={440}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-border/30">
        <span id="scene-detail-title" className="text-sm font-semibold text-text-primary truncate">
          {epLabel} &gt; {flat.partId} <span className="font-mono text-accent">#{sceneNum}</span>
        </span>
        <button
          type="button"
          onClick={() => onNavigateToMain(flat)}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-bg-border/50 text-text-secondary hover:text-accent hover:border-accent/40 cursor-pointer transition-colors shrink-0"
          title="본체 앱의 씬 상세로 이동"
        >
          <ExternalLink size={12} />
          본체 씬 상세로 이동
        </button>
        <button onClick={onClose} className="p-1 hover:bg-bg-border/20 rounded-md cursor-pointer shrink-0"><X size={16} /></button>
      </div>

      {/* 본문 */}
      <div className="flex flex-col gap-3 px-4 py-4 flex-1 overflow-auto">
        {/* 씬 이름 */}
        <div className="text-[13px] font-semibold text-text-primary">{s.sceneId}</div>

        {/* 단계 트랙 (순차 토글) */}
        <div className="flex bg-bg-primary rounded-md p-0.5 border border-bg-border gap-0.5 w-fit">
          {STAGES.map((stage, i) => {
            const checked = s[stage];
            const color = deptCfg.stageColors[stage];
            const isCurrent = checked && (i === STAGES.length - 1 || !s[STAGES[i + 1]]);
            const label = deptCfg.stageLabels[stage];
            return (
              <button
                key={stage}
                onClick={() => onToggle(flat, stage)}
                title={label}
                className={cn(
                  'px-3 h-7 rounded text-[12px] font-medium flex items-center justify-center cursor-pointer transition-all',
                  !checked && 'text-text-secondary/40 hover:text-text-secondary/70',
                )}
                style={
                  isCurrent
                    ? { backgroundColor: color, color: '#000', fontWeight: 700 }
                    : checked
                    ? { backgroundColor: `${color}25`, color }
                    : undefined
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 이미지 (가이드 우선 > 스보) */}
        <div className="rounded-lg border border-bg-border/40 bg-bg-primary/40 overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt={`${s.sceneId} 이미지`} className="w-full max-h-56 object-contain" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 py-8 text-text-secondary/30">
              <ImageIcon size={22} className="opacity-50" />
              <span className="text-[11px]">등록된 이미지가 없습니다</span>
            </div>
          )}
        </div>

        {/* 메모 (#태그 사용) */}
        <div>
          <label className="text-[11px] text-text-secondary/60 mb-1.5 block">메모</label>
          <EntityAwareInput
            multiline
            aria-label="메모"
            value={editMemo}
            /* EntityAwareInput 은 onFocus 를 노출하지 않아, 입력(onChange) 시점에 '편집 중'으로 표시한다.
               (외부 동기화 클로버는 사용자가 실제 타이핑 중일 때만 문제이므로 충분히 커버된다.) */
            onChange={(v) => { memoFocusedRef.current = true; setEditMemo(v); }}
            onBlur={() => { memoFocusedRef.current = false; commitMemo(); }}
            submitOn="ctrl-enter"
            onSubmit={commitMemo}
            users={users}
            enableHashtag
            placeholder="메모 (선택) — #씬번호 로 다른 씬 연결"
            rows={3}
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 placeholder:text-text-secondary/30 resize-none"
          />
          {s.memo && (
            <div className="mt-1.5 text-[11px] text-text-secondary/50 break-words">
              <EntityText text={s.memo} userNames={users.map((u) => u.name)} onHashClick={navigateToHashTarget} />
            </div>
          )}
        </div>
      </div>

      {/* 하단 액션 */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bg-border/30">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-bg-border/50 text-text-secondary hover:text-text-primary cursor-pointer">닫기</button>
      </div>
    </ModalPortal>
  );
}
