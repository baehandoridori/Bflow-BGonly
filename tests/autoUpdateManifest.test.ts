import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { readManifest } from '../electron/autoUpdate/manifest.ts';

test('readManifest preserves structured release notes for update center UI', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bflow-manifest-'));
  const manifestPath = path.join(dir, 'manifest.json');

  await writeFile(manifestPath, JSON.stringify({
    version: '1.22.10',
    buildAt: '2026-05-08T00:00:00.000Z',
    fileCount: 12,
    totalBytes: 3456,
    releaseNotes: [
      {
        version: '1.22.10',
        title: '자동 업데이트 경험 개선',
        items: [
          '시작 시 최신 버전을 최대 10초까지 먼저 준비합니다.',
          '좌하단 버전 버튼에서 업데이트 내역을 확인할 수 있습니다.',
        ],
      },
    ],
  }), 'utf-8');

  try {
    const manifest = await readManifest(manifestPath);

    assert.equal(manifest?.version, '1.22.10');
    assert.deepEqual(manifest?.releaseNotes, [
      {
        version: '1.22.10',
        title: '자동 업데이트 경험 개선',
        items: [
          '시작 시 최신 버전을 최대 10초까지 먼저 준비합니다.',
          '좌하단 버전 버튼에서 업데이트 내역을 확인할 수 있습니다.',
        ],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readManifest preserves categorized release note items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bflow-manifest-'));
  const manifestPath = path.join(dir, 'manifest.json');

  await writeFile(manifestPath, JSON.stringify({
    version: '1.23.4',
    buildAt: '2026-05-09T00:00:00.000Z',
    releaseNotes: [
      {
        version: '1.23.4',
        title: '댓글과 최근 작업 차트 표시를 다듬었습니다',
        items: [
          {
            category: 'bugfix',
            summary: '댓글 입력 영역 안정화',
            description: '댓글이 많이 쌓인 상태에서도 입력창과 전송 버튼이 패널 안에 안정적으로 보입니다.',
          },
          '기존 문자열 항목도 계속 표시합니다.',
        ],
      },
    ],
  }), 'utf-8');

  try {
    const manifest = await readManifest(manifestPath);

    assert.deepEqual(manifest?.releaseNotes, [
      {
        version: '1.23.4',
        title: '댓글과 최근 작업 차트 표시를 다듬었습니다',
        items: [
          {
            category: 'bugfix',
            summary: '댓글 입력 영역 안정화',
            description: '댓글이 많이 쌓인 상태에서도 입력창과 전송 버튼이 패널 안에 안정적으로 보입니다.',
          },
          '기존 문자열 항목도 계속 표시합니다.',
        ],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readManifest ignores malformed release note entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bflow-manifest-'));
  const manifestPath = path.join(dir, 'manifest.json');

  await writeFile(manifestPath, JSON.stringify({
    version: '1.22.10',
    buildAt: '2026-05-08T00:00:00.000Z',
    releaseNotes: [
      { version: '1.22.10', title: '정상', items: ['표시할 내용'] },
      { version: '1.22.10', title: '깨진 항목', items: 'not-array' },
      null,
    ],
  }), 'utf-8');

  try {
    const manifest = await readManifest(manifestPath);

    assert.deepEqual(manifest?.releaseNotes, [
      { version: '1.22.10', title: '정상', items: ['표시할 내용'] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
