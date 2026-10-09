import type { BackgroundSymbolKind } from "./types";
import { getSymbolPreset } from "./symbolCatalog";

export interface BackgroundSymbolGlyphProps {
  symbol: BackgroundSymbolKind;
  hinge?: "left" | "right";
  swing?: "inward" | "outward";
}

/** Top-down symbols share a 100 × 100 box so map placements can resize them. */
export function BackgroundSymbolGlyph({
  symbol: storedSymbol,
  hinge = "left",
  swing = "inward",
}: BackgroundSymbolGlyphProps) {
  const symbol = getSymbolPreset(storedSymbol).id;
  return (
    <g
      className="bg-symbol-glyph"
      pointerEvents="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {symbol === "door" && (
        <g
          transform={`translate(${hinge === "right" ? 100 : 0} ${swing === "outward" ? 100 : 0}) scale(${hinge === "right" ? -1 : 1} ${swing === "outward" ? -1 : 1})`}
        >
          <path d="M8 92H92" opacity={0.4} />
          <path d="M92 92A84 84 0 0 0 8 8" strokeDasharray="5 5" opacity={0.75} />
          <path d="M69 43L67 33L77 35" />
          <path d="M8 92V8" strokeWidth={5} />
          <circle cx={8} cy={92} r={4} fill="currentColor" stroke="none" />
        </g>
      )}
      {symbol === "chair" && (
        <>
          <rect x={14} y={7} width={72} height={18} rx={6} fill="currentColor" fillOpacity={0.13} />
          <rect x={16} y={32} width={68} height={54} rx={9} fill="currentColor" fillOpacity={0.07} />
          <path d="M23 25V32M77 25V32M23 86V94M77 86V94" />
        </>
      )}
      {symbol === "table" && (
        <>
          <rect x={5} y={9} width={90} height={82} rx={12} fill="currentColor" fillOpacity={0.07} />
          <path d="M15 29V21Q15 19 17 19H26M74 19H83Q85 19 85 21V29M15 71V79Q15 81 17 81H26M74 81H83Q85 81 85 79V71" opacity={0.5} />
        </>
      )}
      {symbol === "bed" && (
        <>
          <rect x={9} y={5} width={82} height={90} rx={3} fill="currentColor" fillOpacity={0.07} />
          <path d="M9 13H91M9 40H91M9 49H91" />
          <rect x={18} y={20} width={27} height={14} rx={3} />
          <rect x={55} y={20} width={27} height={14} rx={3} />
          <path d="M19 86H81" opacity={0.45} />
        </>
      )}
      {symbol === "stairs" && (
        <>
          <rect x={10} y={4} width={80} height={92} fill="currentColor" fillOpacity={0.06} />
          <path d="M10 19.33H90M10 34.67H90M10 50H90M10 65.33H90M10 80.67H90" strokeWidth={2} opacity={0.65} />
          <path d="M50 86V16M40 28L50 14L60 28" />
          <circle cx={50} cy={88} r={3.5} fill="currentColor" stroke="none" />
        </>
      )}
      {symbol === "custom" && (
        <>
          <rect x={7} y={10} width={86} height={80} rx={5} fill="currentColor" fillOpacity={0.05} strokeDasharray="7 5" />
          <path d="M38 50H62M50 38V62" opacity={0.65} />
        </>
      )}
    </g>
  );
}

export function SymbolIcon({
  symbol,
  size = 24,
}: {
  symbol: BackgroundSymbolKind;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="-8 -8 116 116" aria-hidden="true" focusable="false">
      <BackgroundSymbolGlyph symbol={symbol} />
    </svg>
  );
}
