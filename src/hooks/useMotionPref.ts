/**
 * 움직임 선호를 캘린더·위젯·배경 등에서 같은 형태로 사용한다.
 * - reduce: OS '동작 줄이기' 또는 앱 설정 '움직임: 최소'. 움직임(위치·크기·회전)을 빼고 opacity 만 남긴다.
 * - lite:   '움직임: 가볍게' 이상(최소·동작 줄이기 포함). 계속 반복되는 장식(배경 루프·펄스)을 멈춘다.
 * - level:  앱 설정값('full' | 'lite' | 'minimal').
 * 기존 사용처의 `const { reduce } = useMotionPref()` 는 그대로 동작한다.
 * OS 값의 초기 null 은 기본 모션으로 다루고, 명시적으로 true 일 때만 줄인다.
 * 같은 조합이면 같은 객체를 돌려준다.
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  getMotionLevel,
  resolveMotionPref,
  subscribeMotionLevel,
  type MotionLevel,
  type MotionPref,
} from '@/utils/motionLevel';

/**
 * 앱 설정 '움직임' 값만 구독한다.
 * useSyncExternalStore 대신 useState+useEffect 로 구독한다 — 컴포넌트를 함수로 직접 불러 보는 기존
 * 테스트 하네스(useState·useEffect 만 흉내 냄)에서도 그대로 돌게.
 */
export function useMotionLevel(): MotionLevel {
  const [level, setLevel] = useState<MotionLevel>(getMotionLevel);
  useEffect(() => {
    setLevel(getMotionLevel());
    return subscribeMotionLevel(() => setLevel(getMotionLevel()));
  }, []);
  return level;
}

export function useMotionPref(): MotionPref {
  const osReduce = useReducedMotion() === true;
  const level = useMotionLevel();
  return resolveMotionPref(osReduce, level);
}
