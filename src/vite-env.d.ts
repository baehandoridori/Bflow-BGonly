/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** 휴가 API 토큰 — 빌드 시 vite define 이 `.env.local` 의 BFLOW_VACATION_TOKEN 으로 치환. 없으면 '' */
declare const __BFLOW_VACATION_TOKEN__: string;
