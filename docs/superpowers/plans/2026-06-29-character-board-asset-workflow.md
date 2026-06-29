# Character Board Asset Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the character board beta so character images, assignees, file links, and episode reels match the confirmed production workflow.

**Architecture:** Keep the existing character board model and optimistic Zustand store. Add only the missing columns and renderer mappings, reuse scene work-link IPC helpers, reuse `AssigneeMultiSelect`, and extend the existing lightbox visual language for character images.

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Supabase, Vite, Node built-in test runner.

---

### Task 1: Data Model and Mapping Tests

**Files:**
- Create: `tests/characterBoardAssetWorkflow.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/supabaseService.ts`
- Modify: `electron/supabase.ts`
- Modify: `DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql`

- [ ] Write tests that assert new character/costume/episode fields map from snake_case rows to renderer domain objects.
- [ ] Run `node --test tests/characterBoardAssetWorkflow.test.ts` and confirm it fails because fields do not exist yet.
- [ ] Add TypeScript interfaces for `workFolderPath`, `workFilePath`, `imageBackground`, `imageFit`, `designAssignee`, `riggingAssignee`, and `reelFilePath`.
- [ ] Extend `rowToCharacter`, `rowToCostume`, and episode row mapping defaults.
- [ ] Add the additive migration with the new nullable/default columns.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: IPC, Store, and Mock Parity

**Files:**
- Modify: `src/stores/useCharacterBoardStore.ts`
- Modify: `src/services/supabaseService.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `electron/supabase.ts`
- Modify: `src/mocks/devElectronAPI.ts`
- Modify: `src/types/index.ts`

- [ ] Add tests for a helper that chooses a costume file and auto-fills the character folder only when the folder is empty.
- [ ] Run the focused test and confirm it fails.
- [ ] Add store methods for character folder update, costume file update, image display update, and episode reel update.
- [ ] Add IPC/preload support for episode reel path update and `path:dirname`.
- [ ] Update mock data and mock APIs so preview supports all new fields.
- [ ] Re-run focused tests and typecheck the touched types.

### Task 3: Character Image Display and Context Menu

**Files:**
- Modify: `src/views/CharacterBoardView.tsx`
- Create: `src/components/characters/CharacterImageFrame.tsx`
- Create: `src/components/characters/CharacterImageContextMenu.tsx`
- Create: `src/components/characters/CharacterImageFitEditor.tsx`
- Create: `src/components/characters/CharacterImageLightbox.tsx`
- Modify: `src/utils/imageActions.ts` if needed.

- [ ] Add a source-wiring test that checks the character board imports and renders the new image frame/context menu/editor.
- [ ] Run it and confirm it fails.
- [ ] Implement a reusable image frame that applies background and fit transform consistently.
- [ ] Implement image right-click actions for background, edit fit, copy image, open folder, and open file.
- [ ] Implement the fit editor with visible crop region, dim/blur outside region, scale, pan, reset, and aspect lock toggle.
- [ ] Implement character image lightbox with left/right navigation over costume images and fit editing.
- [ ] Re-run the source-wiring test.

### Task 4: Assignees and Work Link UI

**Files:**
- Modify: `src/views/CharacterBoardView.tsx`
- Modify: `src/components/characters/*`

- [ ] Add a source-wiring test for `디자인 담당자`, `리깅 담당자`, `AssigneeMultiSelect`, `작업 폴더`, and `작업 파일`.
- [ ] Run it and confirm it fails.
- [ ] Replace the single 담당자 input with two multi-assignee chip rows.
- [ ] Add character folder and selected costume file controls.
- [ ] Ensure choosing a file auto-fills the character folder only when empty.
- [ ] Re-run the focused test.

### Task 5: Episode Reel Path and Scenes View Button

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/supabaseService.ts`
- Modify: `electron/supabase.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/views/EpisodeAssetBoard.tsx`
- Modify: `src/views/CharacterBoardView.tsx`
- Modify: `src/views/ScenesView.tsx`
- Modify: `src/mocks/devElectronAPI.ts`

- [ ] Add tests for episode reel path mapping and source wiring in EpisodeAssetBoard, CharacterBoardView, and ScenesView.
- [ ] Run them and confirm they fail.
- [ ] Add episode reel path load/update APIs.
- [ ] Add Episode Asset tab controls to connect/open reel file.
- [ ] Add character episode button context action to open/connect reel file.
- [ ] Add ScenesView episode-level reel button that opens the file or prompts first connection.
- [ ] Re-run focused tests.

### Task 6: Verification

**Files:**
- Modify as required by fixes.

- [ ] Run `node --test tests/characterBoardAssetWorkflow.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build:vite`.
- [ ] Start the local dev/preview server.
- [ ] Open the mock app, log in with preview credentials if the login screen appears, and exercise:
  - image background right-click actions,
  - fit editor,
  - image copy,
  - design/rigging assignee chips,
  - character folder and costume file selection/open,
  - episode reel connection/open in Episode Asset tab and Scenes view.
- [ ] Fix any failed verification before final response.
