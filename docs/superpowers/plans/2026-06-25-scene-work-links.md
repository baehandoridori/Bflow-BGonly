# Scene Work Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬마다 BG/액팅 작업 폴더와 대표 파일 경로를 연결하고, 카드/시트/우클릭 메뉴/파일 탭에서 확인·열기·변경·해제할 수 있게 만든다.

**Architecture:** 작업 링크는 씬 기본 데이터에 섞지 않고 `scene_work_links` 테이블과 별도 Zustand store로 관리한다. Electron main은 Supabase CRUD, 파일/폴더 선택창, 경로 존재 확인, 파일/폴더 바로 열기 IPC를 제공하고 renderer는 파일 탭에서 관리 UI를 담당한다. 카드/시트/우클릭 메뉴는 store의 파생 상태만 읽고, 시트 배지 표시 여부는 사용자 개인 `preferences.json`에 저장한다.

**Tech Stack:** Electron 33, React 18, TypeScript, Zustand, Supabase Postgres/Realtime, lucide-react, node:test.

## Global Constraints

- Bflow 원본 레포는 참고 전용이며, 모든 개발은 `Bflow-BGonly`에서만 진행한다.
- 코드 변경 후 `npm run typecheck`, 관련 `node --test`, `npm run build:vite`를 통과시킨다.
- 정식 배포 전에는 `npm run build`까지 통과시킨다.
- 데이터 변경은 즉시 UI 반영 → Supabase 저장 → 실패 시 롤백 패턴을 따른다.
- 테스트 모드에서도 선택창 mock, 경로 붙여넣기, 배지 표시, 파일 탭 관리가 동작해야 한다.
- Bflow는 실제 폴더/파일을 생성·삭제·이름변경하지 않는다. 저장하는 것은 경로 문자열뿐이다.
- 링크 해제는 실제 파일/폴더를 삭제하지 않고 Bflow에 저장된 연결만 삭제한다.
- 파일 선택창은 확장자 제한을 두지 않는다.
- 파일 열기는 기본 연결 프로그램으로 바로 연다. 폴더 열기는 탐색기로 연다.
- 개인 경로와 현재 PC에서 확인 안 되는 경로도 저장은 허용하고 파일 탭에 경고한다.
- 우클릭 메뉴에 보이는 에피소드는 `EP01` 같은 ID가 아니라 실제 에피소드 이름을 사용한다.
- Supabase 신규 public 테이블은 명시적 `GRANT SELECT, INSERT, UPDATE, DELETE`와 RLS 정책을 같은 마이그레이션에 포함한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `DEVLOG/migrations/2026-06-25-scene-work-links.sql` | `scene_work_links` 테이블, 인덱스, RLS, grants, updated_at trigger, Realtime publication |
| `src/types/index.ts` | `SceneWorkLink` 타입, ElectronAPI 메서드 타입 |
| `src/utils/sceneWorkLinks.ts` | 링크 슬롯, 경로 경고, 링크 맵, 배지 파생 상태 같은 순수 로직 |
| `tests/sceneWorkLinks.test.ts` | 경로 경고/슬롯 파생/배지 카운트 순수 로직 테스트 |
| `electron/supabase.ts` | `scene_work_links` CRUD 함수 |
| `electron/main.ts` | Supabase CRUD IPC, 선택창/열기/존재확인 IPC, Realtime broadcast |
| `electron/preload.ts` | renderer에 새 IPC 노출 |
| `electron/realtime.ts` | `scene_work_links` postgres_changes 구독 |
| `src/services/sceneWorkLinkService.ts` | renderer 서비스 래퍼 |
| `src/stores/useSceneWorkLinkStore.ts` | 작업 링크 로드/낙관적 upsert/delete/realtime 반영 |
| `src/mocks/devElectronAPI.ts` | 테스트 모드 작업 링크/선택창/열기 mock |
| `src/components/scenes/SceneWorkLinkBadges.tsx` | 카드/시트 공용 아이콘 배지 |
| `src/components/scenes/SceneWorkLinksPanel.tsx` | 파일 탭 작업 링크 관리 UI |
| `src/components/scenes/SceneFilesTab.tsx` | 기존 첨부 파일 탭 상단에 작업 링크 패널 결합 |
| `src/components/scenes/SceneContextMenu.tsx` | 작업 폴더/파일 열기 항목 추가 |
| `src/components/scenes/UnifiedSceneCard.tsx` | A2 카드 배지와 우클릭 메뉴 데이터 주입 |
| `src/components/scenes/UnifiedSceneSheetView.tsx` | S1-A 시트 배지와 토글 설정 |
| `src/components/scenes/UnifiedSceneDetailModal.tsx` | 파일 탭에 BG/ACT 씬 컨텍스트 전달 |
| `src/services/settingsService.ts` | `sheetWorkLinkBadgesVisible` 개인 설정 타입 |
| `src/App.tsx` | Realtime `scene_work_links` 이벤트를 store에 반영 |

---

### Task 1: 순수 도메인 로직과 테스트

**Files:**
- Create: `src/utils/sceneWorkLinks.ts`
- Modify: `src/types/index.ts`
- Test: `tests/sceneWorkLinks.test.ts`

**Interfaces:**
- Produces:
  - `type SceneWorkLinkDepartment = 'bg' | 'acting'`
  - `type SceneWorkLinkKind = 'folder' | 'primary_file' | 'extra_file'`
  - `interface SceneWorkLink`
  - `getWorkLinkSlotKey(sceneUuid, department, kind): string`
  - `buildSceneWorkLinkMap(links): Map<string, SceneWorkLink>`
  - `getWorkLinkWarnings(path, expectedKind): WorkLinkWarning[]`
  - `isLikelyPersonalPath(path): boolean`
  - `getSceneWorkLinkSlots(map, sceneUuid, department): { folder?: SceneWorkLink; primaryFile?: SceneWorkLink }`

- [ ] **Step 1: Write failing tests**

Create `tests/sceneWorkLinks.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSceneWorkLinkMap,
  getSceneWorkLinkSlots,
  getWorkLinkSlotKey,
  getWorkLinkWarnings,
  isLikelyPersonalPath,
} from '../src/utils/sceneWorkLinks.ts';
import type { SceneWorkLink } from '../src/types/index.ts';

test('buildSceneWorkLinkMap indexes primary slots by scene, department, and kind', () => {
  const links: SceneWorkLink[] = [
    { id: '1', sceneUuid: 's1', department: 'bg', linkKind: 'folder', path: 'G:\\show\\A_014', label: null, sortOrder: 0, createdBy: null, createdAt: '2026-06-25T00:00:00.000Z', updatedBy: 'u1', updatedAt: '2026-06-25T00:00:00.000Z' },
    { id: '2', sceneUuid: 's1', department: 'bg', linkKind: 'primary_file', path: 'G:\\show\\A_014\\main.psd', label: null, sortOrder: 0, createdBy: null, createdAt: '2026-06-25T00:00:00.000Z', updatedBy: 'u1', updatedAt: '2026-06-25T00:00:00.000Z' },
  ];

  const map = buildSceneWorkLinkMap(links);

  assert.equal(map.get(getWorkLinkSlotKey('s1', 'bg', 'folder'))?.path, 'G:\\show\\A_014');
  assert.equal(map.get(getWorkLinkSlotKey('s1', 'bg', 'primary_file'))?.path, 'G:\\show\\A_014\\main.psd');
});

test('getSceneWorkLinkSlots returns folder and primary file for a department', () => {
  const links: SceneWorkLink[] = [
    { id: '1', sceneUuid: 's1', department: 'acting', linkKind: 'folder', path: 'G:\\act\\A_014', label: null, sortOrder: 0, createdBy: null, createdAt: '', updatedBy: null, updatedAt: '' },
    { id: '2', sceneUuid: 's1', department: 'acting', linkKind: 'primary_file', path: 'G:\\act\\A_014\\main.clip', label: null, sortOrder: 0, createdBy: null, createdAt: '', updatedBy: null, updatedAt: '' },
  ];

  const slots = getSceneWorkLinkSlots(buildSceneWorkLinkMap(links), 's1', 'acting');

  assert.equal(slots.folder?.path, 'G:\\act\\A_014');
  assert.equal(slots.primaryFile?.path, 'G:\\act\\A_014\\main.clip');
});

test('isLikelyPersonalPath detects user profile paths but not shared drive or UNC paths', () => {
  assert.equal(isLikelyPersonalPath('C:\\Users\\user\\Desktop\\a.psd'), true);
  assert.equal(isLikelyPersonalPath('C:\\Documents and Settings\\user\\a.psd'), true);
  assert.equal(isLikelyPersonalPath('G:\\공유 드라이브\\JBBJ\\a.psd'), false);
  assert.equal(isLikelyPersonalPath('\\\\nas\\show\\a.psd'), false);
});

test('getWorkLinkWarnings allows saving but flags personal and kind mismatch paths', () => {
  assert.deepEqual(getWorkLinkWarnings('C:\\Users\\user\\Desktop\\a.psd', 'primary_file'), ['personal_path']);
  assert.deepEqual(getWorkLinkWarnings('G:\\show\\folder\\', 'primary_file'), ['maybe_not_file']);
  assert.deepEqual(getWorkLinkWarnings('G:\\show\\main.psd', 'folder'), ['maybe_not_folder']);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
```

Expected: FAIL because `src/utils/sceneWorkLinks.ts` does not exist.

- [ ] **Step 3: Add types and utility implementation**

Add to `src/types/index.ts` near scene types:

```ts
export type SceneWorkLinkDepartment = 'bg' | 'acting';
export type SceneWorkLinkKind = 'folder' | 'primary_file' | 'extra_file';

export interface SceneWorkLink {
  id: string;
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}
```

Create `src/utils/sceneWorkLinks.ts`:

```ts
import type { SceneWorkLink, SceneWorkLinkDepartment, SceneWorkLinkKind } from '@/types';

export type WorkLinkWarning = 'personal_path' | 'maybe_not_file' | 'maybe_not_folder';

export function getWorkLinkSlotKey(
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  kind: SceneWorkLinkKind,
): string {
  return `${sceneUuid}:${department}:${kind}`;
}

export function buildSceneWorkLinkMap(links: SceneWorkLink[]): Map<string, SceneWorkLink> {
  const map = new Map<string, SceneWorkLink>();
  for (const link of links) {
    if (link.linkKind === 'extra_file') continue;
    map.set(getWorkLinkSlotKey(link.sceneUuid, link.department, link.linkKind), link);
  }
  return map;
}

export function getSceneWorkLinkSlots(
  map: Map<string, SceneWorkLink>,
  sceneUuid: string | null | undefined,
  department: SceneWorkLinkDepartment,
): { folder?: SceneWorkLink; primaryFile?: SceneWorkLink } {
  if (!sceneUuid) return {};
  return {
    folder: map.get(getWorkLinkSlotKey(sceneUuid, department, 'folder')),
    primaryFile: map.get(getWorkLinkSlotKey(sceneUuid, department, 'primary_file')),
  };
}

export function isLikelyPersonalPath(input: string): boolean {
  const path = input.trim().replace(/\//g, '\\').toLowerCase();
  return /^[a-z]:\\users\\[^\\]+\\/.test(path) || /^[a-z]:\\documents and settings\\[^\\]+\\/.test(path);
}

function hasFileExtension(path: string): boolean {
  const last = path.trim().replace(/\//g, '\\').split('\\').filter(Boolean).pop() ?? '';
  return /\.[^.\s\\/:*?"<>|]+$/.test(last);
}

export function getWorkLinkWarnings(
  path: string,
  expectedKind: 'folder' | 'primary_file',
): WorkLinkWarning[] {
  const trimmed = path.trim();
  const warnings: WorkLinkWarning[] = [];
  if (!trimmed) return warnings;
  if (isLikelyPersonalPath(trimmed)) warnings.push('personal_path');
  const normalized = trimmed.replace(/\//g, '\\');
  if (expectedKind === 'primary_file' && (!hasFileExtension(normalized) || /\\$/.test(normalized))) {
    warnings.push('maybe_not_file');
  }
  if (expectedKind === 'folder' && hasFileExtension(normalized)) {
    warnings.push('maybe_not_folder');
  }
  return warnings;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
```

Expected: PASS.

---

### Task 2: Supabase schema, CRUD IPC, and test-mode mock

**Files:**
- Create: `DEVLOG/migrations/2026-06-25-scene-work-links.sql`
- Modify: `electron/supabase.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/realtime.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/sceneWorkLinkService.ts` (create)
- Modify: `src/mocks/devElectronAPI.ts`

**Interfaces:**
- Consumes: `SceneWorkLink`, `SceneWorkLinkDepartment`, `SceneWorkLinkKind`
- Produces:
  - `readSceneWorkLinks(sceneUuids?: string[]): Promise<SceneWorkLink[]>`
  - `upsertSceneWorkLink(input): Promise<SceneWorkLink>`
  - `deleteSceneWorkLink(sceneUuid, department, linkKind): Promise<void>`
  - Electron IPC methods with matching names

- [ ] **Step 1: Write a failing service/mapping test**

Extend `tests/sceneWorkLinks.test.ts` with mapper-oriented assertions if adding a mapper to `electron/supabase.ts` is too heavy for node import. Prefer a renderer-safe mapper in `src/utils/sceneWorkLinks.ts`:

```ts
import { mapSceneWorkLinkRow } from '../src/utils/sceneWorkLinks.ts';

test('mapSceneWorkLinkRow normalizes database snake_case fields', () => {
  const mapped = mapSceneWorkLinkRow({
    id: 'row1',
    scene_uuid: 's1',
    department: 'bg',
    link_kind: 'folder',
    path: 'G:\\show',
    label: null,
    sort_order: 0,
    created_by: 'u1',
    created_at: '2026-06-25T00:00:00.000Z',
    updated_by: 'u2',
    updated_at: '2026-06-25T01:00:00.000Z',
  });

  assert.equal(mapped.sceneUuid, 's1');
  assert.equal(mapped.linkKind, 'folder');
  assert.equal(mapped.updatedBy, 'u2');
});
```

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
```

Expected: FAIL because `mapSceneWorkLinkRow` does not exist.

- [ ] **Step 2: Add mapper**

Add to `src/utils/sceneWorkLinks.ts`:

```ts
export function mapSceneWorkLinkRow(row: Record<string, unknown>): SceneWorkLink {
  return {
    id: String(row.id ?? ''),
    sceneUuid: String(row.scene_uuid ?? row.sceneUuid ?? ''),
    department: (row.department === 'acting' ? 'acting' : 'bg'),
    linkKind: (row.link_kind === 'primary_file' || row.linkKind === 'primary_file')
      ? 'primary_file'
      : (row.link_kind === 'extra_file' || row.linkKind === 'extra_file') ? 'extra_file' : 'folder',
    path: String(row.path ?? ''),
    label: typeof row.label === 'string' ? row.label : null,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0) || 0,
    createdBy: typeof row.created_by === 'string' ? row.created_by : typeof row.createdBy === 'string' ? row.createdBy : null,
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : typeof row.updatedBy === 'string' ? row.updatedBy : null,
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ''),
  };
}
```

- [ ] **Step 3: Verify mapper test passes**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
```

Expected: PASS.

- [ ] **Step 4: Create migration**

Create `DEVLOG/migrations/2026-06-25-scene-work-links.sql`:

```sql
-- 2026-06-25: 씬 작업 폴더/파일 경로 링크
-- spec: docs/superpowers/specs/2026-06-25-scene-work-links-design.md

CREATE TABLE IF NOT EXISTS scene_work_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_uuid UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (department IN ('bg', 'acting')),
  link_kind TEXT NOT NULL CHECK (link_kind IN ('folder', 'primary_file', 'extra_file')),
  path TEXT NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_scene_work_links_primary_slots
  ON scene_work_links(scene_uuid, department, link_kind)
  WHERE link_kind IN ('folder', 'primary_file');

CREATE INDEX IF NOT EXISTS idx_scene_work_links_scene
  ON scene_work_links(scene_uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scene_work_links TO anon, authenticated, service_role;

ALTER TABLE scene_work_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scene_work_links'
      AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON scene_work_links FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_scene_work_links_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scene_work_links_updated_at ON scene_work_links;
CREATE TRIGGER trg_scene_work_links_updated_at
  BEFORE UPDATE ON scene_work_links
  FOR EACH ROW EXECUTE FUNCTION set_scene_work_links_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='scene_work_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scene_work_links;
  END IF;
END $$;
```

- [ ] **Step 5: Add Supabase CRUD functions**

In `electron/supabase.ts`, add imports/types from `./supabase` local file conventions if needed and functions near metadata/revision-set functions:

```ts
export interface SceneWorkLinkInput {
  sceneUuid: string;
  department: 'bg' | 'acting';
  linkKind: 'folder' | 'primary_file' | 'extra_file';
  path: string;
  label?: string | null;
  sortOrder?: number;
  userId?: string | null;
}

function mapSceneWorkLinkRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    sceneUuid: String(row.scene_uuid ?? ''),
    department: row.department === 'acting' ? 'acting' : 'bg',
    linkKind: row.link_kind === 'primary_file' ? 'primary_file' : row.link_kind === 'extra_file' ? 'extra_file' : 'folder',
    path: String(row.path ?? ''),
    label: typeof row.label === 'string' ? row.label : null,
    sortOrder: Number(row.sort_order ?? 0) || 0,
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    createdAt: String(row.created_at ?? ''),
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function readSceneWorkLinks(sceneUuids?: string[]) {
  let query = supabase
    .from('scene_work_links')
    .select('id, scene_uuid, department, link_kind, path, label, sort_order, created_by, created_at, updated_by, updated_at')
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });
  if (sceneUuids && sceneUuids.length > 0) query = query.in('scene_uuid', sceneUuids);
  const { data, error } = await query;
  throwIfError(error);
  return (data || []).map((row) => mapSceneWorkLinkRow(row as Record<string, unknown>));
}

export async function upsertSceneWorkLink(input: SceneWorkLinkInput) {
  const now = new Date().toISOString();
  const payload = {
    scene_uuid: input.sceneUuid,
    department: input.department,
    link_kind: input.linkKind,
    path: input.path.trim(),
    label: input.label ?? null,
    sort_order: input.sortOrder ?? 0,
    created_by: input.userId ?? null,
    updated_by: input.userId ?? null,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('scene_work_links')
    .upsert(payload, { onConflict: 'scene_uuid,department,link_kind' })
    .select('id, scene_uuid, department, link_kind, path, label, sort_order, created_by, created_at, updated_by, updated_at')
    .single();
  throwIfError(error);
  broadcastDataChange('scene_work_links', 'UPSERT');
  return mapSceneWorkLinkRow(data as Record<string, unknown>);
}

export async function deleteSceneWorkLink(
  sceneUuid: string,
  department: 'bg' | 'acting',
  linkKind: 'folder' | 'primary_file',
) {
  const { error } = await supabase
    .from('scene_work_links')
    .delete()
    .eq('scene_uuid', sceneUuid)
    .eq('department', department)
    .eq('link_kind', linkKind);
  throwIfError(error);
  broadcastDataChange('scene_work_links', 'DELETE');
}
```

Note: if PostgREST refuses `onConflict` because the partial unique index is not accepted, replace with read-then-update-or-insert for `folder` and `primary_file`. Keep `extra_file` insert-only for future.

- [ ] **Step 6: Add IPC**

In `electron/main.ts`, import the new functions and add handlers:

```ts
ipcMain.handle('supabase:read-scene-work-links', wrapIpc(async (_e: unknown, sceneUuids?: string[]) => {
  return sbReadSceneWorkLinks(sceneUuids);
}));

ipcMain.handle('supabase:upsert-scene-work-link', wrapIpc(async (_e: unknown, input: SceneWorkLinkInput) => {
  return sbUpsertSceneWorkLink(input);
}));

ipcMain.handle('supabase:delete-scene-work-link', wrapIpc(async (
  _e: unknown,
  sceneUuid: string,
  department: 'bg' | 'acting',
  linkKind: 'folder' | 'primary_file',
) => {
  await sbDeleteSceneWorkLink(sceneUuid, department, linkKind);
}));
```

In `electron/realtime.ts`, add callback and subscription:

```ts
onSceneWorkLinkChange?: (payload: ChangePayload) => void;
```

```ts
.on(
  'postgres_changes',
  { event: '*', schema: 'public', table: 'scene_work_links' },
  (payload) => {
    console.log('[Realtime] scene_work_links 이벤트 수신:', payload.eventType);
    callbacks.onSceneWorkLinkChange?.(payload);
  },
)
```

In `startSupabaseRealtime`, broadcast it:

```ts
onSceneWorkLinkChange: (payload) => broadcastSupabaseEvent('scene_work_links', payload),
```

- [ ] **Step 7: Add file/folder IPC**

In `electron/main.ts`, add:

```ts
ipcMain.handle('path:choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle('path:choose-file', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle('path:exists', async (_event, targetPath: string) => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
});

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  try {
    const error = await shell.openPath(targetPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
```

Expose matching methods in `electron/preload.ts` and `ElectronAPI`.

- [ ] **Step 8: Add renderer service and mock**

Create `src/services/sceneWorkLinkService.ts`:

```ts
import type { SceneWorkLink, SceneWorkLinkDepartment, SceneWorkLinkKind } from '@/types';

export interface UpsertSceneWorkLinkInput {
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label?: string | null;
  sortOrder?: number;
  userId?: string | null;
}

export async function readSceneWorkLinks(sceneUuids?: string[]): Promise<SceneWorkLink[]> {
  return window.electronAPI.supabaseReadSceneWorkLinks(sceneUuids);
}

export async function upsertSceneWorkLink(input: UpsertSceneWorkLinkInput): Promise<SceneWorkLink> {
  return window.electronAPI.supabaseUpsertSceneWorkLink(input);
}

export async function deleteSceneWorkLink(sceneUuid: string, department: SceneWorkLinkDepartment, linkKind: 'folder' | 'primary_file'): Promise<void> {
  await window.electronAPI.supabaseDeleteSceneWorkLink(sceneUuid, department, linkKind);
}

export const chooseWorkFolder = () => window.electronAPI.chooseFolderPath();
export const chooseWorkFile = () => window.electronAPI.chooseFilePath();
export const pathExists = (path: string) => window.electronAPI.pathExists(path);
export const openWorkPath = (path: string) => window.electronAPI.shellOpenPath(path);
```

In `src/mocks/devElectronAPI.ts`, store links in localStore:

```ts
supabaseReadSceneWorkLinks: async (sceneUuids?: string[]) => {
  const rows = localStore.__sceneWorkLinks ?? [];
  return sceneUuids?.length ? rows.filter((r) => sceneUuids.includes(r.sceneUuid)) : rows;
},
supabaseUpsertSceneWorkLink: async (input) => { ...return row; },
supabaseDeleteSceneWorkLink: async (sceneUuid, department, linkKind) => { ... },
chooseFolderPath: async () => 'G:\\공유 드라이브\\JBBJ\\A_014',
chooseFilePath: async () => 'G:\\공유 드라이브\\JBBJ\\A_014\\main.psd',
pathExists: async (path) => !path.includes('missing'),
shellOpenPath: async (path) => path.includes('missing') ? { ok: false, error: 'not found' } : { ok: true },
```

- [ ] **Step 9: Run checks**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
npm run typecheck
```

Expected: both PASS.

---

### Task 3: Work link store and Realtime integration

**Files:**
- Create: `src/stores/useSceneWorkLinkStore.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `sceneWorkLinkService`, `SceneWorkLink`
- Produces:
  - `loadForSceneUuids(sceneUuids: string[]): Promise<void>`
  - `upsertLink(input): Promise<void>`
  - `deleteLink(sceneUuid, department, kind): Promise<void>`
  - `applyRealtime(payload): void`
  - `getLink(sceneUuid, department, kind): SceneWorkLink | undefined`

- [ ] **Step 1: Write failing pure reducer tests**

Add to `tests/sceneWorkLinks.test.ts`:

```ts
import { applySceneWorkLinkRealtimeRows } from '../src/utils/sceneWorkLinks.ts';

test('applySceneWorkLinkRealtimeRows upserts and deletes rows by id', () => {
  const initial = [
    { id: '1', sceneUuid: 's1', department: 'bg', linkKind: 'folder', path: 'old', label: null, sortOrder: 0, createdBy: null, createdAt: '', updatedBy: null, updatedAt: '' },
  ] as SceneWorkLink[];

  const upserted = applySceneWorkLinkRealtimeRows(initial, {
    eventType: 'UPDATE',
    row: { id: '1', scene_uuid: 's1', department: 'bg', link_kind: 'folder', path: 'new' },
  });
  assert.equal(upserted[0].path, 'new');

  const deleted = applySceneWorkLinkRealtimeRows(upserted, {
    eventType: 'DELETE',
    row: { id: '1' },
  });
  assert.equal(deleted.length, 0);
});
```

Expected RED: `applySceneWorkLinkRealtimeRows` missing.

- [ ] **Step 2: Implement reducer helper**

Add to `src/utils/sceneWorkLinks.ts`:

```ts
export function applySceneWorkLinkRealtimeRows(
  current: SceneWorkLink[],
  event: { eventType: 'INSERT' | 'UPDATE' | 'DELETE' | string; row: Record<string, unknown> },
): SceneWorkLink[] {
  const id = String(event.row.id ?? '');
  if (!id) return current;
  if (event.eventType === 'DELETE') return current.filter((link) => link.id !== id);
  const mapped = mapSceneWorkLinkRow(event.row);
  const idx = current.findIndex((link) => link.id === id);
  if (idx < 0) return [...current, mapped];
  const next = [...current];
  next[idx] = { ...next[idx], ...mapped };
  return next;
}
```

- [ ] **Step 3: Implement store**

Create `src/stores/useSceneWorkLinkStore.ts`:

```ts
import { create } from 'zustand';
import type { SceneWorkLink, SceneWorkLinkDepartment } from '@/types';
import {
  deleteSceneWorkLink,
  readSceneWorkLinks,
  upsertSceneWorkLink,
  type UpsertSceneWorkLinkInput,
} from '@/services/sceneWorkLinkService';
import {
  applySceneWorkLinkRealtimeRows,
  buildSceneWorkLinkMap,
  getWorkLinkSlotKey,
} from '@/utils/sceneWorkLinks';

interface SceneWorkLinkState {
  links: SceneWorkLink[];
  linkMap: Map<string, SceneWorkLink>;
  loading: boolean;
  loadForSceneUuids: (sceneUuids: string[]) => Promise<void>;
  upsertLink: (input: UpsertSceneWorkLinkInput) => Promise<void>;
  deleteLink: (sceneUuid: string, department: SceneWorkLinkDepartment, linkKind: 'folder' | 'primary_file') => Promise<void>;
  applyRealtime: (payload: unknown) => void;
  getLink: (sceneUuid: string | undefined | null, department: SceneWorkLinkDepartment, linkKind: 'folder' | 'primary_file') => SceneWorkLink | undefined;
}

function withMap(links: SceneWorkLink[]) {
  return { links, linkMap: buildSceneWorkLinkMap(links) };
}

export const useSceneWorkLinkStore = create<SceneWorkLinkState>((set, get) => ({
  links: [],
  linkMap: new Map(),
  loading: false,
  loadForSceneUuids: async (sceneUuids) => {
    const unique = Array.from(new Set(sceneUuids.filter(Boolean)));
    if (unique.length === 0) return;
    set({ loading: true });
    try {
      const rows = await readSceneWorkLinks(unique);
      const other = get().links.filter((link) => !unique.includes(link.sceneUuid));
      set({ ...withMap([...other, ...rows]), loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },
  upsertLink: async (input) => {
    const previous = get().links;
    const optimistic: SceneWorkLink = {
      id: `optimistic:${input.sceneUuid}:${input.department}:${input.linkKind}`,
      sceneUuid: input.sceneUuid,
      department: input.department,
      linkKind: input.linkKind,
      path: input.path,
      label: input.label ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdBy: input.userId ?? null,
      createdAt: new Date().toISOString(),
      updatedBy: input.userId ?? null,
      updatedAt: new Date().toISOString(),
    };
    const withoutSlot = previous.filter((link) =>
      !(link.sceneUuid === input.sceneUuid && link.department === input.department && link.linkKind === input.linkKind),
    );
    set(withMap([...withoutSlot, optimistic]));
    try {
      const saved = await upsertSceneWorkLink(input);
      const replaced = get().links.filter((link) =>
        !(link.sceneUuid === input.sceneUuid && link.department === input.department && link.linkKind === input.linkKind),
      );
      set(withMap([...replaced, saved]));
    } catch (err) {
      set(withMap(previous));
      throw err;
    }
  },
  deleteLink: async (sceneUuid, department, linkKind) => {
    const previous = get().links;
    set(withMap(previous.filter((link) => !(link.sceneUuid === sceneUuid && link.department === department && link.linkKind === linkKind))));
    try {
      await deleteSceneWorkLink(sceneUuid, department, linkKind);
    } catch (err) {
      set(withMap(previous));
      throw err;
    }
  },
  applyRealtime: (payload) => {
    const p = payload as { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> } | null;
    if (!p?.eventType) return;
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row) return;
    set(withMap(applySceneWorkLinkRealtimeRows(get().links, { eventType: p.eventType, row })));
  },
  getLink: (sceneUuid, department, linkKind) => {
    if (!sceneUuid) return undefined;
    return get().linkMap.get(getWorkLinkSlotKey(sceneUuid, department, linkKind));
  },
}));
```

- [ ] **Step 4: Wire Realtime**

In `src/App.tsx`, import store and add branch before debounced reload:

```ts
if (table === 'scene_work_links') {
  useSceneWorkLinkStore.getState().applyRealtime(payload);
  return;
}
```

- [ ] **Step 5: Run checks**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 4: Files tab management UI

**Files:**
- Create: `src/components/scenes/SceneWorkLinksPanel.tsx`
- Modify: `src/components/scenes/SceneFilesTab.tsx`
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`

**Interfaces:**
- Consumes: `useSceneWorkLinkStore`, `chooseWorkFolder`, `chooseWorkFile`, `pathExists`, `openWorkPath`
- Produces: UI for connect/change/open/unlink with warnings.

- [ ] **Step 1: Add a minimal component skeleton**

Create `SceneWorkLinksPanel.tsx` with props:

```ts
export interface SceneWorkLinksPanelProps {
  bgScene: Scene | null;
  actScene: Scene | null;
  visibleDepartments: SceneWorkLinkDepartment[];
}
```

Rows:

```tsx
<WorkLinkRow department="bg" linkKind="folder" label="작업 폴더" />
<WorkLinkRow department="bg" linkKind="primary_file" label="대표 파일" />
```

Use `sonner` for toast and existing `ConfirmDialog.show` for unlink confirmation.

- [ ] **Step 2: Implement connect/change menu**

Each empty row shows `[연결]`. Connected rows show `[열기] [변경] [해제]`.

Use one small popover menu:

```text
선택창으로 고르기
경로 붙여넣기
```

For paste, use a compact inline form/modal inside the panel. Accept any non-empty path; trim before saving.

- [ ] **Step 3: Implement warnings**

On render, call `getWorkLinkWarnings(link.path, linkKind)` and `pathExists(link.path)` asynchronously. Show:

- `개인 경로일 수 있음`
- `이 PC에서 확인 안 됨`
- `폴더가 아닌 경로일 수 있음`
- `파일이 아닌 경로일 수 있음`

Do not block save for any warning.

- [ ] **Step 4: Implement open/unlink behavior**

Open:

```ts
const result = await openWorkPath(link.path);
if (!result.ok) toast.error(linkKind === 'folder' ? '이 PC에서 폴더를 찾을 수 없음' : '이 PC에서 파일을 찾을 수 없음');
```

Unlink confirmation:

```ts
const ok = await ConfirmDialog.show({
  message: '이 작업 링크를 해제할까요?\n실제 파일이나 폴더는 삭제되지 않고, Bflow에 저장된 연결만 사라집니다.',
  confirmLabel: '링크 해제',
  tone: 'danger',
});
```

- [ ] **Step 5: Attach to files tab**

Modify `SceneFilesTab` props:

```ts
bgScene: Scene | null;
actScene: Scene | null;
visibleDepartments: SceneWorkLinkDepartment[];
```

Render `SceneWorkLinksPanel` above existing attachment grid.

Modify `UnifiedSceneDetailModal` to pass:

- all view: `['bg', 'acting']`
- bg view: `['bg']`
- acting view: `['acting']`

- [ ] **Step 6: Run checks**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 5: Card/sheet badges and sheet toggle preference

**Files:**
- Create: `src/components/scenes/SceneWorkLinkBadges.tsx`
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`
- Modify: `src/services/settingsService.ts`

**Interfaces:**
- Consumes: `useSceneWorkLinkStore.linkMap`, `getSceneWorkLinkSlots`
- Produces: A2 card badge, S1-A sheet gutter, saved sheet toggle.

- [ ] **Step 1: Add preference type**

In `UserPreferences`:

```ts
sheetWorkLinkBadgesVisible?: boolean;
```

Default missing value to true in component code.

- [ ] **Step 2: Create badge component**

`SceneWorkLinkBadges.tsx` exports:

```ts
export function SceneWorkLinkBadges({
  bgSceneUuid,
  actSceneUuid,
  mode,
}: {
  bgSceneUuid?: string | null;
  actSceneUuid?: string | null;
  mode: 'card-all' | 'card-bg' | 'card-acting' | 'sheet-all' | 'sheet-bg' | 'sheet-acting';
})
```

Use lucide `Folder` and `File`. Linked icons get BG purple or ACT red classes; empty slots are gray.

- [ ] **Step 3: Add card A2**

In `UnifiedSceneCard`, render the badge cluster near the lower right, fixed size, no text. Do not cover selection, revision flag, or completion confetti.

- [ ] **Step 4: Add sheet S1-A**

In `UnifiedSceneSheetView`, add a left outside gutter inside the scene number `<td>` with `position:absolute; left:-...`.

Whole view:

```text
BG row: folder/file
ACT row: folder/file
```

Department view fallback is handled later if single-department sheet component is used. If only unified sheet is active for all view, keep S1-A here.

- [ ] **Step 5: Add sheet toggle**

Add toolbar switch near existing view controls in `UnifiedSceneSheetView`.

On mount:

```ts
const prefs = await loadPreferences();
setVisible(prefs?.sheetWorkLinkBadgesVisible ?? true);
```

On toggle:

```ts
await savePreferences({ ...(prefs ?? {}), sheetWorkLinkBadgesVisible: next });
window.electronAPI?.preferencesBroadcastChange?.({ sheetWorkLinkBadgesVisible: next });
```

- [ ] **Step 6: Run checks**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 6: Right-click menu fast open

**Files:**
- Modify: `src/components/scenes/SceneContextMenu.tsx`
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`
- Modify: single-department card/sheet path if current view still uses local `SceneCard` / `SceneSheetView`.

**Interfaces:**
- Consumes: `SceneWorkLink` slots and `openWorkPath`
- Produces: menu sections with disabled missing links.

- [ ] **Step 1: Extend props**

`SceneContextMenuProps` gains:

```ts
sceneLabel?: string;
workLinks?: {
  episodeName?: string;
  departments: Array<{
    department: 'bg' | 'acting';
    folder?: SceneWorkLink;
    primaryFile?: SceneWorkLink;
  }>;
  onOpen: (link: SceneWorkLink) => void;
};
```

Keep length-change behavior unchanged.

- [ ] **Step 2: Render menu sections**

Before `씬 길이 변경`, render:

```text
{episodeName} · {sceneLabel}
배경
  작업 폴더 열기
  작업 파일 열기
액팅
  작업 폴더 열기
  작업 파일 열기
```

Missing links are disabled with helper text `파일 탭에서 연결`.

- [ ] **Step 3: Wire card/sheet**

In card/sheet components, build `workLinks.departments` from store. Use `useDataStore.getEpisodeDisplayName(ep)` or equivalent lookup to pass the real episode name.

Open handler:

```ts
const result = await openWorkPath(link.path);
if (!result.ok) toast.error(link.linkKind === 'folder' ? '이 PC에서 폴더를 찾을 수 없음' : '이 PC에서 파일을 찾을 수 없음');
```

- [ ] **Step 4: Run checks**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 7: Load lifecycle and preview verification

**Files:**
- Modify: `src/views/ScenesView.tsx`
- Potentially modify: `src/App.tsx`

**Interfaces:**
- Consumes: loaded episodes/scenes
- Produces: link store load for currently relevant scene UUIDs.

- [ ] **Step 1: Load links for visible scenes**

In `ScenesView`, compute visible scene UUIDs from current BG/ACT parts and call:

```ts
useEffect(() => {
  const uuids = visibleScenes.map((s) => s.id).filter(Boolean) as string[];
  void useSceneWorkLinkStore.getState().loadForSceneUuids(uuids).catch((err) => {
    console.warn('[SceneWorkLinks] 로드 실패', err);
  });
}, [visibleSceneUuidKey]);
```

- [ ] **Step 2: Verify existing tests and build**

Run:

```powershell
node --test ./tests/sceneWorkLinks.test.ts
npm run test:entity
npm run typecheck
npm run build:vite
```

Expected: all PASS.

- [ ] **Step 3: Start preview**

If no dev server is already running:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Open in-app browser to `http://localhost:5173/`. If login appears, use preview credentials from AGENTS: name `배한솔`, password `1234`.

- [ ] **Step 4: Manual preview checklist**

Verify:

1. Files tab shows BG/ACT work link sections.
2. Empty links show gray state and `[연결]`.
3. Path paste accepts a personal path and shows warning.
4. Missing path remains colored after saving but shows `이 PC에서 확인 안 됨`.
5. Unlink confirmation says actual file/folder is not deleted.
6. Card A2 badge appears without text.
7. Sheet S1-A gutter appears and toggle hides/shows it.
8. Toggle survives refresh.
9. Right-click menu shows real episode name and disabled missing entries.
10. File open failure shows the correct toast.

---

### Task 8: Review loop and deployment

**Files:** release workflow files only if version/release notes are updated by deployment skill.

- [ ] **Step 1: Commit implementation**

Use Korean commit messages:

```powershell
git status --short
git add <changed files>
git commit -m "씬 작업 링크 연결 기능 추가"
```

- [ ] **Step 2: Open PR**

Follow Bflow PR instructions:

- 제목 format: `[v버전] 변경 내용 한 줄 요약`
- Body sections:
  - `📋 업데이트 요약`
  - `🔧 상세 기술 설명`
  - `🚧 개발 난항`
  - `✅ 테스트 가이드`

- [ ] **Step 3: Review loop**

Trigger Codex review, wait for explicit OK, inspect issue comments, review comments, and line comments with `gh api`.

- [ ] **Step 4: Build and deploy**

After review OK and merge approval path:

```powershell
npm run build
```

Deploy to:

```text
G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\
```

Copy build artifacts first and update `manifest.json` last.

---

## Self-Review

### Spec coverage

- 경로만 저장: Task 2 schema/service stores path string only.
- 선택창/붙여넣기: Task 2 file IPC, Task 4 panel UI.
- 개인 경로/없는 경로 저장 허용 + 경고: Task 1 warnings, Task 4 panel warning.
- 파일 바로 열기/폴더 열기: Task 2 IPC, Task 4/6 open handlers.
- 링크 해제 확인창: Task 4.
- 링크 변경 확인창 없음: Task 4.
- 별도 저장 방식: Task 2 `scene_work_links`.
- 카드 A2, 시트 S1-A, 토글 저장: Task 5.
- 우클릭 메뉴 전체/BG/ACT 구분과 실제 에피소드 이름: Task 6.
- 테스트 모드 동등성: Task 2 mock, Task 7 preview.
- Supabase explicit grants: Task 2 migration.

### Placeholder scan

No unresolved marker or open question remains. UI tasks specify the required props, behavior, copy, and verification commands.

### Type consistency

`SceneWorkLinkDepartment`, `SceneWorkLinkKind`, `SceneWorkLink`, service/store/component props use the same property names: `sceneUuid`, `department`, `linkKind`, `primary_file`.
