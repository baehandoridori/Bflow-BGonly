import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';
import './index.css';

// 해시로 위젯 팝업 모드 감지: #widget-popup/{widgetId}
const hash = window.location.hash;
const popupMatch = hash.match(/^#widget-popup\/(.+)$/);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popupMatch ? (
      <WidgetPopup widgetId={decodeURIComponent(popupMatch[1])} />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
