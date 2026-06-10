export const SINGLE_SCENE_SELECTION_PREFIX = 'scene:';

const UUID_KEY_PREFIX = 'uuid:';
const INDEX_KEY_PREFIX = 'index:';

type SceneSelectionScene = {
  id?: string;
};

type SceneSelectionPart<TScene extends SceneSelectionScene = SceneSelectionScene> = {
  sheetName: string;
  scenes: TScene[];
};

export type SingleSceneSelectionTarget = {
  sheetName: string;
  sceneUuid?: string;
  sceneIndex?: number;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildSingleSceneSelectionId(
  sheetName: string | null | undefined,
  scene: SceneSelectionScene,
  sceneIndex: number,
): string {
  const sheetKey = encodeURIComponent(sheetName ?? '');
  const rowKey = scene.id
    ? `${UUID_KEY_PREFIX}${encodeURIComponent(scene.id)}`
    : `${INDEX_KEY_PREFIX}${Number.isInteger(sceneIndex) ? sceneIndex : -1}`;

  return `${SINGLE_SCENE_SELECTION_PREFIX}${sheetKey}:${rowKey}`;
}

export function parseSingleSceneSelectionId(selectionId: string): SingleSceneSelectionTarget | null {
  if (!selectionId.startsWith(SINGLE_SCENE_SELECTION_PREFIX)) return null;

  const rest = selectionId.slice(SINGLE_SCENE_SELECTION_PREFIX.length);
  const separatorIndex = rest.indexOf(':');
  if (separatorIndex < 0) return null;

  const sheetName = safeDecode(rest.slice(0, separatorIndex));
  const rowKey = rest.slice(separatorIndex + 1);

  if (rowKey.startsWith(UUID_KEY_PREFIX)) {
    const sceneUuid = safeDecode(rowKey.slice(UUID_KEY_PREFIX.length));
    return sceneUuid ? { sheetName, sceneUuid } : null;
  }

  if (rowKey.startsWith(INDEX_KEY_PREFIX)) {
    const sceneIndex = Number(rowKey.slice(INDEX_KEY_PREFIX.length));
    return Number.isInteger(sceneIndex) && sceneIndex >= 0 ? { sheetName, sceneIndex } : null;
  }

  return null;
}

export function resolveSingleSceneSelection<TScene extends SceneSelectionScene>(
  part: SceneSelectionPart<TScene> | null | undefined,
  selectionId: string,
): TScene | undefined {
  if (!part) return undefined;

  const target = parseSingleSceneSelectionId(selectionId);
  if (!target) return undefined;
  if (target.sheetName && target.sheetName !== part.sheetName) return undefined;

  if (target.sceneUuid) {
    return part.scenes.find((scene) => scene.id === target.sceneUuid);
  }

  if (target.sceneIndex !== undefined) {
    return part.scenes[target.sceneIndex];
  }

  return undefined;
}
