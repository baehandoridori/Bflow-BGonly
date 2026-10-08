import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { useMotionLevel } from '@/hooks/useMotionPref';

/**
 * 앱 바깥 framer 설정 (움직임 폴리싱 바탕 B).
 * - 기본: reducedMotion 'user' — 윈도우 '애니메이션 효과 끄기'(동작 줄이기)를 framer 움직임 전체가 따른다.
 * - 앱 설정 '움직임: 최소': 'always' — 동작 줄이기와 같게.
 * 주의: framer 는 x·y·scale 같은 개별 transform 값만 줄인다. transform 문자열·WAAPI·rAF·캔버스·SMIL 은
 * 막지 못하므로 그런 곳은 useMotionPref() 로 직접 분기한다. 안쪽 MotionConfig(캘린더 화면)가 있으면 안쪽이 이긴다.
 * framer 는 요소가 처음 붙을 때 이 값을 읽으므로, 설정을 바꾸면 그 뒤로 새로 열리는 것부터 적용된다.
 */
export function AppMotionConfig({ children }: { children: ReactNode }) {
  const level = useMotionLevel();
  return (
    <MotionConfig reducedMotion={level === 'minimal' ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  );
}
