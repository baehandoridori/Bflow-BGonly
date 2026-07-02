import { useEffect, useMemo } from 'react';
import { useCharacterBoardAccess } from '@/hooks/useCharacterBoardAccess';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { parseAssigneeNames } from '@/utils/characterStageMeta';
import { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';
import type { CharacterTaskItem } from '../types';

export function useMyCharacterTasks(): {
  pendingCharacterTasks: CharacterTaskItem[];
  doneCharacterTasks: CharacterTaskItem[];
} {
  const hasCharacterBoardAccess = useCharacterBoardAccess();
  const currentUser = useAuthStore((s) => s.currentUser);
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const ensureLoadedAndRealtime = useCharacterBoardStore((s) => s.ensureLoadedAndRealtime);

  useEffect(() => {
    if (!hasCharacterBoardAccess || !currentUser) return;
    const release = ensureLoadedAndRealtime({ silent: true });
    return () => { release(); };
  }, [currentUser, ensureLoadedAndRealtime, hasCharacterBoardAccess]);

  const allTasks = useMemo(() => {
    if (!hasCharacterBoardAccess || !currentUser?.name) return [];
    const userName = currentUser.name;
    const tasks: CharacterTaskItem[] = [];
    const activeCharacters = characters
      .filter((character) => character.status !== 'archived')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    for (const character of activeCharacters) {
      const costumes = (byCharacter.get(character.id) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      for (const costume of costumes) {
        if (parseAssigneeNames(costume.designAssignee).some((name) => name === userName)) {
          const meta = DESIGN_STAGE_META[costume.designStage];
          tasks.push({
            key: `char:${costume.id}:design`,
            kind: 'design',
            characterId: character.id,
            characterName: character.name,
            costumeId: costume.id,
            costumeName: costume.name,
            stage: costume.designStage,
            stageLabel: meta.label,
            stageColor: characterStageColor(meta),
            done: costume.designStage === 'done',
          });
        }
        if (parseAssigneeNames(costume.riggingAssignee).some((name) => name === userName)) {
          const meta = RIGGING_STAGE_META[costume.riggingStage];
          tasks.push({
            key: `char:${costume.id}:rigging`,
            kind: 'rigging',
            characterId: character.id,
            characterName: character.name,
            costumeId: costume.id,
            costumeName: costume.name,
            stage: costume.riggingStage,
            stageLabel: meta.label,
            stageColor: characterStageColor(meta),
            done: costume.riggingStage === 'done',
          });
        }
      }
    }
    return tasks;
  }, [byCharacter, characters, currentUser?.name, hasCharacterBoardAccess]);

  return {
    pendingCharacterTasks: allTasks.filter((task) => !task.done),
    doneCharacterTasks: allTasks.filter((task) => task.done),
  };
}
