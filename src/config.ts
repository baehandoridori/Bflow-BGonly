/**
 * 앱 기본 설정 — 하드코딩된 기본값
 *
 * 다른 PC에서 레포를 클론한 뒤 별도 설정 없이 바로 테스트하려면
 * 아래 DEFAULT_GAS_IMAGE_URL에 실제 Apps Script 웹 앱 URL을 넣어주세요.
 *
 * ⚠️  URL을 변경한 뒤에는 앱을 재시작해야 반영됩니다.
 * ⚠️  이 값은 sheets-config.json이 없을 때만 사용됩니다.
 *     설정 화면에서 직접 저장한 URL이 있으면 그쪽이 우선합니다.
 */

// ─── Supabase 프로젝트 URL ─────────────────────────────
// electron/supabase.ts 의 SUPABASE_URL 과 동일하게 유지. 연동 탭 표시용.
export const SUPABASE_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co';

// ─── GAS 이미지 업로드용 기본 URL ───────────────────────
// 아래 URL을 실제 배포된 GAS 웹 앱 URL로 교체하세요.
// 예시: 'https://script.google.com/macros/s/AKfycb.../exec'
export const DEFAULT_GAS_IMAGE_URL = 'https://script.google.com/macros/s/AKfycbwse8JuJug4dx8-zVdnoRizlp03lwbSKc9YOH2-40PAEX5tWGKMzC3WJx6zIvNEc9PC/exec';

// ─── 휴가 관리 API 기본 URL ────────────────────────────────
// 2026-09 이관: 구 Apps Script 웹 앱 → Supabase Edge Function(vacation-api).
// 응답 계약(필드·상태 문자열)은 동결되어 그대로다 — 주소와 인증 헤더만 바뀐다.
export const DEFAULT_VACATION_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co/functions/v1/vacation-api';

// ─── 휴가 API 토큰 (x-bflow-token) ─────────────────────────
// 빌드타임 주입: `.env.local` 의 BFLOW_VACATION_TOKEN 을 vite define 이 치환한다(.env* 는 gitignore).
// **실값을 레포에 커밋하지 않는다.** 비어 있으면 vacation-config.json 의 apiToken(설정 화면 입력란)으로 폴백한다.
export const DEFAULT_VACATION_TOKEN = __BFLOW_VACATION_TOKEN__;

// URL이 비어있으면 자동 연결을 건너뜁니다.
