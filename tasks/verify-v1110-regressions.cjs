const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertIncludes(source, needle, description) {
  if (!source.includes(needle)) {
    throw new Error(`missing ${description}: ${needle}`);
  }
}

const scenesView = read('src/views/ScenesView.tsx');
const scheduleView = read('src/views/ScheduleView.tsx');
const eventSidePanel = read('src/components/calendar/EventSidePanel.tsx');

assertIncludes(scenesView, "UnifiedSceneDetailModal", 'all-view unified detail modal import/render path');
assertIncludes(scenesView, "detailMerged", 'all-view merged detail state');
assertIncludes(scenesView, "deleteSceneByUuid", 'UUID-based batch delete path');

assertIncludes(scheduleView, "isPrivate", 'private event create/edit state');
assertIncludes(scheduleView, "나만 보기", 'private event create/edit UI copy');

assertIncludes(eventSidePanel, "draftPrivate", 'private event side panel edit state');

console.log('v1.11.0 regression checks passed');
