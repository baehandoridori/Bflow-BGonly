import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import fs from 'fs';
import path from 'path';
import pkg from './package.json';
import { describeVacationTokenSource, resolveVacationToken } from './scripts/vacation-token.cjs';

const rendererOnly = process.env.BFLOW_RENDERER_ONLY === '1';
const workspaceNodeModules = path.resolve(__dirname, 'node_modules');
const realWorkspaceNodeModules = fs.existsSync(workspaceNodeModules)
  ? fs.realpathSync(workspaceNodeModules)
  : workspaceNodeModules;

/**
 * 휴가 API 토큰(x-bflow-token) — 번들에 넣을 값.
 * 셸 환경변수 → 이 폴더의 `.env.local` → (워크트리라면) 메인 체크아웃의 `.env.local` 순서로 찾는다.
 * 워크트리에는 `.env.local` 이 없어서 예전엔 토큰이 빈 채로 빌드됐다(scripts/vacation-token.cjs 머리말).
 * 비어 있어도 개발 빌드는 통과한다 — 배포 빌드(npm run build)는 토큰이 없으면 멈춘다.
 */
function vacationTokenFor(mode: string): string {
  const resolved = resolveVacationToken({ root: __dirname, mode });
  if (!resolved.token) {
    console.warn('[vacation-token] 휴가 연동 토큰 없음 — 이 빌드는 휴가 연동이 되지 않습니다(개발 확인용으로만 쓰세요).');
  } else if (resolved.source === 'main-checkout') {
    console.info(`[vacation-token] 휴가 연동 토큰 출처: ${describeVacationTokenSource(resolved)}`);
  }
  return resolved.token;
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BFLOW_VACATION_TOKEN__: JSON.stringify(vacationTokenFor(mode)),
  },
  plugins: [
    react(),
    ...(!rendererOnly
      ? [
          electron([
            {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  outDir: 'dist-electron',
                  rollupOptions: {
                    external: ['ws', 'bufferutil', 'utf-8-validate', 'googleapis', 'google-auth-library'],
                  },
                },
              },
            },
            {
              entry: 'electron/preload.ts',
              onstart(args) {
                args.reload();
              },
              vite: {
                build: {
                  outDir: 'dist-electron',
                },
              },
            },
          ]),
        ]
      : []),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      allow: [
        __dirname,
        workspaceNodeModules,
        realWorkspaceNodeModules,
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // vendor-react: vite-plugin-electron-renderer가 externalize 처리 → 별도 청크 무의미
        // vendor-supabase: 렌더러에서 직접 import 없음 (메인 프로세스 IPC 경유) → 빈 청크라 제거
        // clsx: 40+ 라우트에서 cn() 경유로 사용되므로 별도 청크로 묶지 않음 (Rollup 자동 청킹에 위임)
        manualChunks: {
          'vendor-grid': ['react-grid-layout'],
          'vendor-motion': ['framer-motion'],
          'vendor-ui': ['lucide-react', 'sonner'],
        },
      },
    },
  },
}));
