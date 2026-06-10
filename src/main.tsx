import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WidgetPopup } from './views/WidgetPopup';

// v1.20.0: 글꼴 시스템 — 큐레이션 9종 중 8종 (시스템 기본은 OS 글꼴, import 불필요)
//
// 코덱스 PR #62 3차 P1: @fontsource의 weight별 .css는 *모든 subset*(한자 unified
// ideographs, cyrillic, greek 등)을 포함시켜 빌드 size가 1GB로 폭증. Studio JBBJ
// 사용자는 한국어+영어/숫자 위주이므로 `korean-<weight>.css` + `latin-<weight>.css`
// subset만 명시 import → CJK 한자/cyrillic/greek 등 제외 → 빌드 size 70%+ 감소.
//
// Pretendard Variable: 가변 폰트 1개 파일 → 모든 weight 자동 처리.
import 'pretendard/dist/web/variable/pretendardvariable.css';

// Inter — 영문 우선. latin subset만.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';

// 한국어 폰트들 — korean + latin subset (한자/cyrillic/greek 등 제외).
import '@fontsource/noto-sans-kr/korean-400.css';
import '@fontsource/noto-sans-kr/korean-500.css';
import '@fontsource/noto-sans-kr/korean-700.css';
import '@fontsource/noto-sans-kr/latin-400.css';
import '@fontsource/noto-sans-kr/latin-500.css';
import '@fontsource/noto-sans-kr/latin-700.css';

import '@fontsource/ibm-plex-sans-kr/korean-400.css';
import '@fontsource/ibm-plex-sans-kr/korean-500.css';
import '@fontsource/ibm-plex-sans-kr/korean-700.css';
import '@fontsource/ibm-plex-sans-kr/latin-400.css';
import '@fontsource/ibm-plex-sans-kr/latin-500.css';
import '@fontsource/ibm-plex-sans-kr/latin-700.css';

import '@fontsource/nanum-gothic/korean-400.css';
import '@fontsource/nanum-gothic/korean-700.css';
import '@fontsource/nanum-gothic/latin-400.css';
import '@fontsource/nanum-gothic/latin-700.css';

import '@fontsource/gowun-dodum/korean-400.css';
import '@fontsource/gowun-dodum/latin-400.css';

import '@fontsource/noto-serif-kr/korean-400.css';
import '@fontsource/noto-serif-kr/korean-500.css';
import '@fontsource/noto-serif-kr/korean-700.css';
import '@fontsource/noto-serif-kr/latin-400.css';
import '@fontsource/noto-serif-kr/latin-500.css';
import '@fontsource/noto-serif-kr/latin-700.css';

import './index.css';
import './styles/path-link.css';
import './styles/activity-widget.css';
import './styles/scene-effects.css';
import { hasUsableElectronAPI, installDevElectronAPI } from './mocks/devElectronAPI';

function shouldInstallBrowserElectronMock(): boolean {
  if (hasUsableElectronAPI(window.electronAPI)) return false;
  if (import.meta.env.DEV) return true;

  const localPreviewHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  return localPreviewHosts.has(window.location.hostname);
}

async function bootstrap() {
  // 로컬 브라우저 프리뷰: electronAPI가 없으면 mock 설치
  if (shouldInstallBrowserElectronMock()) {
    installDevElectronAPI();
  }

  // 해시로 위젯 팝업 모드 감지: #widget-popup/{widgetId}?key=val
  const hash = window.location.hash;
  const popupMatch = hash.match(/^#widget-popup\/([^?]+)(\?.*)?$/);
  const popupParams = popupMatch?.[2]
    ? Object.fromEntries(new URLSearchParams(popupMatch[2]))
    : {};
  const feedbackHubPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('preview') === 'feedback-hub';
  const PreviewApp = feedbackHubPreview
    ? (await import('./views/FeedbackHubPreviewApp')).FeedbackHubPreviewApp
    : null;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {popupMatch ? (
        <WidgetPopup widgetId={decodeURIComponent(popupMatch[1])} extraParams={popupParams} />
      ) : PreviewApp ? (
        <PreviewApp />
      ) : (
        <App />
      )}
    </React.StrictMode>
  );
}

bootstrap();
