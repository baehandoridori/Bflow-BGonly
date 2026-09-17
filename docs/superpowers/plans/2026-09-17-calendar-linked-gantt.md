# Shared calendar linked Gantt folders and projects

## User-approved behavior

The user's correction is whole-calendar import, with original team/member sharing preserved. They explicitly chose automatic ongoing synchronization of events and audience. Continue the previously authorized release/deployment workflow after implementation and verification.

## Architecture

- Persist one calendar binding with stable folder/project identifiers. Do not copy event or ACL authority.
- Read linked folders/projects from current calendar rows, members, users and events through authenticated server RPCs. Preserve owner; team visibility grants viewing, not implicit editing.
- Original native calendar event IDs remain stable task identities. Exclude existing Gantt projections and leave reverse calendar-link task fields empty to avoid loops.
- Linked folders/projects are not normal editable Gantt aggregates. Disable local hierarchy/progress/share mutations. Open a linked task in the source calendar event editor, preserving the source read/edit permissions.
- A dedicated link/unlink command is atomic and idempotent. Unlink only removes the binding. Source deletion and revoked access immediately remove derived rows on next read.
- Existing one-time event copies remain independent and available as a secondary option. Do not convert or overwrite them.
- Preview follows identical visibility, binding, source refresh and session rules.

## Tasks

- [x] Backend binding, source-authoritative reads, mutation rejection, session/permission and migration tests.
- [x] Preview equivalent binding, cross-user source updates, revoked access and idempotency tests.
- [x] Whole-calendar link UI as default, linked folder/project display, source editor and unlink controls.
- [x] Integration/review, typecheck, relevant tests, full development build, authenticated browser checks.
- [x] Version/release notes, PR/merge, exact-merge installer build, DB migration, manifest-last deployment and whole-payload verification.

## Ownership

- calendar_data: SQL, Gantt types/domain/store/main persistence and backend tests.
- calendar_sharing: preview gateway/mock and preview tests.
- calendar_tag_ui: Gantt import/view/dialog UI and UI tests.
- root: integration, realtime gaps, docs/release notes, final tests and deployment.

## Clarifications

- Same calendar maps to one linked folder/project visible to its original audience; importer does not become owner.
- Displayed source edit permission is honored through the existing calendar event editor. Gantt-only completion, groups, predecessor and local sharing controls are not applied to source calendar events.
- Protect unrelated root checkout, other worktrees, user settings and running installed app.
