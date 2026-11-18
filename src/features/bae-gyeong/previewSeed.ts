/**
 * 테스트 모드(?preview=1)의 8단계 시험 자료: 시험 계정 둘(장삐쭈 · 허혜원, 'BAE경 사용자')의 기록과 장부 줄, 검수자 한 명(안류천),
 * 그리고 배한솔(관리자)의 기록 둘에 검수자가 찍은 도장 — 팀 기록 · 도장 · 景 숫자 · 비용 표가 테스트 모드에서도 보이게.
 * 브라우저 저장소에 한 번만 넣는다(previewGateway 의 seed 선택). 그림은 앱에 들어 있는 스타일 예시 그림 주소를 받는다.
 * node --test 가 바로 읽을 수 있게 값 import 가 없다.
 */
import type { BaeJob, BaeUsageLine } from '../../shared/bae/jobs.ts';
import type { BaeMember } from '../../shared/bae/access.ts';

export interface PreviewStampLine { id: number; jobId: string; jobOwner: string; stamp: 'seen' | 'good' | 'again' | null; note: string | null; by: string; at: string }
export interface PreviewSeedData {
  members: BaeMember[];
  jobs: BaeJob[];
  usage: Array<BaeUsageLine & { userId: string }>;
  stamps: PreviewStampLine[];
}

/** 시험 계정 (devElectronAPI 의 MOCK_USERS 와 같은 id). */
export const PREVIEW_SEED_PEOPLE = { hansol: '1', a: '2', b: '3', reviewer: '4' } as const;
const NAMES: Record<string, string> = { '1': '배한솔', '2': '장삐쭈', '3': '허혜원', '4': '안류천' };

const id = (n: number) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** now 기준으로 지난 열흘 남짓에 흩어진 기록. images: 결과 그림으로 쓸 주소들 (없으면 그림 없이). */
export function baePreviewSeed(now: Date, images: string[]): PreviewSeedData {
  // 오늘 아직 오지 않은 시각은 '조금 전'으로 당긴다 (늦은 시각일수록 지금에 가깝게, 순서는 그대로)
  const at = (daysAgo: number, hour: number, min = 0) => {
    const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, min, 0, 0);
    if (d.getTime() > now.getTime() - 60_000) d.setTime(now.getTime() - (24 - hour) * 600_000 - (60 - min) * 1000);
    return d.toISOString();
  };
  const img = (i: number) => (images.length ? images[i % images.length] : undefined);
  type Spec = { n: number; who: string; kind: BaeJob['kind']; status: BaeJob['status']; day: number; hour: number; request: string; name?: string; prompt: string; summaryKo: string; order: number; image: number; sec: number; stamp?: { s: 'seen' | 'good' | 'again'; note?: string; by: string; day: number; hour: number }; error?: string };
  const specs: Spec[] = [
    { n: 1, who: '2', kind: 'new', status: 'done', day: 0, hour: 10, request: '아파트 지하 주차장. 형광등이 몇 개 꺼져 있고 바닥에 물웅덩이.', name: '지하 주차장 밤', prompt: 'An underground apartment parking garage at night, a few fluorescent lights out, puddles on the floor.', summaryKo: '지하 주차장, 꺼진 형광등과 물웅덩이로 어둡고 축축한 느낌.', order: 0.0241, image: 0.0752, sec: 48 },
    { n: 2, who: '2', kind: 'same', status: 'done', day: 1, hour: 15, request: '같은 거실, TV 쪽 벽을 정면으로.', prompt: 'The same living room, facing the TV wall straight on.', summaryKo: '같은 거실을 TV 쪽 벽 정면에서.', order: 0.0233, image: 0.0801, sec: 52, stamp: { s: 'seen', by: '4', day: 1, hour: 17 } },
    { n: 3, who: '2', kind: 'edit', status: 'done', day: 3, hour: 11, request: '교실 창문을 더 크게, 오후 햇빛.', prompt: 'The classroom with larger windows and afternoon sunlight.', summaryKo: '창문을 키운 오후 교실.', order: 0.0198, image: 0.0779, sec: 45 },
    { n: 4, who: '2', kind: 'new', status: 'failed', day: 5, hour: 9, request: '비 오는 버스 정류장', prompt: 'A bus stop in the rain.', summaryKo: '비 오는 정류장.', order: 0.0187, image: 0, sec: 0, error: '그림 모델이 답하지 않았어요 (503).' },
    { n: 5, who: '3', kind: 'new', status: 'done', day: 0, hour: 14, request: '소나무 숲 사이 산길, 이른 아침 안개.', name: '안개 산길', prompt: 'A mountain trail between pine trees, early morning fog.', summaryKo: '안개 낀 이른 아침의 소나무 산길.', order: 0.0262, image: 0.0834, sec: 51 },
    { n: 6, who: '3', kind: 'import', status: 'done', day: 2, hour: 16, request: '불러온 사진: 학교 복도', prompt: '', summaryKo: '', order: 0, image: 0, sec: 0 },
    { n: 7, who: '3', kind: 'new', status: 'done', day: 6, hour: 13, request: '회의실, 긴 책상과 화이트보드.', prompt: 'A meeting room with a long table and a whiteboard.', summaryKo: '긴 책상과 화이트보드가 있는 회의실.', order: 0.0215, image: 0.0768, sec: 47, stamp: { s: 'good', by: '4', day: 5, hour: 10 } },
    { n: 8, who: '3', kind: 'denoise', status: 'done', day: 9, hour: 18, request: '', prompt: '', summaryKo: '', order: 0, image: 0, sec: 0 },
    { n: 9, who: '1', kind: 'new', status: 'done', day: 1, hour: 20, request: '편의점 앞, 비 그친 저녁. 간판 불빛이 젖은 바닥에 비침.', name: '편의점 저녁', prompt: 'In front of a convenience store on an evening after rain, sign lights reflecting on the wet ground.', summaryKo: '비 그친 저녁 편의점 앞, 젖은 바닥에 간판 불빛.', order: 0.0229, image: 0.0811, sec: 49, stamp: { s: 'good', note: '불빛 반사 좋아요', by: '4', day: 0, hour: 11 } },
    { n: 10, who: '1', kind: 'same', status: 'done', day: 2, hour: 10, request: '같은 교실, 칠판 쪽.', prompt: 'The same classroom, toward the blackboard.', summaryKo: '같은 교실을 칠판 쪽에서.', order: 0.0221, image: 0.0795, sec: 50, stamp: { s: 'again', note: '칠판이 너무 작아요. 화면의 1/3 정도로 다시 해 보면 좋겠어요.', by: '4', day: 0, hour: 11, } },
  ];
  const jobs: BaeJob[] = []; const usage: PreviewSeedData['usage'] = []; const stamps: PreviewStampLine[] = [];
  let sid = 0;
  for (const s of specs) {
    const created = at(s.day, s.hour); const done = s.status !== 'drawing';
    const src = s.status === 'failed' ? undefined : img(s.n);
    const stampAt = s.stamp ? at(s.stamp.day, s.stamp.hour, 30) : null;
    const updated = stampAt && stampAt > created ? stampAt : at(s.day, s.hour, 1);
    jobs.push({
      id: id(s.n), userId: s.who, userName: NAMES[s.who] ?? s.who, kind: s.kind, status: s.status, name: s.name ?? null, parentJobId: null,
      summary: { request: s.request, ratio: '16:9', ...(s.kind === 'denoise' || s.kind === 'import' ? { source: s.kind === 'denoise' ? '거실 정면.png' : '학교 복도.jpg' } : {}) },
      result: s.status === 'done' ? { w: 2048, h: 1152, sec: s.sec || undefined, usdOrder: s.order, usdImage: s.image } : s.error ? { error: s.error } : {},
      images: s.status === 'done' && src ? { result: src, thumb: src } : {},
      selfReview: null, stamp: s.stamp?.s ?? null, stampAt, costUsd: s.order + s.image, origin: 'JBBJ-PC', appVersion: 'preview', hidden: false,
      createdAt: created, finishedAt: done ? at(s.day, s.hour, 1) : null, updatedAt: updated,
      pd: s.summaryKo ? { summaryKo: s.summaryKo, prompt: s.prompt, notesKo: [] } : {}, stampBy: s.stamp?.by ?? null, stampNote: s.stamp?.note ?? null,
    });
    if (s.order) usage.push({ requestId: `seed-${s.n}-order`, jobId: id(s.n), kind: 'order', model: 'gpt-6.1-sol', tokens: { input: 9000, output: 800 }, usd: s.order, at: created, userId: s.who });
    if (s.image) usage.push({ requestId: `seed-${s.n}-image`, jobId: id(s.n), kind: 'image', model: 'gpt-image-2.5-sunburst', tokens: { input: 1600, output: 1631 }, usd: s.image, at: at(s.day, s.hour, 1), userId: s.who });
    if (s.stamp && stampAt) stamps.push({ id: ++sid, jobId: id(s.n), jobOwner: s.who, stamp: s.stamp.s, note: s.stamp.note ?? null, by: s.stamp.by, at: stampAt });
  }
  // 차례가 남는 것을 보이려고: 배한솔의 교실(10)은 처음에 확인함이었다가 다시로 바뀌었다
  stamps.push({ id: 0, jobId: id(10), jobOwner: '1', stamp: 'seen', note: null, by: '4', at: at(1, 9) });
  stamps.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id - y.id)).forEach((x, i) => { x.id = i + 1; });
  return {
    members: [{ userId: '2', role: 'user' }, { userId: '3', role: 'user' }, { userId: '4', role: 'reviewer' }],
    jobs: jobs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), usage, stamps,
  };
}
