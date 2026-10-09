import { useEffect, useMemo, useRef, useState } from "react";
import {
  Film,
  Image as GalleryIcon,
  Layers3,
  Map,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useAuthStore } from "@/stores/useAuthStore";
import { useDataStore } from "@/stores/useDataStore";
import { useBackgroundStore } from "./useBackgroundStore";
import { BackgroundMapEditor } from "./BackgroundMapEditor";
import { BackgroundAssetPanel } from "./BackgroundAssetPanel";
import { AssetDialog } from "./BackgroundAssetDialog";
import type { BackgroundView } from './types';
import { BackgroundGroupPanel } from "./BackgroundGroupPanel";
import { BackgroundEpisodePanel } from "./BackgroundEpisodePanel";
import "./backgrounds.css";

const tabs = [
  { id: "maps", label: "도면 탐색", icon: Map },
  { id: "assets", label: "배경 목록", icon: GalleryIcon },
  { id: "groups", label: "시점 묶음", icon: Layers3 },
  { id: "episodes", label: "에피소드별 배경", icon: Film },
] as const;

export default function BackgroundLibraryView() {
  const user = useAuthStore((state) => state.currentUser),
    allEpisodes = useDataStore((state) => state.episodes);
  const { snapshot, loading, pending, error, updateRequired, execute } = useBackgroundStore();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("maps"),
    [selectedViewId, setSelectedViewId] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const [mapAsset, setMapAsset] = useState<{ id: string; variantId?: string; usageReadOnly?: boolean } | null>(null);
  const mapAssetCache = useRef<BackgroundView>();
  const liveMapAsset = snapshot.views.find(view => view.id === mapAsset?.id);
  if (!mapAsset) mapAssetCache.current = undefined;
  else if (liveMapAsset) mapAssetCache.current = liveMapAsset;
  // Optimistic deletion must not unmount the dialog before a failed save can restore its draft.
  const mapAssetView = liveMapAsset || (mapAssetCache.current?.id === mapAsset?.id ? mapAssetCache.current : undefined);
  const episodes = useMemo(
    () =>
      [...new Set(allEpisodes.map((episode) => episode.episodeNumber))].sort(
        (a, b) => a - b,
      ),
    [allEpisodes],
  );
  const getEpisodeDisplayName = useDataStore(state => state.getEpisodeDisplayName);
  const episodeLabels = Object.fromEntries(allEpisodes.map(episode => [episode.episodeNumber, getEpisodeDisplayName(episode)]));
  useEffect(() => {
    setSelectedViewId(null);
    setMapAsset(null);
    void useBackgroundStore.getState().initialize(user?.id ?? null);
    return () => {
      void useBackgroundStore.getState().initialize(null);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      void useBackgroundStore.getState().refresh();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id]);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await useBackgroundStore.getState().refresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section
      className={`bg-library bg-library-shell${tab === 'maps' ? ' bg-library-maps' : ''}`}
      aria-label="배경 라이브러리"
    >
      <header className="bg-library-header">
        <div>
          <span className="bg-eyebrow">BACKGROUND LIBRARY</span>
          <h1>배경 라이브러리</h1>
          <p>장소를 찾고, 시점을 고르고, 에피소드로 이어보세요.</p>
        </div>
        <div className="bg-library-status">
          <span>
            {pending
              ? "저장 중…"
              : loading
                ? "불러오는 중…"
                : updateRequired
                  ? "업데이트 필요"
                  : snapshot.canManage
                    ? "관리자 편집 가능"
                    : "라이브러리 보기"}
          </span>
          <button
            type="button"
            className="bg-icon"
            title="배경 라이브러리 새로고침"
            aria-label="배경 라이브러리 새로고침"
            disabled={loading || pending || refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {updateRequired ? (
        // Stored data from a newer app: no tabs, no error strip, no body. Nothing can be seen or edited until a read succeeds.
        <div className="bg-empty" role="alert">
          <RefreshCw size={28} strokeWidth={1.4} aria-hidden="true" />
          <h3>업데이트가 필요해요</h3>
          <p>이 PC의 B flow보다 새 버전에서 만든 도면 자료가 저장돼 있어서, 지금 버전으로는 배경 화면을 열 수 없어요. 화면 왼쪽 아래의 버전 버튼을 눌러 업데이트한 뒤 다시 열어 주세요. 저장된 자료는 그대로 안전하고, 업데이트하기 전까지 이 PC에서는 보거나 고칠 수 없어요.</p>
          <button type="button" className="bg-button bg-primary" disabled={loading || refreshing} onClick={() => void refresh()}>다시 확인</button>
        </div>
      ) : (
        <>
          <nav className="bg-library-tabs" aria-label="배경 라이브러리 메뉴">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={cn(tab === id && "selected")}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          {error && (
            <div className="bg-error bg-global-error" role="alert">
              {error}
            </div>
          )}
          {loading && !snapshot.maps.length && !snapshot.places.length ? (
            <div className="bg-loading" role="status">
              배경 라이브러리를 불러오고 있습니다…
            </div>
          ) : (
            <div className="bg-library-body" key={user?.id || "signed-out"}>
              <div hidden={tab !== "maps"} className="bg-tab-content">
                <BackgroundMapEditor
                  snapshot={snapshot}
                  pending={pending}
                  execute={execute}
                  onOpenView={(id, variantId) => setMapAsset({ id, variantId })}
                  onOpenCatalog={() => setTab('assets')}
                />
              </div>
              <div hidden={tab !== "assets"} className="bg-tab-content">
                <BackgroundAssetPanel
                  snapshot={snapshot}
                  episodes={episodes}
                  pending={pending}
                  execute={execute}
                  selectedViewId={selectedViewId}
                  onSelectedViewChange={setSelectedViewId}
                />
              </div>
              <div hidden={tab !== "groups"} className="bg-tab-content">
                <BackgroundGroupPanel
                  snapshot={snapshot}
                  pending={pending}
                  execute={execute}
                />
              </div>
              <div hidden={tab !== "episodes"} className="bg-tab-content">
                <BackgroundEpisodePanel
                  snapshot={snapshot}
                  episodes={episodes}
                  episodeLabels={episodeLabels}
                  onOpenView={(id, variantId) => setMapAsset({ id, variantId, usageReadOnly: true })}
                  pending={pending}
                  execute={execute}
                />
              </div>
              {mapAssetView && <AssetDialog key={`${mapAssetView.id}:${mapAsset?.variantId || ''}`} view={mapAssetView} initialVariantId={mapAsset?.variantId} readOnly={mapAsset?.usageReadOnly} usageReadOnly={mapAsset?.usageReadOnly} placeId={mapAssetView.placeId} snapshot={snapshot} episodes={episodes} pending={pending} execute={execute} onClose={() => setMapAsset(null)} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}
