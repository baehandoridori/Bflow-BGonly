import type { LiveList, LiveMap, LiveObject } from '@liveblocks/client';

// ─── 스트로크/레이어 타입 (Liveblocks Storage용) ────────────

export type LbStroke = {
  id: string;
  points: number[];        // [x1,y1,x2,y2,...] 플랫 배열 (네트워크 전송량 절약)
  color: string;
  width: number;
  layerId: string;
  tool: 'brush' | 'eraser';
  userId: string;
  userName: string;
  timestamp: number;
};

export type LbLayer = {
  id: string;
  name: string;
  visible: boolean;
  order: number;
};

// ─── Liveblocks 글로벌 타입 선언 ────────────────────────────

declare global {
  interface Liveblocks {
    Presence: {
      cursor: { x: number; y: number } | null;
      activeTool: 'brush' | 'eraser';
      activeColor: string;
      userName: string;
    };
    Storage: {
      strokes: LiveMap<string, LiveObject<LbStroke>>;
      layers: LiveMap<string, LiveObject<LbLayer>>;
      layerOrder: LiveList<string>;
      canvasWidth: number;
      canvasHeight: number;
    };
    UserMeta: {
      id: string;
      info: { name: string; color: string };
    };
  }
}

// ─── 공개 키 ────────────────────────────────────────────────
// Liveblocks 공개 키 (공개 키이므로 보안 문제 없음)
export const LIVEBLOCKS_PUBLIC_KEY = 'pk_dev_OuH8jZKYDqeobUMETieHXlEUaeoXLKvas1zU_BnZ9tn0efDC6Un8Nd5NgTs0yqC0';
