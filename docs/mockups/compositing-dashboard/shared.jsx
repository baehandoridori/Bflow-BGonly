/* ─── 공유 컴포넌트 & 훅 ──────────────────────────────────
   3개 시안에서 공통으로 사용. 모든 색상은 토큰 경유.
   ───────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── 아이콘 (인라인 SVG, lucide 스타일) ─────────────────────
function Icon({ name, size = 14, strokeWidth = 2, className = '', style }) {
  const s = size;
  const common = {
    width: s, height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    style,
  };
  const paths = {
    'clapperboard': <>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-3.6c1.1-.3 2.2.3 2.5 1.3Z"/>
      <path d="m6.2 5.3 3.1 3.9"/>
      <path d="m12.4 3.4 3.1 4"/>
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
    </>,
    'play': <polygon points="6 3 20 12 6 21 6 3"/>,
    'pause': <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    'check': <polyline points="20 6 9 17 4 12"/>,
    'check-square': <><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    'square': <rect x="3" y="3" width="18" height="18" rx="2"/>,
    'layers': <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    'sliders': <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
    'alert': <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    'lock': <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    'unlock': <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>,
    'film': <><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></>,
    'eye': <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    'users': <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    'rotate': <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,
    'arrow-right': <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    'chevron-down': <polyline points="6 9 12 15 18 9"/>,
    'chevron-right': <polyline points="9 18 15 12 9 6"/>,
    'circle': <circle cx="12" cy="12" r="10"/>,
    'dot': <circle cx="12" cy="12" r="3" fill="currentColor"/>,
    'plus': <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    'search': <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    'sun': <><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></>,
    'moon': <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>,
    'filter': <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,
    'list': <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    'grid': <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>,
    'maximize': <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name]}</svg>;
}

// ─── 상태 칩 ──────────────────────────────
function StatusChip({ statusId, size = 'md', variant = 'soft' }) {
  const s = window.BF_DATA.STATUSES.find(s => s.id === statusId) || window.BF_DATA.STATUSES[0];
  const sizes = {
    sm: { padding: '2px 7px', fontSize: 10, gap: 4, iconSize: 9 },
    md: { padding: '3px 9px', fontSize: 11, gap: 5, iconSize: 10 },
    lg: { padding: '5px 12px', fontSize: 12, gap: 6, iconSize: 12 },
  }[size];
  const styles = variant === 'solid' ? {
    background: `rgb(var(${s.cssVar}))`,
    color: 'white',
    fontWeight: 700,
  } : {
    background: `rgb(var(${s.cssVar}) / 0.14)`,
    color: `rgb(var(${s.cssVar}))`,
    fontWeight: 600,
  };
  return (
    <span style={{
      ...styles,
      display: 'inline-flex',
      alignItems: 'center',
      gap: sizes.gap,
      padding: sizes.padding,
      fontSize: sizes.fontSize,
      borderRadius: 999,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
    }}>
      <Icon name={s.icon} size={sizes.iconSize} strokeWidth={2.5} />
      {s.label}
    </span>
  );
}

// ─── 상태 점(작은 인디케이터) ──────────────
function StatusDot({ statusId, size = 8, withPulse = false }) {
  const s = window.BF_DATA.STATUSES.find(s => s.id === statusId) || window.BF_DATA.STATUSES[0];
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: 999,
      background: `rgb(var(${s.cssVar}))`,
      boxShadow: withPulse ? `0 0 0 2px rgb(var(${s.cssVar}) / 0.25), 0 0 8px rgb(var(${s.cssVar}) / 0.5)` : 'none',
      flexShrink: 0,
    }} />
  );
}

// ─── 담당자 아바타 ─────────────────────────
function AssigneeAvatar({ name, initials, tone, size = 22, withName = false, ring = false }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{
        width: size, height: size,
        borderRadius: 999,
        background: `linear-gradient(135deg, hsl(${tone}, 60%, 55%), hsl(${(tone + 40) % 360}, 65%, 45%))`,
        color: 'white',
        fontSize: size * 0.42,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: ring ? `0 0 0 2px rgb(var(--color-bg-card)), 0 0 0 3px hsl(${tone}, 60%, 55%)` : 'none',
      }}>
        {initials}
      </span>
      {withName && <span style={{ fontSize: 12, color: 'rgb(var(--color-text-primary))', fontWeight: 500 }}>{name}</span>}
    </span>
  );
}

// ─── 파트 컬러 chip ───────────────────────
function PartBadge({ partId, size = 'md' }) {
  const part = window.BF_DATA.PARTS_DEF.find(p => p.id === partId);
  const sizes = {
    sm: { padding: '1px 6px', fontSize: 10, w: 16, h: 16 },
    md: { padding: '2px 8px', fontSize: 11, w: 20, h: 20 },
    lg: { padding: '3px 10px', fontSize: 13, w: 26, h: 26 },
  }[size];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: sizes.w, height: sizes.h,
      borderRadius: 5,
      background: `rgb(var(${part.cssVar}) / 0.18)`,
      color: `rgb(var(${part.cssVar}))`,
      fontSize: sizes.fontSize,
      fontWeight: 800,
      letterSpacing: '0.02em',
    }}>{partId}</span>
  );
}

// ─── 파티클 emitter ────────────────────────
function ParticleBurst({ count = 8, radius = 38 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const r = radius + Math.random() * 10;
        const dx = Math.cos(angle) * r;
        const dy = Math.sin(angle) * r;
        return (
          <span key={i}
            className="bf-particle"
            style={{
              left: '50%',
              top: '50%',
              '--dx': `${dx}px`,
              '--dy': `${dy}px`,
              animationDelay: `${i * 60}ms`,
            }}
          />
        );
      })}
    </>
  );
}

// ─── 진입 스태거 훅 ────────────────────────
// 카드 컬렉션이 마운트되자마자 정렬 순서대로 차례차례 등장
function useStaggerEntry(items, getOrder = (it) => it.no) {
  const sorted = useMemo(() => {
    return items.map((it, i) => ({ ...it, _idx: i }))
      .sort((a, b) => getOrder(a) - getOrder(b))
      .map((it, i) => ({ ...it, _staggerIdx: i }));
  }, [items]);
  // 원래 순서로 다시 (인덱스만 매핑 결과로 갖고 있음)
  const result = useMemo(() => {
    const map = new Map(sorted.map((s) => [s._idx, s._staggerIdx]));
    return items.map((it, i) => ({ ...it, _staggerIdx: map.get(i) || 0 }));
  }, [items, sorted]);
  return result;
}

// ─── 마운트 키 (재진입 애니메이션 트리거) ──
function useMountKey() {
  const [key, setKey] = useState(0);
  const replay = useCallback(() => setKey(k => k + 1), []);
  return [key, replay];
}

// ─── 헤더 (3개 시안 공통) ──────────────────
function DashHeader({ episode, viewerIsCompositor, onReplay, accent = 'accent', toolbar = null }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '18px 28px 14px',
      borderBottom: '1px solid rgb(var(--color-bg-border) / 0.6)',
      gap: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36,
          background: `linear-gradient(135deg, rgb(var(--color-accent)) 0%, rgb(var(--color-accent-sub)) 100%)`,
          borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white',
        }}>
          <Icon name="clapperboard" size={18} strokeWidth={2} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>
              컴포지팅 현황
            </h1>
            <span style={{ fontSize: 12, color: 'rgb(var(--color-text-secondary))', fontWeight: 500 }}>
              {episode.title} · {episode.code}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>
            <span>총 {episode.totalScenes}컷</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{window.BF_DATA.fmtTime(episode.totalDuration)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>업데이트 {episode.lastUpdated}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {toolbar}
        {/* 담당 컴포지터 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 6px 8px',
          background: viewerIsCompositor
            ? `rgb(var(--color-accent) / 0.14)`
            : `rgb(var(--color-bg-card))`,
          border: `1px solid ${viewerIsCompositor ? 'rgb(var(--color-accent) / 0.5)' : 'rgb(var(--color-bg-border))'}`,
          borderRadius: 999,
        }}>
          <AssigneeAvatar
            name={episode.compositor.name}
            initials={episode.compositor.initials}
            tone={episode.compositor.tone}
            size={22}
            ring
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', fontWeight: 600, letterSpacing: '0.04em' }}>
              담당 컴포지터
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: viewerIsCompositor ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-primary))' }}>
              {episode.compositor.name}
              {viewerIsCompositor && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, opacity: 0.85 }}>(나)</span>}
            </span>
          </div>
          <Icon name={viewerIsCompositor ? 'unlock' : 'lock'} size={12} strokeWidth={2.4} style={{ color: viewerIsCompositor ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))', marginLeft: 2 }} />
        </div>

        {/* 보는 중인 사람 */}
        <div title="현재 보고 있는 팀원" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px',
          background: 'rgb(var(--color-bg-card))',
          border: '1px solid rgb(var(--color-bg-border))',
          borderRadius: 999,
        }}>
          <Icon name="eye" size={12} style={{ color: 'rgb(var(--color-text-secondary))' }} />
          <div style={{ display: 'flex', gap: -4 }}>
            {episode.viewers.map((v, i) => (
              <span key={v.name} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i }}>
                <AssigneeAvatar name={v.name} initials={v.initials} tone={v.tone} size={18} ring />
              </span>
            ))}
          </div>
          <span style={{ fontSize: 10, color: 'rgb(var(--color-text-secondary))', marginLeft: 4, fontWeight: 500 }}>3명</span>
        </div>

        {onReplay && (
          <button onClick={onReplay} title="진입 애니메이션 재생" style={{
            cursor: 'pointer',
            width: 32, height: 32,
            borderRadius: 8,
            background: 'rgb(var(--color-bg-card))',
            border: '1px solid rgb(var(--color-bg-border))',
            color: 'rgb(var(--color-text-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 160ms',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgb(var(--color-accent))'; e.currentTarget.style.borderColor = 'rgb(var(--color-accent) / 0.5)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgb(var(--color-text-secondary))'; e.currentTarget.style.borderColor = 'rgb(var(--color-bg-border))'; }}>
            <Icon name="rotate" size={14} />
          </button>
        )}
      </div>
    </header>
  );
}

// ─── 상태 범례 ────────────────────────────
function StatusLegend({ stats, activeStatus, onToggle, layout = 'row' }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: layout === 'row' ? 'row' : 'column',
      gap: layout === 'row' ? 8 : 6,
      flexWrap: 'wrap',
    }}>
      {window.BF_DATA.STATUSES.map((s) => {
        const count = stats.byStatus[s.id] || 0;
        const isActive = activeStatus === s.id;
        const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
        return (
          <button
            key={s.id}
            onClick={() => onToggle && onToggle(s.id)}
            style={{
              all: 'unset',
              cursor: onToggle ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px 6px 9px',
              background: isActive
                ? `rgb(var(${s.cssVar}) / 0.18)`
                : 'rgb(var(--color-bg-card))',
              border: `1px solid ${isActive ? `rgb(var(${s.cssVar}) / 0.55)` : 'rgb(var(--color-bg-border))'}`,
              borderRadius: 999,
              fontSize: 11,
              color: 'rgb(var(--color-text-primary))',
              transition: 'all 180ms',
            }}>
            <StatusDot statusId={s.id} size={8} withPulse={isActive} />
            <span style={{ color: 'rgb(var(--color-text-secondary))' }}>{s.label}</span>
            <span style={{
              fontWeight: 700,
              color: `rgb(var(${s.cssVar}))`,
              fontVariantNumeric: 'tabular-nums',
            }}>{count}</span>
            <span style={{ fontSize: 9, color: 'rgb(var(--color-text-secondary) / 0.7)', marginLeft: -2 }}>
              {pct.toFixed(0)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── 진행률 바 (마이크로) ────────────────
function ProgressBar({ value, height = 3, statusId }) {
  const cssVar = statusId
    ? window.BF_DATA.STATUSES.find(s => s.id === statusId)?.cssVar
    : '--color-accent';
  return (
    <div style={{
      height, width: '100%',
      background: 'rgb(var(--color-bg-border) / 0.5)',
      borderRadius: 999,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        height: '100%',
        background: `rgb(var(${cssVar}))`,
        borderRadius: 999,
        transition: 'width 600ms var(--easing-out)',
      }} />
    </div>
  );
}

// ─── 뷰 모드 토글 (Timeline / Matrix / Cinema) ────
function ViewModeToggle({ value, onChange }) {
  const options = [
    { id: 'timeline', label: 'Timeline', icon: 'film',    hint: 'AE 타임라인 + LP 카드' },
    { id: 'matrix',   label: 'Matrix',   icon: 'grid',    hint: '파트 × 상태 매트릭스' },
    { id: 'cinema',   label: 'Cinema',   icon: 'layers',  hint: '시네마틱 컴포지팅 룸' },
  ];
  return (
    <div style={{
      display: 'inline-flex',
      padding: 3,
      background: 'rgb(var(--color-bg-card))',
      border: '1px solid rgb(var(--color-bg-border))',
      borderRadius: 8,
      gap: 2,
    }}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            title={opt.hint}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '5px 10px',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11,
              fontWeight: 600,
              background: active ? 'rgb(var(--color-accent))' : 'transparent',
              color: active ? 'rgb(var(--color-on-accent))' : 'rgb(var(--color-text-secondary))',
              boxShadow: active ? `0 0 12px rgb(var(--color-accent) / 0.45)` : 'none',
              transition: 'all 160ms',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'rgb(var(--color-text-primary))'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'rgb(var(--color-text-secondary))'; }}
          >
            <Icon name={opt.icon} size={12} strokeWidth={2.4} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  BF_UI: {
    Icon, StatusChip, StatusDot, AssigneeAvatar, PartBadge,
    ParticleBurst, useStaggerEntry, useMountKey,
    DashHeader, StatusLegend, ProgressBar, ViewModeToggle,
  },
});
