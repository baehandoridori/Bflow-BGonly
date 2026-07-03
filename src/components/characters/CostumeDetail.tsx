import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import {
  COSTUME_DESIGN_STAGES,
  COSTUME_RIGGING_STAGES,
  type Character,
  type CharacterCostume,
} from '@/types';
import { AssigneeNamePicker } from '@/components/characters/AssigneeNamePicker';
import { StageRail } from '@/components/characters/StageRail';
import { TagChipSection } from '@/components/characters/TagChips';
import { claimReactKey } from '@/utils/claimReactKey';
import { DESIGN_STAGE_META, RIGGING_STAGE_META } from '@/constants/characterStages';
import {
  displayCharacterPathName,
  openStoredCharacterPath,
} from '@/services/characterPathActions';

// 미리 정의된 태그 팔레트 — 토글 칩으로 노출.
const STRUCTURE_TAG_PALETTE = ['얼굴각도 컨트롤러', '책가방 세트', '뒷모습', '앞모습 없음', '측면'] as const;
const ASSET_TAG_PALETTE = ['담배', '핸드폰', '가방', '안경', '모자'] as const;

function PathActionRow({
  label,
  path,
  onPick,
  onOpen,
  onCreate,
  creating = false,
}: {
  label: string;
  path: string | null;
  onPick: () => void;
  onOpen: () => void;
  onCreate?: () => void;
  creating?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-bg-border/70 bg-bg-border/10 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        <div className="text-sm text-text-primary truncate" title={path ?? undefined}>{displayCharacterPathName(path)}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {!path && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            title="기준 경로에 캐릭터 이름으로 폴더를 만들어 연결"
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {creating && <Loader2 size={11} className="animate-spin" />}
            만들기
          </button>
        )}
        <button
          type="button"
          onClick={onPick}
          disabled={creating}
          className="rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50 disabled:opacity-50"
        >
          선택
        </button>
        {path && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-md border border-bg-border px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-text-secondary/50"
          >
            열기
          </button>
        )}
      </div>
    </div>
  );
}

function VersionNumberInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    focused.current = false;
    const n = Number(draft);
    const next = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      min={1}
      value={draft}
      aria-label="버전 번호"
      onFocus={() => { focused.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') {
          claimReactKey(event);
          focused.current = false;
          setDraft(String(value));
          (event.target as HTMLInputElement).blur();
        }
      }}
      className="w-14 rounded-md border border-bg-border bg-transparent px-1 py-1 text-center text-text-primary outline-none focus:border-accent/50"
    />
  );
}

/** 선택 복장의 진행 상세 — 버전·작업 경로·단계별 담당자·태그. */
export function CostumeDetail({
  character,
  costume,
  onPickFolder,
  onPickFile,
  onCreateFolder,
  creatingFolder,
}: {
  character: Character;
  costume: CharacterCostume;
  onPickFolder: () => void;
  onPickFile: () => void;
  onCreateFolder: () => void;
  creatingFolder: boolean;
}) {
  const updateCostumeStage = useCharacterBoardStore((s) => s.updateCostumeStage);
  const updateCostumeField = useCharacterBoardStore((s) => s.updateCostumeField);
  const setCostumeTags = useCharacterBoardStore((s) => s.setCostumeTags);
  const setVersion = useCharacterBoardStore((s) => s.setVersion);

  return (
    <div className="flex flex-col gap-5">
      {/* 버전 */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-text-secondary">버전</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="버전 내리기"
              className="h-8 w-8 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.max(1, Math.floor(costume.versionNo) - 1))}
            >
              −
            </button>
            <VersionNumberInput value={costume.versionNo} onCommit={(next) => setVersion(costume.id, next)} />
            <button
              type="button"
              aria-label="버전 올리기"
              className="h-8 w-8 rounded-md border border-bg-border text-text-primary hover:bg-bg-border/40 cursor-pointer"
              onClick={() => setVersion(costume.id, Math.floor(costume.versionNo) + 1)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* 작업 경로 */}
      <div className="grid gap-2 md:grid-cols-2">
        <PathActionRow
          label="작업 폴더"
          path={character.workFolderPath}
          onPick={onPickFolder}
          onOpen={() => openStoredCharacterPath(character.workFolderPath, '작업 폴더')}
          onCreate={onCreateFolder}
          creating={creatingFolder}
        />
        <PathActionRow
          label="작업 파일"
          path={costume.workFilePath}
          onPick={onPickFile}
          onOpen={() => openStoredCharacterPath(costume.workFilePath, '작업 파일')}
        />
      </div>

      {/* 단계 레일 + 담당자 */}
      <div className="flex flex-col gap-5 rounded-xl border border-bg-border/60 bg-bg-border/10 p-4">
        <StageRail
          label="디자인 단계"
          stages={COSTUME_DESIGN_STAGES}
          meta={DESIGN_STAGE_META}
          current={costume.designStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'design', s)}
          headerRight={
            <AssigneeNamePicker
              label="디자인 담당자"
              value={costume.designAssignee}
              onChange={(next) => updateCostumeField(costume.id, { designAssignee: next })}
            />
          }
        />
        <div className="h-px bg-bg-border/50" />
        <StageRail
          label="리깅 단계"
          stages={COSTUME_RIGGING_STAGES}
          meta={RIGGING_STAGE_META}
          current={costume.riggingStage}
          onSelect={(s) => updateCostumeStage(costume.id, 'rigging', s)}
          headerRight={
            <AssigneeNamePicker
              label="리깅 담당자"
              value={costume.riggingAssignee}
              onChange={(next) => updateCostumeField(costume.id, { riggingAssignee: next })}
            />
          }
        />
      </div>

      {/* 태그 */}
      <TagChipSection
        label="구조 태그"
        palette={STRUCTURE_TAG_PALETTE}
        tags={costume.structureTags}
        onChange={(next) => setCostumeTags(costume.id, 'structure', next)}
      />
      <TagChipSection
        label="에셋 태그"
        palette={ASSET_TAG_PALETTE}
        tags={costume.assetTags}
        onChange={(next) => setCostumeTags(costume.id, 'asset', next)}
      />
    </div>
  );
}
