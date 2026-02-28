// ─── 화이트보드 위젯 타입 정의 ───────────────────────────────

export interface StrokePoint {
  x: number;
  y: number;
}

export interface WhiteboardStroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
  layerId: string;
  tool: WhiteboardTool;
  userId: string;
  userName: string;
  timestamp: number;
}

export interface WhiteboardLayer {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

export interface ActiveUser {
  userId: string;
  userName: string;
  lastActive: number;
}

export interface WhiteboardData {
  version: 1;
  layers: WhiteboardLayer[];
  strokes: WhiteboardStroke[];
  canvasWidth: number;
  canvasHeight: number;
  lastModified: number;
  activeUsers?: ActiveUser[];
}

export type WhiteboardTab = 'local' | 'public';
export type WhiteboardTool = 'brush' | 'eraser';
