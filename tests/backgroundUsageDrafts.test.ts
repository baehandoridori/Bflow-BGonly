import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUsageDraft,
  editUsageDraft,
  setUsageDraftError,
  usageDraftFor,
} from "../src/features/backgrounds/usageDrafts.ts";
import type { BackgroundUsage } from "../src/features/backgrounds/types.ts";

const usage = (id: string, episodeNumber: number): BackgroundUsage => ({
  id,
  episodeNumber,
  placeId: "place-a",
  revision: 2,
  variantIds: ["day"],
  memo: "saved",
});

test("episode drafts remain independent through navigation and canonical refreshes", () => {
  const first = usage("ep-1", 1),
    second = usage("ep-2", 2);
  let drafts = editUsageDraft({}, first, {
    memo: "첫 에피소드의 저장 전 메모",
    variantIds: ["day", "night"],
  });
  drafts = editUsageDraft(drafts, second, { memo: "둘째 에피소드 메모" });
  const refreshed = {
    ...first,
    revision: 9,
    memo: "다른 사용자의 변경",
    variantIds: [],
  };
  drafts = editUsageDraft(drafts, refreshed, { memo: "돌아와 이어 쓰는 메모" });
  const restored = usageDraftFor(drafts, refreshed);
  assert.equal(restored.memo, "돌아와 이어 쓰는 메모");
  assert.deepEqual(restored.variantIds, ["day", "night"]);
  assert.equal(
    restored.revision,
    2,
    "CAS must retain the revision from the first edit",
  );
  assert.equal(usageDraftFor(drafts, second).memo, "둘째 에피소드 메모");
  assert.equal(first.memo, "saved");
});

test("save failure and returning to the episode preserve draft, error, and CAS revision", () => {
  const first = usage("ep-1", 1),
    second = usage("ep-2", 2);
  let drafts = editUsageDraft({}, first, { memo: "실패해도 남을 메모" });
  drafts = setUsageDraftError(drafts, first, "다른 변경이 있습니다.");
  drafts = editUsageDraft(drafts, second, { variantIds: ["night"] });
  const restored = usageDraftFor(drafts, { ...first, revision: 3 });
  assert.equal(restored.memo, "실패해도 남을 메모");
  assert.equal(restored.revision, 2);
  assert.equal(drafts[first.id].error, "다른 변경이 있습니다.");
  assert.equal(drafts[first.id].dirty, true);
});

test("successful save clears only that usage and clean drafts follow canonical revisions", () => {
  const first = usage("ep-1", 1),
    second = usage("ep-2", 2);
  let drafts = editUsageDraft({}, first, { memo: "저장할 메모" });
  drafts = editUsageDraft(drafts, second, { memo: "계속 편집할 메모" });
  drafts = clearUsageDraft(drafts, first.id);
  const saved = { ...first, revision: 3, memo: "저장할 메모" };
  assert.equal(usageDraftFor(drafts, saved), saved);
  assert.equal(usageDraftFor(drafts, second).memo, "계속 편집할 메모");
  const cleanError = setUsageDraftError(
    drafts,
    saved,
    "삭제를 완료하지 못했습니다.",
  );
  assert.equal(
    usageDraftFor(cleanError, { ...saved, revision: 4 }).revision,
    4,
  );
});
