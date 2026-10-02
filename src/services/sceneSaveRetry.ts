/**
 * 씬 단계 저장의 자동 재전송 진행기 — 앱에 하나(움직임 폴리싱 20번 safety-net).
 *
 * 씬 목록 화면을 떠났다 돌아와도 같은 진행기를 써야 '같은 칸 재클릭은 마지막 값만'이 이어진다.
 * 그래서 화면(컴포넌트) 안이 아니라 모듈에 둔다. 규칙·수치는 src/utils/saveRetry.ts.
 */
import { browserSaveRetryEnv, createSaveRetryController } from '@/utils/saveRetry';

export const sceneSaveRetry = createSaveRetryController(browserSaveRetryEnv());
