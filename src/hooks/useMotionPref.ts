/**
 * 움직임 선호를 캘린더·위젯·배경 등에서 같은 형태로 사용한다.
 * - reduce: OS '동작 줄이기' 또는 앱 설정 '움직임: 최소'. 움직임(위치·크기·회전)을 빼고 opacity 만 남긴다.
 * - lite:   '움직임: 가볍게' 이상(최소·동작 줄이기 포함). 계속 반복되는 장식(배경 루프·펄스)을 멈춘다.
 * - level:  앱 설정값('full' | 'lite' | 'minimal').
 * 기존 사용처의 `const { reduce } = useMotionPref()` 는 그대로 동작한다.
 * OS 값은 matchMedia 를 직접 구독한다 — framer 의 useReducedMotion 은 처음 그릴 때 한 번만 읽어서, 앱을 쓰는 도중
 * 윈도우 '애니메이션 효과'를 바꾸면 오래 떠 있는 사이드바·헤더·말풍선이 앱을 다시 켤 때까지 옛 값을 썼다.
 * 같은 조합이면 같은 객체를 돌려준다.
 */
import { useEffect, useState } from 'react';
import {
  getMotionLevel,
  readMotionPref,
  subscribeMotionLevel,
  subscribeOsReducedMotion,
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

/**
 * 앱 설정과 OS '동작 줄이기'를 함께 구독한다. 상태 하나·effect 하나 — 사용처의 훅 순서(테스트 하네스가 칸 번호로
 * 상태·effect 를 집는다)가 예전과 같게 둔다.
 */
export function useMotionPref(): MotionPref {
  const [pref, setPref] = useState<MotionPref>(readMotionPref);
  useEffect(() => {
    const sync = () => setPref(readMotionPref());
    sync();
    const offLevel = subscribeMotionLevel(sync);
    const offOs = subscribeOsReducedMotion(sync);
    return () => {
      offLevel();
      offOs();
    };
  }, []);
  return pref;
}
