/**
 * 씬 카드·시트 — 팀원이 바꾼 순간 잠깐 빛나는 표시 (움직임 폴리싱 9번 teammate-live).
 *
 * 다른 팀원이 단계를 바꾼 신호가 들어오면(내가 바꾼 건 제외):
 *   1. 카드 테두리 링이 은은하게 한 번 빛났다 가라앉는다(1.5초, 일괄이면 0.9초).
 *   2. 카드 위 가운데에 '김지은 · 검수 ✓' 이름표가 내려왔다가 2.2초 뒤 사라진다(한 장씩 바꾼 경우만).
 *
 * 신호 묶기:
 *   - BG 체크 한 번에 단계 수만큼 신호가 연달아 온다(LO→완료→검수 순서 저장). 같은 씬에 직전 신호에서
 *     400ms 안에 또 오면 빛을 다시 틀지 않고 이름표 글자만 고친다.
 *   - 300ms 안에 서로 다른 씬 4장 이상이 바뀌면 일괄 작업으로 보고 이름표를 빼고 짧게만 빛낸다.
 *     그 사이 이미 붙은 이름표도 거둔다(이름표는 120ms 늦게 떠서 대부분 보이기 전에 거둬진다).
 *   - 동시에 빛나는 링은 최대 8장.
 * 표시가 끝난 항목은 타이머 하나로 묶어 지운다.
 *
 * 렌더: src/components/scenes/SceneRemoteFlash.tsx (React key = seq 로 재마운트해 다시 튼다).
 * 수신: src/utils/remoteSceneFlash.ts (App 의 실시간 수신부에서 값이 실제로 바뀐 경우만 부른다).
 * node --test 가 그대로 import 하도록 런타임 의존은 zustand 와 상대 경로뿐이다.
 */

import { create } from 'zustand';
import { DEPARTMENT_CONFIGS } from '../types/index.ts';
import type { Department, Stage } from '../types/index.ts';

/** 링 한 번(ms) — 목업 1500ms. */
export const SCENE_FLASH_RING_MS = 1500;
/** 일괄 변경일 때 링(ms) — 몇 장만 짧게. */
export const SCENE_FLASH_BULK_RING_MS = 900;
/** 항목 유지 시간(ms) — 이름표 퇴장(2200 + 220ms)이 끝난 뒤 지운다. */
export const SCENE_FLASH_TTL_MS = 2500;
/** 일괄 항목 유지 시간(ms). */
export const SCENE_FLASH_BULK_TTL_MS = 1000;
/** 같은 씬의 연달은 신호를 한 번으로 묶는 간격(ms, 직전 신호 기준). */
export const SCENE_FLASH_MERGE_MS = 400;
/** 일괄 판정 창(ms). */
export const SCENE_FLASH_BULK_WINDOW_MS = 300;
/** 일괄 판정 — 창 안에서 서로 다른 씬이 이만큼 이상 바뀌면 일괄. */
export const SCENE_FLASH_BULK_MIN_SCENES = 4;
/** 동시에 빛나는 링 상한. */
export const SCENE_FLASH_MAX_RINGS = 8;

const STAGE_ORDER: readonly Stage[] = ['lo', 'done', 'review', 'png'];

export type SceneFlashChange =
  | { kind: 'stage'; stage: Stage; value: boolean; department: Department }
  | { kind: 'phase'; label: string };

export interface SceneFlash {
  /** 링·이름표를 처음부터 다시 틀 React key. */
  seq: number;
  /** 이번 링이 시작된 시각. */
  startedAt: number;
  /** 마지막으로 묶인 신호 시각(400ms 묶음 판정). */
  lastAt: number;
  /** 바꾼 팀원 이름(이름표). 모르면 null — 이름표 없음. */
  byName: string | null;
  /** 이름표 글자. 예: '검수 ✓', '작업중 2차'. */
  label: string;
  /** 이름표를 보일지 — 한 장씩 바꾼 경우만. */
  tag: boolean;
  /** 일괄 변경의 짧은 링. */
  bulk: boolean;
  /** 이번 묶음에서 바뀐 단계와 값(이름표 글자 계산용). */
  stages: Readonly<Partial<Record<Stage, boolean>>>;
  department: Department;
  /** 이번 묶음의 액팅 단계 이름 — 있으면 단계 체크 글자보다 우선. */
  phaseLabel: string | null;
  /** 이번 묶음의 마지막 단일 변경 글자(체크·해제가 섞였을 때). */
  lastLabel: string;
}

export interface SceneFlashBook {
  flashes: Readonly<Record<string, SceneFlash>>;
  /** 일괄 판정용 최근 신호(창 밖은 지운다). */
  recent: ReadonlyArray<{ uuid: string; at: number }>;
  /** 이 시각 전까지 들어오는 새 씬은 일괄로 본다. */
  bulkUntil: number;
}

export const EMPTY_SCENE_FLASH_BOOK: SceneFlashBook = Object.freeze({
  flashes: Object.freeze({}) as Readonly<Record<string, SceneFlash>>,
  recent: Object.freeze([]) as ReadonlyArray<{ uuid: string; at: number }>,
  bulkUntil: 0,
});

export function sceneFlashRingMs(flash: Pick<SceneFlash, 'bulk'>): number {
  return flash.bulk ? SCENE_FLASH_BULK_RING_MS : SCENE_FLASH_RING_MS;
}

export function sceneFlashTtlMs(flash: Pick<SceneFlash, 'bulk'>): number {
  return flash.bulk ? SCENE_FLASH_BULK_TTL_MS : SCENE_FLASH_TTL_MS;
}

function stageName(department: Department, stage: Stage): string {
  return DEPARTMENT_CONFIGS[department]?.stageLabels[stage] ?? stage;
}

function singleChangeLabel(change: SceneFlashChange): string {
  if (change.kind === 'phase') return change.label;
  return `${stageName(change.department, change.stage)} ${change.value ? '✓' : '해제'}`;
}

/**
 * 묶음 안 변경들로 이름표 글자를 정한다.
 * - 액팅 단계 이름이 있으면 그것.
 * - 모두 체크면 가장 높은 단계 ✓ (LO→완료→검수 연속 저장이면 '검수 ✓').
 * - 모두 해제면 가장 낮은 단계 해제 (완료를 풀면 검수·PNG 도 같이 풀린다 → '완료 해제').
 * - 섞이면 마지막 변경.
 */
export function sceneFlashLabel(input: Pick<SceneFlash, 'stages' | 'department' | 'phaseLabel' | 'lastLabel'>): string {
  if (input.phaseLabel) return input.phaseLabel;
  const changed = STAGE_ORDER.filter((stage) => input.stages[stage] !== undefined);
  if (changed.length === 0) return input.lastLabel;
  const values = changed.map((stage) => input.stages[stage]);
  if (values.every((value) => value === true)) return `${stageName(input.department, changed[changed.length - 1])} ✓`;
  if (values.every((value) => value === false)) return `${stageName(input.department, changed[0])} 해제`;
  return input.lastLabel;
}

/** 끝난 항목과 창 밖 신호를 지운다. 바뀐 게 없으면 같은 객체를 돌려준다. */
export function pruneSceneFlashes<T extends SceneFlashBook>(book: T, now: number): T {
  let flashes: Record<string, SceneFlash> | null = null;
  for (const [uuid, flash] of Object.entries(book.flashes)) {
    if (now - flash.startedAt < sceneFlashTtlMs(flash)) continue;
    flashes ??= { ...book.flashes };
    delete flashes[uuid];
  }
  const recent = book.recent.filter((entry) => now - entry.at < SCENE_FLASH_BULK_WINDOW_MS);
  if (!flashes && recent.length === book.recent.length) return book;
  return { ...book, flashes: flashes ?? book.flashes, recent };
}

let flashSeq = 0;

/**
 * 원격 변경 신호 하나를 반영한 새 장부를 돌려준다(순수 함수 — 시각은 인자로).
 * 값이 실제로 바뀌었고 보낸 사람이 내가 아닌 신호만 넘길 것(그 판정은 remoteSceneFlash.ts).
 */
export function applySceneFlash(
  current: SceneFlashBook,
  input: { uuid: string; byName: string | null; change: SceneFlashChange; now: number },
): SceneFlashBook {
  const { uuid, byName, change, now } = input;
  const book = pruneSceneFlashes(current, now);
  const recent = [...book.recent, { uuid, at: now }];
  const distinct = new Set(recent.map((entry) => entry.uuid)).size;
  const enteringBulk = distinct >= SCENE_FLASH_BULK_MIN_SCENES;
  const bulkUntil = enteringBulk ? now + SCENE_FLASH_BULK_WINDOW_MS : book.bulkUntil;
  const isBulk = enteringBulk || now < book.bulkUntil;

  const flashes: Record<string, SceneFlash> = { ...book.flashes };
  if (enteringBulk) {
    // 창 안에서 막 시작된 표시도 일괄로 돌린다 — 이름표만 거둔다(링은 다시 틀지 않아 깜빡이지 않는다).
    for (const entry of book.recent) {
      const flash = flashes[entry.uuid];
      if (flash && flash.tag) flashes[entry.uuid] = { ...flash, tag: false };
    }
  }

  const previous = flashes[uuid];
  const label = singleChangeLabel(change);
  if (previous && now - previous.lastAt <= SCENE_FLASH_MERGE_MS) {
    const stages = change.kind === 'stage' ? { ...previous.stages, [change.stage]: change.value } : previous.stages;
    const phaseLabel = change.kind === 'phase' ? change.label : previous.phaseLabel;
    const department = change.kind === 'stage' ? change.department : previous.department;
    const merged = { ...previous, stages, phaseLabel, department, lastLabel: label, lastAt: now, byName: byName ?? previous.byName };
    flashes[uuid] = { ...merged, label: sceneFlashLabel(merged), tag: merged.tag && !isBulk };
    return { flashes, recent, bulkUntil };
  }

  // 새 링 — 동시에 빛나는 링이 상한이면 건너뛴다(일괄 판정용 신호 기록은 남긴다).
  const activeRings = Object.entries(flashes)
    .filter(([key, flash]) => key !== uuid && now - flash.startedAt < sceneFlashRingMs(flash))
    .length;
  if (activeRings >= SCENE_FLASH_MAX_RINGS) return { flashes, recent, bulkUntil };

  const department: Department = change.kind === 'stage' ? change.department : previous?.department ?? 'acting';
  const next = {
    seq: ++flashSeq,
    startedAt: now,
    lastAt: now,
    byName,
    tag: !isBulk && !!byName,
    bulk: isBulk,
    stages: change.kind === 'stage' ? { [change.stage]: change.value } : {},
    department,
    phaseLabel: change.kind === 'phase' ? change.label : null,
    lastLabel: label,
  };
  flashes[uuid] = { ...next, label: sceneFlashLabel(next) };
  return { flashes, recent, bulkUntil };
}

/** 여러 uuid(통합 카드의 BG·ACT) 중 가장 최근에 시작된 표시. */
export function pickSceneFlash(
  flashes: Readonly<Record<string, SceneFlash>>,
  uuids: ReadonlyArray<string | null | undefined>,
): SceneFlash | undefined {
  let picked: SceneFlash | undefined;
  for (const uuid of uuids) {
    if (!uuid) continue;
    const flash = flashes[uuid];
    if (flash && (!picked || flash.seq > picked.seq)) picked = flash;
  }
  return picked;
}

interface SceneFlashState extends SceneFlashBook {
  /** 원격 변경 신호 하나. now 는 테스트용. */
  pulse: (uuid: string, byName: string | null, change: SceneFlashChange, now?: number) => void;
  clearAll: () => void;
}

let sweepTimer: ReturnType<typeof setTimeout> | null = null;

/** 끝난 항목을 지우는 타이머 하나 — 가장 먼저 끝나는 항목 시각에 맞춰 다시 건다. */
function scheduleSweep(get: () => SceneFlashState, set: (partial: Partial<SceneFlashState>) => void): void {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = null;
  const flashes = Object.values(get().flashes);
  if (flashes.length === 0) return;
  const nextExpiry = Math.min(...flashes.map((flash) => flash.startedAt + sceneFlashTtlMs(flash)));
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    const state = get();
    const pruned = pruneSceneFlashes(state, Date.now());
    if (pruned !== state) set({ flashes: pruned.flashes, recent: pruned.recent });
    scheduleSweep(get, set);
  }, Math.max(16, nextExpiry - Date.now()));
}

export const useSceneFlashStore = create<SceneFlashState>((set, get) => ({
  ...EMPTY_SCENE_FLASH_BOOK,
  pulse: (uuid, byName, change, now = Date.now()) => {
    const next = applySceneFlash(get(), { uuid, byName, change, now });
    set({ flashes: next.flashes, recent: next.recent, bulkUntil: next.bulkUntil });
    scheduleSweep(get, set);
  },
  clearAll: () => {
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = null;
    set({ flashes: {}, recent: [], bulkUntil: 0 });
  },
}));
