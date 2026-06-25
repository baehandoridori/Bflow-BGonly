import type { SceneWorkLink, SceneWorkLinkDepartment, SceneWorkLinkKind } from '@/types';

export interface UpsertSceneWorkLinkInput {
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label?: string | null;
  sortOrder?: number;
  userId?: string | null;
}

export async function readSceneWorkLinks(sceneUuids?: string[]): Promise<SceneWorkLink[]> {
  return window.electronAPI.supabaseReadSceneWorkLinks(sceneUuids);
}

export async function upsertSceneWorkLink(input: UpsertSceneWorkLinkInput): Promise<SceneWorkLink> {
  return window.electronAPI.supabaseUpsertSceneWorkLink(input);
}

export async function deleteSceneWorkLink(
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  linkKind: 'folder' | 'primary_file',
): Promise<void> {
  await window.electronAPI.supabaseDeleteSceneWorkLink(sceneUuid, department, linkKind);
}

export async function chooseWorkFolder(): Promise<string | null> {
  return window.electronAPI.chooseFolderPath?.() ?? null;
}

export async function chooseWorkFile(): Promise<string | null> {
  return window.electronAPI.chooseFilePath?.() ?? null;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  return window.electronAPI.pathExists?.(targetPath) ?? false;
}

export async function openWorkPath(targetPath: string): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI.shellOpenPath?.(targetPath) ?? { ok: false, error: 'shellOpenPath unavailable' };
}
