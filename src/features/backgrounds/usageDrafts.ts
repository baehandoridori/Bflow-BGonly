import type { BackgroundUsage } from "./types.ts";

export interface BackgroundUsageDraft {
  usage: BackgroundUsage;
  dirty: boolean;
  error: string;
}
export type BackgroundUsageDrafts = Record<string, BackgroundUsageDraft>;

/** Dirty drafts retain the revision from the first edit, including after navigation. */
export function usageDraftFor(
  drafts: BackgroundUsageDrafts,
  usage: BackgroundUsage,
): BackgroundUsage {
  const cached = drafts[usage.id];
  return cached?.dirty ? cached.usage : usage;
}

export function editUsageDraft(
  drafts: BackgroundUsageDrafts,
  usage: BackgroundUsage,
  patch: Partial<Pick<BackgroundUsage, "memo" | "variantIds">>,
): BackgroundUsageDrafts {
  const previous = usageDraftFor(drafts, usage);
  return {
    ...drafts,
    [usage.id]: {
      usage: {
        ...previous,
        ...patch,
        variantIds: [...(patch.variantIds ?? previous.variantIds)],
      },
      dirty: true,
      error: "",
    },
  };
}

export function setUsageDraftError(
  drafts: BackgroundUsageDrafts,
  usage: BackgroundUsage,
  error: string,
): BackgroundUsageDrafts {
  return {
    ...drafts,
    [usage.id]: {
      usage: usageDraftFor(drafts, usage),
      dirty: drafts[usage.id]?.dirty ?? false,
      error,
    },
  };
}

export function clearUsageDraft(
  drafts: BackgroundUsageDrafts,
  id: string,
): BackgroundUsageDrafts {
  const next = { ...drafts };
  delete next[id];
  return next;
}
