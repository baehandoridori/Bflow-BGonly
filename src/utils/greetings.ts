/**
 * 시간대별 인사말 유틸리티
 * Dashboard 상단 토스트에 표시
 */

/** 시간대별 인사말 풀 (xx = 이름만, xxx = 전체 이름) */
const GREETINGS: Record<string, string[]> = {
  // 아침 (6-11)
  morning: [
    'xx님, 좋은 아침이예요!',
    'xx님, 좋은 아침입니다!',
    '오늘도 화이팅이예요, xx님!',
    'xx님, 상쾌한 아침이네요!',
    '좋은 하루 보내세요, xx님!',
    'xx님, 오늘도 좋은 하루 되세요!',
  ],
  // 점심 (11-13)
  lunch: [
    'xx님, 점심 맛있게 드셨나요?',
    'xx님, 든든하게 드셨나요?',
    '오후도 힘내요, xx님!',
    'xx님, 맛점 하셨나요?',
  ],
  // 오후 (13-18)
  afternoon: [
    'xx님, 피곤하지 않으신가요?',
    'xx님, 커피 한잔 더?',
    '오후도 힘내봐요, xx님!',
    'xx님, 오늘 하루도 거의 다 왔어요!',
    'xx님, 조금만 더 힘내요!',
  ],
  // 저녁 (18-21)
  evening: [
    'xx님, 저녁 맛있게 드셨나요?',
    'xx님, 화이팅!',
    '수고하셨어요, xx님!',
    'xx님, 오늘도 고생 많으셨어요!',
  ],
  // 밤 (21-00)
  night: [
    'xx님, 너무 무리하진 마세요!',
    'xx님, 같이 마무리 해 볼까요?',
    '오늘도 수고했어요, xx님!',
    'xx님, 얼른 퇴근하세요!',
    'xx님, 오늘 하루도 고생 많았어요!',
  ],
  // 새벽 (0-6)
  dawn: [
    'xx님, 돌아오셨군요!',
    'xx님, 먹고살기 힘들죠?',
    'xx님, 이 시간에도 일하시다니..!',
    'xx님, 건강 챙기세요!',
  ],
};

/** 최초 로그인 인사말 */
const FIRST_LOGIN = 'xxx님 안녕하세요!';

/** 시간대 결정 */
function getTimeSlot(hour: number): string {
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'lunch';
  if (hour >= 13 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 21) return 'evening';
  if (hour >= 21 && hour < 24) return 'night';
  return 'dawn'; // 0-6
}

/** 이름에서 성 제거 (xx용: 2글자 이상이면 첫 글자 제거) */
function getShortName(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed.length >= 2 ? trimmed.slice(1) : trimmed;
}

/** 인사말 생성 */
export function getGreeting(fullName: string, isFirstLogin: boolean): string {
  if (isFirstLogin) {
    return FIRST_LOGIN.replace('xxx', fullName);
  }

  const hour = new Date().getHours();
  const slot = getTimeSlot(hour);
  const pool = GREETINGS[slot] ?? GREETINGS.morning;
  const msg = pool[Math.floor(Math.random() * pool.length)];
  const shortName = getShortName(fullName);

  return msg.replace(/xx/g, shortName);
}

/** 최초 로그인 여부 확인/기록 (localStorage) */
const FIRST_LOGIN_KEY = 'bflow_first_login_shown';

export function isFirstLogin(): boolean {
  return !localStorage.getItem(FIRST_LOGIN_KEY);
}

export function markFirstLoginShown(): void {
  localStorage.setItem(FIRST_LOGIN_KEY, '1');
}
