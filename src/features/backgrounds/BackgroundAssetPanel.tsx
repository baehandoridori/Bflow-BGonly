import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type {
  BackgroundPlace,
  BackgroundSnapshot,
  BackgroundVariant,
  BackgroundView,
} from "./types";
import { filterBackgroundViews } from "./domain";
import {
  EmptyState,
  Thumbnail,
  placeLabel,
  shotLabel,
  timeLabel,
  type RunCommand,
} from "./BackgroundUI";
import { PlaceDialog } from "./BackgroundPlaceDialog";
import { AssetDialog } from "./BackgroundAssetDialog";

export function BackgroundAssetPanel({
  snapshot,
  episodes,
  pending,
  execute,
  selectedViewId,
  onSelectedViewChange,
}: {
  snapshot: BackgroundSnapshot;
  episodes: number[];
  pending: boolean;
  execute: RunCommand;
  selectedViewId: string | null;
  onSelectedViewChange: (id: string | null) => void;
}) {
  const [placeId, setPlaceId] = useState(""),
    [search, setSearch] = useState(""),
    [relation, setRelation] = useState<
      "home" | "camera" | "visible" | "related"
    >("home");
  const [shot, setShot] = useState<BackgroundView["shot"] | "all">("all"),
    [time, setTime] = useState<BackgroundVariant["time"] | "all">("all"),
    [placeDialog, setPlaceDialog] = useState<
      BackgroundPlace | null | undefined
    >(),
    [creating, setCreating] = useState(false),
    [error, setError] = useState("");
  const selectedPlace = snapshot.places.find((place) => place.id === placeId);
  const views = useMemo(
    () =>
      filterBackgroundViews(snapshot, {
        search,
        placeId,
        relation,
        shot,
        time,
      }),
    [snapshot, search, placeId, relation, shot, time],
  );
  const selectedViewCache = useRef<BackgroundView>();
  const currentView = snapshot.views.find((view) => view.id === selectedViewId);
  if (currentView) selectedViewCache.current = currentView;
  const selectedView =
    currentView ||
    (selectedViewCache.current?.id === selectedViewId
      ? selectedViewCache.current
      : undefined);
  const renderPlaces = (parentId: string | null, depth = 0): ReactNode =>
    snapshot.places
      .filter((place) => place.parentId === parentId)
      .map((place) => (
        <div key={place.id}>
          <button
            type="button"
            className={cn("bg-tree-row", placeId === place.id && "selected")}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => setPlaceId(place.id)}
          >
            <Folder size={15} />
            <span>{place.name}</span>
            <small>
              {
                snapshot.views.filter((view) => view.placeId === place.id)
                  .length
              }
            </small>
          </button>
          {renderPlaces(place.id, depth + 1)}
        </div>
      ));
  const openFolder = async () => {
    if (!selectedPlace?.folderPath) return;
    setError("");
    try {
      const result = await window.electronAPI.shellOpenPath?.(
        selectedPlace.folderPath,
      );
      if (!result?.ok)
        throw new Error(result?.error || "폴더를 열 수 없습니다.");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <div className="bg-catalog">
      <aside className="bg-place-sidebar">
        <header>
          <strong>장소 폴더</strong>
          {snapshot.canManage && (
            <button
              className="bg-icon"
              type="button"
              aria-label="장소 추가"
              title="장소 폴더 추가"
              disabled={pending}
              onClick={() => setPlaceDialog(null)}
            >
              <FolderPlus size={17} />
            </button>
          )}
        </header>
        <button
          type="button"
          className={cn("bg-tree-row", !placeId && "selected")}
          onClick={() => setPlaceId("")}
        >
          <FolderOpen size={16} />
          <span>모든 배경</span>
          <small>{snapshot.views.length}</small>
        </button>
        <div className="bg-place-tree">{renderPlaces(null)}</div>
        {!snapshot.places.length && (
          <p className="bg-note bg-sidebar-note">
            장소 폴더를 만들어 배경을 모아보세요.
          </p>
        )}
      </aside>
      <div className="bg-catalog-main">
        <div className="bg-panel-heading">
          <div>
            <span className="bg-eyebrow">
              배경 목록
              {selectedPlace && (
                <>
                  <ChevronRight size={12} />
                  {placeLabel(snapshot.places, selectedPlace.id)}
                </>
              )}
            </span>
            <h2>{selectedPlace?.name || "모든 배경"}</h2>
            <p>소속 폴더, 카메라 위치, 화면에 보이는 장소를 각각 살펴보세요.</p>
          </div>
          <div className="bg-toolbar">
            {selectedPlace?.folderPath && (
              <button type="button" onClick={() => void openFolder()}>
                <FolderOpen size={15} />
                작업 폴더
              </button>
            )}
            {snapshot.canManage && (
              <>
                {selectedPlace && (
                  <button
                    type="button"
                    className="bg-icon"
                    title="장소 폴더 편집"
                    aria-label="장소 폴더 편집"
                    disabled={pending}
                    onClick={() => setPlaceDialog(selectedPlace)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="bg-primary"
                  disabled={pending || !snapshot.places.length}
                  onClick={() => setCreating(true)}
                >
                  <ImagePlus size={16} />
                  배경 등록
                </button>
              </>
            )}
          </div>
        </div>
        <div className="bg-catalog-filters">
          <label className="bg-search">
            <Search size={16} />
            <input
              value={search}
              aria-label="배경 검색"
              placeholder="이름, 태그, 메모 검색"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="장소와의 관계"
            value={relation}
            disabled={!placeId}
            onChange={(event) =>
              setRelation(event.target.value as typeof relation)
            }
          >
            <option value="home">이 장소 폴더의 배경</option>
            <option value="camera">이 장소에서 바라본 배경</option>
            <option value="visible">이 장소가 보이는 배경</option>
            <option value="related">이 장소와 관련된 배경</option>
          </select>
          <select
            aria-label="구도 필터"
            value={shot}
            onChange={(event) => setShot(event.target.value as typeof shot)}
          >
            <option value="all">모든 구도</option>
            {Object.entries(shotLabel).map(([value, name]) => (
              <option value={value} key={value}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="시간대 필터"
            value={time}
            onChange={(event) => setTime(event.target.value as typeof time)}
          >
            <option value="all">모든 시간대</option>
            {Object.entries(timeLabel).map(([value, name]) => (
              <option value={value} key={value}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="bg-error" role="alert">
            {error}
          </p>
        )}
        <div className="bg-results-note">{views.length}개 배경</div>
        {views.length ? (
          <div className="bg-asset-grid">
            {views.map((view) => (
              <button
                type="button"
                className="bg-asset-card"
                key={view.id}
                onClick={() => onSelectedViewChange(view.id)}
              >
                <Thumbnail
                  view={view}
                  variant={
                    time === "all"
                      ? undefined
                      : view.variants.find((item) => item.time === time)
                  }
                />
                <div className="bg-asset-card-body">
                  <div className="bg-asset-card-meta">
                    <span>{shotLabel[view.shot]}</span>
                    <span>
                      {view.variants.map((variant) => variant.name).join(" / ")}
                    </span>
                  </div>
                  <h3>{view.name}</h3>
                  <p>{placeLabel(snapshot.places, view.placeId)}</p>
                  <small>
                    카메라 ·{" "}
                    {view.cameraPlaceId
                      ? placeLabel(snapshot.places, view.cameraPlaceId)
                      : "미지정"}
                  </small>
                  {view.tags.length > 0 && (
                    <div className="bg-tags">
                      {view.tags.slice(0, 3).map((tag, index) => (
                        <span key={`${tag}-${index}`}>#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              snapshot.views.length
                ? "조건에 맞는 배경이 없습니다"
                : "장소별 배경을 등록해 보세요"
            }
            description={
              snapshot.views.length
                ? "장소 관계나 검색 조건을 바꾸어 살펴보세요."
                : "장소 폴더를 만든 뒤 이미지와 구도, 낮·밤 변형을 함께 등록할 수 있습니다."
            }
          >
            {snapshot.canManage && !snapshot.places.length && (
              <button
                type="button"
                className="bg-primary"
                onClick={() => setPlaceDialog(null)}
              >
                <Plus size={16} />첫 장소 만들기
              </button>
            )}
          </EmptyState>
        )}
      </div>
      {placeDialog !== undefined && (
        <PlaceDialog
          place={placeDialog}
          parentId={placeId || null}
          snapshot={snapshot}
          pending={pending}
          execute={execute}
          onClose={() => setPlaceDialog(undefined)}
          onSaved={setPlaceId}
        />
      )}{" "}
      {(creating || selectedView) && (
        <AssetDialog
          key={creating ? "new" : selectedView?.id}
          view={creating ? null : selectedView!}
          placeId={placeId || snapshot.places[0]?.id || ""}
          snapshot={snapshot}
          episodes={episodes}
          pending={pending}
          execute={execute}
          onClose={() => {
            setCreating(false);
            onSelectedViewChange(null);
          }}
        />
      )}
    </div>
  );
}
