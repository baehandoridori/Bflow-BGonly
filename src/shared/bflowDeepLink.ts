/** Shared by Electron and the renderer; links carry identity, never executable actions. */
export type BflowDeepLink = { sheetName: string; sceneId: string } | { revisionId: string };

export function buildRetakeDeepLink(revisionId: string): string {
  return `bflow://retake/${encodeURIComponent(revisionId)}`;
}

export function parseBflowDeepLink(url: string): BflowDeepLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'bflow:' || parsed.username || parsed.password || parsed.port) return null;
    const segments = parsed.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent);
    if (parsed.hostname === 'retake' && segments.length === 1 && /^[a-zA-Z0-9_-]{1,128}$/.test(segments[0])) {
      return { revisionId: segments[0] };
    }
    if (parsed.hostname === 'scene' && segments.length === 2 && segments.every((s) => s.trim() && !/[\u0000-\u001f/\\]/.test(s))) {
      return { sheetName: segments[0], sceneId: segments[1] };
    }
    return null;
  } catch {
    return null;
  }
}
