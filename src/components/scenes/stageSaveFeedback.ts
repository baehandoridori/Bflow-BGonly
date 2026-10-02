/* ═══════════════════════════════════════════════════════════════
   단계 체크 저장 실패의 안심 장치 (움직임 폴리싱 20번 safety-net — 한솔 결정 2026-10-03)

   - 다시 보내는 중인 칸: 은은한 점선 테두리 + 살짝 흐림(CSS, motion-scene-check.css 의 [data-save-pending]).
   - 끝내 되돌린 칸: 고개를 젓듯 좌우로 0.24초(translate 0→−3→3→−2→0px) + 빨간(#E17055) 1.5px 테두리가
     0.9초 동안 번졌다 사라진다(15% 지점에서 가장 진함). 동작 줄이기면 흔들림 없이 테두리만.
   - 안내는 버튼 없는 토스트 한 줄: 'a012 검수 체크를 저장하지 못해 되돌렸어요' + '인터넷 연결을 확인해 주세요'.

   칸 이름(cell id)은 세 버튼 묶음이 같이 쓴다:
   - 씬 단위 LO/완료/검수/PNG 칸: 'lo' | 'done' | 'review' | 'png'
   - 액팅 단계 칩: 'phase:work' 처럼
   - 담당자별 버튼: 'a:<이름>:lo' · 'a:<이름>:phase:done' · 'a:<이름>:round'

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 흔들림(도리도리) 길이. */
export const ROLLBACK_SHAKE_MS = 240;
/** 빨간 테두리가 번졌다 사라지는 길이. */
export const ROLLBACK_BORDER_MS = 900;
/** 되돌림 표시를 지우는 시점 — 테두리가 다 사라진 뒤. */
export const ROLLBACK_FLASH_CLEAR_MS = ROLLBACK_BORDER_MS + 150;

/**
 * 흔들림은 개별 transform 속성 translate 로 건다 — 버튼의 누름(:active scale, transform 속성)과 서로 덮어쓰지 않고 더해진다.
 * 곡선은 사양대로 ease-out(전체 길이에 한 번).
 */
export const ROLLBACK_SHAKE_KEYFRAMES: Keyframe[] = [
  { translate: '0px 0px' },
  { translate: '-3px 0px' },
  { translate: '3px 0px' },
  { translate: '-2px 0px' },
  { translate: '0px 0px' },
];
export const ROLLBACK_SHAKE_EASE = 'ease-out';

/** 빨간 테두리 층의 opacity — 0 → 1(15% 지점) → 0. 오를 때는 빠르게, 내릴 때는 고르게. */
export const ROLLBACK_BORDER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { opacity: 1, offset: 0.15, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { opacity: 0 },
];

export type StageCellStage = 'lo' | 'done' | 'review' | 'png';
export type StageCellPhase = 'wait' | 'work' | 'feedback' | 'done';

export function stageCellId(stage: StageCellStage): string {
  return stage;
}

export function phaseCellId(state: StageCellPhase): string {
  return `phase:${state}`;
}

export function assigneeCellId(name: string, cell: string): string {
  return `a:${name}:${cell}`;
}

/** 여러 저장 묶음(씬 단위 칸·액팅 칩·담당자별)에 흩어진 '다시 보내는 중' 칸을 한 목록으로. */
export function flattenPendingCells(bySlot: Readonly<Record<string, readonly string[]>> | undefined): string[] {
  if (!bySlot) return [];
  const out = new Set<string>();
  for (const cells of Object.values(bySlot)) cells.forEach((cell) => out.add(cell));
  return [...out];
}

/* ─── 안내 문구 ──────────────────────────────────────────────── */

export type RollbackSubject =
  | { kind: 'check'; label: string }
  | { kind: 'phase'; label: string }
  | { kind: 'round' };

/**
 * 'a012 검수 체크를 저장하지 못해 되돌렸어요' · 'a012 김지은 '완료' 단계를 …' · 'a012 김지은 작업 차수를 …'.
 */
export function rollbackToastTitle(sceneId: string, subject: RollbackSubject, assigneeName?: string): string {
  const who = assigneeName ? ` ${assigneeName}` : '';
  const what =
    subject.kind === 'check'
      ? `${subject.label} 체크를`
      : subject.kind === 'phase'
        ? `'${subject.label}' 단계를`
        : '작업 차수를';
  return `${sceneId}${who} ${what} 저장하지 못해 되돌렸어요`;
}

/** 인터넷 문제(다시 보내 봤지만 안 됨)면 연결 확인, 거절된 저장이면 새로고침 안내. */
export function rollbackToastDescription(kind: 'transient' | 'permanent'): string {
  return kind === 'transient'
    ? '인터넷 연결을 확인해 주세요'
    : '이 변경은 저장할 수 없었어요. 새로고침한 뒤 다시 확인해 주세요';
}
