/**
 * 컴포지팅 대시보드용 preview/dev mock 시드 데이터.
 *
 * `?preview=1` (또는 vite dev) 진입 시 episodes + compositing_states 를
 * 풍부하게 채워, Timeline 4 행 분포 / 카드 그리드 / 호버 / 모달 / 색 펄스 / status filter 등을
 * Supabase 연결 없이도 시각 검증 가능하게 한다.
 *
 * **주의 — 운영 영향 0**:
 *   `devElectronAPI` 는 `window.electronAPI` 가 이미 정의되어 있으면 install 자체를 skip 하므로
 *   실제 Electron 빌드(.exe)에서는 이 시드가 절대 사용되지 않는다. Vite 가 mock 모듈을
 *   dead-code dynamic import 로 bundle 에 포함시키지만 실행 분기가 비활성이라 노출되지 않는다.
 *
 * 시드 정책:
 *   - EP05 1개 활성 (episodeNumber=5)
 *   - 파트 A·B·C·D 4 파트, 각 파트마다 BG·ACT 두 sheet
 *   - 각 파트당 6 씬 (총 24 씬)
 *   - durationFrames 는 절반 정도만 채움 — Timeline 룰러가 분:초 / 씬 인덱스 fallback 둘 다 검증 가능하게 (단, EP 내에서는 일관성 위해 모두 채움)
 *   - 단계 분포는 다양: 파트 A 절반 done · 일부 adjust · 1 error / 파트 B 대부분 combine · aggregated / 파트 C 다 batch / 파트 D done + adjust 혼합
 *   - 이미지는 picsum.photos seed URL (preview 에 외부 네트워크가 있으면 로드됨)
 */

import type { CompositingStatus, Episode, Scene } from '@/types';

const FPS = 24;

/** 모든 씬에 동일하게 24fps 기준 길이. 시드 정도라 일관성 + 단순화. */
function makeScene(no: number, sceneId: string, assignee: string, durationSec: number, uuidSeed: string): Scene {
  return {
    id: `mock-scene-${uuidSeed}`,
    no,
    sceneId,
    memo: '',
    storyboardUrl: `https://picsum.photos/seed/sb-${sceneId}/180/120`,
    guideUrl: `https://picsum.photos/seed/gd-${sceneId}/180/120`,
    assignee,
    layoutId: '',
    lo: false,
    done: false,
    review: false,
    png: false,
    durationFrames: Math.round(durationSec * FPS),
  };
}

/** 한 파트의 BG 시트 + ACT 시트 두 Part 를 같은 sceneId 페어로 묶어 만든다. */
function makePartPair(
  partId: 'A' | 'B' | 'C' | 'D',
  bgAssignee: string,
  actAssignee: string,
  sceneIds: string[],
): Array<Episode['parts'][number]> {
  const bgScenes = sceneIds.map((sid, i) => makeScene(i + 1, sid, bgAssignee, 4 + (i % 4), `EP05-${partId}-BG-${sid}`));
  const actScenes = sceneIds.map((sid, i) => makeScene(i + 1, sid, actAssignee, 4 + (i % 4), `EP05-${partId}-ACT-${sid}`));
  if (partId === 'A' && actScenes[0]) {
    actScenes[0] = {
      ...actScenes[0],
      assignee: `${actAssignee}, 강선영`,
      sceneState: 'work',
      workRound: 1,
      lo: true,
      done: true,
      assigneeProgress: {
        [actAssignee]: {
          sceneState: 'work',
          workRound: 1,
          feedbackRound: 0,
          lo: true,
          done: true,
          review: false,
          png: false,
        },
        강선영: {
          sceneState: 'wait',
          workRound: 0,
          feedbackRound: 0,
          lo: false,
          done: false,
          review: false,
          png: false,
        },
      },
    };
  }
  const lower = partId.toLowerCase();
  return [
    { id: `mock-part-EP05-${partId}-BG`, partId, department: 'bg', sheetName: `EP05_${partId}_BG`, scenes: bgScenes },
    { id: `mock-part-EP05-${partId}-ACT`, partId: lower as string, department: 'acting', sheetName: `EP05_${partId}_ACT`, scenes: actScenes },
  ];
}

export const MOCK_EPISODES: Episode[] = [
  {
    episodeNumber: 5,
    title: 'EP.05',
    parts: [
      ...makePartPair('A', '원동우', '이혜민', ['a001', 'a002', 'a003', 'a004', 'a005', 'a006']),
      ...makePartPair('B', '강선영', '이다은', ['b001', 'b002', 'b003', 'b004', 'b005', 'b006']),
      ...makePartPair('C', '박정인', '김어진', ['c001', 'c002', 'c003', 'c004', 'c005', 'c006']),
      ...makePartPair('D', '허혜원', '류이레', ['d001', 'd002', 'd003', 'd004', 'd005', 'd006']),
    ],
  },
];

/** compositing_states row 시드 — 다양한 단계 분포로 Timeline/카드 색 검증. */
export interface MockCompositingRow {
  id: string;
  episode_number: number;
  scene_id: string;
  part_id: string;
  status: CompositingStatus;
  error_kind: string | null;
  error_note: string | null;
  progress_percent: number;
  updated_at: string;
  updated_by: string | null;
}

function row(
  scene_id: string,
  part_id: 'A' | 'B' | 'C' | 'D',
  status: CompositingStatus,
  updatedBy = '7',
  offsetMinAgo = 0,
  errorKind: string | null = null,
): MockCompositingRow {
  return {
    id: `mock-comp-${scene_id}`,
    episode_number: 5,
    scene_id,
    part_id,
    status,
    error_kind: errorKind,
    error_note: null,
    progress_percent: status === 'combine' || status === 'adjust' ? 60 : 0,
    updated_at: new Date(Date.now() - offsetMinAgo * 60 * 1000).toISOString(),
    updated_by: updatedBy,
  };
}

export const MOCK_COMPOSITING_STATES: MockCompositingRow[] = [
  // 파트 A — 절반 done · 일부 adjust · 1 error
  row('a001', 'A', 'done',      '7', 120),
  row('a002', 'A', 'done',      '7',  95),
  row('a003', 'A', 'done',      '7',  80),
  row('a004', 'A', 'adjust',    '7',  35),
  row('a005', 'A', 'error',     '7',  20, 'missing_file'),
  row('a006', 'A', 'aggregated','7',  10),

  // 파트 B — 대부분 combine · aggregated (작업 중)
  row('b001', 'B', 'aggregated','7', 200),
  row('b002', 'B', 'aggregated','7', 180),
  row('b003', 'B', 'combine',   '7',  60),
  row('b004', 'B', 'combine',   '7',  45),
  row('b005', 'B', 'combine',   '7',  30),
  // b006 — row 없음 (= batch 디폴트 — DB INSERT 는 첫 변경 시)

  // 파트 C — 다 batch (= row 없음, caller 가 디폴트로 그림)
  // (의도적으로 비움)

  // 파트 D — done + adjust 혼합 + 다른 사람이 변경 (highlight 트리거 시연용)
  row('d001', 'D', 'done',   '7', 240),
  row('d002', 'D', 'done',   '8', 200),  // 이혜민이 변경 → 본인 아닌 사람 한솔 입장에서 색 펄스 가능
  row('d003', 'D', 'adjust', '8', 150),
  row('d004', 'D', 'adjust', '7',  90),
  row('d005', 'D', 'done',   '7',   5),  // 가장 최근 → CTI 위치
  row('d006', 'D', 'batch',  '7',  60),
];
