# Calendar reliability, administrator overview and multiple tags

> **For agentic workers:** Use superpowers:subagent-driven-development; work only in this isolated worktree. Preserve other workers' changes.

**Goal:** Fix false creation failures, show every calendar to the designated administrator, and support colored multiple tags with administrator-only tag management.

**Architecture:** Keep renderer → IPC → main → Supabase. Server session tokens establish actors for new reads and writes. Preserve legacy tag_id compatibility while adding tag_ids. The administrator overview adds event reading only and marks exception calendars separately; existing administrator calendar-management rights stay unchanged.

## Decisions

- The requested administrator is the canonical live user ID `fcc4b438-2696-4e88-a03f-d6f34e73e08f` with role `admin`; display-name equality alone never grants access.
- Unshared calendars are enabled by default but grouped in an initially collapsed “관리자 전용 · 미공유 캘린더” rail section. Collapsing the list does not hide events; individual checkboxes do that.
- Multiple-tag filtering displays an event when any attached, nondeleted tag is enabled. No-tag events retain current behavior.
- Existing tag_id becomes the first selected tag for old clients; explicit empty arrays clear tags. Tag deletion removes references without deleting events.
- User subsequently authorized calendar-to-Gantt import and deployment of all changes. Complete reviewed DB migration, PR/merge, an exact-merge installer build, and manifest-last deployment. Preserve the unrelated dirty root checkout and do not restart the installed app.
- Calendar import copies selected accessible events into an editable project, preserving the source. Store provenance separately from outbound calendar linkage, skip same-source duplicates per project, and exclude Gantt projections. No ongoing two-way synchronization is implied.

## Tasks

- [x] Reproduce overlapping calendar metadata loads and Gantt creation failures. Add deferred-response regression tests including newer pending/success/failure and account switching. Correct false failure reporting without hiding actual failures or resending writes.
- [x] Add server-session calendar overview and multi-tag persistence. Cover designated admin, other admin, ordinary users, private calendars, legacy rows, empty tags, tag deletion and rejected writes. Verify migration in disposable PostgreSQL runtime.
- [x] Implement administrator-only collapsed rail section and multi-tag filter/text helpers. Test grouping, visibility defaults, OR filter semantics and deletion fallback.
- [x] Add multi-select tag chips and administrator tag-management entry points to creation/edit UI. Render colored badges in calendar chips/cards and hover tooltip. Verify preview as 배한솔 and as normal user.
- [x] Update version/minor release notes/architecture/roadmap. Run `npm run typecheck`, calendar/Gantt tests and `npm run build:vite`; inspect browser preview with login and shared-state interactions. Review final diff and record actual validation limits.
- [x] Implement calendar-to-Gantt import, durable duplicate prevention, permission/session checks, tests and browser verification.
- [x] Review final implementation, update release notes, create/merge PR, and apply the tested database migration.
- [x] Build the exact merge, preserve existing deployment files, publish manifest last, and verify full payload hashes plus installer/version metadata.

## Ownership

- Creation failures: calendar_sharing, store/settings modal and Gantt paths.
- Data contract, SQL, IPC, service, preview: calendar_data.
- Event UI and tag display: calendar_tag_ui.
- Rail, filter, integration, docs, final verification: root.

## Verification commands

```powershell
npm.cmd run typecheck
npm.cmd run test:calendar
npm.cmd run test:gantt
npm.cmd run build:vite
git diff --check
```
