import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type CompletionBodyBuilder = (input: {
  senderName: string;
  revisionLabel?: string;
  note?: string | null;
}) => string;

type NotificationItemProps = {
  n: {
    id: string;
    type: 'revision';
    title: string;
    body: string;
    metadata: { revisionAction: 'assignee_done'; revisionId: string };
    isRead: boolean;
    createdAt: string;
  };
  onNavigate: () => void;
};

async function loadNotificationItem(): Promise<ComponentType<NotificationItemProps>> {
  const result = await build({
    entryPoints: ['src/components/NotificationPanel.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    loader: { '.css': 'empty' },
    external: ['react', 'react/jsx-runtime', '@/utils/devPreviewNotifications'],
    plugins: [{
      name: 'export-notification-item-for-test',
      setup(esbuild) {
        esbuild.onLoad({ filter: /NotificationPanel\.tsx$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace(
            'function NotificationItem(',
            'export function NotificationItem(',
          ),
          loader: 'tsx',
        }));
      },
    }],
  });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  evaluate((id: string) => {
    if (id === '@/utils/devPreviewNotifications') {
      return { addDevPreviewNotifications: async () => {}, isDevPreviewNotificationToolsEnabled: () => false };
    }
    return nodeRequire(id);
  }, module, module.exports);
  return module.exports.NotificationItem as ComponentType<NotificationItemProps>;
}

test('assignee completion notification defaults include requester and notify users but exclude completer', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1', 'requester-1', 'completer-1', ''],
      requesterId: 'requester-1',
      completerId: 'completer-1',
    }),
    ['worker-1', 'requester-1'],
  );
});

test('assignee completion notification selected recipients are sanitized and sender-safe', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1'],
      requesterId: 'requester-1',
      selectedUserIds: ['selected-1', 'worker-1', 'completer-1', 'selected-1'],
      completerId: 'completer-1',
    }),
    ['selected-1', 'worker-1'],
  );
});

test('assignee completion notification honors an intentionally empty selected list', async () => {
  const { buildRevisionAssigneeCompletionNotifyUserIds } = await import('../src/utils/revisionNotificationRecipients.ts');

  assert.deepEqual(
    buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: ['worker-1'],
      requesterId: 'requester-1',
      selectedUserIds: [],
      completerId: 'completer-1',
    }),
    [],
  );
});

test('retake completion notification body preserves the full path for its path button', async () => {
  const module = await import('../src/utils/revisionNotificationRecipients.ts');
  const buildBody = (module as unknown as { buildRetakeAssigneeCompletionBody?: CompletionBodyBuilder })
    .buildRetakeAssigneeCompletionBody;
  assert.equal(typeof buildBody, 'function');
  if (!buildBody) return;

  const path = 'G:\\공유 드라이브\\JBBJ 자료실\\EP01\\A001\\최종 파일.psd';
  assert.equal(
    buildBody({ senderName: '배한솔', revisionLabel: 're#7', note: `  ${path}  ` }),
    `배한솔님이 re#7 담당을 완료했습니다. ${path}`,
  );
});

test('retake completion notification renders a G drive path as the existing path button', async () => {
  const NotificationItem = await loadNotificationItem();
  const path = 'G:\\공유 드라이브\\JBBJ 자료실\\EP01\\A001\\최종 파일.psd';
  const markup = renderToStaticMarkup(createElement(NotificationItem, {
    n: {
      id: 'retake-done-1',
      type: 'revision',
      title: '리테이크 담당 완료 — a001',
      body: `배한솔님이 re#7 담당을 완료했습니다. ${path}`,
      metadata: { revisionAction: 'assignee_done', revisionId: 'revision-1' },
      isRead: false,
      createdAt: '2026-09-07T00:00:00.000Z',
    },
    onNavigate() {},
  }));

  assert.match(markup, /<button[^>]+title="G:\\공유 드라이브\\JBBJ 자료실\\EP01\\A001\\최종 파일\.psd/);
  assert.match(markup, />최종 파일\.psd<\/span>/);
});

test('retake completion notifications use a selected-recipient broadcast path', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const broadcast = readFileSync('electron/broadcast.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const store = readFileSync('src/stores/useRevisionStore.ts', 'utf8');
  const service = readFileSync('src/services/revisionService.ts', 'utf8');

  assert.match(preload, /supabaseDispatchRetakeAssigneeCompletionNotification/);
  assert.match(main, /supabase:dispatch-retake-assignee-completion-notification/);
  assert.match(broadcast, /retake-assignee-completion/);
  assert.match(app, /retake-assignee-completion/);
  assert.match(app, /if \(notiSettings\.commentNotify === false\) return/);
  assert.match(app, /const dedupeKey = `revision:\$\{p\.revisionId \?\? ''\}:assignee_done:\$\{p\.updatedAt \?\? ''\}`/);
  assert.match(app, /isGeneralRevisionSceneKey/);
  assert.match(app, /const sceneKey = p\.sceneKey;/);
  assert.match(app, /const isGeneralRetakeCompletion = !sceneKey \|\| isGeneralRevisionSceneKey\(sceneKey\);/);
  assert.match(app, /const sceneTarget = !isGeneralRetakeCompletion/);
  assert.match(app, /sceneId:\s*p\.sceneUuid/);
  assert.match(app, /sheetName:\s*p\.sheetName/);
  assert.match(app, /department:\s*p\.department/);
  assert.match(app, /metadata: !isGeneralRetakeCompletion/);
  assert.match(app, /sceneId:\s*sceneTarget\?\.sceneUuid \?\? p\.sceneUuid/);
  assert.match(app, /sceneName:\s*sceneTarget\?\.sceneName \?\? sceneKey/);
  assert.match(app, /sheetName:\s*sceneTarget\?\.sheetName \?\? p\.sheetName/);
  assert.match(app, /revisionAction:\s*'assignee_done'/);
  assert.match(app, /revisionEventId/);
  assert.match(app, /fallbackNotifyUserIds/);
  assert.match(app, /id !== userId/);
  assert.match(app, /resolveLatestAssigneeCompletionFallback/);
  assert.match(app, /resolveNewAssigneeCompletionFallback/);
  assert.match(app, /oldRow\?\.assignee_states/);
  assert.match(app, /oldRow\?\.assignee_states \? null : resolveLatestAssigneeCompletionFallback\(newRow\.assignee_states,\s*targets\)/);
  assert.match(app, /retakeHubSetId:\s*p\.setId \?\? undefined/);
  assert.match(store, /resolveNotificationSceneTarget/);
  assert.match(store, /sceneUuid:\s*sceneTarget\?\.sceneUuid/);
  assert.match(store, /sheetName:\s*sceneTarget\?\.sheetName/);
  assert.match(store, /department:\s*targetDepartment/);
  assert.match(store, /completionNotifyUserIds:\s*recipients/);
  assert.match(store, /dispatchRetakeAssigneeCompletionNotification/);
  assert.match(service, /sceneUuid\?:\s*string/);
  assert.match(service, /sheetName\?:\s*string/);
  assert.match(service, /department\?:\s*'bg' \| 'acting'/);
  assert.match(service, /completionNotifyUserIds:\s*string\[\] = \[\]/);
  assert.match(service, /completedByName:\s*completerName \|\| userId/);
});
