# 이미지 첨부 → Supabase Storage 전환 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 이미지(스토리보드/가이드) 업로드/조회/삭제를 Google Drive + GAS 경유에서 Supabase Storage로 전환한다.

**Architecture:** Electron 메인 프로세스에서 Supabase Storage 클라이언트로 직접 업로드. `nativeImage`로 800px JPEG 안전망 변환. Public 버킷 + 계층 경로(EP/part/sceneId). 기존 `sheetName, sceneId, imageType, base64` IPC 시그니처 유지로 호출부 최소 수정.

**Tech Stack:** Electron + TypeScript + Supabase Storage (`@supabase/supabase-js` 기본 포함) + Electron `nativeImage` (외부 의존성 0).

**Spec:** `docs/superpowers/specs/2026-04-17-image-storage-to-supabase-design.md`

---

## 파일 구조

### 신규 생성 파일

| 파일 | 역할 |
|------|------|
| `electron/storage.ts` | Supabase Storage 업로드/삭제 + nativeImage 안전망 변환 |
| `src/services/storageService.ts` | 렌더러 IPC 래퍼 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/main.ts` | `storage:upload-image`, `storage:delete-image` IPC 핸들러 추가 |
| `electron/preload.ts` | `storageUploadImage`, `storageDeleteImage` expose |
| `src/types/index.ts` | ElectronAPI 인터페이스에 신규 메서드 추가 |
| `src/mocks/devElectronAPI.ts` | mock 스텁 추가 |
| `src/utils/imageUtils.ts` | `sheetsUploadImage` → `storageUploadImage` 교체 |
| `src/components/scenes/SceneDetailModal.tsx` | (필요 시) 삭제 호출부 업데이트 |

---

## Chunk 1: Supabase Storage 버킷 + RLS

### Task 1.1: 버킷 생성 + RLS 정책

**Files:**
- Supabase Dashboard에서 실행

- [ ] **Step 1: Storage 버킷 생성**

Supabase Dashboard → Storage → "New bucket" → 이름: `scene-images`, Public: ✅ 체크 → 생성

- [ ] **Step 2: RLS 정책 SQL 실행**

SQL Editor에서 실행:

```sql
-- anon key 업로드 허용
CREATE POLICY "scene_images_anon_insert" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'scene-images');

-- anon key 삭제 허용
CREATE POLICY "scene_images_anon_delete" ON storage.objects
  FOR DELETE TO anon
  USING (bucket_id = 'scene-images');

-- SELECT는 public 버킷이라 자동 허용됨
```

- [ ] **Step 3: 검증**

```sql
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
AND policyname LIKE 'scene_images%';
```

Expected: 2개 row (INSERT + DELETE)

---

## Chunk 2: Electron 메인 프로세스 Storage 모듈

### Task 2.1: electron/storage.ts 생성

**Files:**
- Create: `electron/storage.ts`

- [ ] **Step 1: 파일 생성 (전체 내용)**

```typescript
/**
 * Supabase Storage 기반 이미지 업로드/삭제
 *
 * - 기존 GAS/Drive 경로를 Storage 버킷 'scene-images'로 대체
 * - nativeImage로 안전망 resize (렌더러에서 이미 변환된 경우 double-resize 방지)
 */

import { nativeImage } from 'electron';
import { supabase } from './supabase';

const BUCKET = 'scene-images';
const MAX_PX = 800;
const JPEG_QUALITY = 80;
const SAFE_SIZE_BYTES = 500 * 1024; // 500KB 이상이면 안전망 resize 고려

/** sheetName 예: "EP01_A_BG" → { ep: "EP01", partId: "A" } */
function parseSheetName(sheetName: string): { ep: string; partId: string } {
  const m = sheetName.match(/^(EP\d+)_([A-Z])_/);
  if (!m) throw new Error(`Invalid sheetName: ${sheetName}`);
  return { ep: m[1], partId: m[2] };
}

function buildPath(sheetName: string, sceneId: string, imageType: string): string {
  const { ep, partId } = parseSheetName(sheetName);
  return `${ep}/${partId}/${sceneId}/${imageType}_${Date.now()}.jpg`;
}

/** public URL → storage 경로 추출 */
export function extractPathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/);
  return m ? m[1] : null;
}

/** base64 → 필요 시 resize된 JPEG Buffer */
function toBuffer(base64Data: string): Buffer {
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');
  const buffer = Buffer.from(match[2], 'base64');

  // 안전망: 이미 작으면 그대로 사용 (renderer에서 이미 처리된 경우)
  if (buffer.length <= SAFE_SIZE_BYTES) return buffer;

  // 크면 nativeImage로 크기 확인 후 필요할 때만 resize
  const image = nativeImage.createFromBuffer(buffer);
  const { width, height } = image.getSize();
  if (width === 0 || height === 0) {
    throw new Error('Image decode failed');
  }
  if (width > MAX_PX || height > MAX_PX) {
    const ratio = Math.min(MAX_PX / width, MAX_PX / height);
    const resized = image.resize({
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    });
    return resized.toJPEG(JPEG_QUALITY);
  }
  // 크기는 작은데 파일만 큰 경우 (PNG 등) — JPEG 인코딩만
  return image.toJPEG(JPEG_QUALITY);
}

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const buffer = toBuffer(base64Data);
    const path = buildPath(sheetName, sceneId, imageType);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Storage] 업로드 실패:', msg);
    return { ok: false, error: msg };
  }
}

export async function deleteImage(url: string): Promise<void> {
  const path = extractPathFromPublicUrl(url);
  if (!path) return; // 비-Supabase URL은 무시 (legacy drive URL 등)
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('[Storage] 삭제 실패:', error.message);
}
```

- [ ] **Step 2: TypeScript 검증**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add electron/storage.ts
git commit -m "feat: Supabase Storage 이미지 업로드/삭제 모듈 추가"
```

---

## Chunk 3: IPC 핸들러 + preload + 타입

### Task 3.1: electron/main.ts IPC 핸들러 추가

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: import 추가**

`electron/main.ts` 상단 imports에 추가:

```typescript
import { uploadImage as storageUploadImage, deleteImage as storageDeleteImage } from './storage';
```

- [ ] **Step 2: IPC 핸들러 추가**

기존 `sheets:upload-image` 핸들러 근처에 추가 (wrapIpc 패턴 따름):

```typescript
// ─── Supabase Storage IPC ──────────────────────────────

ipcMain.handle(
  'storage:upload-image',
  async (_event, sheetName: string, sceneId: string, imageType: 'storyboard' | 'guide', base64Data: string) => {
    return storageUploadImage(sheetName, sceneId, imageType, base64Data);
  },
);

ipcMain.handle(
  'storage:delete-image',
  async (_event, url: string) => {
    await storageDeleteImage(url);
  },
);
```

- [ ] **Step 3: TypeScript 검증 + 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts
git commit -m "feat: Storage IPC 핸들러 추가 (upload/delete)"
```

### Task 3.2: preload.ts expose

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: electronAPI에 추가**

```typescript
    storageUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) =>
      ipcRenderer.invoke('storage:upload-image', sheetName, sceneId, imageType, base64Data),
    storageDeleteImage: (url: string) => ipcRenderer.invoke('storage:delete-image', url),
```

- [ ] **Step 2: 커밋**

```bash
git add electron/preload.ts
git commit -m "feat: Storage IPC preload expose"
```

### Task 3.3: ElectronAPI 타입 + mock 스텁

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/mocks/devElectronAPI.ts`

- [ ] **Step 1: ElectronAPI 인터페이스에 추가**

`src/types/index.ts`의 ElectronAPI 인터페이스에 추가:

```typescript
  // ─── Supabase Storage ──────────────────────────
  storageUploadImage: (
    sheetName: string,
    sceneId: string,
    imageType: string,
    base64Data: string,
  ) => Promise<{ ok: boolean; url?: string; error?: string }>;
  storageDeleteImage: (url: string) => Promise<void>;
```

- [ ] **Step 2: mock 스텁 추가**

`src/mocks/devElectronAPI.ts`의 mockAPI 객체에 추가:

```typescript
    storageUploadImage: async () => ({ ok: true, url: 'mock://image' }),
    storageDeleteImage: async () => {},
```

- [ ] **Step 3: TypeScript 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/types/index.ts src/mocks/devElectronAPI.ts
git commit -m "feat: Storage API 타입 + mock 스텁"
```

---

## Chunk 4: 렌더러 서비스 + 호출부 교체

### Task 4.1: src/services/storageService.ts 생성

**Files:**
- Create: `src/services/storageService.ts`

- [ ] **Step 1: 파일 생성**

```typescript
/**
 * Supabase Storage IPC 래퍼 (렌더러 → 메인)
 *
 * 기존 sheetsUploadImage를 대체. 시그니처 호환 유지.
 */

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  return window.electronAPI.storageUploadImage(sheetName, sceneId, imageType, base64Data);
}

export async function deleteImage(url: string): Promise<void> {
  return window.electronAPI.storageDeleteImage(url);
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/services/storageService.ts
git commit -m "feat: storageService 렌더러 래퍼 추가"
```

### Task 4.2: src/utils/imageUtils.ts에서 호출 교체

**Files:**
- Modify: `src/utils/imageUtils.ts`

- [ ] **Step 1: 기존 코드 확인**

파일을 읽고 `sheetsUploadImage` 호출 위치를 확인 (`saveImage` 함수 내부, 대략 line 58 근처).

- [ ] **Step 2: import 추가**

파일 상단에 추가:

```typescript
import * as storageService from '@/services/storageService';
```

- [ ] **Step 3: 호출 교체**

`saveImage()` 내부의 `window.electronAPI.sheetsUploadImage(...)` 호출을 다음으로 교체:

```typescript
const result = await storageService.uploadImage(sheetName, sceneId, imageType as 'storyboard' | 'guide', base64Data);
```

> 반환값 `{ ok, url, error }`는 기존 `sheetsUploadImage`와 동일하므로 호출 이후 로직은 그대로 유지.

- [ ] **Step 4: 빌드 검증**

```bash
npx tsc --noEmit
npx vite build
```

- [ ] **Step 5: 커밋**

```bash
git add src/utils/imageUtils.ts
git commit -m "feat: imageUtils 업로드 경로 Supabase Storage로 전환"
```

### Task 4.3: 삭제 경로 연결 (SceneDetailModal 확인)

**Files:**
- Modify: `src/components/scenes/SceneDetailModal.tsx` (필요 시)

- [ ] **Step 1: 기존 삭제 경로 확인**

`SceneDetailModal.tsx`에서 이미지 X 버튼 (삭제) 관련 핸들러를 찾는다. 기존에 URL만 비우고 파일 삭제는 안 하고 있었을 가능성 높음.

- [ ] **Step 2: 삭제 호출 추가**

`confirmRemoveImage` 핸들러를 찾아서 수정. **중요: `onFieldUpdate`가 URL을 비우므로 반드시 URL을 먼저 캡처한 뒤 비운다.**

```typescript
import * as storageService from '@/services/storageService';

// 기존 confirmRemoveImage 내부 — 반드시 이 순서:
const confirmRemoveImage = useCallback(() => {
  if (!deleteConfirm) return;
  const field = deleteConfirm === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
  // 1) URL 먼저 캡처 (onFieldUpdate가 비우기 전에)
  const oldUrl = deleteConfirm === 'storyboard' ? scene.storyboardUrl : scene.guideUrl;
  // 2) Storage 파일 삭제 (비동기, 실패해도 DB는 갱신)
  if (oldUrl) storageService.deleteImage(oldUrl).catch(() => {/* best-effort */});
  // 3) DB 필드 비우기
  onFieldUpdate(sceneIndex, field, '');
  setDeleteConfirm(null);
}, [sceneIndex, onFieldUpdate, deleteConfirm, scene]);
```

> 주의:
> - `deleteImage`는 public Supabase URL만 삭제하고 legacy `drive-img://`는 no-op이므로 안전.
> - 의존성 배열에 `scene` 추가 필수 (URL 읽기용).

- [ ] **Step 3: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit && npx vite build
git add src/components/scenes/SceneDetailModal.tsx
git commit -m "feat: 씬 이미지 삭제 시 Storage 파일도 제거"
```

---

## Chunk 5: 통합 빌드 + 수동 테스트

### Task 5.1: 전체 빌드 검증

- [ ] **Step 1: TypeScript + Vite**

```bash
npx tsc --noEmit
npx vite build
```

Expected: 둘 다 성공

- [ ] **Step 2: Electron 전체 빌드**

```bash
npm run build
```

Expected: dist-electron, dist 생성

### Task 5.2: 수동 테스트

- [ ] **Step 1: 업로드 테스트**

1. 앱 실행 → 씬 모달 열기
2. 클립보드에 이미지 복사 후 Ctrl+V
3. ✅ 확인: 썸네일 표시, Supabase Dashboard → Storage → scene-images 버킷에 파일 생성

- [ ] **Step 2: 재접속 테스트**

1. 앱 재시작 → 동일 씬 열기
2. ✅ 확인: 이미지 정상 표시 (public URL 사용, drive-img 프록시 없음)

- [ ] **Step 3: 삭제 테스트**

1. 씬 이미지 X 버튼 클릭
2. ✅ 확인: UI에서 사라짐, Supabase Storage에서도 파일 삭제, DB URL 빈 값

- [ ] **Step 4: Legacy 호환 테스트 (있다면)**

1. 기존 drive-img:// URL이 있는 씬이 있다면 열어본다
2. ✅ 확인: 여전히 정상 표시

### Task 5.3: 최종 커밋

- [ ] **Step 1: 버전 업데이트 (선택)**

`package.json` 패치 버전 올리기.

- [ ] **Step 2: 최종 커밋**

```bash
git add package.json
git commit -m "chore: 이미지 저장소를 Supabase Storage로 전환"
```

---

## 요약

| Chunk | 내용 | 난이도 | 예상 시간 |
|-------|------|--------|----------|
| **1** | Storage 버킷 + RLS | 낮음 | 5분 |
| **2** | electron/storage.ts | 낮음 | 10분 |
| **3** | IPC + preload + 타입 | 낮음 | 10분 |
| **4** | 렌더러 서비스 + 호출부 | 중간 | 15분 |
| **5** | 빌드 + 수동 테스트 | 낮음 | 10분 |

**총 예상 시간**: ~50분

---

## 알려진 한계 (스펙에서 발췌)

1. **Upload 성공 후 DB 저장 실패 시 orphan 파일** — 내부 도구 수준에서 허용, 수동 정리 가능
2. **동시 업로드 시 Last-Write-Wins** — timestamp로 경로 분리되나 DB는 나중 URL만 유지
3. **CDN TTL ~1시간** — 삭제 후에도 캐시에 잠시 남을 수 있음

## 공존 기간 참고

본 전환이 완료되어도 다음 요소는 당분간 유지됨 (스펙의 "선택적 후속 작업"):
- `sheets:upload-image` IPC 핸들러 (electron/main.ts)
- `sheetsUploadImage` ElectronAPI 타입 + preload expose
- `drive-image.ts` 및 `drive-img://` 프로토콜

새 코드에서 호출하지 않으면 실제 실행 경로에는 영향 없음. 별도 정리 작업에서 제거 예정.

---

*작성일: 2026-04-17*
