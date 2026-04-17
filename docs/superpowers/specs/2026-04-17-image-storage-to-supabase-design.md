# 이미지 첨부 → Supabase Storage 전환 설계

## Context

현재 B flow의 이미지 첨부는 **3단계 외부 의존**을 거칩니다:

1. **PC 로컬 캐시** (`%APPDATA%/images/`)
2. **GAS (Google Apps Script) 웹 앱** — 업로드 중계
3. **Google Drive** — 원본 저장

DB(Supabase)에는 Drive URL만 저장됩니다.

### 문제점
- **외부 의존성 3개** (GAS 서버 URL, Drive 인증, drive-img:// 프록시) — 설정/유지보수 부담
- **새 컴퓨터에서 설정 필요** (GAS URL 입력, 재인증 등)
- **Drive 403 우회용 프록시 프로토콜(drive-img://)** — 복잡도 증가
- **로컬 캐시 관리 로직** (manifest.json, 500MB 자동 정리) — 필요성 감소

### 목표
이미지 저장/조회를 **Supabase Storage 한 곳**으로 통합하여 외부 의존성 제거 + 구현 단순화.

### 제약 조건
- Supabase Free 플랜 유지 (Storage 1GB)
- 기존 Google Drive 이미지 마이그레이션은 **하지 않음** (정식 빌드 시 데이터 계승 없음)
- 기존 업로드 UX(클립보드 붙여넣기, 파일 선택) 유지
- 기존 IPC 시그니처 호환 유지 (`sheetName, sceneId, imageType, base64` 형태)

---

## 아키텍처

```
사용자가 이미지 첨부
  ↓
[renderer]
  - 클립보드 버튼 → window.electronAPI.clipboardReadImage() (main에서 800px 리사이즈 완료)
  - 파일 선택/드래그/Ctrl+V → imageUtils.resizeBlob() (Canvas API로 800px JPEG 변환)
  ↓
storageService.uploadImage(sheetName, sceneId, imageType, base64)
  ↓ IPC 'storage:upload-image'
[main] electron/storage.ts
  ↓ ① base64 → Buffer
  ↓ ② 안전망: 버퍼가 크거나 크기 정보가 충분하면 nativeImage로 재측정 후 필요 시만 resize
  ↓    (이미 렌더러에서 변환됐으면 double-resize 없이 그대로 사용)
  ↓ ③ Supabase Storage 'scene-images' 버킷에 업로드
  ↓    경로: EP01/A/a001/storyboard_<timestamp>.jpg
  ↓ ④ public URL 반환
[renderer] DB 업데이트: scenes.storyboard_url = <public URL>
[UI] <img src="<public URL>"> 로 즉시 표시 (프록시 불필요)
```

### 핵심 결정
- **이미지 변환**: Electron 내장 `nativeImage` API 사용 (`sharp`/`jimp` 불필요)
  - 속도: ~50-150ms (네이티브 C++ 기반, sharp와 동급)
  - 외부 dependency 추가 0개
  - 기존 `clipboard:read-image` 핸들러에서 이미 사용 중인 검증된 API
- **이중 변환 방지**: 렌더러에서 이미 resize된 경우 main에서는 그대로 업로드 (단, 크기가 의심스러울 때만 안전망 resize)
- **API 시그니처**: 기존 `sheetsUploadImage(sheetName, sceneId, imageType, base64)`와 동일 — 호출부 최소 수정
- **버킷 접근**: Public 버킷 (URL 기반 조회)
- **파일 경로**: 계층 구조 `{EP}/{part}/{sceneId}/{type}_{timestamp}.jpg` — `sheetName`에서 EP/part 추출
- **삭제 시점**: 사용자가 UI에서 명시적으로 지울 때만

---

## 구성 요소

### 신규 파일

| 파일 | 역할 |
|------|------|
| `electron/storage.ts` | Supabase Storage 업로드/삭제 + nativeImage 안전망 변환 헬퍼 |
| `src/services/storageService.ts` | 렌더러 IPC 래퍼 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `electron/main.ts` | `storage:upload-image`, `storage:delete-image` IPC 핸들러 추가 |
| `electron/preload.ts` | `storageUploadImage`, `storageDeleteImage` expose |
| `src/types/index.ts` | ElectronAPI 인터페이스에 신규 메서드 추가 |
| `src/mocks/devElectronAPI.ts` | mock 스텁 추가 |
| `src/utils/imageUtils.ts` | `sheetsUploadImage` → `storageUploadImage` 교체 (renderer resize는 유지) |
| `src/components/scenes/SceneDetailModal.tsx` | 클립보드 버튼 경로의 업로드 호출 변경 |

### Supabase Dashboard + SQL 설정

1. Storage 버킷 `scene-images` 생성 (Public)
2. RLS 정책 (Storage는 public이어도 `INSERT`/`DELETE`에 명시적 정책 필요):

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

---

## 구현 세부

### 경로 구성 헬퍼

```typescript
// electron/storage.ts
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
function extractPathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/);
  return m ? m[1] : null;
}
```

### 업로드 핵심 로직

```typescript
// electron/storage.ts
import { nativeImage } from 'electron';
import { supabase } from './supabase';

const BUCKET = 'scene-images';
const MAX_PX = 800;
const JPEG_QUALITY = 80;
const SAFE_SIZE_BYTES = 500 * 1024; // 500KB 이상이면 안전망 resize 고려

/** base64 → 필요 시 resize된 JPEG Buffer */
function toBuffer(base64Data: string): Buffer {
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');
  let buffer = Buffer.from(match[2], 'base64');

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

### 렌더러 서비스

```typescript
// src/services/storageService.ts (신규)
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

### 호출부 교체

`src/utils/imageUtils.ts`의 `saveImage()` 함수 — 기존에 `sheetsUploadImage`를 호출하던 부분만 `storageUploadImage`로 교체. Renderer의 `resizeBlob()`/`resizeDataUrl()` 로직은 유지 (IPC 페이로드 절감). 시그니처가 동일하므로 호출부는 한 줄 변경.

---

## 에러 처리

| 상황 | 대응 |
|------|------|
| base64 파싱 실패 | `{ ok: false, error: 'Invalid base64' }` 반환 → UI 에러 토스트 |
| nativeImage decode 실패 | 명확한 에러 메시지 → "이미지 파일이 손상되었거나 지원되지 않는 형식입니다" |
| Storage 업로드 실패 (네트워크/용량) | 에러 전파 → UI 토스트 + 재시도 버튼 |
| Storage 삭제 실패 | 경고 로그 + DB URL은 비움 (orphan 파일은 수동 정리 가능) |
| 존재하지 않는 URL 삭제 | no-op |
| 비-Supabase URL 삭제 시도 | no-op (legacy drive URL 보호) |

### 알려진 한계 (트레이드오프)

1. **업로드 성공 후 DB 저장 실패 시 orphan 파일**
   - 업로드는 성공했는데 `updateSceneField`가 실패하면 Storage에 파일이 남고 DB엔 참조 없음.
   - 20명 내부 도구에서 흔치 않음. 수동 대시보드 정리로 대응.

2. **동시 업로드 시 Last-Write-Wins**
   - 두 사용자가 같은 씬에 동시 업로드 → timestamp 다르므로 둘 다 성공, DB는 나중 URL만 보관, 먼저 URL의 파일은 orphan.
   - 기존 씬 데이터 동기화 정책(LWW)과 일관.

3. **Public URL CDN TTL**
   - 삭제 후에도 CDN 캐시에 남아 최대 ~1시간 동안 기존 URL로 조회 가능.
   - 내부 도구에서는 문제 없음.

---

## 테스트 계획

### 단위 테스트 (수동)

1. **이미지 붙여넣기 → 업로드**
   - 씬 모달 열기 → 클립보드에 5MB PNG 복사 → Ctrl+V
   - ✅ 기대: ~1초 이내 썸네일 표시, DB에 Supabase URL 저장
   - ✅ Supabase Dashboard → Storage → scene-images 버킷에 파일 확인

2. **이미지 삭제**
   - 기존 이미지의 X 버튼 클릭
   - ✅ 기대: UI에서 즉시 사라짐, Storage에서도 파일 삭제, DB URL 빈 값

3. **이미지 조회**
   - 앱 재시작 후 해당 씬 열기
   - ✅ 기대: public URL로 즉시 표시 (drive-img:// 프록시 없이)

4. **Legacy Drive URL 호환**
   - DB에 기존 `drive-img://` URL이 있는 씬 조회
   - ✅ 기대: 기존 프록시로 정상 표시 (호환 유지)

5. **파일 크기 시나리오**
   - 10KB 작은 JPEG 업로드 → 재압축 없이 그대로 저장
   - 20MB 거대 PNG 업로드 → 800px로 resize되어 ~200KB 저장
   - 손상된 base64 → 명확한 에러

### 빌드 검증
```bash
npx tsc --noEmit
npx vite build
```

---

## 리스크 및 완화

| 리스크 | 확률 | 심각도 | 완화책 |
|--------|------|--------|--------|
| **Free 1GB 용량** | 중 | 중 | 장당 ~200KB 기준 ~5,000장 한계. 800MB 도달 시 모니터링 알림. 프로($25/월) 업그레이드로 100GB |
| **Supabase 정지** | 낮음 | 높음 | DB도 이미 의존 — 신규 리스크 아님. keep-alive로 예방 |
| **Public 버킷 URL 노출** | 낮음 | 낮음 | 내부 도구 + 경로+timestamp 추측 어려움. 민감 이미지 아님 |
| **대용량 이미지 메모리** | 낮음 | 낮음 | nativeImage는 Chromium 기반. 일반(<20MB) 이미지 문제없음 |
| **Storage RLS 누락** | 중 | 높음 | 설치 단계에 RLS SQL 실행 필수 — 누락 시 403 |
| **Upload 성공+DB 실패 orphan** | 낮음 | 낮음 | 수동 대시보드 정리 |

---

## 마이그레이션 전략

**없음.** 기존 Drive 이미지 URL은 DB에 남아있을 수 있으나:
- 정식 빌드 시 데이터 계승 없음 (사용자 확정)
- 남아있어도 `drive-img://` 프록시로 계속 표시됨 (기존 로직 유지)
- 새로 업로드하는 이미지만 Supabase Storage 경로

### 선택적 후속 작업 (별도 작업)
- `sheets:upload-image` IPC 핸들러 제거
- `electron/drive-image.ts` 제거
- `drive-img://` 프로토콜 핸들러 제거
- 이미지 캐시 manifest.json 제거
- 설정 UI에서 "이미지 업로드 서버 URL" 섹션 제거

위 제거 작업은 본 전환 완료 후 모든 경로가 Storage로 이전되었는지 확인한 뒤 진행.

---

## 검증 기준

- [ ] Storage 버킷 + RLS SQL 적용 완료
- [ ] 씬 이미지 붙여넣기 → Supabase Storage 업로드 성공
- [ ] DB에 public URL 저장됨
- [ ] 재접속 후 이미지 조회 정상
- [ ] 이미지 삭제 시 Storage 파일도 제거됨
- [ ] 업로드 오류 시 명확한 에러 메시지
- [ ] `tsc --noEmit` + `vite build` 통과
- [ ] 기존 GAS 경로는 여전히 호환 (하위호환 유지)

---

*작성일: 2026-04-17*
*작성자: Claude × 한솔 (Studio JBBJ)*
