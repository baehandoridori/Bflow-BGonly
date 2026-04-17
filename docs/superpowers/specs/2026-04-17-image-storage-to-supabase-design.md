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

---

## 아키텍처

```
사용자가 이미지 첨부
  ↓
[renderer] storageService.uploadImage(sceneKey, type, base64)
  ↓ IPC 'storage:upload-image'
[main] electron/storage.ts
  ↓ ① nativeImage로 800px 리사이즈 + JPEG 80% 변환 (~200KB)
  ↓ ② Supabase Storage 'scene-images' 버킷에 업로드
  ↓    경로: EP01/A/a001/storyboard_<timestamp>.jpg
  ↓ ③ public URL 반환
[renderer] DB 업데이트: scenes.storyboard_url = <public URL>
[UI] <img src="<public URL>"> 로 즉시 표시 (프록시 불필요)
```

### 핵심 결정
- **이미지 변환**: Electron 내장 `nativeImage` API 사용 (`sharp`/`jimp` 불필요)
  - 속도: ~50-150ms (네이티브 C++ 기반, sharp와 동급)
  - 외부 dependency 추가 0개
  - 기존 `clipboard:read-image` 핸들러에서 이미 사용 중인 검증된 API
- **버킷 접근**: Public 버킷 (URL 기반 조회)
  - RLS로 anon 키가 업로드/삭제/읽기 가능
- **파일 경로**: 계층 구조 `{EP}/{part}/{sceneId}/{type}_{timestamp}.jpg`
- **삭제 시점**: 사용자가 UI에서 명시적으로 지울 때만 (씬/에피소드 아카이빙 시에도 이미지 유지)

---

## 구성 요소

### 신규 파일

| 파일 | 역할 |
|------|------|
| `electron/storage.ts` | Supabase Storage 업로드/삭제 + nativeImage 변환 헬퍼 |
| `src/services/storageService.ts` | 렌더러 IPC 래퍼 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `electron/main.ts` | `storage:upload-image`, `storage:delete-image` IPC 핸들러 추가 |
| `electron/preload.ts` | `storageUploadImage`, `storageDeleteImage` expose |
| `src/types/index.ts` | ElectronAPI 인터페이스에 신규 메서드 추가 |
| `src/mocks/devElectronAPI.ts` | mock 스텁 추가 |
| 씬 모달 이미지 업로드 호출부 | `sheetsUploadImage` → `storageUploadImage` 교체 |

### Supabase 설정 (Dashboard + SQL)

1. Storage 버킷 `scene-images` 생성 (Public)
2. RLS 정책:
   - `INSERT`, `UPDATE`, `DELETE`, `SELECT` 모두 anon 허용 (기존 테이블 정책과 일치)

---

## 데이터 흐름

### 업로드

```typescript
// src/services/storageService.ts (신규)
export async function uploadImage(
  sceneKey: { episodeNumber: number; partId: string; sceneId: string },
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ url: string }> {
  return window.electronAPI.storageUploadImage(sceneKey, imageType, base64Data);
}
```

```typescript
// electron/storage.ts (신규)
import { nativeImage } from 'electron';
import { supabase } from './supabase';

const BUCKET = 'scene-images';

function resizeToJpeg(base64Data: string, maxSize = 800, quality = 80): Buffer {
  const image = nativeImage.createFromDataURL(base64Data);
  const { width, height } = image.getSize();
  if (width === 0 || height === 0) throw new Error('Invalid image data');
  let target = image;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    target = image.resize({
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    });
  }
  return target.toJPEG(quality);
}

function buildPath(sceneKey: SceneKey, imageType: string): string {
  const ep = `EP${String(sceneKey.episodeNumber).padStart(2, '0')}`;
  return `${ep}/${sceneKey.partId}/${sceneKey.sceneId}/${imageType}_${Date.now()}.jpg`;
}

export async function uploadImage(
  sceneKey: SceneKey,
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ url: string }> {
  const buffer = resizeToJpeg(base64Data);
  const path = buildPath(sceneKey, imageType);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

export async function deleteImage(url: string): Promise<void> {
  const path = extractPathFromPublicUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('[Storage] 삭제 실패:', error.message);
}
```

### 조회

public URL을 `<img src>`에 직접 사용. 변환/프록시 불필요.
기존 `sanitizeImageUrl()`은 HTTPS URL을 그대로 통과시키므로 호환됨.

### 삭제

```typescript
// 사용자가 씬 이미지 X 버튼 클릭
storageService.deleteImage(scene.storyboardUrl)
  .then(() => { supabaseService.updateSceneField(sceneUuid, 'storyboard_url', ''); });
```

---

## 에러 처리

| 상황 | 대응 |
|------|------|
| nativeImage 변환 실패 (손상된 이미지) | 명확한 에러 반환 → 사용자에게 "이미지 파일이 올바르지 않습니다" 알림 |
| Storage 업로드 실패 (네트워크/용량) | 에러 전파 → UI에서 재시도 버튼 또는 에러 토스트 |
| Storage 삭제 실패 | 경고 로그만 남기고 DB URL은 비움 (orphan 파일은 수동 정리 가능) |
| 존재하지 않는 URL 삭제 | no-op (에러 무시) |

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

4. **용량 초과 시뮬레이션**
   - Supabase 대시보드에서 용량 근접 상태 확인
   - ✅ 기대: 업로드 실패 시 명확한 에러 메시지

### 빌드 검증
```bash
npx tsc --noEmit
npx vite build
```

---

## 리스크 및 완화

| 리스크 | 확률 | 심각도 | 완화책 |
|--------|------|--------|--------|
| **Free 1GB 용량 초과** | 중 | 중 | 변환으로 장당 ~200KB → 5,000장 여유. 프로 플랜($25/월) 업그레이드로 100GB |
| **Supabase 정지** | 낮음 | 높음 | DB도 이미 Supabase 의존 — 신규 리스크 아님. keep-alive로 예방 |
| **Public 버킷 노출** | 낮음 | 낮음 | 내부 도구 + URL 추측 어려움 (timestamp+경로). 민감 이미지 아님 |
| **기존 GAS 코드 잔존** | 낮음 | 낮음 | `sheets:upload-image` 핸들러는 당분간 유지 — 다른 경로 없어졌는지 확인 후 제거 |
| **대용량 이미지 메모리** | 낮음 | 낮음 | nativeImage는 Chromium 기반 — 일반적인 이미지(<20MB) 문제없음 |

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
