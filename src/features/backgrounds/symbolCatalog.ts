import type { BackgroundSymbolKind } from "./types";

export const symbolCatalog: ReadonlyArray<{
  id: BackgroundSymbolKind;
  label: string;
  width: number;
  height: number;
}> = [
  { id: "door", label: "문", width: 100, height: 100 },
  { id: "chair", label: "의자", width: 60, height: 60 },
  { id: "table", label: "테이블", width: 180, height: 110 },
  { id: "bed", label: "침대", width: 130, height: 210 },
  { id: "stairs", label: "계단", width: 120, height: 240 },
  { id: "custom", label: "기타 사물", width: 100, height: 80 },
];

/** Removed presets remain readable in saved maps, but use the generic object everywhere. */
export function getSymbolPreset(symbol: BackgroundSymbolKind) {
  return symbolCatalog.find(item => item.id === symbol) ?? symbolCatalog.find(item => item.id === "custom")!;
}
