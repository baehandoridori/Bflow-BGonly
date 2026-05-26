import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import pkg from './package.json';

const rendererOnly = process.env.BFLOW_RENDERER_ONLY === '1';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
});
