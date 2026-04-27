import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';
import './index.css';
import './styles/path-link.css';
import './styles/activity-widget.css';

// 브라우저 개발 환경: electronAPI가 없으면 mock 설치
// import.meta.env.DEV 를 외곽 if 로 분리해 production 빌드에서 dynamic import 가
// dead-code 로 명확히 제거되도록 한다 (mock 12명 정보가 .exe 번들에 들어가지 않게).
if (import.meta.env.DEV) {
  if (!window.electronAPI) {
    const { installDevElectronAPI } = await import('./mocks/devElectronAPI');
    installDevElectronAPI();
  }
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
