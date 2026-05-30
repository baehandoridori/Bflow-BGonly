# Feedback Hub Preview Baseline

Date: 2026-05-29

This document keeps the current Feedback Hub mockup/app preview as a reusable design baseline.

## Reusable Preview Entry Points

- Live in-app preview: `http://localhost:59286/?preview=feedback-hub`
- App preview source: `src/views/FeedbackHubPreviewApp.tsx`
- Static polish mockup: `docs/mockups/feedback-hub-polish-preview.html`
- Baseline screenshot: `docs/mockups/2026-05-29-feedback-hub-preview-baseline.png`
- Comment read-state option screen: `docs/mockups/2026-05-29-feedback-comment-read-state-options.html`

## Current Baseline Decisions

- The page name is `피드백 허브`.
- Main users are administrators, but artists also need to filter their own assigned or related feedback.
- The main list is organized as an episode > part > scene tree.
- The `씬 트리` view is the default, with `에피소드별` and `상태 보드` as alternate views.
- Scene detail opening must stay visible but not dominate the feedback content.
- Revision comments are represented with a speech-bubble SVG icon and a count, not emoji.
- New/unread comment markers use the accent color.
- Already-read comment markers are visually de-emphasized with a gray tone.
- Revision lifecycle events should be visible in the real scene detail modal comments/activity area, not as a separate compositing-only modal.

## Why Keep This Baseline

This is the first feedback-hub direction that combines the user's preferred A+C direction:

- hub-like overview
- episode/part/scene grouping
- revision status flow
- scene detail access
- comment/read-state awareness
- preview data that can be manipulated inside the app

Use this as the reference before making further Feedback Hub visual or interaction changes.
