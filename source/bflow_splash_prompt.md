# Bflow 스플래시 스크린 구현 가이드

## 📁 파일 준비

### 1. 프로젝트에 넣을 에셋 파일

```
bflow/
├── public/
│   ├── splash/
│   │   ├── opening_video.mp4          ← 원본 비디오 (672×592, 24fps, 5초)
│   │   └── opening_image_cropped.png  ← 크롭된 아이콘 이미지 (926×816)
```

> ⚠️ **중요**: `opening_image_cropped.png`은 원본 16:9 이미지가 아니라,
> 비디오 비율(672:592)에 맞춰 중앙 크롭한 버전을 사용해야 합니다.
> (원본 1456×816 → 크롭 926×816)

### 2. 레퍼런스 목업 파일

```
프롬프트와 함께 첨부할 파일:
├── splash_v5.html       ← 동작하는 HTML 목업 (브라우저에서 열어서 확인 가능)
└── 이 파일 (README)     ← 구현 스펙
```

---

## 🎯 Claude Code 프롬프트

아래 프롬프트를 Claude Code에 붙여넣고, `splash_v5.html` 파일을 함께 첨부하세요.

---

### 프롬프트 시작

```
## 요청

Bflow PWA 앱의 스플래시 스크린(앱 로딩 화면) 컴포넌트를 만들어줘.
첨부한 `splash_v5.html` 목업이 완성된 레퍼런스야. 이 HTML의 동작을 그대로 React 컴포넌트로 옮겨줘.

## 기술 스택

- React 18 + TypeScript
- Tailwind CSS
- Framer Motion (애니메이션)

## 에셋 파일 위치

- 비디오: `/splash/opening_video.mp4` (672×592, 24fps, ~5초)
- 이미지: `/splash/opening_image_cropped.png` (926×816, 비디오와 동일 비율로 크롭됨)

두 파일 모두 `public/splash/` 폴더에 있어.

## 핵심 동작 시퀀스 (목업과 동일하게)

1. **0.0s** — 화면 전체 검정, 비디오 재생 시작 (blur 8px + brightness 0.6 + scale 1.05)
2. **0.3s ~ 1.8s** — blur/brightness/scale이 서서히 원래 값으로 (1.5초 ease-out)
3. **0.0s ~ 5.0s** — 비디오 재생 중, 하단에 프로그레스 바 표시
4. **5.0s** — 비디오 종료 → 크로스페이드 (0.8초간 비디오 fade-out + 이미지 fade-in 동시에)
5. **5.7s** — "Bflow" 텍스트 + "B THE FLOW." 태그라인 fade-up 등장 (1.2초)
6. **6.2s** — 프로그레스 바 사라짐
7. **7.0s~** — 스플래시 완료 → 메인 앱으로 전환 (onComplete 콜백)

## 사각형 페더 마스크 (가장 중요한 부분!)

비디오와 이미지 모두에 CSS mask를 적용해서 가장자리가 검정 배경으로 자연스럽게 녹아들어야 해.
원형(radial-gradient)이 아니라 **사각형 페더**야:

```css
/* 두 개의 linear-gradient를 intersect(교집합)해서 사각형 페더 효과 */
-webkit-mask-image:
  linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%),
  linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
mask-image:
  linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%),
  linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
-webkit-mask-composite: destination-in;
mask-composite: intersect;
```

이 마스크가 없으면 비디오/이미지의 직사각형 테두리가 그대로 보여서 어색해.

## 레이어 구조

```
z-index 순서 (아래 → 위):

0: 배경 글로우 (cyan, blue 원형 blur 120px, 느리게 fade-in)
1: 이미지 레이어 (비디오 아래에서 대기, ended 이벤트 후 z-index 3으로)
2: 비디오 레이어 (재생 중 표시, ended 후 fade-out)
10: 텍스트 + 프로그레스 바
```

## 비디오↔이미지 크기 매칭 방법

비디오(672×592)와 이미지(926×816)는 해상도는 다르지만 비율이 같아.
둘 다 같은 컨테이너 안에서 `object-fit: cover`로 채우면 아이콘이 같은 크기로 보여.

```
컨테이너: width: min(420px, 75vmin), aspect-ratio: 672/592
비디오/이미지: position: absolute, inset: -10%, width/height: 120% (페더 여유분)
```

## 디자인 디테일

- 배경: 순수 #000000
- 폰트: 'Outfit' (Google Fonts) - weight 300, 400, 600
- "B" 글자: linear-gradient(135deg, #06D6D6, #3B82F6) 텍스트 그라디언트
- "flow" 글자: white
- 태그라인: rgba(255,255,255,0.45), letter-spacing 0.18em, uppercase
- 프로그레스 바: 2px 높이, linear-gradient(90deg, #06D6D6, #3B82F6)
- 배경 글로우 1: rgba(6,214,214,0.25), 500px, blur 120px
- 배경 글로우 2: rgba(59,130,246,0.15), 350px, blur 120px

## 컴포넌트 인터페이스

```tsx
interface SplashScreenProps {
  onComplete: () => void;  // 스플래시 끝나면 호출 → 메인 앱 마운트
}
```

스플래시가 끝나면 (텍스트 등장 후 약 1.5초 뒤) onComplete를 호출해서
부모 컴포넌트가 메인 앱으로 전환할 수 있게 해줘.

## 주의사항

- 비디오는 반드시 `muted`, `playsInline` 속성 필요 (모바일 자동재생 정책)
- 비디오 로딩 실패 시 → 이미지만 바로 보여주는 폴백
- 이미지 preload 처리 (비디오 재생 중에 미리 로드)
- Framer Motion의 AnimatePresence로 스플래시→앱 전환 처리
- 디버그 패널과 리플레이 버튼은 구현하지 않아도 됨 (목업 전용)
```

### 프롬프트 끝

---

## ✅ 체크리스트

프롬프트 전달 전 확인:

- [ ] `public/splash/opening_video.mp4` 파일 존재
- [ ] `public/splash/opening_image_cropped.png` 파일 존재 (크롭 버전!)
- [ ] `splash_v5.html`을 브라우저에서 열어 동작 확인
- [ ] 프롬프트에 `splash_v5.html` 첨부

## 💡 추가 팁

Claude Code가 만든 결과물에서 확인할 포인트:

1. **크로스페이드 순간** — 아이콘 크기가 점프하지 않는지
2. **페더 마스크** — 사각형인지 (원형이면 안 됨)
3. **모바일** — `playsInline` + `muted` 없으면 iOS에서 자동재생 안 됨
4. **onComplete 타이밍** — 너무 빠르면 텍스트가 안 보이고, 너무 느리면 답답함
