// 렌더러 전용 dev 서버 — Electron 플러그인을 끄고 (BFLOW_RENDERER_ONLY=1) Vite 만 인-프로세스로 구동.
// 브라우저 preview(?preview=1) 검증용. 운영 빌드/Electron 실행과 무관.
process.env.BFLOW_RENDERER_ONLY = '1';
const { createServer } = await import('vite');
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  server: { port, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
server.printUrls();
