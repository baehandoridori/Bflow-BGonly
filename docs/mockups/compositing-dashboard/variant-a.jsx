/* ─── 시안 A v3: AE 타임라인 (파트 단위) + LP/Dock 호버 카드 그리드 ──
   상단: AE 타임라인 패널
     - 시간 룰러 / RAM 프리뷰 바 / Work Area 바
     - 4개 파트 = 4개 컴포지션 레이어. 각 레이어 막대 안에 상태 분포를 stacked로 표시
     - 씬은 타임라인에서 안 그림 (창 좁아져도 안 미세해짐)
     - CTI(빨간 플레이헤드)는 가장 마지막 진행 위치
   하단: 파트별 씬 카드 그리드
     - 마우스가 다가가는 카드는 LP/Dock magnification처럼 떠오름 (smoothstep falloff)
     - 클릭 → 살짝 위로 띄워서 floating 고정 (glow + 위로 6px)
     - 떠오른 카드 다시 클릭 → 상세 모달
     - 카드: BG/ACT 두 담당자 + 가이드/실제 두 이미지
   ────────────────────────────────────────────────────────── */

const { Icon, StatusChip, StatusDot, AssigneeAvatar, PartBadge,
        ParticleBurst, DashHeader, StatusLegend, ProgressBar } = window.BF_UI;

// ── 레이아웃 상수 ───────────────────────────
const LAYER_PANEL_W = 200;
const ROW_H = 44;
const RULER_H = 26;
const RAM_BAR_H = 8;
const WORK_AREA_H = 12;

// ──────────────────────────────────────────────────────────────
// 1. AE 타임라인 패널 — 파트 단위 (씬은 막대 안 stacked로만)
// ──────────────────────────────────────────────────────────────

function TimeRuler({ totalSec, ticks = 12 }) {
  return (
    <div style={{
      position: 'relative',
      height: RULER_H,
      background: 'rgb(var(--color-bg-primary) / 0.8)',
      borderBottom: '1px solid rgb(var(--color-bg-border))',
      fontFamily: '"Pretendard Variable", monospace',
      fontSize: 10,
      color: 'rgb(var(--color-text-secondary))',
      letterSpacing: '0.04em',
    }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const frac = i / ticks;
        const sec = Math.round(totalSec * frac);
        const isEdge = i === 0 || i === ticks;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${frac * 100}%`,
            top: 0, bottom: 0,
          }}>
            <div style={{
              position: 'absolute',
              left: 0, bottom: 0,
              width: 1, height: 6,
              background: 'rgb(var(--color-text-secondary) / 0.7)',
            }} />
            <span style={{
              position: 'absolute',
              top: 4,
              left: isEdge && i === ticks ? 'auto' : 4,
              right: isEdge && i === ticks ? 4 : 'auto',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}>
              {window.BF_DATA.fmtTime(sec)}
            </span>
          </div>
        );
      })}
      {Array.from({ length: ticks * 4 }).map((_, i) => {
        if (i % 4 === 0) return null;
        const frac = i / (ticks * 4);
        return (
          <div key={`m${i}`} style={{
            position: 'absolute',
            left: `${frac * 100}%`,
            bottom: 0,
            width: 1, height: 3,
            background: 'rgb(var(--color-text-secondary) / 0.35)',
          }} />
        );
      })}
    </div>
  );
}

function RamPreviewBar({ episode, totalSec }) {
  const segments = [];
  let timeOffset = 0;
  for (const part of episode.parts) {
    const slice = part.duration / part.scenes.length;
    let inner = 0;
    for (const sc of part.scenes) {
      if (sc.compositingStatus === 'done') {
        segments.push({
          left: ((timeOffset + inner) / totalSec) * 100,
          width: (slice / totalSec) * 100,
        });
      }
      inner += slice;
    }
    timeOffset += part.duration;
  }
  return (
    <div style={{
      position: 'relative',
      height: RAM_BAR_H,
      background: 'rgb(var(--color-bg-primary) / 0.9)',
      borderBottom: '1px solid rgb(var(--color-bg-border) / 0.6)',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'repeating-linear-gradient(90deg, rgb(var(--status-done) / 0.15) 0 4px, transparent 4px 8px)',
      }} />
      {segments.map((seg, i) => (
        <div key={i}
          className="bf-wipe-in"
          style={{
            position: 'absolute',
            left: `${seg.left}%`,
            width: `${seg.width}%`,
            top: 1, bottom: 1,
            background: 'rgb(var(--status-done))',
            boxShadow: '0 0 8px rgb(var(--status-done) / 0.55)',
            animationDelay: `${i * 18 + 400}ms`,
          }} />
      ))}
      <span style={{
        position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
        fontSize: 8, fontWeight: 700,
        color: 'rgb(var(--status-done))',
        letterSpacing: '0.1em',
        background: 'rgb(var(--color-bg-primary) / 0.92)',
        padding: '0 4px', pointerEvents: 'none',
      }}>RAM</span>
    </div>
  );
}

function WorkAreaBar({ episode, totalSec }) {
  let firstFrac = null, lastFrac = null;
  let timeOffset = 0;
  for (const part of episode.parts) {
    const slice = part.duration / part.scenes.length;
    let inner = 0;
    for (const sc of part.scenes) {
      if (['combine', 'adjust', 'aggregated'].includes(sc.compositingStatus)) {
        const f1 = (timeOffset + inner) / totalSec;
        const f2 = (timeOffset + inner + slice) / totalSec;
        if (firstFrac === null) firstFrac = f1;
        lastFrac = f2;
      }
      inner += slice;
    }
    timeOffset += part.duration;
  }
  if (firstFrac === null) { firstFrac = 0; lastFrac = 1; }
  return (
    <div style={{
      position: 'relative',
      height: WORK_AREA_H,
      background: 'rgb(var(--color-bg-primary) / 0.6)',
      borderBottom: '1px solid rgb(var(--color-bg-border))',
    }}>
      <div className="bf-wipe-in" style={{
        position: 'absolute',
        left: `${firstFrac * 100}%`,
        width: `${(lastFrac - firstFrac) * 100}%`,
        top: 2, bottom: 2,
        background: 'rgb(var(--status-combine) / 0.42)',
        border: '1px solid rgb(var(--status-combine) / 0.7)',
        borderRadius: 2,
        animationDelay: '600ms',
      }}>
        <div style={{
          position: 'absolute', left: -3, top: -1, bottom: -1,
          width: 6, background: 'rgb(var(--status-combine))',
          borderRadius: '2px 0 0 2px',
          boxShadow: '0 0 6px rgb(var(--status-combine) / 0.7)',
        }} />
        <div style={{
          position: 'absolute', right: -3, top: -1, bottom: -1,
          width: 6, background: 'rgb(var(--status-combine))',
          borderRadius: '0 2px 2px 0',
          boxShadow: '0 0 6px rgb(var(--status-combine) / 0.7)',
        }} />
      </div>
      <span style={{
        position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
        fontSize: 8, fontWeight: 700,
        color: 'rgb(var(--status-combine))',
        letterSpacing: '0.1em',
        background: 'rgb(var(--color-bg-primary) / 0.92)',
        padding: '0 4px', pointerEvents: 'none',
      }}>WORK AREA</span>
    </div>
  );
}

// 파트 막대 — AE 컴포지션 레이어. 막대 내부에 상태 분포 stacked bar
function CompLayerRow({ part, totalSec, timeOffsetSec, idx, dimmed, focused,
                       onHoverPart, onClickPart, isFocusedPart, scrollToPart }) {
  const partColor = `rgb(var(${part.cssVar}))`;
  // 상태별 카운트 (씬 순서 무관, 분포만)
  const counts = window.BF_DATA.STATUSES.reduce((acc, s) => {
    acc[s.id] = part.scenes.filter(sc => sc.compositingStatus === s.id).length;
    return acc;
  }, {});
  const donePct = (counts.done / part.scenes.length) * 100;

  return (
    <div
      className="bf-wipe-in"
      style={{
        position: 'relative',
        height: ROW_H,
        borderBottom: '1px solid rgb(var(--color-bg-border) / 0.5)',
        background: isFocusedPart
          ? `linear-gradient(90deg, rgb(var(${part.cssVar}) / 0.07), transparent 80%)`
          : idx % 2 === 0 ? 'transparent' : 'rgb(var(--color-bg-primary) / 0.3)',
        opacity: dimmed ? 0.45 : 1,
        transition: 'all 240ms',
        cursor: 'pointer',
        animationDelay: `${300 + idx * 80}ms`,
      }}
      onMouseEnter={() => onHoverPart(part.partId)}
      onMouseLeave={() => onHoverPart(null)}
      onClick={(e) => { e.stopPropagation(); onClickPart(part.partId); scrollToPart && scrollToPart(part.partId); }}
    >
      {/* 파트 막대 본체 */}
      <div style={{
        position: 'absolute',
        left: `${(timeOffsetSec / totalSec) * 100}%`,
        width: `${(part.duration / totalSec) * 100}%`,
        top: 6, bottom: 6,
        background: 'rgb(var(--color-bg-primary) / 0.5)',
        border: `1.5px solid ${isFocusedPart ? `rgb(var(${part.cssVar}))` : `rgb(var(${part.cssVar}) / 0.55)`}`,
        borderRadius: 5,
        overflow: 'hidden',
        transition: 'all 220ms var(--easing-out)',
        transform: isFocusedPart ? 'translateY(-1px) scaleY(1.06)' : 'none',
        boxShadow: isFocusedPart
          ? `0 6px 18px rgb(var(--color-shadow) / 0.5), 0 0 18px rgb(var(${part.cssVar}) / 0.55)`
          : `0 1px 4px rgb(var(--color-shadow) / 0.3)`,
      }}>
        {/* 좌측 파트 라벨 컬러 strip */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 4, background: partColor,
        }} />
        {/* 상태 분포 (가로 stacked bar) */}
        <div style={{
          position: 'absolute', left: 4, right: 4, top: 4, bottom: 14,
          display: 'flex', gap: 0,
          borderRadius: 2, overflow: 'hidden',
        }}>
          {window.BF_DATA.STATUSES.map((s) => {
            const c = counts[s.id];
            if (c === 0) return null;
            const w = (c / part.scenes.length) * 100;
            return (
              <div key={s.id}
                title={`${s.label} ${c}`}
                style={{
                  width: `${w}%`,
                  background: `linear-gradient(180deg, rgb(var(${s.cssVar}) / 0.95), rgb(var(${s.cssVar}) / 0.7))`,
                  borderRight: '1px solid rgb(var(--color-bg-primary) / 0.5)',
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {w > 7 && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, color: 'white',
                    textShadow: '0 1px 2px rgb(0 0 0 / 0.5)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{c}</span>
                )}
              </div>
            );
          })}
        </div>
        {/* 하단 라벨 */}
        <div style={{
          position: 'absolute', bottom: 1, left: 6, right: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 9, color: 'rgb(var(--color-text-secondary))',
          fontFamily: 'monospace', letterSpacing: '0.02em',
        }}>
          <span style={{ fontWeight: 700, color: partColor }}>
            {part.partId}파트 · {part.scenes.length}컷
          </span>
          <span>{window.BF_DATA.fmtTime(part.duration)} · 완료 {donePct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function LayerPanel({ episode, focusedPart, hoveredPart, pinnedPart, onHoverPart, onClickPart,
                     soloPart, onSetSolo, mutedParts, onToggleMuted, scrollToPart }) {
  return (
    <div style={{
      width: LAYER_PANEL_W,
      flexShrink: 0,
      borderRight: '1px solid rgb(var(--color-bg-border))',
      background: 'rgb(var(--color-bg-card) / 0.7)',
    }}>
      <div style={{
        height: RULER_H + RAM_BAR_H + WORK_AREA_H,
        borderBottom: '1px solid rgb(var(--color-bg-border))',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '0 10px 4px',
        background: 'rgb(var(--color-bg-primary) / 0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgb(var(--color-text-secondary) / 0.3)' }} />
          <span>COMP NAME</span>
        </div>
      </div>
      {episode.parts.map((part) => {
        const isFocused = focusedPart === part.partId;
        const isPinned = pinnedPart === part.partId;
        const isSolo = soloPart === part.partId;
        const isMuted = mutedParts.includes(part.partId);
        const donePct = (part.scenes.filter(s => s.compositingStatus === 'done').length / part.scenes.length) * 100;
        return (
          <button
            key={part.partId}
            style={{
              all: 'unset',
              display: 'block',
              width: '100%',
              boxSizing: 'border-box',
              height: ROW_H,
              padding: '6px 10px',
              borderBottom: '1px solid rgb(var(--color-bg-border) / 0.5)',
              cursor: 'pointer',
              background: isFocused
                ? `linear-gradient(90deg, rgb(var(${part.cssVar}) / 0.18), transparent 90%)`
                : 'transparent',
              transition: 'all 200ms',
              position: 'relative',
            }}
            onMouseEnter={() => onHoverPart(part.partId)}
            onMouseLeave={() => onHoverPart(null)}
            onClick={() => { onClickPart(part.partId); scrollToPart && scrollToPart(part.partId); }}
          >
            <div style={{
              position: 'absolute', left: 0, top: 4, bottom: 4,
              width: 4, background: `rgb(var(${part.cssVar}))`,
              borderRadius: '0 2px 2px 0',
              boxShadow: isFocused ? `0 0 10px rgb(var(${part.cssVar}) / 0.7)` : 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
              <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
                <span
                  onClick={() => onSetSolo(isSolo ? null : part.partId)}
                  title="Solo"
                  style={{
                    width: 14, height: 14, borderRadius: 2,
                    background: isSolo ? 'rgb(var(--status-adjust))' : 'rgb(var(--color-bg-border) / 0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 800,
                    color: isSolo ? 'rgb(var(--color-bg-primary))' : 'rgb(var(--color-text-secondary))',
                    cursor: 'pointer',
                  }}>S</span>
                <span
                  onClick={() => onToggleMuted(part.partId)}
                  title="Visibility"
                  style={{
                    width: 14, height: 14, borderRadius: 2,
                    background: !isMuted ? 'rgb(var(--color-text-primary) / 0.85)' : 'rgb(var(--color-bg-border) / 0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: !isMuted ? 'rgb(var(--color-bg-primary))' : 'rgb(var(--color-text-secondary))',
                    cursor: 'pointer',
                  }}>
                  <Icon name="eye" size={9} strokeWidth={2.6} />
                </span>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: `rgb(var(${part.cssVar}))`,
                letterSpacing: '0.02em',
              }}>{part.partId}파트</span>
              <span style={{
                fontSize: 9, fontFamily: 'monospace',
                color: 'rgb(var(--color-text-secondary))',
                marginLeft: 'auto',
              }}>{part.scenes.length}컷</span>
            </div>
            <div style={{ marginTop: 4, marginLeft: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                flex: 1, height: 3,
                background: 'rgb(var(--color-bg-border) / 0.4)',
                borderRadius: 999, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${donePct}%`, height: '100%',
                  background: `rgb(var(${part.cssVar}))`,
                  boxShadow: `0 0 6px rgb(var(${part.cssVar}) / 0.5)`,
                  transition: 'width 600ms var(--easing-out)',
                }} />
              </div>
              <span style={{
                fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                color: 'rgb(var(--color-text-primary))',
                minWidth: 26, textAlign: 'right',
              }}>{donePct.toFixed(0)}%</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 2. LP/Dock 호버 카드 그리드
// ──────────────────────────────────────────────────────────────

const CARD_W = 184;
const CARD_GAP = 14;

// 단일 카드 — BG/ACT 두 담당자 + 가이드/실제 두 이미지
function SceneCard({ scene, idx, lift, isPinned, dimmed, onClick, onOpenDetail }) {
  const status = window.BF_DATA.STATUSES.find(s => s.id === scene.compositingStatus);
  const part = window.BF_DATA.PARTS_DEF.find(p => p.id === scene.partId);
  // hover: 카드 직접 호버 시 추가 lift + glow (LP magnification 와 합쳐짐)
  const [hovered, setHovered] = useState(false);
  // lift: 0~1, mouse magnify. hover 시 최소 0.55 보장
  const effectiveLift = Math.max(lift, hovered ? 0.55 : 0);
  const liftPx = effectiveLift * 14 + (isPinned ? 12 : 0) + (hovered ? 4 : 0);
  const scale = 1 + effectiveLift * 0.07 + (isPinned ? 0.04 : 0);
  const isElevated = isPinned || effectiveLift > 0.15;
  const borderColor = isPinned ? `rgb(var(${status.cssVar}))` : isElevated ? `rgb(var(${status.cssVar}) / 0.85)` : 'rgb(var(--color-bg-border))';
  return (
    <div
      data-scene-id={scene.sceneId}
      className="bf-cascade-item"
      style={{
        '--idx': idx,
        width: CARD_W,
        flexShrink: 0,
        position: 'relative',
        zIndex: isPinned ? 50 : hovered ? 35 : isElevated ? 20 : 1,
        transform: `translateY(${-liftPx}px) scale(${scale})`,
        transformOrigin: 'bottom center',
        transition: 'transform 180ms var(--easing-out), filter 180ms',
        filter: dimmed ? 'saturate(0.5) brightness(0.7)' : 'none',
        opacity: dimmed ? 0.35 : 1,
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (isPinned) onOpenDetail(scene);
        else onClick(scene.sceneId);
      }}
    >
      {/* 글로우 */}
      {isElevated && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: 14, zIndex: -1,
          background: `radial-gradient(circle, rgb(var(${status.cssVar}) / ${isPinned ? 0.5 : hovered ? 0.4 : 0.28}), transparent 70%)`,
          filter: 'blur(10px)',
          animation: isPinned ? 'bf-glow-pulse 2s ease-in-out infinite' : 'none',
          '--bf-glow': `var(${status.cssVar})`,
        }} />
      )}

      <div style={{
        background: 'rgb(var(--color-bg-card))',
        border: `1.5px solid ${borderColor}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: isPinned
          ? `0 18px 40px rgb(var(--color-shadow) / 0.6), 0 0 28px rgb(var(${status.cssVar}) / 0.55)`
          : isElevated
            ? `0 10px 26px rgb(var(--color-shadow) / 0.45), 0 0 14px rgb(var(${status.cssVar}) / 0.3)`
            : `0 2px 8px rgb(var(--color-shadow) / 0.25)`,
        transition: 'box-shadow 200ms',
      }}>
        {/* 헤더: 씬 ID + 상태 칩 */}
        <div style={{ padding: '8px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgb(var(--color-text-secondary) / 0.6)' }}>#{scene.partSceneNo}</span>
            <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 800, color: 'rgb(var(--color-text-primary))', letterSpacing: '0.02em' }}>
              {scene.sceneId}
            </span>
          </div>
          <StatusChip statusId={scene.compositingStatus} size="sm" />
        </div>

        {/* 두 이미지 (가이드 + 실제) — 본 앱의 UnifiedSceneCard 패턴 */}
        <div style={{
          margin: '0 10px 6px',
          display: 'flex', gap: 1,
          borderRadius: 6, overflow: 'hidden',
          background: 'rgb(var(--color-bg-border))',
          position: 'relative',
        }}>
          <div style={{ flex: 1, position: 'relative', height: 78, background: 'rgb(var(--color-bg-primary))' }}>
            <img src={scene.guideUrl} alt="guide" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{
              position: 'absolute', top: 3, left: 3,
              fontSize: 8, fontFamily: 'monospace', fontWeight: 700,
              padding: '1px 4px', borderRadius: 3,
              background: 'rgb(var(--color-bg-primary) / 0.85)',
              color: 'rgb(var(--color-text-secondary))',
              letterSpacing: '0.05em',
            }}>가이드</span>
          </div>
          <div style={{ flex: 1, position: 'relative', height: 78, background: 'rgb(var(--color-bg-primary))' }}>
            <img src={scene.finalUrl} alt="final" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{
              position: 'absolute', top: 3, left: 3,
              fontSize: 8, fontFamily: 'monospace', fontWeight: 700,
              padding: '1px 4px', borderRadius: 3,
              background: `rgb(var(${status.cssVar}) / 0.88)`,
              color: 'white',
              letterSpacing: '0.05em',
            }}>실제</span>
          </div>
          {scene.errorKind && (
            <div style={{
              position: 'absolute', bottom: 3, left: 3, right: 3,
              padding: '2px 5px',
              background: 'rgb(var(--status-error) / 0.94)',
              borderRadius: 3, fontSize: 9, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <Icon name="alert" size={9} strokeWidth={3} />{scene.errorKind}
            </div>
          )}
        </div>

        {/* 메모 (있을 때만) */}
        {scene.memo && (
          <div style={{ padding: '0 10px 4px', fontSize: 10, color: 'rgb(217 161 76)', fontStyle: 'italic', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            "{scene.memo}"
          </div>
        )}

        {/* BG/ACT 두 담당자 */}
        <div style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
              padding: '1px 4px', borderRadius: 3,
              background: 'rgb(116 185 255 / 0.18)', color: 'rgb(116 185 255)',
              minWidth: 22, textAlign: 'center',
            }}>BG</span>
            <AssigneeAvatar name={scene.bgAssignee.name} initials={scene.bgAssignee.initials} tone={scene.bgAssignee.tone} size={15} />
            <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-primary))', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scene.bgAssignee.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
              padding: '1px 4px', borderRadius: 3,
              background: 'rgb(245 190 179 / 0.18)', color: 'rgb(245 190 179)',
              minWidth: 22, textAlign: 'center',
            }}>ACT</span>
            <AssigneeAvatar name={scene.actAssignee.name} initials={scene.actAssignee.initials} tone={scene.actAssignee.tone} size={15} />
            <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-primary))', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scene.actAssignee.name}
            </span>
          </div>
        </div>

        {/* 진행도 바 */}
        <div style={{
          height: 3, background: 'rgb(var(--color-bg-border) / 0.4)',
        }}>
          <div style={{
            width: `${scene.progress * 100}%`, height: '100%',
            background: `rgb(var(${status.cssVar}))`,
            boxShadow: `0 0 6px rgb(var(${status.cssVar}) / 0.6)`,
            transition: 'width 600ms var(--easing-out)',
          }} />
        </div>
      </div>

      {/* 핀 상태 힌트 */}
      {isPinned && (
        <div style={{
          position: 'absolute',
          bottom: -22, left: '50%', transform: 'translateX(-50%)',
          fontSize: 9, fontWeight: 700,
          color: `rgb(var(${status.cssVar}))`,
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          textShadow: '0 1px 4px rgb(var(--color-shadow) / 0.5)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Icon name="arrow-right" size={9} strokeWidth={2.5} /> 다시 클릭하면 상세 보기
        </div>
      )}
    </div>
  );
}

// 파트 단위 카드 행 — LP 호버 magnification
function PartCardRow({ part, idx, scenes, focused, hoveredPart, pinnedScene,
                       onClickScene, onOpenDetail, partOffsetIdx, scrollAnchorRef,
                       statusFilter, expanded, onToggleExpanded }) {
  const rowRef = useRef(null);
  const [mouseX, setMouseX] = useState(null);
  const [hovered, setHovered] = useState(false);

  const handleMove = useCallback((e) => {
    if (!rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setMouseX(e.clientX - rect.left);
  }, []);
  const handleLeave = useCallback(() => {
    setMouseX(null);
    setHovered(false);
  }, []);

  const partColor = `rgb(var(${part.cssVar}))`;
  const isDimmed = focused && !hoveredPart && focused !== part.partId;
  const cardRefs = useRef({});

  // 상태 분포 (헤더 인라인 mini bar 용)
  const counts = window.BF_DATA.STATUSES.reduce((acc, s) => {
    acc[s.id] = part.scenes.filter(sc => sc.compositingStatus === s.id).length;
    return acc;
  }, {});
  const donePct = (counts.done / part.scenes.length) * 100;

  const computeLift = useCallback((cardEl) => {
    if (mouseX === null || !cardEl || !rowRef.current) return 0;
    const cardRect = cardEl.getBoundingClientRect();
    const rowRect = rowRef.current.getBoundingClientRect();
    const cardCenterX = cardRect.left - rowRect.left + cardRect.width / 2;
    const dx = Math.abs(mouseX - cardCenterX);
    const max = 200;
    const t = Math.max(0, 1 - dx / max);
    return t * t * (3 - 2 * t);
  }, [mouseX]);

  return (
    <div ref={scrollAnchorRef} data-part-anchor={part.partId} style={{
      padding: expanded ? '12px 28px 36px' : '10px 28px 10px',
      borderBottom: '1px dashed rgb(var(--color-bg-border) / 0.4)',
      opacity: isDimmed ? 0.55 : 1,
      transition: 'opacity 240ms, padding 240ms',
    }}>
      {/* 파트 헤더 — 클릭하면 접고/펴기 */}
      <button
        onClick={onToggleExpanded}
        style={{
          all: 'unset',
          display: 'flex', alignItems: 'center', gap: 12,
          width: '100%',
          marginBottom: expanded ? 14 : 0,
          cursor: 'pointer',
          padding: '4px 0',
          borderRadius: 4,
        }}
        title={expanded ? '파트 접기' : '파트 펼치기'}
      >
        {/* chevron */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18,
          color: 'rgb(var(--color-text-secondary))',
          transition: 'transform 220ms var(--easing-out), color 160ms',
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
        }}>
          <Icon name="chevron-down" size={14} strokeWidth={2.4} />
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 8,
          background: `rgb(var(${part.cssVar}) / 0.22)`,
          color: partColor,
          fontWeight: 800, fontSize: 14, letterSpacing: '0.02em',
          boxShadow: focused === part.partId ? `0 0 0 2px ${partColor}, 0 0 18px rgb(var(${part.cssVar}) / 0.5)` : 'none',
          transition: 'all 240ms',
        }}>{part.partId}</span>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>
          {part.partId}파트
        </h3>
        <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>
          {part.scenes.length}컷 · {window.BF_DATA.fmtTime(part.duration)}
        </span>
        {/* 접혀있을 때 — 인라인 상태 분포 미니 바 */}
        {!expanded && (
          <div style={{
            display: 'flex', height: 6, width: 200, marginLeft: 4,
            borderRadius: 999, overflow: 'hidden',
            background: 'rgb(var(--color-bg-border) / 0.4)',
          }}>
            {window.BF_DATA.STATUSES.map((s) => {
              const w = (counts[s.id] / part.scenes.length) * 100;
              if (w === 0) return null;
              return <div key={s.id} style={{ width: `${w}%`, background: `rgb(var(${s.cssVar}))` }} title={`${s.label} ${counts[s.id]}`} />;
            })}
          </div>
        )}
        {!expanded && (
          <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600 }}>
            완료 {donePct.toFixed(0)}%
          </span>
        )}
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, rgb(var(${part.cssVar}) / 0.5), transparent)` }} />
        {expanded && hovered && mouseX !== null && (
          <span style={{
            fontSize: 9, color: 'rgb(var(--color-text-secondary))',
            letterSpacing: '0.05em',
          }}>👆 LP를 훑듯이 마우스를 움직여보세요</span>
        )}
      </button>

      {/* LP 카드 행 — expanded 일 때만 렌더 */}
      {expanded && (
        <div
          ref={rowRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          onMouseEnter={() => setHovered(true)}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `40px ${CARD_GAP}px`,
            alignItems: 'flex-end',
            paddingTop: 18,
            minHeight: 240,
            animation: 'bf-card-cascade 320ms var(--easing-out)',
          }}
        >
          {part.scenes.map((scene, i) => {
            const cardEl = cardRefs.current[scene.sceneId];
            const lift = computeLift(cardEl);
            const isPinned = pinnedScene === scene.sceneId;
            const isFiltered = statusFilter && scene.compositingStatus !== statusFilter;
            return (
              <div key={scene.sceneId} ref={(el) => { if (el) cardRefs.current[scene.sceneId] = el; }}>
                <SceneCard
                  scene={scene}
                  idx={partOffsetIdx + i}
                  lift={lift}
                  isPinned={isPinned}
                  dimmed={isFiltered && !isPinned}
                  onClick={onClickScene}
                  onOpenDetail={onOpenDetail}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 3. 상세 모달
// ──────────────────────────────────────────────────────────────
function SceneDetailModal({ scene, onClose, viewerIsCompositor }) {
  const status = window.BF_DATA.STATUSES.find(s => s.id === scene.compositingStatus);
  const part = window.BF_DATA.PARTS_DEF.find(p => p.id === scene.partId);
  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0,
        background: 'rgb(var(--color-overlay) / 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        animation: 'bf-card-cascade 240ms var(--easing-out)',
        padding: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92%', maxWidth: 880, maxHeight: '90%',
          background: 'rgb(var(--color-bg-card))',
          border: `1.5px solid rgb(var(${status.cssVar}) / 0.6)`,
          borderRadius: 14,
          boxShadow: `0 30px 80px rgb(var(--color-shadow) / 0.6), 0 0 42px rgb(var(${status.cssVar}) / 0.35)`,
          overflow: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* 헤더 */}
        <div style={{
          padding: '14px 22px',
          borderBottom: '1px solid rgb(var(--color-bg-border))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              padding: '4px 10px',
              background: `rgb(var(${part.cssVar}) / 0.22)`,
              color: `rgb(var(${part.cssVar}))`,
              fontWeight: 800, fontSize: 14, borderRadius: 6,
              letterSpacing: '0.02em',
            }}>{part.partId}파트</span>
            <h2 style={{ margin: 0, fontSize: 22, fontFamily: 'monospace', fontWeight: 800, letterSpacing: '0.03em' }}>
              {scene.sceneId.toUpperCase()}
            </h2>
            <span style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>
              #{scene.partSceneNo} · {scene.duration}s
            </span>
            <StatusChip statusId={scene.compositingStatus} variant="solid" size="lg" />
          </div>
          <button onClick={onClose} style={{
            all: 'unset', cursor: 'pointer',
            width: 32, height: 32, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgb(var(--color-text-secondary))',
            background: 'rgb(var(--color-bg-border) / 0.3)',
            fontSize: 18,
          }} aria-label="닫기">✕</button>
        </div>

        {/* 본문 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, padding: 22 }}>
          {/* 좌측: 두 이미지 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>가이드 · 스토리보드</div>
              <div style={{
                width: '100%', paddingBottom: '56.25%',
                position: 'relative',
                background: 'rgb(var(--color-bg-primary))',
                border: '1px solid rgb(var(--color-bg-border))',
                borderRadius: 8, overflow: 'hidden',
              }}>
                <img src={scene.guideUrl} alt="guide" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: `rgb(var(${status.cssVar}))`, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>실제 컴포지팅</div>
              <div style={{
                width: '100%', paddingBottom: '56.25%',
                position: 'relative',
                background: 'rgb(var(--color-bg-primary))',
                border: `1px solid rgb(var(${status.cssVar}) / 0.5)`,
                borderRadius: 8, overflow: 'hidden',
                boxShadow: `0 0 22px rgb(var(${status.cssVar}) / 0.2)`,
              }}>
                <img src={scene.finalUrl} alt="final" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            </div>
          </div>

          {/* 우측: 메타데이터 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 담당자들 */}
            <div>
              <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>담당자</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: 'rgb(116 185 255 / 0.1)',
                  border: '1px solid rgb(116 185 255 / 0.35)',
                  borderRadius: 8,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                    padding: '2px 6px', borderRadius: 4,
                    background: 'rgb(116 185 255 / 0.25)', color: 'rgb(116 185 255)',
                  }}>BG</span>
                  <AssigneeAvatar name={scene.bgAssignee.name} initials={scene.bgAssignee.initials} tone={scene.bgAssignee.tone} size={26} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{scene.bgAssignee.name}</span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: 'rgb(245 190 179 / 0.1)',
                  border: '1px solid rgb(245 190 179 / 0.35)',
                  borderRadius: 8,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                    padding: '2px 6px', borderRadius: 4,
                    background: 'rgb(245 190 179 / 0.25)', color: 'rgb(245 190 179)',
                  }}>ACT</span>
                  <AssigneeAvatar name={scene.actAssignee.name} initials={scene.actAssignee.initials} tone={scene.actAssignee.tone} size={26} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{scene.actAssignee.name}</span>
                </div>
              </div>
            </div>

            {/* 진행도 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700 }}>진행도</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: `rgb(var(${status.cssVar}))` }}>{(scene.progress * 100).toFixed(0)}%</span>
              </div>
              <ProgressBar value={scene.progress} height={6} statusId={scene.compositingStatus} />
              {scene.revision > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>
                  리비전 {scene.revision}회
                </div>
              )}
            </div>

            {scene.memo && (
              <div>
                <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>메모</div>
                <div style={{
                  padding: '8px 12px',
                  background: 'rgb(var(--color-bg-primary) / 0.5)',
                  border: '1px solid rgb(var(--color-bg-border))',
                  borderRadius: 6,
                  fontSize: 12, fontStyle: 'italic', color: 'rgb(var(--color-text-primary))', lineHeight: 1.55,
                }}>"{scene.memo}"</div>
              </div>
            )}

            {scene.errorKind && (
              <div style={{
                padding: '10px 12px',
                background: 'rgb(var(--status-error) / 0.16)',
                border: '1px solid rgb(var(--status-error) / 0.5)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, color: 'rgb(var(--status-error))', fontWeight: 600,
              }}>
                <Icon name="alert" size={14} />
                {scene.errorKind}
              </div>
            )}

            {/* 상태 변경 (컴포지터 전용) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', letterSpacing: '0.1em', fontWeight: 700 }}>상태 변경</span>
                {!viewerIsCompositor && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'rgb(var(--color-text-secondary))' }}>
                    <Icon name="lock" size={10} /> 담당 컴포지터만 가능
                  </span>
                )}
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5,
                opacity: viewerIsCompositor ? 1 : 0.4,
                pointerEvents: viewerIsCompositor ? 'auto' : 'none',
              }}>
                {window.BF_DATA.STATUSES.map(s => (
                  <button key={s.id} style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    textAlign: 'center',
                    background: s.id === scene.compositingStatus
                      ? `rgb(var(${s.cssVar}) / 0.25)`
                      : 'rgb(var(--color-bg-primary) / 0.5)',
                    border: `1px solid ${s.id === scene.compositingStatus ? `rgb(var(${s.cssVar}))` : 'rgb(var(--color-bg-border) / 0.6)'}`,
                    borderRadius: 6,
                    fontSize: 11, fontWeight: 600,
                    color: `rgb(var(${s.cssVar}))`,
                  }}>{s.short}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 4. 메인 시안 A
// ──────────────────────────────────────────────────────────────
function VariantA({ episode, stats, viewerIsCompositor }) {
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'matrix' | 'cinema'
  const [hoveredPart, setHoveredPart] = useState(null);
  const [pinnedPart, setPinnedPart] = useState(null);
  const [pinnedScene, setPinnedScene] = useState(null); // 떠올린 카드
  const [detailScene, setDetailScene] = useState(null); // 모달 열린 씬
  const [filterStatus, setFilterStatus] = useState(null);
  const [soloPart, setSoloPart] = useState(null);
  const [mutedParts, setMutedParts] = useState([]);
  // 파트별 펼침/접힘 — 기본 모두 펼침
  const [expandedParts, setExpandedParts] = useState(() => new Set(episode.parts.map(p => p.partId)));
  const [mountKey, replay] = window.BF_UI.useMountKey();
  const partAnchorRefs = useRef({});
  const scrollContainerRef = useRef(null);

  const togglePartExpanded = useCallback((partId) => {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  }, []);
  const allExpanded = expandedParts.size === episode.parts.length;
  const toggleAllParts = useCallback(() => {
    setExpandedParts(allExpanded ? new Set() : new Set(episode.parts.map(p => p.partId)));
  }, [allExpanded, episode.parts]);

  const focusedPart = pinnedPart || hoveredPart || soloPart;

  const playheadFrac = useMemo(() => {
    let lastProgress = 0;
    const totalSec = episode.totalDuration;
    let timeOffset = 0;
    for (const part of episode.parts) {
      const slice = part.duration / part.scenes.length;
      let inner = 0;
      for (const sc of part.scenes) {
        if (sc.compositingStatus !== 'batch' && sc.compositingStatus !== 'done') {
          const center = (timeOffset + inner + slice * sc.progress) / totalSec;
          lastProgress = Math.max(lastProgress, center);
        }
        if (sc.compositingStatus === 'done') {
          const end = (timeOffset + inner + slice) / totalSec;
          lastProgress = Math.max(lastProgress, end);
        }
        inner += slice;
      }
      timeOffset += part.duration;
    }
    return lastProgress;
  }, [episode]);

  const totalSec = episode.totalDuration;
  let timeOffsetAcc = 0;
  let segIdxAcc = 0;

  const toggleMuted = (id) => setMutedParts(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);

  const scrollToPart = useCallback((partId) => {
    const anchor = partAnchorRefs.current[partId];
    if (anchor && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const top = anchor.offsetTop - 280; // 타임라인 패널 높이 보정
      container.scrollTo({ top, behavior: 'smooth' });
    }
  }, []);

  // 헤더 우측 툴바 — 뷰 토글 + 일괄 펼치기/접기
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <window.BF_UI.ViewModeToggle value={viewMode} onChange={setViewMode} />
      {viewMode === 'timeline' && (
        <button
          onClick={toggleAllParts}
          title={allExpanded ? '모든 파트 접기' : '모든 파트 펼치기'}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 11, fontWeight: 600,
            color: 'rgb(var(--color-text-secondary))',
            background: 'rgb(var(--color-bg-card))',
            border: '1px solid rgb(var(--color-bg-border))',
            transition: 'all 160ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgb(var(--color-text-primary))'; e.currentTarget.style.borderColor = 'rgb(var(--color-accent) / 0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgb(var(--color-text-secondary))'; e.currentTarget.style.borderColor = 'rgb(var(--color-bg-border))'; }}
        >
          <Icon name={allExpanded ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} />
          {allExpanded ? '모두 접기' : '모두 펼치기'}
        </button>
      )}
    </div>
  );

  // viewMode 분기 — matrix / cinema 면 해당 시안 렌더 (헤더 toolbar 그대로 전달)
  if (viewMode === 'matrix') {
    return <window.BF_VariantB episode={episode} stats={stats} viewerIsCompositor={viewerIsCompositor} toolbar={toolbar} />;
  }
  if (viewMode === 'cinema') {
    return <window.BF_VariantC episode={episode} stats={stats} viewerIsCompositor={viewerIsCompositor} toolbar={toolbar} />;
  }

  return (
    <div className="bf-dash" key={mountKey} data-screen-label="시안A AE 타임라인 + LP 카드" style={{
      width: '100%', height: '100%',
      background: 'rgb(var(--color-bg-primary))',
      color: 'rgb(var(--color-text-primary))',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <DashHeader episode={episode} viewerIsCompositor={viewerIsCompositor} onReplay={replay} toolbar={toolbar} />

      <div ref={scrollContainerRef} className="bf-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} onClick={() => setPinnedScene(null)}>
        {/* 상태 범례 */}
        <div style={{ padding: '10px 28px 8px' }}>
          <StatusLegend stats={stats} activeStatus={filterStatus} onToggle={(id) => setFilterStatus(s => s === id ? null : id)} />
        </div>

        {/* AE 타임라인 패널 */}
        <div style={{
          margin: '8px 28px 8px',
          background: 'rgb(var(--color-bg-card))',
          border: '1px solid rgb(var(--color-bg-border))',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 8px 24px rgb(var(--color-shadow) / 0.3)',
          display: 'flex',
        }}>
          <LayerPanel
            episode={episode}
            focusedPart={focusedPart}
            hoveredPart={hoveredPart}
            pinnedPart={pinnedPart}
            onHoverPart={setHoveredPart}
            onClickPart={(p) => setPinnedPart(prev => prev === p ? null : p)}
            soloPart={soloPart}
            onSetSolo={setSoloPart}
            mutedParts={mutedParts}
            onToggleMuted={toggleMuted}
            scrollToPart={scrollToPart}
          />

          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <TimeRuler totalSec={totalSec} />
            <RamPreviewBar episode={episode} totalSec={totalSec} />
            <WorkAreaBar episode={episode} totalSec={totalSec} />

            <div style={{ position: 'relative' }}>
              {episode.parts.map((part, i) => {
                const startIdx = segIdxAcc;
                const startOffset = timeOffsetAcc;
                segIdxAcc += part.scenes.length;
                timeOffsetAcc += part.duration;
                const isMuted = mutedParts.includes(part.partId);
                const isSolod = soloPart !== null;
                const isDimmed = isMuted || (isSolod && soloPart !== part.partId);
                return (
                  <CompLayerRow
                    key={part.partId}
                    part={part}
                    totalSec={totalSec}
                    timeOffsetSec={startOffset}
                    idx={i}
                    dimmed={isDimmed}
                    isFocusedPart={focusedPart === part.partId}
                    onHoverPart={setHoveredPart}
                    onClickPart={(p) => setPinnedPart(prev => prev === p ? null : p)}
                    scrollToPart={scrollToPart}
                  />
                );
              })}

              {/* CTI 플레이헤드 */}
              <div style={{
                position: 'absolute',
                left: `${playheadFrac * 100}%`,
                top: -(RULER_H + RAM_BAR_H + WORK_AREA_H),
                bottom: 0,
                width: 1,
                background: 'rgb(229 57 53)',
                boxShadow: '0 0 8px rgb(229 57 53 / 0.7)',
                pointerEvents: 'none',
                zIndex: 50,
                animation: 'bf-wipe-in 700ms var(--easing-out) 200ms both',
                transformOrigin: 'top center',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: -6,
                  width: 13, height: 14,
                  background: 'rgb(229 57 53)',
                  clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                  filter: 'drop-shadow(0 1px 3px rgb(229 57 53 / 0.5))',
                }} />
                <div style={{
                  position: 'absolute', top: -3, left: 6,
                  fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                  color: 'rgb(229 57 53)',
                  background: 'rgb(var(--color-bg-card))',
                  padding: '1px 4px', borderRadius: 2,
                  whiteSpace: 'nowrap',
                  border: '1px solid rgb(229 57 53)',
                }}>{window.BF_DATA.fmtTime(Math.round(totalSec * playheadFrac))}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 안내 띠 */}
        <div style={{
          margin: '0 28px 8px',
          padding: '8px 14px',
          background: 'rgb(var(--color-bg-card) / 0.5)',
          border: '1px solid rgb(var(--color-bg-border) / 0.5)',
          borderRadius: 6,
          fontSize: 10.5,
          color: 'rgb(var(--color-text-secondary))',
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span><strong style={{ color: 'rgb(var(--status-done))' }}>■ RAM</strong> 완료 캐시</span>
          <span><strong style={{ color: 'rgb(var(--status-combine))' }}>■ Work Area</strong> 진행중 영역</span>
          <span><strong style={{ color: 'rgb(229 57 53)' }}>│ CTI</strong> 최신 진행 위치</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>레이어 클릭 → 아래 카드 영역으로 점프 / S → 솔로 / 👁 → 가리기</span>
        </div>

        {/* 파트별 씬 카드 그리드 (LP 호버) */}
        <div>
          {episode.parts.map((part, pi) => {
            const baseOffset = pi * 30;
            return (
              <PartCardRow
                key={part.partId}
                part={part}
                idx={pi}
                scenes={part.scenes}
                focused={focusedPart}
                hoveredPart={hoveredPart}
                pinnedScene={pinnedScene}
                onClickScene={(id) => setPinnedScene(prev => prev === id ? null : id)}
                onOpenDetail={(scene) => setDetailScene(scene)}
                partOffsetIdx={baseOffset}
                scrollAnchorRef={(el) => { if (el) partAnchorRefs.current[part.partId] = el; }}
                statusFilter={filterStatus}
                expanded={expandedParts.has(part.partId)}
                onToggleExpanded={() => togglePartExpanded(part.partId)}
              />
            );
          })}
        </div>
      </div>

      {/* 상세 모달 */}
      {detailScene && (
        <SceneDetailModal
          scene={detailScene}
          onClose={() => setDetailScene(null)}
          viewerIsCompositor={viewerIsCompositor}
        />
      )}
    </div>
  );
}

Object.assign(window, { BF_VariantA: VariantA });
