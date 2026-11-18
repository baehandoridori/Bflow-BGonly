// BAE경 '다른 각도로' (7단계): 엔진 · 그리는 판 · 깊이 · 창 움직임 · 통로. 창은 windows/AngleWindow.tsx.
export { ANG, type AngleSet, type AngleCam, type AngleView } from './engine';
export { createAngleGL, type AngleGL } from './gl';
export { createWorkerDepth, angleDepthInput, angleDepthReady, type AngleDepth, type AngleDepthFn } from './depth';
export { AngleController, angleMemory, angleFileTarget, guessKind, type AngleTarget, type AngleResultChoice, type AngleHost, type AngleUi } from './controller';
export { baeAngleGateway, type BaeAngleGateway } from './gateway';
export { createPreviewAngleGateway, previewAngleDepth } from './previewAngle';
