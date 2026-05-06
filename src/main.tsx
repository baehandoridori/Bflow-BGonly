import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';

// v1.20.0: 글꼴 시스템 — 큐레이션 9종 중 8종 (시스템 기본은 OS 글꼴, import 불필요)
// Pretendard Variable: 가변 폰트 1개 파일 → 모든 weight 자동 처리, 가장 효율적
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/gowun-dodum/400.css';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/500.css';
import '@fontsource/noto-serif-kr/700.css';
import 'spoqa-han-sans/css/SpoqaHanSansNeo.css';

import './index.css';
import './styles/path-link.css';
import './styles/activity-widget.css';
import './styles/scene-effects.css';

async function bootstrap() {
  // 브라우저 개발 환경: electronAPI가 없으면 mock 설치
  if (!window.electronAPI && import.meta.env.DEV) {
    const { installDevElectronAPI } = await import('./mocks/devElectronAPI');
    installDevElectronAPI();
  }

  // 해시로 위젯 팝업 모드 감지: #widget-popup/{widgetId}?key=val
  const hash = window.location.hash;
  const popupMatch = hash.match(/^#widget-popup\/([^?]+)(\?.*)?$/);
  const popupParams = popupMatch?.[2]
    ? Object.fromEntries(new URLSearchParams(popupMatch[2]))
    : {};

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {popupMatch ? (
        <WidgetPopup widgetId={decodeURIComponent(popupMatch[1])} extraParams={popupParams} />
      ) : (
        <App />
      )}
    </React.StrictMode>
  );
}

bootstrap();
