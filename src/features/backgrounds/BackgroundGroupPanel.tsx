import { useState } from "react";
import { Layers3, Pencil, Plus } from "lucide-react";
import type { BackgroundGroup, BackgroundSnapshot } from "./types";
import {
  BackgroundModal,
  EmptyState,
  Field,
  PlaceOptions,
  Thumbnail,
  placeLabel,
  type RunCommand,
} from "./BackgroundUI";
import { VariantChecks } from "./BackgroundEpisodePanel";

function GroupDialog({
  group,
  snapshot,
  pending,
  execute,
  onClose,
}: {
  group: BackgroundGroup | null;
  snapshot: BackgroundSnapshot;
  pending: boolean;
  execute: RunCommand;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BackgroundGroup>(
    group || {
      id: crypto.randomUUID(),
      revision: 1,
      name: "",
      placeId: snapshot.places[0]?.id || "",
      variantIds: [],
    },
  );
  const [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const save = async (remove = false) => {
    setError("");
    try {
      if (remove && group)
        await execute({
          type: "delete",
          kind: "group",
          id: group.id,
          expectedRevision: group.revision,
        });
      else
        await execute({
          type: "save",
          kind: "group",
          entity: { ...draft, name: draft.name.trim() },
          expectedRevision: group?.revision ?? null,
        });
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <BackgroundModal
      title={group ? "시점 묶음 편집" : "새 시점 묶음"}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="bg-note">
          장소마다 자주 쓰는 기본 구도나 주요 시점을 모아두세요. 묶음을 바꿔도
          이미 적용한 에피소드는 바뀌지 않습니다.
        </p>
        <Field label="묶음 이름">
          <input
            autoFocus
            required
            maxLength={160}
            placeholder="예: 기본 시점 · 주요 시점"
            value={draft.name}
            disabled={pending}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </Field>
        <Field label="장소">
          <select
            required
            value={draft.placeId}
            disabled={pending}
            onChange={(event) =>
              setDraft({
                ...draft,
                placeId: event.target.value,
                variantIds: [],
              })
            }
          >
            <option value="">장소 선택</option>
            <PlaceOptions places={snapshot.places} />
          </select>
        </Field>
        <VariantChecks
          snapshot={snapshot}
          placeId={draft.placeId}
          value={draft.variantIds}
          onChange={(variantIds) => setDraft({ ...draft, variantIds })}
          disabled={pending}
        />
        {error && (
          <p className="bg-error" role="alert">
            {error}
          </p>
        )}
        <div className="bg-actions">
          <button type="button" disabled={pending} onClick={onClose}>
            취소
          </button>
          <button
            className="bg-primary"
            disabled={pending || !draft.name.trim() || !draft.placeId}
          >
            묶음 저장
          </button>
        </div>
        {group && (
          <div className="bg-delete-section">
            {deleting ? (
              <>
                <p>
                  묶음을 삭제할까요? 이미 적용한 에피소드의 배경은 유지됩니다.
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setDeleting(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="bg-danger"
                  disabled={pending}
                  onClick={() => void save(true)}
                >
                  삭제 확인
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bg-danger"
                disabled={pending}
                onClick={() => setDeleting(true)}
              >
                묶음 삭제
              </button>
            )}
          </div>
        )}
      </form>
    </BackgroundModal>
  );
}

export function BackgroundGroupPanel({
  snapshot,
  pending,
  execute,
}: {
  snapshot: BackgroundSnapshot;
  pending: boolean;
  execute: RunCommand;
}) {
  const [placeId, setPlaceId] = useState(""),
    [dialog, setDialog] = useState<BackgroundGroup | null | undefined>();
  const groups = snapshot.groups.filter(
    (group) => !placeId || group.placeId === placeId,
  );
  return (
    <div className="bg-panel">
      <div className="bg-panel-heading">
        <div>
          <span className="bg-eyebrow">시점 묶음</span>
          <h2>자주 쓰는 배경을 한 번에</h2>
          <p>
            기본 시점과 주요 시점을 모아두고, 에피소드에 필요한 만큼 가져오세요.
          </p>
        </div>
        {snapshot.canManage && (
          <button
            type="button"
            className="bg-primary"
            disabled={pending || !snapshot.places.length}
            onClick={() => setDialog(null)}
          >
            <Plus size={16} />
            묶음 만들기
          </button>
        )}
      </div>
      <div className="bg-toolbar">
        <select
          aria-label="시점 묶음 장소 필터"
          value={placeId}
          onChange={(event) => setPlaceId(event.target.value)}
        >
          <option value="">모든 장소</option>
          <PlaceOptions places={snapshot.places} />
        </select>
        <span className="bg-note">{groups.length}개 묶음</span>
      </div>
      {groups.length ? (
        <div className="bg-group-grid">
          {groups.map((group) => {
            const variants = snapshot.views.flatMap((view) =>
              view.variants
                .filter((variant) => group.variantIds.includes(variant.id))
                .map((variant) => ({ view, variant })),
            );
            return (
              <article className="bg-group-card" key={group.id}>
                <header>
                  <Layers3 size={18} />
                  <div>
                    <h3>{group.name}</h3>
                    <small>{placeLabel(snapshot.places, group.placeId)}</small>
                  </div>
                  {snapshot.canManage && (
                    <button
                      className="bg-icon"
                      type="button"
                      title="묶음 편집"
                      aria-label={`${group.name} 편집`}
                      disabled={pending}
                      onClick={() => setDialog(group)}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </header>
                <div className="bg-group-previews">
                  {variants.slice(0, 4).map(({ view, variant }) => (
                    <div key={variant.id}>
                      <Thumbnail view={view} variant={variant} />
                      <small>
                        {view.name} · {variant.name}
                      </small>
                    </div>
                  ))}
                </div>
                <p className="bg-note">
                  {variants.length}개 변형 · 에피소드별 배경에서 적용
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="자주 쓰는 시점을 묶어보세요"
          description={
            snapshot.places.length
              ? "장소별 배경 변형을 선택해 기본 시점과 주요 시점 묶음을 만들 수 있습니다."
              : "배경 목록에서 장소를 먼저 만들어 주세요."
          }
        />
      )}
      {dialog !== undefined && (
        <GroupDialog
          group={dialog}
          snapshot={snapshot}
          pending={pending}
          execute={execute}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}
