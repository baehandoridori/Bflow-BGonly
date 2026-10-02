import { useMemo, useState, useEffect, useCallback, useId } from 'react';
import { PieChart } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Widget } from './Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDashboardEpisodes } from '@/hooks/useDashboardEpisodes';
import { useDashboardRollKey } from '@/hooks/useDashboardRollKey';
import { useMotionPref } from '@/hooks/useMotionPref';
import { calcDashboardStats } from '@/utils/calcStats';
import { MOTION_MS, transformPreset } from '@/utils/motion';
import { progressBucket, ringReveal, ringSegmentArcs, type ProgressBucket } from '@/utils/progressMotion';
import { DEPARTMENT_CONFIGS } from '@/types';
import { HorizontalBar } from './charts/HorizontalBar';
import { StatCard } from './charts/StatCard';
import { RollingNumber } from '@/components/ui/RollingNumber';
import type { ChartType } from '@/types';

const SUPPORTED_CHARTS: ChartType[] = ['donut', 'horizontal-bar', 'stat-card'];

/* ── 퍼센티지 구간별 색상 세그먼트 ── */
const COLOR_SEGMENTS = [
  { min: 0,  max: 25,  color: '#FF6B6B' },
  { min: 25, max: 50,  color: '#E17055' },
  { min: 50, max: 75,  color: '#FDCB6E' },
  { min: 75, max: 100, color: '#00B894' },
];

/* ── 구간별 동기부여 메시지 풀 ── */
interface MotivMessage {
  text: string;
  author?: string;
}

const MESSAGES: Record<ProgressBucket, MotivMessage[]> = {
  '0': [
    { text: '시작이 반이다.', author: '아리스토텔레스' },
    { text: '천 리 길도 한 걸음부터.', author: '노자' },
    { text: '빈 캔버스가 가장 설레는 순간입니다.' },
  ],
  '1-10': [
    { text: '씨앗을 심었어요. 잘 자랄 거예요.' },
    { text: '위대한 일은 작은 시작에서 비롯된다.' },
    { text: '무언가를 시작하는 용기가 가장 귀한 재능이다.', author: '시드니 스미스' },
  ],
  '10-25': [
    { text: '멈추지 않는 한, 느리게 가도 괜찮다.', author: '공자' },
    { text: '기초가 튼튼하면 건물은 흔들리지 않습니다.' },
    { text: '인내는 쓰지만 그 열매는 달다.', author: '장자크 루소' },
  ],
  '25-50': [
    { text: '꾸준함은 천재를 이긴다.' },
    { text: '속도가 붙기 시작합니다. 리듬을 유지하세요.' },
    { text: '매일 조금씩, 그것이 비결이다.', author: '레이먼드 챈들러' },
  ],
  '50-75': [
    { text: '반환점을 돌았습니다. 이제 내리막길.' },
    { text: '끝이 보이기 시작합니다. 집중하세요.' },
    { text: '성공은 매일 반복한 작은 노력의 합이다.', author: '로버트 콜리어' },
  ],
  '75-99': [
    { text: '거의 다 왔어요. 라스트 스퍼트!' },
    { text: '마지막 1%가 작품의 완성도를 결정합니다.' },
    { text: '끝까지 해낸 자만이 승리를 맛본다.', author: '나폴레옹 보나파르트' },
  ],
  '100': [
    { text: '완벽합니다. 수고하셨습니다!' },
    { text: '모든 씬 완료. 정말 대단해요!' },
    { text: '불가능이란 노력하지 않는 자의 변명이다.', author: '나폴레옹 보나파르트' },
  ],
};

/* ── 진행도 무관 랜덤 멘트 (팀원 어록) ── */
const RANDOM_MESSAGES: MotivMessage[] = [
  { text: '응후응후', author: '이혜민' },
  { text: 'る..', author: 'ちいかわ' },
  { text: '저는 서울에 사는 초등학생을 보면 너무 화나요', author: '이명훈' },
  { text: '네 ㅋㅋ 찌찌 ㅋㅋ', author: '원동우' },
  { text: '너 지웅이 좋아해?', author: '류이레' },
  { text: '우리 언젠가 분명히 잡혀갈거야.....', author: '정영준' },
  { text: '틀리면 엑쓰', author: '경환엄마' },
  { text: '응후응후 (여러분 모두 힘든 작업을 하고 계시지만 분명히 힘든 만큼 값진 결과가 되돌아올 것입니다. 포기하지 말고 옆에있는 팀원을 의지하면서 언제나 열심히 즐겁게 오래오래 일하는 스튜디오 장삐쭈가 되었으면 좋겠습니다. 사코팍 화이팅! 스튜디오장삐쭈 화이팅!)', author: '이혜민' },
];

/** 구간(progressBucket)마다 명언 풀. 팀원이 체크해 0.1% 움직여도 같은 구간이면 같은 풀·같은 명언을 유지한다. */
function getMessagePool(bucket: ProgressBucket): MotivMessage[] {
  return [...MESSAGES[bucket], ...RANDOM_MESSAGES];
}

/* 명언 바뀜 — 아래에서 떠올라 위로 사라진다. transform 문자열(합성 스레드), 동작 줄이기면 opacity 만. */
const QUOTE_MOTION = transformPreset({ from: 'translateY(8px)', exitTo: 'translateY(-8px)', duration: 500, exitDuration: MOTION_MS.slow });
const QUOTE_MOTION_REDUCED = transformPreset({ from: 'translateY(8px)' }, true);

/* 진행률 원 */
const RING_SIZE = 160;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 60;
const RING_STROKE = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 구간색 띠 4개 — 값과 무관하게 늘 그려 두고, 얼마나 보일지는 가림막 하나가 정한다(경계를 넘어도 띠가 이어진다). */
const RING_ARCS = ringSegmentArcs(COLOR_SEGMENTS, RING_CIRCUMFERENCE);
/**
 * 끝의 둥근 머리 — 12시 자리에서 시계 방향(앞쪽)으로만 나온 반원. 원 전체를 쓰면 뒤쪽 반이 12시 앞의
 * 마지막 구간(초록)을 비춰 0% 근처에서 두 색 점이 된다. 호와 맞닿는 곳 실선이 비치지 않게 0.5px 겹친다.
 */
const RING_CAP_PATH = [
  `M ${RING_CENTER - 0.5} ${RING_CENTER - RING_RADIUS - RING_STROKE / 2}`,
  `H ${RING_CENTER}`,
  `A ${RING_STROKE / 2} ${RING_STROKE / 2} 0 0 1 ${RING_CENTER} ${RING_CENTER - RING_RADIUS + RING_STROKE / 2}`,
  `H ${RING_CENTER - 0.5} Z`,
].join(' ');

export function OverallProgressWidget() {
  const episodes = useDashboardEpisodes();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const chartType = useAppStore((s) => s.chartTypes['overall-progress']) ?? 'donut';
  const isAll = dashboardFilter === 'all';
  const dept = isAll ? undefined : dashboardFilter;
  const deptConfig = !isAll ? DEPARTMENT_CONFIGS[dashboardFilter] : null;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const pctRaw = stats.overallPct;
  const pct = Number(pctRaw.toFixed(1));
  // 숫자는 소수 한 자리로 폭을 고정한다. 100% 만 '100%' 로(원 안에 넉넉히 들어가게).
  const pctDecimals = pct >= 100 ? 0 : 1;
  // 탭·에피소드를 바꾼 직후, 데이터가 처음 도착한 순간에는 굴리지 않는다.
  const rollKey = `${useDashboardRollKey()}|${stats.totalScenes > 0 ? 'ready' : 'empty'}`;
  const { reduce } = useMotionPref();
  const ringMaskId = `bf-overall-ring-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  const title = deptConfig
    ? `전체 진행률 (${deptConfig.shortLabel})`
    : '전체 진행률 (통합)';

  const activeChart = SUPPORTED_CHARTS.includes(chartType) ? chartType : 'donut';

  // SVG 원형 진행률 — 가림막이 드러내는 길이와 끝점(둥근 머리) 각도
  const reveal = ringReveal(pct, RING_CIRCUMFERENCE);

  // ── 동기부여 메시지 로테이션 ── (구간이 실제로 바뀔 때와 8초 주기에만 바뀐다)
  const bucket = progressBucket(pct);
  const pool = useMemo(() => getMessagePool(bucket), [bucket]);
  const [msgIdx, setMsgIdx] = useState(0);

  const pickNext = useCallback(() => {
    setMsgIdx((prev) => {
      let next = Math.floor(Math.random() * pool.length);
      if (pool.length > 1) {
        while (next === prev) next = Math.floor(Math.random() * pool.length);
      }
      return next;
    });
  }, [pool.length]);

  useEffect(() => {
    setMsgIdx(Math.floor(Math.random() * pool.length));
  }, [pool]);

  useEffect(() => {
    const interval = setInterval(pickNext, 8000);
    return () => clearInterval(interval);
  }, [pickNext]);

  const currentMsg = pool[msgIdx % pool.length];

  // ── 가로 막대 ──
  if (activeChart === 'horizontal-bar') {
    return (
      <Widget title={title} icon={<PieChart size={16} />}>
        <div className="flex flex-col gap-3 h-full">
          <HorizontalBar
            items={stats.stageStats.map((s) => ({
              label: s.label,
              value: s.done,
              total: s.total,
              pct: s.pct,
              color: deptConfig ? deptConfig.stageColors[s.stage] : '#6C5CE7',
            }))}
          />
          <div className="flex gap-4 text-xs text-text-secondary mt-auto">
            <span>전체 {stats.totalScenes}씬</span>
            <span className="text-stage-png">완료 {stats.fullyDone}</span>
            <span className="text-status-none">미시작 {stats.notStarted}</span>
          </div>
        </div>
      </Widget>
    );
  }

  // ── 숫자 카드 ──
  if (activeChart === 'stat-card') {
    return (
      <Widget title={title} icon={<PieChart size={16} />}>
        <StatCard
          value={<RollingNumber value={pctRaw} decimals={pctDecimals} suffix="%" resetKey={rollKey} />}
          label={title}
          subValue={`${stats.totalScenes}씬 중 ${stats.fullyDone} 완료`}
          pct={pct}
        />
      </Widget>
    );
  }

  // ── 기본: 도넛 ──
  return (
    <Widget title={title} icon={<PieChart size={16} />}>
      <div className="flex flex-col items-center justify-center h-full gap-2">
        {/* 원형 차트 */}
        <div className="relative">
          <svg width={RING_SIZE} height={RING_SIZE}>
            <defs>
              {/* 가림막: 호 하나(길이만 전환) + 끝의 둥근 머리(같은 박자로 회전). 흰 곳만 아래 색 띠가 보인다. */}
              <mask id={ringMaskId} maskUnits="userSpaceOnUse" x={0} y={0} width={RING_SIZE} height={RING_SIZE}>
                <circle
                  cx={RING_CENTER}
                  cy={RING_CENTER}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={RING_STROKE}
                  strokeDasharray={`${reveal.length} ${RING_CIRCUMFERENCE}`}
                  transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                  className="bf-progress-arc bf-entry-ring"
                />
                <g
                  className="bf-progress-cap bf-entry-ring-cap"
                  data-visible={reveal.capVisible ? 'true' : 'false'}
                  style={{
                    transform: `rotate(${reveal.capDeg}deg)`,
                    transformOrigin: `${RING_CENTER}px ${RING_CENTER}px`,
                    opacity: reveal.capVisible ? 1 : 0,
                  }}
                >
                  <path d={RING_CAP_PATH} fill="#fff" />
                </g>
              </mask>
            </defs>
            <circle cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" stroke="rgb(var(--color-bg-border))" strokeWidth={RING_STROKE} />
            <g mask={`url(#${ringMaskId})`}>
              {RING_ARCS.map((arc) => (
                <circle
                  key={arc.key}
                  cx={RING_CENTER}
                  cy={RING_CENTER}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={RING_STROKE}
                  strokeDasharray={arc.dasharray}
                  strokeDashoffset={arc.dashoffset}
                  transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <RollingNumber
              value={pctRaw}
              decimals={pctDecimals}
              suffix="%"
              resetKey={rollKey}
              className="text-3xl font-bold text-text-primary"
            />
          </div>
        </div>

        {/* 요약 숫자 */}
        <div className="flex gap-4 text-xs text-text-secondary">
          <span>전체 {stats.totalScenes}씬</span>
          <span className="text-stage-png">완료 {stats.fullyDone}</span>
          <span className="text-status-none">미시작 {stats.notStarted}</span>
        </div>

        {/* 동기부여 메시지 */}
        <div className="min-h-[2.5rem] flex items-center justify-center w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${msgIdx}-${pool[0]?.text}`}
              {...(reduce ? QUOTE_MOTION_REDUCED : QUOTE_MOTION)}
              className="text-center px-3"
            >
              <p className="text-xs italic text-text-secondary/80 leading-relaxed">
                &ldquo;{currentMsg.text}&rdquo;
              </p>
              {currentMsg.author && (
                <p className="text-[11px] text-text-secondary/60 mt-0.5">
                  — {currentMsg.author}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Widget>
  );
}
