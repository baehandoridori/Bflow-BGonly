# Character Board Asset Workflow Design

## Goal

캐릭터 현황판 베타에서 캐릭터 이미지 표시, 썸네일 맞춤, 담당자, 작업 파일, 에피소드 릴 파일을 실제 작업 흐름에 맞게 다듬는다.

## Confirmed Decisions

- 대표 이미지는 복장마다 1장만 유지한다. 디자인 이미지 업로드 후, 리깅 완료 이미지를 같은 대표 이미지에 덮어쓴다.
- 파일 복사는 이번 범위에서 하지 않는다. Bflow에는 경로만 저장하고, 실제 파일/폴더는 사용자가 고른 위치를 연다.
- 캐릭터에는 기본 작업 폴더 1개를 저장한다.
- 복장마다 작업 파일 1개를 저장한다. 파일을 고르면 캐릭터 기본 작업 폴더가 비어 있을 때만 파일의 상위 폴더를 자동 저장한다.
- 담당자는 디자인 담당자와 리깅 담당자를 분리하고, 각각 여러 명을 칩으로 선택할 수 있게 한다.
- PNG 배경 표시는 복장 이미지별로 저장한다. 이미지 우클릭 메뉴에서 투명, 검정, 흰색, 체크무늬를 고를 수 있다.
- 썸네일 맞춤은 원본 이미지를 바꾸지 않고 표시값만 저장한다. 저장값은 확대율, 가로 이동, 세로 이동, 비율 잠금 여부다.
- 상세 이미지 창에서도 같은 썸네일 맞춤을 편집할 수 있고, 좌우 키로 같은 캐릭터의 다른 복장 이미지를 볼 수 있다.
- 이미지 복사는 파일 복사가 아니라 현재 대표 이미지를 클립보드에 이미지로 복사하는 기능이다.
- 에피소드 릴 파일은 에피소드 단위로 1개 저장한다. 에피소드 탭에서 연결하고, 캐릭터 현황판과 씬 뷰에서 열 수 있다. 연결되지 않은 경우 씬 뷰 버튼은 경로 설정부터 열어준다.

## Data Model

### `characters`

Add nullable path field:

- `work_folder_path text`: 캐릭터 기본 작업 폴더.

### `character_costumes`

Add nullable asset/display fields:

- `work_file_path text`: 이 복장에 연결된 작업 파일.
- `image_background text`: `transparent | black | white | checker`, default `black`.
- `image_fit jsonb`: `{ scale: number, x: number, y: number, lockAspect: boolean }`, default `{ scale: 1, x: 0, y: 0, lockAspect: true }`.
- `design_assignee text`: 디자인 담당자 칩 문자열. 기존 씬 담당자와 같은 comma-separated name format.
- `rigging_assignee text`: 리깅 담당자 칩 문자열.

Existing `featured_image_url` stays the single displayed image.

### `episodes`

Add nullable path field:

- `reel_file_path text`: 에피소드 릴 파일.

## UI Behavior

### Character Cards and Detail Images

- Cards use the costume image display settings when rendering thumbnails.
- The selected costume's large image uses the same display settings.
- Right-clicking an image opens image actions: background display, thumbnail fit editor, copy image, open linked folder/file when available.
- Transparent PNG readability is handled by the saved background display. Default is black.

### Thumbnail Fit Editor

- Opens from image right-click and from the detail image lightbox.
- Shows the target crop box and dims/blurs the area outside the visible thumbnail region.
- Supports drag to move, scale control, reset, and lock aspect toggle.
- Persists image fit to `character_costumes.image_fit`.

### Lightbox

- Reuses the app's existing lightbox visual language.
- For character images, entries are the current character's costumes that have images.
- Arrow keys and side buttons navigate between costume images.
- The lightbox has actions for copy image, background display, and edit fit.

### Assignees

- In the costume detail panel, show two rows:
  - 디자인 담당자
  - 리깅 담당자
- Both use existing `AssigneeMultiSelect` and `AssigneeChipList`.
- External names remain allowed because the scene assignee selector already supports them.

### Work Links

- Character detail header and card context menu can open the character folder.
- Costume detail can open/change the selected costume file.
- Choosing a costume file saves `work_file_path`. If `character.work_folder_path` is empty, save `dirname(work_file_path)` to the character.
- Open failures show the same kind of toast as scene work links.

### Episode Reel

- Episode Asset tab shows reel file connection controls.
- Character board episode buttons can open the reel through right-click.
- Scenes view shows a reel button in an appropriate episode-level area. If a reel is connected it opens the file; if not, it opens the file picker and saves the selected path.

## Error Handling

- All Supabase writes use the existing optimistic update then rollback pattern.
- File/folder open uses Electron `shell.openPath`; if the path is missing on this PC, show a toast and keep the saved path.
- Choosing a file/folder stores only the path; it never copies, moves, or edits the actual file.
- Existing rows missing new columns fall back to safe defaults in renderer mapping.

## Tests and Verification

- Add focused tests for:
  - character row/costume row mapping defaults and new fields.
  - costume file selection auto-filling character folder only when empty.
  - episode reel path mapping and view wiring.
  - UI source wiring for assignee rows, background actions, fit editor, and reel button.
- Run `npm run typecheck`.
- Run focused `node --test` files for new behavior.
- Run `npm run build:vite`.
- Run preview/mock app, log in with preview credentials if needed, and manually test character image actions, file links, assignee chips, and episode reel button.

## Deferred TODO

- 자동 연동: 이미지 폴더의 PNG를 기준으로 상위 캐릭터 폴더에서 `.moho` 파일을 찾아 자동 연결한다.
- 캐릭터 이미지 정렬: 여러 캐릭터 이미지를 별도로 정렬/배치하는 기능을 추가한다.
