/**
 * 테스트 모드 전용: 로컬 JSON 파일로 Google Sheets를 시뮬레이션
 *
 * 테스트 폴더 내에 test-data/sheets.json 파일을 만들어서
 * 읽기/쓰기를 수행한다. 실제 Google Sheets API 대신 사용.
 */

import type { Episode, Scene, Part } from '@/types';

// 앱 실행 경로 기준 test-data 폴더
const TEST_DATA_DIR = 'test-data';
const TEST_SHEET_FILE = `${TEST_DATA_DIR}/sheets.json`;

/** 테스트 시트에서 전체 데이터 읽기 */
export async function readTestSheet(): Promise<Episode[]> {
  try {
    const data = await window.electronAPI.testReadSheet(TEST_SHEET_FILE);
    if (data && Array.isArray(data)) {
      return data as Episode[];
    }
  } catch (err) {
    console.error('[테스트] 시트 읽기 실패:', err);
  }
  // 파일 없으면 샘플 데이터 생성
  const sample = generateSampleData();
  await writeTestSheet(sample);
  return sample;
}

/** 테스트 시트에 전체 데이터 쓰기 */
export async function writeTestSheet(episodes: Episode[]): Promise<void> {
  try {
    await window.electronAPI.testWriteSheet(TEST_SHEET_FILE, episodes);
  } catch (err) {
    console.error('[테스트] 시트 쓰기 실패:', err);
  }
}

/** 씬 체크박스 토글 → 테스트 시트에 반영 */
export async function toggleTestSceneStage(
  episodes: Episode[],
  episodeNumber: number,
  partId: string,
  sceneId: string,
  stage: keyof Pick<Scene, 'lo' | 'done' | 'review' | 'png'>
): Promise<Episode[]> {
  const updated = episodes.map((ep) => {
    if (ep.episodeNumber !== episodeNumber) return ep;
    return {
      ...ep,
      parts: ep.parts.map((part) => {
        if (part.partId !== partId) return part;
        return {
          ...part,
          scenes: part.scenes.map((scene) => {
            if (scene.sceneId !== sceneId) return scene;
            return { ...scene, [stage]: !scene[stage] };
          }),
        };
      }),
    };
  });
  await writeTestSheet(updated);
  return updated;
}

// ─── 샘플 데이터 생성기 ─────────────────────────────────

const SAMPLE_ASSIGNEES = ['원동우', '김하늘', '이서연', '박준혁', '최민지'];

function makeScene(no: number, partPrefix: string, assigneeIdx: number): Scene {
  const id = `${partPrefix}${String(no).padStart(3, '0')}`;
  const assignee = SAMPLE_ASSIGNEES[assigneeIdx % SAMPLE_ASSIGNEES.length];
  // 랜덤 진행도
  const progress = Math.random();
  return {
    no,
    sceneId: id,
    memo: no % 3 === 0 ? '프랍 있음' : no % 5 === 0 ? '밤 씬' : '',
    storyboardUrl: '',
    guideUrl: '',
    assignee,
    lo: progress > 0.2,
    done: progress > 0.4,
    review: progress > 0.6,
    png: progress > 0.8,
  };
}

function makePart(epNum: number, partId: string, sceneCount: number): Part {
  const prefix = partId.toLowerCase();
  return {
    partId,
    sheetName: `EP${String(epNum).padStart(2, '0')}_${partId}`,
    scenes: Array.from({ length: sceneCount }, (_, i) =>
      makeScene(i + 1, prefix, i)
    ),
  };
}

function generateSampleData(): Episode[] {
  return [
    {
      episodeNumber: 1,
      title: 'EP.01',
      parts: [
        makePart(1, 'A', 12),
        makePart(1, 'B', 10),
        makePart(1, 'C', 8),
      ],
    },
    {
      episodeNumber: 2,
      title: 'EP.02',
      parts: [
        makePart(2, 'A', 15),
        makePart(2, 'B', 11),
        makePart(2, 'C', 9),
        makePart(2, 'D', 7),
      ],
    },
  ];
}
