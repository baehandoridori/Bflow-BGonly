// 그림판 묶음의 바깥 입구: 엔진(createBoard) · 부품(BoardView, useBoard) · 순수 계산 몇 가지
export { createBoard, localBoardMemory } from './Board';
export type { Board, BoardCallbacks, BoardDraft, BoardElements, BoardFit, BoardMemory, BoardMode, BoardOptions, BoardTool, BoardUi, FillMode, PlaceColor } from './Board';
export { BoardView, useBoard } from './BoardView';
export type { BoardViewProps } from './BoardView';
export { dimsFor, guideCtl, guideFor, tiltLabel, withGuideParam } from './guideMath';
export type { BoardNote } from './notesMath';
export { isPhotoLike } from './image';
