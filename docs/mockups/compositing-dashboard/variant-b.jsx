/* ─── 시안 B: 매트릭스 보드 ──────────────────────────────────
   행=파트(A/B/C/D), 열=상태(배치/조합/취합/보정/오류/완료).
   셀에 씬 카드 스택. 한 눈에 어디서 막혀있는지 파악.
   파트 헤더 호버 → 행 글로우 / 상태 헤더 호버 → 열 글로우.
   상단에 슬림 타임라인 바.
   ────────────────────────────────────────────────────────── */

const { Icon, StatusChip, StatusDot, AssigneeAvatar, PartBadge,
        ParticleBurst, DashHeader, StatusLegend, ProgressBar } = window.BF_UI;

// ── 슬림 타임라인 (B의 보조 컨텍스트) ──────────────────
function SlimTimeline({ episode, focusedPart, onHoverPart, onClickPart, pinnedPart }) {
  const total = episode.totalDuration;
  let offset = 0;
  return (
    <div style={{ padding: '10px 28px 14px' }}>
      <div style={{
        position: 'relative', height: 30, borderRadius: 6,
        background: 'rgb(var(--color-bg-card))',
        border: '1px solid rgb(var(--color-bg-border))',
        overflow: 'hidden',
        display: 'flex',
      }}>
        {episode.parts.map((part) => {
          const widthPct = (part.duration / total) * 100;
          const isFocused = focusedPart === part.partId;
          const isDimmed = focusedPart && focusedPart !== part.partId;
          return (
            <button
              key={part.partId}
              className="bf-wipe-in"
              style={{
                all: 'unset',
                width: `${widthPct}%`,
                cursor: 'pointer',
                position: 'relative',
                background: isFocused
                  ? `linear-gradient(180deg, rgb(var(${part.cssVar}) / 0.6), rgb(var(${part.cssVar}) / 0.3))`
                  : `linear-gradient(180deg, rgb(var(${part.cssVar}) / 0.3), rgb(var(${part.cssVar}) / 0.15))`,
                opacity: isDimmed ? 0.4 : 1,
                borderRight: '1px solid rgb(var(--color-bg-primary) / 0.5)',
                animationDelay: `${{ A: 0, B: 80, C: 160, D: 240 }[part.partId]}ms`,
                transition: 'all 240ms',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
                color: `rgb(var(${part.cssVar}))`,
                letterSpacing: '0.04em',
                boxShadow: isFocused ? `inset 0 0 0 1.5px rgb(var(${part.cssVar}))` : 'none',
              }}
              onMouseEnter={() => onHoverPart(part.partId)}
              onMouseLeave={() => onHoverPart(null)}
              onClick={() => onClickPart(part.partId)}
            >
              {part.partId}파트
              <span style={{ marginLeft: 6, fontWeight: 500, fontSize: 10, opacity: 0.7 }}>
                {part.scenes.length}컷 · {window.BF_DATA.fmtTime(part.duration)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 매트릭스 셀 안의 미니 씬 카드 ──────────────────────
function MatrixCard({ scene, idx, dimmed, isHovered, isPinned, onHover, onClick }) {
  const status = window.BF_DATA.STATUSES.find(s => s.id === scene.compositingStatus);
  const isFocused = isHovered || isPinned;
  return (
    <div
      className="bf-cascade-item"
      style={{
        '--idx': idx,
        position: 'relative',
        width: 124,
        cursor: 'pointer',
        transition: 'transform 240ms var(--easing-out), opacity 240ms',
        transform: isFocused ? 'translateY(-4px) scale(1.04)' : 'translateY(0) scale(1)',
        opacity: dimmed && !isFocused ? 0.35 : 1,
        zIndex: isFocused ? 30 : 1,
      }}
      onMouseEnter={() => onHover(scene.sceneId)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(scene.sceneId); }}
    >
      {isFocused && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: 12,
          background: `radial-gradient(circle, rgb(var(${status.cssVar}) / 0.4), transparent 70%)`,
          filter: 'blur(8px)', zIndex: -1,
          animation: isPinned ? 'bf-glow-pulse 1.8s ease-in-out infinite' : 'none',
          '--bf-glow': `var(${status.cssVar})`,
        }} />
      )}
      <div style={{
        background: 'rgb(var(--color-bg-card))',
        border: `1.5px solid ${isFocused ? `rgb(var(${status.cssVar}))` : 'rgb(var(--color-bg-border))'}`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: isFocused
          ? `0 10px 28px rgb(var(--color-shadow) / 0.5), 0 0 22px rgb(var(${status.cssVar}) / 0.4)`
          : '0 2px 6px rgb(var(--color-shadow) / 0.22)',
      }}>
        <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: 'rgb(var(--color-bg-primary))', overflow: 'hidden' }}>
          <img src={scene.thumbnail} alt={scene.sceneId} draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', top: 3, left: 3,
            padding: '1px 5px',
            background: 'rgb(var(--color-bg-primary) / 0.75)',
            backdropFilter: 'blur(4px)',
            borderRadius: 4, fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
            color: 'rgb(var(--color-text-primary))',
          }}>{scene.sceneId}</div>
          {scene.errorKind && (
            <div style={{
              position: 'absolute', bottom: 3, left: 3, right: 3,
              padding: '1px 4px',
              background: 'rgb(var(--status-error) / 0.92)',
              borderRadius: 3, fontSize: 8, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <Icon name="alert" size={8} strokeWidth={3} />
              {scene.errorKind}
            </div>
          )}
          {scene.compositingStatus === 'done' && (
            <div style={{
              position: 'absolute', top: 3, right: 3,
              width: 14, height: 14, borderRadius: 999,
              background: 'rgb(var(--status-done))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white',
            }}>
              <Icon name="check" size={9} strokeWidth={3.5} />
            </div>
          )}
        </div>
        <div style={{
          padding: '4px 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 4, borderTop: '1px solid rgb(var(--color-bg-border) / 0.4)',
        }}>
          <AssigneeAvatar name={scene.assignee} initials={scene.assigneeInitials} tone={scene.assigneeTone} size={14} />
          <span style={{ fontSize: 9, color: 'rgb(var(--color-text-secondary))', fontFamily: 'monospace' }}>
            {scene.partId}·{scene.partSceneNo}
          </span>
          {scene.revision > 0 && (
            <span style={{
              fontSize: 8, fontWeight: 700,
              color: `rgb(var(${status.cssVar}))`,
              background: `rgb(var(${status.cssVar}) / 0.18)`,
              padding: '1px 4px', borderRadius: 4,
            }}>v{scene.revision}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 매트릭스 셀 (한 파트 × 한 상태) ──────────────
function MatrixCell({ scenes, status, isHovered, isFocusedRow, isFocusedCol, idxOffset,
                     hoveredScene, pinnedScene, onHoverScene, onClickScene }) {
  // 셀 자체 dim — 행 또는 열이 포커스 됐고 본 셀이 그에 포함 안되면 dim
  const isAttended = isFocusedRow || isFocusedCol;
  const expanded = scenes.length > 0;
  return (
    <div style={{
      minHeight: 110,
      padding: 8,
      background: isAttended
        ? `rgb(var(${status.cssVar}) / 0.06)`
        : 'rgb(var(--color-bg-primary) / 0.4)',
      borderRadius: 8,
      border: `1px dashed ${isAttended ? `rgb(var(${status.cssVar}) / 0.45)` : 'rgb(var(--color-bg-border) / 0.6)'}`,
      transition: 'all 240ms',
      position: 'relative',
    }}>
      {expanded ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {scenes.map((sc, i) => (
            <MatrixCard
              key={sc.sceneId}
              scene={sc}
              idx={idxOffset + i}
              dimmed={false}
              isHovered={hoveredScene === sc.sceneId}
              isPinned={pinnedScene === sc.sceneId}
              onHover={onHoverScene}
              onClick={onClickScene}
            />
          ))}
        </div>
      ) : (
        <div style={{
          height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgb(var(--color-text-secondary) / 0.4)',
          fontSize: 11,
        }}>
          —
        </div>
      )}
    </div>
  );
}

// ── 메인 시안 B ───────────────────────────────────────
function VariantB({ episode, stats, viewerIsCompositor, toolbar }) {
  const [hoveredPart, setHoveredPart] = useState(null);
  const [pinnedPart, setPinnedPart] = useState(null);
  const [hoveredStatus, setHoveredStatus] = useState(null);
  const [pinnedStatus, setPinnedStatus] = useState(null);
  const [hoveredScene, setHoveredScene] = useState(null);
  const [pinnedScene, setPinnedScene] = useState(null);
  const [mountKey, replay] = window.BF_UI.useMountKey();
  const focusedPart = pinnedPart || hoveredPart;
  const focusedStatus = pinnedStatus || hoveredStatus;

  // 셀별 씬 분배 (정렬: partSceneNo)
  const cellMap = useMemo(() => {
    const m = {};
    for (const p of episode.parts) {
      m[p.partId] = {};
      for (const s of window.BF_DATA.STATUSES) m[p.partId][s.id] = [];
      for (const sc of p.scenes) m[p.partId][sc.compositingStatus].push(sc);
      for (const s of window.BF_DATA.STATUSES) m[p.partId][s.id].sort((a, b) => a.partSceneNo - b.partSceneNo);
    }
    return m;
  }, [episode]);

  return (
    <div className="bf-dash" key={mountKey} data-screen-label="시안B 매트릭스" style={{
      width: '100%', height: '100%',
      background: 'rgb(var(--color-bg-primary))',
      color: 'rgb(var(--color-text-primary))',
      display: 'flex', flexDirection: 'column',
    }}>
      <DashHeader episode={episode} viewerIsCompositor={viewerIsCompositor} onReplay={replay} toolbar={toolbar} />

      <SlimTimeline
        episode={episode}
        focusedPart={focusedPart}
        pinnedPart={pinnedPart}
        onHoverPart={setHoveredPart}
        onClickPart={(p) => setPinnedPart(prev => prev === p ? null : p)}
      />

      {/* 매트릭스 */}
      <div style={{ padding: '0 28px 24px' }} onClick={() => { setPinnedScene(null); }}>
        {/* 상태 헤더 행 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '88px repeat(6, 1fr)',
          gap: 10,
          marginBottom: 8,
          alignItems: 'end',
        }}>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            파트 \ 상태
          </div>
          {window.BF_DATA.STATUSES.map((s) => {
            const total = episode.parts.reduce((a, p) => a + p.scenes.filter(sc => sc.compositingStatus === s.id).length, 0);
            const isHovered = hoveredStatus === s.id;
            const isPinned = pinnedStatus === s.id;
            const isFocused = isHovered || isPinned;
            return (
              <button
                key={s.id}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '8px 10px',
                  background: isFocused
                    ? `rgb(var(${s.cssVar}) / 0.18)`
                    : 'rgb(var(--color-bg-card))',
                  border: `1px solid ${isFocused ? `rgb(var(${s.cssVar}) / 0.55)` : 'rgb(var(--color-bg-border) / 0.7)'}`,
                  borderRadius: 8,
                  transition: 'all 200ms',
                }}
                onMouseEnter={() => setHoveredStatus(s.id)}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() => setPinnedStatus(prev => prev === s.id ? null : s.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <StatusDot statusId={s.id} size={7} withPulse={isPinned} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: `rgb(var(${s.cssVar}))` }}>{s.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--color-text-primary))' }}>
                    {total}
                  </span>
                  <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))' }}>
                    / {episode.totalScenes}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 파트 행 */}
        {episode.parts.map((part, pi) => {
          const isHovered = hoveredPart === part.partId;
          const isPinned = pinnedPart === part.partId;
          const isFocused = isHovered || isPinned;
          const baseIdx = pi * 30;
          return (
            <div key={part.partId} style={{
              display: 'grid',
              gridTemplateColumns: '88px repeat(6, 1fr)',
              gap: 10,
              marginBottom: 10,
              alignItems: 'stretch',
            }}>
              {/* 파트 헤더 */}
              <button
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: '12px 10px',
                  background: isFocused
                    ? `linear-gradient(135deg, rgb(var(${part.cssVar}) / 0.25), rgb(var(${part.cssVar}) / 0.12))`
                    : 'rgb(var(--color-bg-card))',
                  border: `1px solid ${isFocused ? `rgb(var(${part.cssVar}) / 0.7)` : 'rgb(var(--color-bg-border) / 0.7)'}`,
                  borderRadius: 8,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  transition: 'all 200ms',
                  boxShadow: isFocused ? `0 0 22px rgb(var(${part.cssVar}) / 0.32)` : 'none',
                }}
                onMouseEnter={() => setHoveredPart(part.partId)}
                onMouseLeave={() => setHoveredPart(null)}
                onClick={() => setPinnedPart(prev => prev === part.partId ? null : part.partId)}
              >
                <div>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: `rgb(var(${part.cssVar}))`,
                    letterSpacing: '0.02em',
                    lineHeight: 1,
                  }}>{part.partId}</div>
                  <div style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', marginTop: 2, fontWeight: 500 }}>
                    {part.scenes.length}컷
                  </div>
                </div>
                <div style={{ fontSize: 9, color: 'rgb(var(--color-text-secondary))', fontFamily: 'monospace', marginTop: 6 }}>
                  {window.BF_DATA.fmtTime(part.duration)}
                </div>
              </button>

              {/* 셀 6개 */}
              {window.BF_DATA.STATUSES.map((s, si) => {
                const isFocusedCol = focusedStatus === s.id;
                const isFocusedRow = focusedPart === part.partId;
                const isAttended = isFocusedCol || isFocusedRow;
                const isDimmed = (focusedPart || focusedStatus) && !isAttended;
                return (
                  <div key={s.id} style={{
                    opacity: isDimmed ? 0.32 : 1,
                    transition: 'opacity 200ms',
                  }}>
                    <MatrixCell
                      scenes={cellMap[part.partId][s.id]}
                      status={s}
                      isFocusedCol={isFocusedCol}
                      isFocusedRow={isFocusedRow}
                      idxOffset={baseIdx + si * 5}
                      hoveredScene={hoveredScene}
                      pinnedScene={pinnedScene}
                      onHoverScene={setHoveredScene}
                      onClickScene={(id) => setPinnedScene(prev => prev === id ? null : id)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { BF_VariantB: VariantB });
