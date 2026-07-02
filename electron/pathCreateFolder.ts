import path from 'path';

export type PathCreateFolderErrorCode =
  | 'parent-missing'
  | 'invalid-name'
  | 'permission'
  | 'unknown';

export interface ResolvedChildFolderPath {
  parentPath: string;
  folderName: string;
  fullPath: string;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeWindowsFolderName(rawName: unknown): string {
  if (typeof rawName !== 'string') return '';
  let name = rawName
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!name) return '';
  if (WINDOWS_RESERVED_NAME.test(name)) name = `${name}_`;
  if (name.length > 100) name = name.slice(0, 100).replace(/[. ]+$/g, '');
  return name;
}

export function resolveChildFolderPath(parentPath: unknown, folderName: unknown): ResolvedChildFolderPath | null {
  if (typeof parentPath !== 'string' || !parentPath.trim()) return null;

  const sanitized = sanitizeWindowsFolderName(folderName);
  if (!sanitized) return null;

  const resolvedParent = path.resolve(parentPath.trim());
  const fullPath = path.resolve(path.join(resolvedParent, sanitized));
  const parentWithSep = resolvedParent.endsWith(path.sep) ? resolvedParent : `${resolvedParent}${path.sep}`;

  if (!fullPath.startsWith(parentWithSep)) return null;

  return {
    parentPath: resolvedParent,
    folderName: sanitized,
    fullPath,
  };
}
