/* ─── 시안 C: 시네마틱 컴포지팅 룸 ─────────────────────────
   영화 후반작업 부스 분위기. 어두운 톤 + 미세 그레인 + 상태 글로우.
   각 씬 카드는 본인 상태 색의 후광을 항상 두르고 있어,
   한눈에 "어느 컷이 어떤 상태인지" 색으로 파악 가능.
   파트는 좌측 트랙 메뉴로 / 우측에 큰 모니터 프리뷰.
   ────────────────────────────────────────────────────────── */

const { Icon, StatusChip, StatusDot, AssigneeAvatar, PartBadge,
        ParticleBurst, DashHeader, StatusLegend, ProgressBar } = window.BF_UI;

// ── 미세 그레인 + 라이트 리크 배경 ───────────────────────
function CinemaBackdrop() {
  return (
    <>
      {/* 라이트 리크 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.4,
        background: `
          radial-gradient(ellipse 600px 400px at 15% 5%, rgb(var(--color-accent) / 0.12), transparent 60%),
          radial-gradient(ellipse 700px 500px at 100% 100%, rgb(var(--color-accent-sub) / 0.08), transparent 65%)
        `,
        zIndex: 0,
      }} />
      {/* 미세 그레인 (CSS 노이즈) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.04,
        mixBlendMode: 'overlay',
        zIndex: 0,
        background: 'url("data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='3'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.7'/></svg>`) + '")',
      }} />
      {/* 스캔라인 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.03,
        zIndex: 0,
        background: 'repeating-linear-gradient(180deg, transparent 0, transparent 2px, currentColor 2px, currentColor 3px)',
        color: 'rgb(var(--color-text-primary))',
      }} />
    </>
  );
}

// ── 씬 카드 (콘스텔레이션 모드) ──────────────────────
function ConstellationCard({ scene, idx, dimmed, isHovered, isPinned, onHover, onClick, focusedScene }) {
  const status = window.BF_DATA.STATUSES.find(s => s.id === scene.compositingStatus);
  const part = window.BF_DATA.PARTS_DEF.find(p => p.id === scene.partId);
  const isFocused = isHovered || isPinned;

  // 카드마다 미세한 회전 — 매번 동일하도록 sceneId 기반
  const seed = scene.sceneId.charCodeAt(scene.sceneId.length - 1) + scene.sceneId.charCodeAt(0);
  const rotate = ((seed % 5) - 2) * 0.6;
  const yOffset = ((seed % 4)) * 2;

  return (
    <div
      className="bf-cascade-item"
      style={{
        '--idx': idx,
        position: 'relative',
        width: 92,
        flexShrink: 0,
        marginLeft: idx === 0 ? 0 : -8,
        zIndex: isFocused ? 50 : 1,
        transition: 'all 320ms var(--easing-out)',
        transform: isFocused
          ? `translateY(-14px) scale(1.18) rotate(0deg)`
          : `translateY(${yOffset}px) rotate(${rotate}deg)`,
        opacity: dimmed && !isFocused ? 0.28 : 1,
        filter: dimmed && !isFocused ? 'blur(0.8px) saturate(0.5)' : 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={() => onHover(scene.sceneId)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(scene.sceneId); }}
    >
      {/* 상태 후광 — 항상 있는 ambient glow */}
      <div style={{
        position: 'absolute',
        inset: -3,
        borderRadius: 11,
        background: `radial-gradient(circle, rgb(var(${status.cssVar}) / ${isFocused ? 0.55 : 0.22}), transparent 70%)`,
        filter: 'blur(8px)',
        zIndex: -1,
        animation: isPinned ? 'bf-glow-pulse 1.8s ease-in-out infinite' : 'none',
        '--bf-glow': `var(${status.cssVar})`,
        transition: 'all 300ms',
      }} />

      <div style={{
        position: 'relative',
        background: 'rgb(var(--color-bg-card))',
        border: `1.5px solid rgb(var(${status.cssVar}) / ${isFocused ? 1 : 0.6})`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: isFocused
          ? `0 16px 38px rgb(var(--color-shadow) / 0.65), 0 0 32px rgb(var(${status.cssVar}) / 0.55)`
          : `0 3px 10px rgb(var(--color-shadow) / 0.4), 0 0 12px rgb(var(${status.cssVar}) / 0.22)`,
      }}>
        {/* 썸네일 */}
        <div style={{
          position: 'relative',
          width: '100%',
          paddingBottom: '70%',
          background: 'rgb(var(--color-bg-primary))',
          overflow: 'hidden',
        }}>
          <img src={scene.thumbnail} alt={scene.sceneId} draggable={false}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover',
              filter: isFocused ? 'brightness(1.1) saturate(1.1)' : 'brightness(0.92)',
              transition: 'all 320ms',
            }} />
          {/* Vignette */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 50%, rgb(0 0 0 / 0.35) 100%)',
            pointerEvents: 'none',
          }} />
          {/* 좌상단 파트 점 */}
          <div style={{
            position: 'absolute', top: 4, left: 4,
            width: 6, height: 6, borderRadius: 999,
            background: `rgb(var(${part.cssVar}))`,
            boxShadow: `0 0 6px rgb(var(${part.cssVar}) / 0.7)`,
          }} />
          {/* 우상단 상태 아이콘 */}
          <div style={{
            position: 'absolute', top: 4, right: 4,
            width: 14, height: 14, borderRadius: 999,
            background: `rgb(var(${status.cssVar}))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: `0 0 8px rgb(var(${status.cssVar}) / 0.7)`,
          }}>
            <Icon name={status.icon} size={8} strokeWidth={3} />
          </div>
          {/* 씬 ID — 모노 폰트 */}
          <div style={{
            position: 'absolute', bottom: 3, left: 4,
            fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
            color: 'white',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            letterSpacing: '0.05em',
          }}>
            {scene.sceneId.toUpperCase()}
          </div>
          {scene.errorKind && (
            <div style={{
              position: 'absolute', bottom: 3, right: 3,
              padding: '1px 4px',
              background: 'rgb(var(--status-error))',
              borderRadius: 3, fontSize: 7.5, fontWeight: 800,
              color: 'white',
              letterSpacing: '0.02em',
            }}>!</div>
          )}
        </div>
        {/* 푸터 */}
        <div style={{
          padding: '4px 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: `linear-gradient(180deg, rgb(var(${status.cssVar}) / 0.08), rgb(var(${status.cssVar}) / 0.16))`,
        }}>
          <AssigneeAvatar name={scene.assignee} initials={scene.assigneeInitials} tone={scene.assigneeTone} size={14} />
          <span style={{ fontSize: 9, color: 'rgb(var(--color-text-secondary))', fontFamily: 'monospace' }}>
            {scene.duration}s
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 좌측 파트 트랙 (필터 패널) ──────────────────────────
function PartTracks({ episode, focusedPart, hoveredPart, pinnedPart, onHoverPart, onClickPart }) {
  return (
    <div style={{
      width: 170,
      flexShrink: 0,
      padding: '14px 14px 14px 28px',
      borderRight: '1px solid rgb(var(--color-bg-border) / 0.5)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4,
      }}>
        에피소드 파트
      </div>
      {episode.parts.map((part) => {
        const isFocused = focusedPart === part.partId;
        const isHovered = hoveredPart === part.partId;
        const isPinned = pinnedPart === part.partId;
        const isDimmed = focusedPart && !isFocused;
        const donePct = (part.scenes.filter(s => s.compositingStatus === 'done').length / part.scenes.length) * 100;
        return (
          <button
            key={part.partId}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '10px 12px',
              borderRadius: 9,
              background: isFocused
                ? `linear-gradient(135deg, rgb(var(${part.cssVar}) / 0.25), rgb(var(${part.cssVar}) / 0.08))`
                : 'rgb(var(--color-bg-card) / 0.7)',
              border: `1px solid ${isFocused ? `rgb(var(${part.cssVar}))` : 'rgb(var(--color-bg-border) / 0.6)'}`,
              transition: 'all 200ms var(--easing-out)',
              opacity: isDimmed ? 0.5 : 1,
              boxShadow: isFocused ? `0 0 22px rgb(var(${part.cssVar}) / 0.4)` : 'none',
              transform: isFocused ? 'translateX(4px)' : 'translateX(0)',
              display: 'block',
              position: 'relative',
            }}
            onMouseEnter={() => onHoverPart(part.partId)}
            onMouseLeave={() => onHoverPart(null)}
            onClick={() => onClickPart(part.partId)}
          >
            {/* 좌측 액센트 바 */}
            <div style={{
              position: 'absolute',
              left: -1, top: 8, bottom: 8,
              width: 3, borderRadius: 999,
              background: `rgb(var(${part.cssVar}))`,
              boxShadow: isFocused ? `0 0 10px rgb(var(${part.cssVar}) / 0.8)` : 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 22, fontWeight: 800,
                color: `rgb(var(${part.cssVar}))`,
                lineHeight: 1,
              }}>{part.partId}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))', fontWeight: 500 }}>
                {part.scenes.length}컷
              </span>
              {isPinned && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 9, fontWeight: 700,
                  color: `rgb(var(${part.cssVar}))`,
                  letterSpacing: '0.05em',
                }}>고정</span>
              )}
            </div>
            <div style={{
              height: 3, background: 'rgb(var(--color-bg-border) / 0.4)',
              borderRadius: 999, overflow: 'hidden',
            }}>
              <div style={{
                width: `${donePct}%`,
                height: '100%',
                background: `rgb(var(${part.cssVar}))`,
                boxShadow: `0 0 6px rgb(var(${part.cssVar}) / 0.6)`,
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgb(var(--color-text-secondary))' }}>
                {window.BF_DATA.fmtTime(part.duration)}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgb(var(--color-text-primary))', fontVariantNumeric: 'tabular-nums' }}>
                {donePct.toFixed(0)}%
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── 우측 모니터 프리뷰 (포커스된 씬 / 없으면 진행 요약) ────
function CinemaPreview({ episode, stats, focusedScene, viewerIsCompositor }) {
  if (focusedScene) {
    const status = window.BF_DATA.STATUSES.find(s => s.id === focusedScene.compositingStatus);
    const part = window.BF_DATA.PARTS_DEF.find(p => p.id === focusedScene.partId);
    return (
      <div style={{
        width: 280,
        flexShrink: 0,
        padding: '14px 28px 14px 14px',
        borderLeft: '1px solid rgb(var(--color-bg-border) / 0.5)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          포커스 모니터
        </div>
        <div style={{
          width: '100%',
          paddingBottom: '56.25%',
          position: 'relative',
          background: 'rgb(var(--color-bg-primary))',
          borderRadius: 6,
          overflow: 'hidden',
          border: `1px solid rgb(var(${status.cssVar}) / 0.6)`,
          boxShadow: `0 0 28px rgb(var(${status.cssVar}) / 0.3)`,
        }}>
          <img src={focusedScene.thumbnail} alt={focusedScene.sceneId} draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 30%, rgb(0 0 0 / 0.5) 100%)' }} />
          <div style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 7px',
            background: `rgb(var(${part.cssVar}) / 0.9)`,
            color: 'white',
            fontSize: 10, fontWeight: 700, borderRadius: 4,
          }}>{focusedScene.partId}파트</div>
          <div style={{
            position: 'absolute', bottom: 6, left: 6,
            fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: 'white',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)', letterSpacing: '0.05em',
          }}>{focusedScene.sceneId.toUpperCase()}</div>
          <div style={{ position: 'absolute', bottom: 6, right: 6 }}>
            <StatusChip statusId={focusedScene.compositingStatus} variant="solid" size="sm" />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))' }}>담당</span>
            <AssigneeAvatar name={focusedScene.assignee} initials={focusedScene.assigneeInitials} tone={focusedScene.assigneeTone} size={18} withName />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))' }}>씬 길이</span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgb(var(--color-text-primary))', fontWeight: 600 }}>{focusedScene.duration}s</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))' }}>진행도</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: `rgb(var(${status.cssVar}))` }}>{(focusedScene.progress * 100).toFixed(0)}%</span>
          </div>
          {focusedScene.memo && (
            <div style={{
              padding: '6px 9px',
              background: 'rgb(var(--color-bg-card))',
              border: '1px solid rgb(var(--color-bg-border) / 0.6)',
              borderRadius: 5,
              fontSize: 11, color: 'rgb(var(--color-text-secondary))', lineHeight: 1.5,
              fontStyle: 'italic',
            }}>
              "{focusedScene.memo}"
            </div>
          )}
          {focusedScene.errorKind && (
            <div style={{
              padding: '6px 9px',
              background: 'rgb(var(--status-error) / 0.16)',
              border: '1px solid rgb(var(--status-error) / 0.5)',
              borderRadius: 5,
              fontSize: 11, color: 'rgb(var(--status-error))', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon name="alert" size={11} />
              {focusedScene.errorKind}
            </div>
          )}
        </div>
        {viewerIsCompositor && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>
              상태 변경
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {window.BF_DATA.STATUSES.map(s => (
                <button key={s.id} style={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  background: s.id === focusedScene.compositingStatus
                    ? `rgb(var(${s.cssVar}) / 0.22)`
                    : 'rgb(var(--color-bg-card))',
                  border: `1px solid ${s.id === focusedScene.compositingStatus ? `rgb(var(${s.cssVar}))` : 'rgb(var(--color-bg-border) / 0.5)'}`,
                  borderRadius: 5,
                  fontSize: 10, textAlign: 'center', fontWeight: 600,
                  color: `rgb(var(${s.cssVar}))`,
                }}>
                  {s.short}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  // 포커스 없음 — 진행 요약
  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      padding: '14px 28px 14px 14px',
      borderLeft: '1px solid rgb(var(--color-bg-border) / 0.5)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        전체 진행 요약
      </div>
      {/* 원형 도넛 */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <Donut stats={stats} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {window.BF_DATA.STATUSES.map(s => {
          const c = stats.byStatus[s.id];
          const pct = stats.total > 0 ? (c / stats.total) * 100 : 0;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot statusId={s.id} size={8} />
              <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))', flex: 1 }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: `rgb(var(${s.cssVar}))`, fontVariantNumeric: 'tabular-nums' }}>{c}</span>
              <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary) / 0.7)', minWidth: 28, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div style={{
        marginTop: 8,
        padding: '8px 10px',
        background: 'rgb(var(--color-bg-card) / 0.7)',
        border: '1px solid rgb(var(--color-bg-border) / 0.5)',
        borderRadius: 6,
        fontSize: 10, color: 'rgb(var(--color-text-secondary))', lineHeight: 1.55,
      }}>
        <strong style={{ color: 'rgb(var(--color-text-primary))', fontSize: 11 }}>인터랙션</strong><br />
        파트 트랙을 호버하면 해당 컷이 부각됩니다.<br />
        씬 카드를 호버 → 우측 모니터에서 미리보기.<br />
        클릭 → 고정.
      </div>
    </div>
  );
}

// ── 작은 도넛 SVG ──────────────────────────────
function Donut({ stats }) {
  const size = 140;
  const r = 56;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke="rgb(var(--color-bg-border) / 0.4)" strokeWidth="14" />
      {window.BF_DATA.STATUSES.map((s) => {
        const v = stats.byStatus[s.id] / stats.total;
        const offset = (acc / stats.total) * C;
        const len = v * C;
        acc += stats.byStatus[s.id];
        return (
          <circle key={s.id}
            cx={cx} cy={cy} r={r} fill="none"
            stroke={`rgb(var(${s.cssVar}))`}
            strokeWidth="14"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'all 600ms var(--easing-out)' }}
          />
        );
      })}
      <text x={cx} y={cy - 2} textAnchor="middle"
        fill="rgb(var(--color-text-primary))" fontSize="22" fontWeight="800"
        style={{ fontVariantNumeric: 'tabular-nums' }}>
        {(stats.overall * 100).toFixed(0)}
        <tspan fontSize="11" dy="-3" fill="rgb(var(--color-text-secondary))">%</tspan>
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle"
        fill="rgb(var(--color-text-secondary))" fontSize="9" letterSpacing="0.1em">
        완료
      </text>
    </svg>
  );
}

// ── 메인 시안 C ────────────────────────────────────────
function VariantC({ episode, stats, viewerIsCompositor, toolbar }) {
  const [hoveredPart, setHoveredPart] = useState(null);
  const [pinnedPart, setPinnedPart] = useState(null);
  const [hoveredScene, setHoveredScene] = useState(null);
  const [pinnedScene, setPinnedScene] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [mountKey, replay] = window.BF_UI.useMountKey();
  const focusedPart = pinnedPart || hoveredPart;

  const focusedScene = useMemo(() => {
    const id = hoveredScene || pinnedScene;
    if (!id) return null;
    for (const p of episode.parts) {
      const f = p.scenes.find(s => s.sceneId === id);
      if (f) return f;
    }
    return null;
  }, [hoveredScene, pinnedScene, episode]);

  let offsetIdx = 0;

  return (
    <div className="bf-dash" key={mountKey} data-screen-label="시안C 시네마틱" style={{
      width: '100%', height: '100%',
      background: 'rgb(var(--color-bg-primary))',
      color: 'rgb(var(--color-text-primary))',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <CinemaBackdrop />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <DashHeader episode={episode} viewerIsCompositor={viewerIsCompositor} onReplay={replay} toolbar={toolbar} />

        {/* 상태 범례 (가운데) */}
        <div style={{ padding: '12px 28px 6px' }}>
          <StatusLegend stats={stats} activeStatus={filterStatus} onToggle={(id) => setFilterStatus(s => s === id ? null : id)} />
        </div>

        {/* 본 영역: 좌 트랙 / 중앙 씬 캔버스 / 우 모니터 */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <PartTracks
            episode={episode}
            focusedPart={focusedPart}
            hoveredPart={hoveredPart}
            pinnedPart={pinnedPart}
            onHoverPart={setHoveredPart}
            onClickPart={(p) => setPinnedPart(prev => prev === p ? null : p)}
          />

          {/* 중앙 — 파트별 컴포지팅 라인 */}
          <div style={{
            flex: 1, minWidth: 0,
            padding: '14px 14px 24px',
            overflow: 'visible',
          }} onClick={() => setPinnedScene(null)}>
            {episode.parts.map((part) => {
              const isFocused = focusedPart === part.partId;
              const isDimmed = focusedPart && !isFocused;
              const startIdx = offsetIdx;
              offsetIdx += part.scenes.length;
              return (
                <div key={part.partId} style={{
                  padding: '14px 0 16px',
                  borderBottom: '1px dashed rgb(var(--color-bg-border) / 0.4)',
                  opacity: isDimmed ? 0.5 : 1,
                  transition: 'opacity 240ms',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      letterSpacing: '0.1em',
                      color: `rgb(var(${part.cssVar}))`,
                      textShadow: `0 0 12px rgb(var(${part.cssVar}) / 0.5)`,
                    }}>
                      {part.partId}파트 — {part.scenes.length}컷
                    </span>
                    <div style={{
                      flex: 1,
                      height: 1,
                      background: `linear-gradient(90deg, rgb(var(${part.cssVar}) / 0.6), transparent)`,
                    }} />
                    <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontFamily: 'monospace' }}>
                      {window.BF_DATA.fmtTime(part.duration)}
                    </span>
                  </div>
                  {/* 컴포지팅 라인 — 카드들을 가로로 빽빽이 */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    rowGap: 24,
                    paddingTop: 8,
                  }}>
                    {part.scenes.map((scene, i) => {
                      const isFiltered = filterStatus && scene.compositingStatus !== filterStatus;
                      return (
                        <ConstellationCard
                          key={scene.sceneId}
                          scene={scene}
                          idx={startIdx + i}
                          dimmed={isFiltered}
                          isHovered={hoveredScene === scene.sceneId}
                          isPinned={pinnedScene === scene.sceneId}
                          onHover={setHoveredScene}
                          onClick={(id) => setPinnedScene(prev => prev === id ? null : id)}
                          focusedScene={focusedScene}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <CinemaPreview
            episode={episode}
            stats={stats}
            focusedScene={focusedScene}
            viewerIsCompositor={viewerIsCompositor}
          />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BF_VariantC: VariantC });
