/**
 * 앱 기본 설정 — 하드코딩된 기본값
 *
 * 다른 PC에서 레포를 클론한 뒤 별도 설정 없이 바로 테스트하려면
 * 아래 DEFAULT_WEB_APP_URL에 실제 Apps Script 웹 앱 URL을 넣어주세요.
 *
 * ⚠️  URL을 변경한 뒤에는 앱을 재시작해야 반영됩니다.
 * ⚠️  이 값은 sheets-config.json이 없을 때만 사용됩니다.
 *     설정 화면에서 직접 저장한 URL이 있으면 그쪽이 우선합니다.
 */

// ─── Google Apps Script 웹 앱 기본 URL ───────────────────────
// 아래 URL을 실제 배포된 GAS 웹 앱 URL로 교체하세요.
// 예시: 'https://script.google.com/macros/s/AKfycb.../exec'
export const DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwse8JuJug4dx8-zVdnoRizlp03lwbSKc9YOH2-40PAEX5tWGKMzC3WJx6zIvNEc9PC/exec';

// ─── 휴가 관리 Apps Script 웹 앱 기본 URL ──────────────────
export const DEFAULT_VACATION_URL = 'https://script.google.com/macros/s/AKfycbx82kD3CV_0saumS9i1EDfin_GRLNemL5FOeUHgp5diZn6Mt91mduRTBImiwHtutfHI/exec';

// URL이 비어있으면 자동 연결을 건너뜁니다.
