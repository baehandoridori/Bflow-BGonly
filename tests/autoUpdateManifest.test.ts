import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

import { readManifest } from '../electron/autoUpdate/manifest.ts';

test('manifest generation and reading preserve every valid item and the complete version history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bflow-manifest-generator-'));
  const validItems = [
    '기존 문자열 항목',
    ...Array.from({ length: 12 }, (_, index) => ({
      category: 'bugfix', summary: `개선 ${index + 1}`, description: `상세 설명 ${index + 1}`,
    })),
    { category: 'feature', summary: '마지막 항목', description: '이 항목까지 전달해야 합니다.' },
  ];
  const expected = Array.from({ length: 5 }, (_, index) => ({
    version: `1.${115 - index}.0`, title: `릴리스 ${index + 1}`, items: validItems,
  }));
  const notes = expected.map(note => ({
    ...note,
    items: [null, '', '  ', false, 42, {}, { summary: '', description: ' ' }, ...note.items],
  }));
  const installer = Buffer.from('test installer bytes');
  try {
    await mkdir(path.join(dir, 'scripts'));
    await mkdir(path.join(dir, 'DEVLOG'));
    await mkdir(path.join(dir, 'dist', 'win-unpacked'), { recursive: true });
    const generator = path.join(dir, 'scripts', 'generate-manifest.js');
    await copyFile(new URL('../scripts/generate-manifest.js', import.meta.url), generator);
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '1.115.0' }));
    await writeFile(path.join(dir, 'DEVLOG', 'update-notes.json'), JSON.stringify(notes));
    await writeFile(path.join(dir, 'dist', 'BFLOW-Setup.exe'), installer);
    await writeFile(path.join(dir, 'dist', 'win-unpacked', 'app.txt'), 'app');

    const result = spawnSync(process.execPath, [generator], { cwd: dir, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    const manifestPath = path.join(dir, 'dist', 'manifest.json');
    const generated = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(generated.releaseNotes, expected, 'generation must not truncate either items or older versions');
    assert.deepEqual((await readManifest(manifestPath))?.releaseNotes, expected, 'the app must receive the same complete notes');
    assert.deepEqual(generated.installer, { fileName: 'BFLOW-Setup.exe', sizeBytes: installer.length });
    assert.equal(generated.fileCount, 1);
    assert.equal(generated.totalBytes, 3);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('bflow-manifest-generator-'));
    await rm(dir, { recursive: true, force: true });
  }
});

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
