/**
 * 테스트 모드 전용: 로컬 JSON 파일로 Google Sheets를 시뮬레이션
 *
 * 테스트 폴더 내에 test-data/sheets.json 파일을 만들어서
 * 읽기/쓰기를 수행한다. 실제 Google Sheets API 대신 사용.
 */

import type { Episode, Scene, Part, Department } from '@/types';

// 시트 파일 경로 — 메인 프로세스에서 resolve
let sheetFilePath: string | null = null;

async function getSheetPath(): Promise<string> {
  if (!sheetFilePath) {
    sheetFilePath = await window.electronAPI.testGetSheetPath();
  }
  return sheetFilePath;
}

/** 레거시 데이터 마이그레이션: department 없는 Part에 'bg' 기본값 설정 */
function migrateEpisodes(episodes: Episode[]): Episode[] {
  return episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => ({
      ...part,
      department: part.department || 'bg' as Department,
    })),
  }));
}

/** 테스트 시트에서 전체 데이터 읽기 */
export async function readTestSheet(): Promise<Episode[]> {
  const filePath = await getSheetPath();
  try {
    const data = await window.electronAPI.testReadSheet(filePath);
    if (data && Array.isArray(data)) {
      return migrateEpisodes(data as Episode[]);
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
  const filePath = await getSheetPath();
  try {
    await window.electronAPI.testWriteSheet(filePath, episodes);
  } catch (err) {
    console.error('[테스트] 시트 쓰기 실패:', err);
  }
}

/** 에피소드 추가 (테스트) */
export async function addTestEpisode(
  episodes: Episode[],
  episodeNumber: number,
  department: Department = 'bg'
): Promise<Episode[]> {
  const deptSuffix = department === 'bg' ? '_BG' : '_ACT';
  const tabName = `EP${String(episodeNumber).padStart(2, '0')}_A${deptSuffix}`;
  const newEp: Episode = {
    episodeNumber,
    title: `EP.${String(episodeNumber).padStart(2, '0')}`,
    parts: [{ partId: 'A', department, sheetName: tabName, scenes: [] }],
  };
  const updated = [...episodes, newEp];
  await writeTestSheet(updated);
  return updated;
}

/** 파트 추가 (테스트) */
export async function addTestPart(
  episodes: Episode[],
  episodeNumber: number,
  partId: string,
  department: Department = 'bg'
): Promise<Episode[]> {
  const deptSuffix = department === 'bg' ? '_BG' : '_ACT';
  const tabName = `EP${String(episodeNumber).padStart(2, '0')}_${partId}${deptSuffix}`;
  const updated = episodes.map((ep) => {
    if (ep.episodeNumber !== episodeNumber) return ep;
    return {
      ...ep,
      parts: [...ep.parts, { partId, department, sheetName: tabName, scenes: [] }],
    };
  });
  await writeTestSheet(updated);
  return updated;
}

/** 씬 추가 (테스트) */
export async function addTestScene(
  episodes: Episode[],
  sheetName: string,
  sceneId: string,
  assignee: string,
  memo: string
): Promise<Episode[]> {
  const updated = episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => {
      if (part.sheetName !== sheetName) return part;
      const nextNo = part.scenes.length > 0
        ? Math.max(...part.scenes.map((s) => s.no)) + 1
        : 1;
      const newScene: Scene = {
        no: nextNo,
        sceneId: sceneId || '',
        memo: memo || '',
        storyboardUrl: '',
        guideUrl: '',
        assignee: assignee || '',
        layoutId: '',
        lo: false,
        done: false,
        review: false,
        png: false,
      };
      return { ...part, scenes: [...part.scenes, newScene] };
    }),
  }));
  await writeTestSheet(updated);
  return updated;
}

/** 씬 삭제 (테스트) */
export async function deleteTestScene(
  episodes: Episode[],
  sheetName: string,
  rowIndex: number
): Promise<Episode[]> {
  const updated = episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => {
      if (part.sheetName !== sheetName) return part;
      return {
        ...part,
        scenes: part.scenes.filter((_, i) => i !== rowIndex),
      };
    }),
  }));
  await writeTestSheet(updated);
  return updated;
}

/** 씬 필드 업데이트 (테스트) */
export async function updateTestSceneField(
  episodes: Episode[],
  sheetName: string,
  rowIndex: number,
  field: string,
  value: string
): Promise<Episode[]> {
  const updated = episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => {
      if (part.sheetName !== sheetName) return part;
      return {
        ...part,
        scenes: part.scenes.map((scene, i) => {
          if (i !== rowIndex) return scene;
          if (field === 'lo' || field === 'done' || field === 'review' || field === 'png') {
            return { ...scene, [field]: value === 'true' };
          }
          if (field === 'no') {
            return { ...scene, no: parseInt(value, 10) || 0 };
          }
          return { ...scene, [field]: value };
        }),
      };
    }),
  }));
  await writeTestSheet(updated);
  return updated;
}

/** 씬 체크박스 토글 → 테스트 시트에 반영 (sheetName으로 파트 식별) */
export async function toggleTestSceneStage(
  episodes: Episode[],
  sheetName: string,
  sceneId: string,
  stage: keyof Pick<Scene, 'lo' | 'done' | 'review' | 'png'>
): Promise<Episode[]> {
  const updated = episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => {
      if (part.sheetName !== sheetName) return part;
      return {
        ...part,
        scenes: part.scenes.map((scene) => {
          if (scene.sceneId !== sceneId) return scene;
          return { ...scene, [stage]: !scene[stage] };
        }),
      };
    }),
  }));
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
  // 레이아웃 그룹 시뮬레이션: 3~4씬마다 같은 레이아웃
  const layoutGroup = Math.ceil(no / 3);
  return {
    no,
    sceneId: id,
    memo: no % 3 === 0 ? '프랍 있음' : no % 5 === 0 ? '밤 씬' : '',
    storyboardUrl: '',
    guideUrl: '',
    assignee,
    layoutId: String(layoutGroup),
    lo: progress > 0.2,
    done: progress > 0.4,
    review: progress > 0.6,
    png: progress > 0.8,
  };
}

function makePart(epNum: number, partId: string, sceneCount: number, department: Department = 'bg'): Part {
  const prefix = partId.toLowerCase();
  const deptSuffix = department === 'bg' ? '_BG' : '_ACT';
  return {
    partId,
    department,
    sheetName: `EP${String(epNum).padStart(2, '0')}_${partId}${deptSuffix}`,
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
        // BG parts
        makePart(1, 'A', 12, 'bg'),
        makePart(1, 'B', 10, 'bg'),
        makePart(1, 'C', 8, 'bg'),
        // Acting parts
        makePart(1, 'A', 10, 'acting'),
        makePart(1, 'B', 8, 'acting'),
        makePart(1, 'C', 6, 'acting'),
      ],
    },
    {
      episodeNumber: 2,
      title: 'EP.02',
      parts: [
        // BG parts
        makePart(2, 'A', 15, 'bg'),
        makePart(2, 'B', 11, 'bg'),
        makePart(2, 'C', 9, 'bg'),
        makePart(2, 'D', 7, 'bg'),
        // Acting parts
        makePart(2, 'A', 12, 'acting'),
        makePart(2, 'B', 9, 'acting'),
        makePart(2, 'C', 7, 'acting'),
        makePart(2, 'D', 5, 'acting'),
      ],
    },
  ];
}
