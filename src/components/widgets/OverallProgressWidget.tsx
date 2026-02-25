import { useMemo, useState, useEffect, useCallback } from 'react';
import { PieChart } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Widget } from './Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDashboardEpisodes } from '@/hooks/useDashboardEpisodes';
import { calcDashboardStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';

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

const MESSAGES: Record<string, MotivMessage[]> = {
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
  { text: '저 인스타 지울 수 있습니다', author: '강지융' },
  { text: '근데 인스타에 연락처가 있어서 못지워요', author: '강지융' },
  { text: '네 ㅋㅋ 찌찌 ㅋㅋ', author: '원동우' },
  { text: '너 지웅이 좋아해?', author: '류이레' },
  { text: '우리 언젠가 분명히 잡혀갈거야.....', author: '정영준' },
  { text: '틀리면 엑쓰', author: '경환엄마' },
];

function getMessagePool(pct: number): MotivMessage[] {
  let base: MotivMessage[];
  if (pct === 0) base = MESSAGES['0'];
  else if (pct >= 100) base = MESSAGES['100'];
  else if (pct < 10) base = MESSAGES['1-10'];
  else if (pct < 25) base = MESSAGES['10-25'];
  else if (pct < 50) base = MESSAGES['25-50'];
  else if (pct < 75) base = MESSAGES['50-75'];
  else base = MESSAGES['75-99'];
  return [...base, ...RANDOM_MESSAGES];
}

export function OverallProgressWidget() {
  const episodes = useDashboardEpisodes();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const isAll = dashboardFilter === 'all';
  const dept = isAll ? undefined : dashboardFilter;
  const deptConfig = !isAll ? DEPARTMENT_CONFIGS[dashboardFilter] : null;
  const stats = useMemo(() => calcDashboardStats(episodes, dept), [episodes, dept]);
  const pctRaw = stats.overallPct;
  const pct = Number(pctRaw.toFixed(1));

  const title = deptConfig
    ? `전체 진행률 (${deptConfig.shortLabel})`
    : '전체 진행률 (통합)';

  // SVG 원형 진행률
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    return COLOR_SEGMENTS.map((seg) => {
      const segStart = seg.min;
      const segEnd = Math.min(seg.max, pct);
      if (segEnd <= segStart) return null;
      const arcLength = ((segEnd - segStart) / 100) * circumference;
      const startOffset = (segStart / 100) * circumference;
      return {
        color: seg.color,
        dasharray: `${arcLength} ${circumference - arcLength}`,
        dashoffset: -startOffset,
      };
    }).filter(Boolean) as { color: string; dasharray: string; dashoffset: number }[];
  }, [pct, circumference]);

  // ── 동기부여 메시지 로테이션 ──
  const pool = useMemo(() => getMessagePool(pct), [pct]);
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

  return (
    <Widget title={title} icon={<PieChart size={16} />}>
      <div className="flex flex-col items-center justify-center h-full gap-2">
        {/* 원형 차트 */}
        <div className="relative">
          <svg width={160} height={160}>
            <circle cx={80} cy={80} r={radius} fill="none" stroke="rgb(var(--color-bg-border))" strokeWidth={10} />
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx={80}
                cy={80}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={10}
                strokeDasharray={seg.dasharray}
                strokeDashoffset={seg.dashoffset}
                strokeLinecap={i === segments.length - 1 ? 'round' : 'butt'}
                transform="rotate(-90 80 80)"
                className="transition-all duration-700 ease-out"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-bold text-text-primary">{pct}%</span>
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
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
