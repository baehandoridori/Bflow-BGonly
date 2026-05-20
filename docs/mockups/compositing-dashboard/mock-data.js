/* ─── 컴포지팅 대시보드 목업 데이터 ──────────────────────────
   B flow 실제 데이터 구조(types/index.ts: Episode/Part/Scene)를 따름.
   본 시안용으로 "컴포지팅 상태(compositingStatus)" 필드를 추가.
   ────────────────────────────────────────────────────────── */

const ASSIGNEES = [
  { name: '원동우', initials: '원', tone: 220 },
  { name: '김하늘', initials: '하', tone: 200 },
  { name: '이서연', initials: '서', tone: 330 },
  { name: '박준혁', initials: '준', tone: 30 },
  { name: '최민지', initials: '민', tone: 280 },
  { name: '윤성원', initials: '성', tone: 160 },
];

const STATUSES = [
  { id: 'batch',      label: '배치',     short: '배치',    cssVar: '--status-batch',      icon: 'square' },
  { id: 'combine',    label: '조합 중',  short: '조합',    cssVar: '--status-combine',    icon: 'layers' },
  { id: 'aggregated', label: '취합완료', short: '취합',    cssVar: '--status-aggregated', icon: 'check-square' },
  { id: 'adjust',     label: '보정 중',  short: '보정',    cssVar: '--status-adjust',     icon: 'sliders' },
  { id: 'error',      label: '오류',     short: '오류',    cssVar: '--status-error',      icon: 'alert' },
  { id: 'done',       label: '완료',     short: '완료',    cssVar: '--status-done',       icon: 'check' },
];

// 오류 세부 분류 (Bflow 본 앱에선 미정의 — 본 시안 제안)
const ERROR_KINDS = ['파일 미싱', '옥에티 수정', '리테이크 대기', '소스 누락', '경로 오류'];

const PARTS_DEF = [
  { id: 'A', cssVar: '--part-a', sceneCount: 14, duration: 330 }, // 5:30
  { id: 'B', cssVar: '--part-b', sceneCount: 22, duration: 390 }, // 6:30
  { id: 'C', cssVar: '--part-c', sceneCount: 16, duration: 330 }, // 5:30
  { id: 'D', cssVar: '--part-d', sceneCount: 12, duration: 300 }, // 5:00
];

// 결정적 PRNG (seed로 재현 가능한 mock)
function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// 파트별 진행도 분포 — 앞 파트일수록 완료에 가까움
const STATUS_DISTRIBUTION = {
  A: { done: 0.6,  aggregated: 0.15, adjust: 0.1,  combine: 0.05, error: 0.05, batch: 0.05 },
  B: { done: 0.2,  aggregated: 0.2,  adjust: 0.25, combine: 0.2,  error: 0.1,  batch: 0.05 },
  C: { done: 0.05, aggregated: 0.1,  adjust: 0.15, combine: 0.3,  error: 0.05, batch: 0.35 },
  D: { done: 0.0,  aggregated: 0.0,  adjust: 0.05, combine: 0.15, error: 0.05, batch: 0.75 },
};

function sampleStatus(rng, partId) {
  const dist = STATUS_DISTRIBUTION[partId];
  const r = rng();
  let acc = 0;
  for (const s of STATUSES) {
    acc += dist[s.id] || 0;
    if (r <= acc) return s.id;
  }
  return 'batch';
}

// 썸네일 — 두 종류 생성
//  · guide: 스토리보드(흑백/라인) 풍
//  · final: 컴포지팅된 컬러풀한 컷
// 같은 컷이 가이드 → 실제로 어떻게 변했는지 비교할 수 있도록 동일한 구도 사용
function thumbnailsFor(partId, rng) {
  const hueBase = { A: 25, B: 45, C: 100, D: 210 }[partId];
  const h1 = (hueBase + Math.floor(rng() * 40) - 20 + 360) % 360;
  const h2 = (h1 + 60 + Math.floor(rng() * 40)) % 360;
  const sat = 30 + Math.floor(rng() * 30);
  const light = 25 + Math.floor(rng() * 25);
  const horizon = 55 + rng() * 15;
  const p1x = 30 + rng() * 20, p1y = 45 + rng() * 10;
  const p2x = 70 + rng() * 20, p2y = 55 + rng() * 8;
  const p3x = 110 + rng() * 20, p3y = 42 + rng() * 12;
  const objX = 20 + Math.floor(rng() * 60);
  const objY = 30 + Math.floor(rng() * 50);
  const objR = 4 + rng() * 4;
  const treeX = 12 + rng() * 30;

  // 가이드: 단색 + 굵은 라인, 스토리보드 느낌
  const guide = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'>
      <rect width='160' height='90' fill='#1d1f24'/>
      <line x1='0' y1='${horizon}' x2='160' y2='${horizon}' stroke='#8b8da3' stroke-width='1' stroke-dasharray='3 2'/>
      <path d='M0 ${horizon + 5} L${p1x} ${p1y} L${p2x} ${p2y} L${p3x} ${p3y} L160 ${horizon + 8}'
        stroke='#c8c8d2' stroke-width='1.5' fill='none'/>
      <rect x='${treeX}' y='${horizon - 18}' width='3' height='18' fill='#c8c8d2'/>
      <circle cx='${treeX + 1.5}' cy='${horizon - 22}' r='5' stroke='#c8c8d2' stroke-width='1' fill='none'/>
      <circle cx='${objX}%' cy='${objY}%' r='${objR}' stroke='#fdd773' stroke-width='1.4' fill='none'/>
      <text x='4' y='10' font-family='monospace' font-size='6' fill='#8b8da3' letter-spacing='1'>GUIDE</text>
    </svg>
  `)}`;

  // 실제: 컬러 그라디언트 풀 컴포지팅 룩
  const isNight = rng() > 0.65;
  const objColor = isNight ? '#fdd773' : '#fff';
  const final = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='hsl(${h1},${sat}%,${light + 12}%)'/>
          <stop offset='1' stop-color='hsl(${h2},${sat + 10}%,${light - 5}%)'/>
        </linearGradient>
        <radialGradient id='v' cx='50%' cy='50%' r='65%'>
          <stop offset='0' stop-color='#000' stop-opacity='0'/>
          <stop offset='1' stop-color='#000' stop-opacity='0.45'/>
        </radialGradient>
      </defs>
      <rect width='160' height='90' fill='url(#g)'/>
      <path d='M0 ${horizon + 5} L${p1x} ${p1y} L${p2x} ${p2y} L${p3x} ${p3y} L160 ${horizon + 8} L160 90 L0 90 Z'
        fill='hsl(${h2},${sat + 5}%,${Math.max(8, light - 18)}%)' opacity='0.92'/>
      <rect x='${treeX}' y='${horizon - 18}' width='3' height='18' fill='hsl(${h2},${sat}%,${Math.max(5, light - 20)}%)'/>
      <circle cx='${treeX + 1.5}' cy='${horizon - 22}' r='5' fill='hsl(${h2},${sat + 5}%,${Math.max(5, light - 14)}%)'/>
      <circle cx='${objX}%' cy='${objY}%' r='${objR}' fill='${objColor}' opacity='${0.7 + rng() * 0.25}'/>
      <rect width='160' height='90' fill='url(#v)'/>
    </svg>
  `)}`;
  return { guide, final };
}

function buildEpisode(seed = 42) {
  const rng = mulberry32(seed);
  const parts = [];
  let globalNo = 1;

  for (const pd of PARTS_DEF) {
    const scenes = [];
    for (let i = 0; i < pd.sceneCount; i++) {
      const sceneId = `${pd.id.toLowerCase()}${String(i + 1).padStart(3, '0')}`;
      const status = sampleStatus(rng, pd.id);
      const bgAssignee = pick(rng, ASSIGNEES);
      let actAssignee = pick(rng, ASSIGNEES);
      // BG·ACT 동일인 방지
      if (actAssignee.name === bgAssignee.name) {
        actAssignee = ASSIGNEES[(ASSIGNEES.indexOf(actAssignee) + 1) % ASSIGNEES.length];
      }
      const sceneLen = 2 + Math.floor(rng() * 12); // 2~14초
      const thumbs = thumbnailsFor(pd.id, rng);
      scenes.push({
        sceneId,
        no: globalNo++,
        partId: pd.id,
        partSceneNo: i + 1,
        memo: rng() > 0.7 ? pick(rng, ['프랍 있음', '밤 씬', '클로즈업', '와이드 샷', '인물 다수', '비 오는 씬']) : '',
        thumbnail: thumbs.final,    // 호환: 기존 시안 B/C
        guideUrl: thumbs.guide,     // 스토리보드 가이드
        finalUrl: thumbs.final,     // 실제 컴포지팅된 이미지
        // 호환: 기존 시안에서 단일 assignee 참조
        assignee: bgAssignee.name,
        assigneeInitials: bgAssignee.initials,
        assigneeTone: bgAssignee.tone,
        bgAssignee: { name: bgAssignee.name, initials: bgAssignee.initials, tone: bgAssignee.tone },
        actAssignee: { name: actAssignee.name, initials: actAssignee.initials, tone: actAssignee.tone },
        compositingStatus: status,
        errorKind: status === 'error' ? pick(rng, ERROR_KINDS) : null,
        duration: sceneLen,
        // 진행도(0~1) — 보정/조합/배치는 진행도 다름
        progress: status === 'done' ? 1
          : status === 'aggregated' ? 0.85
          : status === 'adjust' ? 0.5 + rng() * 0.3
          : status === 'combine' ? 0.3 + rng() * 0.3
          : status === 'error' ? 0.4 + rng() * 0.4
          : 0.05,
        revision: status === 'adjust' || status === 'error' ? Math.floor(rng() * 3) + 1 : 0,
      });
    }
    parts.push({
      partId: pd.id,
      cssVar: pd.cssVar,
      duration: pd.duration,
      sceneCount: pd.sceneCount,
      scenes,
    });
  }

  return {
    episodeNumber: 5,
    title: 'EP.05',
    code: 'EP05_펜치우니버스의 첫 모험',
    parts,
    totalDuration: parts.reduce((a, p) => a + p.duration, 0),
    totalScenes: parts.reduce((a, p) => a + p.sceneCount, 0),
    compositor: { name: '원동우', initials: '원', tone: 220, role: '담당 컴포지터' },
    viewers: ASSIGNEES.slice(1, 4),
    lastUpdated: '방금 전',
  };
}

// 진행률 통계
function computeStats(episode) {
  const allScenes = episode.parts.flatMap(p => p.scenes);
  const total = allScenes.length;
  const byStatus = {};
  for (const s of STATUSES) byStatus[s.id] = 0;
  for (const sc of allScenes) byStatus[sc.compositingStatus]++;
  const overall = byStatus.done / total;
  return { total, byStatus, overall };
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 글로벌 export
Object.assign(window, {
  BF_DATA: {
    ASSIGNEES, STATUSES, PARTS_DEF, ERROR_KINDS,
    buildEpisode, computeStats, fmtTime,
  },
});
