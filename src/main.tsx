import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installMockElectronAPI } from './mocks/electronAPI';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';
import './index.css';

// 브라우저 환경(Electron 없음)이면 mock API 설치
installMockElectronAPI();

// 해시로 위젯 팝업 모드 감지: #widget-popup/{widgetId}?key=val
const hash = window.location.hash;
const popupMatch = hash.match(/^#widget-popup\/([^?]+)(\?.*)?$/);
const popupParams = popupMatch?.[2]
  ? Object.fromEntries(new URLSearchParams(popupMatch[2]))
  : {};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {popupMatch ? (
      <WidgetPopup widgetId={decodeURIComponent(popupMatch[1])} extraParams={popupParams} />
    ) : (
      <App />
    )}
  </StrictMode>
);
