/**
 * 화면 검증용 — 미리보기 주소를 **앱과 같은 화면 엔진(Electron)** 으로 연다.
 *
 * 왜: 미리보기를 PC 에 깔린 Chrome 으로만 확인하면 앱과 다른 엔진으로 보게 된다(앱은 Electron 33 = Chromium 130,
 * Chrome 은 그보다 훨씬 새 버전). v1.128.0 에서 캐릭터 현황판 카드 그림이 앱에서만 통째로 사라졌는데,
 * 새 Chrome 에서는 멀쩡해서 검증을 통과했다(<button> 안의 flex 자식이 늘어나는 기본값이 엔진마다 달랐다).
 *
 * 사용:
 *   npm run dev:renderer          # 다른 터미널에서 미리보기 서버(5190)
 *   npm run preview:electron      # 앱 엔진으로 창을 연다
 * 환경변수:
 *   BFLOW_PREVIEW_URL          열 주소 (기본 http://localhost:5190/?preview=1)
 *   BFLOW_PREVIEW_DEBUG_PORT   원격 디버그 포트 — 자동 조작·측정 도구를 붙일 때
 * 주소·포트를 명령줄 인자로 받지 않는다 — Electron 이 스크립트 뒤의 인자를 자기 것으로 읽다가 그대로 꺼지는 경우가 있었다.
 *
 * 실제 앱의 preload 를 싣지 않으므로 화면은 브라우저용 mock 으로 돈다(실제 서버에 쓰지 않는다).
 * 설정·세션 폴더도 설치된 B flow(%APPDATA%\Bflow-BGonly)와 따로 쓴다.
 */
'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

const url = process.env.BFLOW_PREVIEW_URL || 'http://localhost:5190/?preview=1';
const debugPort = process.env.BFLOW_PREVIEW_DEBUG_PORT;

app.setPath('userData', path.join(app.getPath('temp'), 'bflow-preview-electron'));
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: `B flow 미리보기 — Electron ${process.versions.electron} (Chromium ${process.versions.chrome})`,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
