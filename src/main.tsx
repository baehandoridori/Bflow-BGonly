import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';
import './index.css';

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
