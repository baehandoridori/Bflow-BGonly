import { useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type {
  BackgroundImageRevision,
  BackgroundSnapshot,
  BackgroundVariant,
  BackgroundView,
} from "./types";
import {
  BackgroundModal,
  Field,
  PlaceChecks,
  PlaceOptions,
  Thumbnail,
  shotLabel,
  timeLabel,
  uploadBackgroundImage,
  type RunCommand,
} from "./BackgroundUI";
import { ReverseUsagePanel } from "./BackgroundEpisodePanel";
import { BackgroundFileLinks } from './BackgroundFileLinks';
import { appendBackgroundImage, assertBackgroundImageCapacity, backgroundWorkFilePath, disconnectBackgroundImage, prepareBackgroundFileLinks } from './fileLinks';

const newRevision = (): BackgroundImageRevision => ({
  id: crypto.randomUUID(),
  imageUrl: "",
  filePath: "",
  sourceImagePath: "",
  createdAt: new Date().toISOString(),
});
const newVariant = (
  time: BackgroundVariant["time"] = "day",
): BackgroundVariant => {
  const revision = newRevision();
  return {
    id: crypto.randomUUID(),
    name: timeLabel[time],
    time,
    workFilePath: "",
    revisions: [revision],
    activeRevisionId: revision.id,
  };
};
const newView = (placeId: string): BackgroundView => ({
  id: crypto.randomUUID(),
  revision: 1,
  name: "",
  placeId,
  cameraPlaceId: null,
  visiblePlaceIds: [],
  relatedPlaceIds: [],
  shot: "wide",
  tags: [],
  memo: "",
  variants: [newVariant()],
});

export function AssetDialog({
  view,
  placeId,
  snapshot,
  episodes,
  pending,
  execute,
  onClose,
  initialVariantId,
  usageReadOnly = false,
  readOnly = false,
}: {
  view: BackgroundView | null;
  placeId: string;
  snapshot: BackgroundSnapshot;
  episodes: number[];
  pending: boolean;
  execute: RunCommand;
  onClose: () => void;
  initialVariantId?: string;
  usageReadOnly?: boolean;
  readOnly?: boolean;
}) {
  const [editableDraft, setDraft] = useState<BackgroundView>(() =>
    prepareBackgroundFileLinks(structuredClone(view || newView(placeId))),
  );
  // Readers follow live revisions; editors keep the revision their draft began with.
  const draft = (!snapshot.canManage || readOnly) && view ? view : editableDraft;
  const [variantId, setVariantId] = useState(draft.variants.find(item => item.id === initialVariantId)?.id ?? draft.variants[0].id),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [uploading, setUploading] = useState(false);
  const [tagsText, setTagsText] = useState(draft.tags.join(", "));
  const [imageNotice, setImageNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const variant =
    draft.variants.find((item) => item.id === variantId) || draft.variants[0];
  const revision = variant.revisions.find(
    (item) => item.id === variant.activeRevisionId,
  )!;
  const canEdit = snapshot.canManage && !readOnly,
    disabled = pending || uploading || !canEdit;
  const canEditRef = useRef(canEdit); canEditRef.current = canEdit;
  const uploadLock = useRef(false);
  const linked =
    snapshot.usages.some((usage) => usage.variantIds.includes(variant.id)) ||
    snapshot.groups.some((group) => group.variantIds.includes(variant.id));
  const patchVariant = (patch: Partial<BackgroundVariant>) =>
    setDraft((previous) => ({
      ...previous,
      variants: previous.variants.map((item) =>
        item.id === variant.id ? { ...item, ...patch } : item,
      ),
    }));
  const save = async (remove = false) => {
    if (disabled || uploadLock.current) return;
    setError("");
    try {
      if (remove && view)
        await execute({
          type: "delete",
          kind: "view",
          id: view.id,
          expectedRevision: draft.revision,
        });
      else
        await execute({
          type: "save",
          kind: "view",
          entity: {
            ...draft,
            name: draft.name.trim(),
            tags: [
              ...new Set(
                tagsText
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              ),
            ],
          },
          expectedRevision: view ? draft.revision : null,
        });
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const upload = async (file: File) => {
    if (disabled || uploadLock.current) return;
    const target = variant.id;
    uploadLock.current = true;
    setUploading(true);
    setError("");
    setImageNotice('');
    try {
      assertBackgroundImageCapacity(variant);
      let sourceImagePath = '';
      try { sourceImagePath = window.electronAPI.getPathForFile(file) || ''; } catch { /* Browser uploads have no local path. */ }
      const imageUrl = await uploadBackgroundImage(file);
      if (canEditRef.current) {
        setDraft(previous => appendBackgroundImage(previous, target, { ...newRevision(), imageUrl, sourceImagePath }));
        if (!sourceImagePath) setImageNotice('이미지 미리보기를 등록했어요. 원본 파일도 열려면 이미지파일 경로를 연결해 주세요.');
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };
  const connectImagePath = async (path: string) => {
    if (disabled || uploadLock.current) throw new Error('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
    const target = variant.id;
    uploadLock.current = true; setUploading(true); setError(''); setImageNotice('');
    try {
      assertBackgroundImageCapacity(variant);
      const file = await window.electronAPI.backgroundReadImageFile(path);
      if (!canEditRef.current) throw new Error('파일 연결 권한이 변경되었습니다.');
      const result = await window.electronAPI.backgroundUploadImage(file.dataUrl);
      if (!result.ok || !result.url) throw new Error(result.error || '미리보기를 저장하지 못했습니다.');
      if (!canEditRef.current) throw new Error('파일 연결 권한이 변경되었습니다.');
      setDraft(previous => appendBackgroundImage(previous, target, { ...newRevision(), imageUrl: result.url!, sourceImagePath: file.filePath }));
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      uploadLock.current = false; setUploading(false);
    }
  };
  return (
    <BackgroundModal
      title={view ? view.name : "새 배경 등록"}
      wide
      onClose={() => {
        if (!pending && !uploading) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {readOnly && <p className="bg-note">원본 확인 화면입니다. 배경 수정은 배경 목록에서 진행해 주세요.</p>}
        <div className="bg-asset-detail">
          <section className="bg-asset-visual">
            <div
              className="bg-variant-tabs"
              role="tablist"
              aria-label="배경 변형"
            >
              {draft.variants.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === variant.id}
                  onClick={() => setVariantId(item.id)}
                >
                  {item.name}
                </button>
              ))}
              {canEdit && (
                <button
                  type="button"
                  disabled={disabled}
                  title="낮·밤 등 변형 추가"
                  onClick={() => {
                    const item = newVariant(
                      draft.variants.some((v) => v.time === "day")
                        ? "night"
                        : "day",
                    );
                    setDraft({ ...draft, variants: [...draft.variants, item] });
                    setVariantId(item.id);
                  }}
                >
                  <Plus size={15} />
                  변형
                </button>
              )}
            </div>
            <div className="bg-image-drop" onDragOver={event => { if (!disabled && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); if (!disabled) void upload(event.dataTransfer.files[0]); }}>
              <Thumbnail view={draft} variant={variant} className="bg-large-preview" />
            </div>
            {canEdit && (
              <div className="bg-toolbar">
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="배경 수정본 이미지"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void upload(file);
                  }}
                />
                <button
                  type="button"
                  className="bg-primary"
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} />
                  {uploading ? "이미지 연결 중…" : "이미지파일 연결"}
                </button>
                <small className="bg-note">
                  PNG · JPG · WebP / 20MB · 이미지 위로 드래그해도 연결됩니다.
                </small>
              </div>
            )}
            <div className="bg-field-grid">
              <Field label="변형 이름">
                <input
                  maxLength={160}
                  required
                  value={variant.name}
                  disabled={disabled}
                  onChange={(event) =>
                    patchVariant({ name: event.target.value })
                  }
                />
              </Field>
              <Field label="시간대">
                <select
                  value={variant.time}
                  disabled={disabled}
                  onChange={(event) =>
                    patchVariant({
                      time: event.target.value as BackgroundVariant["time"],
                    })
                  }
                >
                  {Object.entries(timeLabel).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="이미지 수정 이력">
              <select
                value={variant.activeRevisionId}
                disabled={disabled}
                onChange={(event) =>
                  patchVariant({ activeRevisionId: event.target.value })
                }
              >
                {variant.revisions.map((row, index) => (
                  <option key={row.id} value={row.id}>
                    수정본 {index + 1} ·{" "}
                    {new Date(row.createdAt).toLocaleString("ko-KR")}
                    {row.imageUrl ? "" : " · 이미지 미등록"}
                  </option>
                ))}
              </select>
            </Field>
            <p className="bg-note">
              낮·밤은 각각의 변형으로, 그림의 변경은 변형 안의 수정 이력으로
              남습니다.
            </p>
            <BackgroundFileLinks key={`${variant.id}:${revision.id}`} workPath={backgroundWorkFilePath(variant)} imagePath={revision.sourceImagePath || ''} canEdit={canEdit} disabled={pending || uploading}
              onWorkPath={workFilePath => { if (canEditRef.current && !uploadLock.current) patchVariant({ workFilePath }); }}
              onImagePath={connectImagePath} onChooseImage={() => fileInput.current?.click()}
              onDisconnectImage={() => setDraft(previous => disconnectBackgroundImage(previous, variant.id, revision.id))}
              onRefreshImage={() => { void connectImagePath(revision.sourceImagePath || '').catch(() => {}); }} onError={setError} />
            {imageNotice && <p className="bg-note" role="status">{imageNotice}</p>}
            {canEdit && draft.variants.length > 1 && (
              <button
                type="button"
                className="bg-danger"
                disabled={disabled || linked}
                title={
                  linked
                    ? "에피소드 또는 묶음에서 사용 중인 변형입니다."
                    : "선택한 변형과 수정 이력 삭제"
                }
                onClick={() => {
                  const remaining = draft.variants.filter(
                    (item) => item.id !== variant.id,
                  );
                  setDraft({ ...draft, variants: remaining });
                  setVariantId(remaining[0].id);
                }}
              >
                <Trash2 size={14} />이 변형 삭제{linked ? " · 사용 중" : ""}
              </button>
            )}
          </section>
          <section className="bg-asset-metadata">
            <Field label="배경 이름">
              <input
                autoFocus
                required
                maxLength={160}
                value={draft.name}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field label="소속 장소 폴더">
              <select
                required
                value={draft.placeId}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, placeId: event.target.value })
                }
              >
                <option value="">장소 선택</option>
                <PlaceOptions places={snapshot.places} />
              </select>
            </Field>
            <Field label="카메라가 있는 장소">
              <select
                value={draft.cameraPlaceId || ""}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    cameraPlaceId: event.target.value || null,
                  })
                }
              >
                <option value="">미지정 · 특수 클로즈업</option>
                <PlaceOptions places={snapshot.places} />
              </select>
            </Field>
            <PlaceChecks
              label="화면에 보이는 장소"
              places={snapshot.places}
              value={draft.visiblePlaceIds}
              onChange={(visiblePlaceIds) =>
                setDraft({ ...draft, visiblePlaceIds })
              }
              disabled={disabled}
            />
            <PlaceChecks
              label="함께 관련된 장소"
              places={snapshot.places}
              value={draft.relatedPlaceIds}
              onChange={(relatedPlaceIds) =>
                setDraft({ ...draft, relatedPlaceIds })
              }
              disabled={disabled}
            />
            <Field label="구도">
              <select
                value={draft.shot}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    shot: event.target.value as BackgroundView["shot"],
                  })
                }
              >
                {Object.entries(shotLabel).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="검색 태그 · 쉼표로 구분">
              <input
                maxLength={2000}
                value={canEdit ? tagsText : draft.tags.join(", ")}
                disabled={disabled}
                onChange={(event) => setTagsText(event.target.value)}
              />
            </Field>
            <Field label="배경 메모">
              <textarea
                rows={3}
                maxLength={10000}
                value={draft.memo}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, memo: event.target.value })
                }
              />
            </Field>
          </section>
        </div>
        {error && (
          <p className="bg-error" role="alert">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="bg-actions">
            <small className="bg-note">
              변경한 내용은 저장 버튼을 누르면 반영됩니다.
            </small>
            <button
              type="button"
              disabled={pending || uploading}
              onClick={onClose}
            >
              닫기
            </button>
            <button
              className="bg-primary"
              disabled={disabled || !draft.name.trim() || !draft.placeId}
            >
              배경 저장
            </button>
          </div>
        )}
        {view && (
          <ReverseUsagePanel
            readOnly={usageReadOnly || readOnly}
            view={view}
            variant={variant}
            snapshot={snapshot}
            episodes={episodes}
            pending={
              pending ||
              uploading ||
              !view.variants.some((item) => item.id === variant.id)
            }
            execute={execute}
          />
        )}
        {view && canEdit && (
          <div className="bg-delete-section">
            {deleting ? (
              <>
                <p>
                  배경과 모든 변형을 삭제할까요? 도면·묶음·에피소드에서 사용
                  중이면 연결을 먼저 해제해야 합니다.
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setDeleting(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="bg-danger"
                  disabled={disabled}
                  onClick={() => void save(true)}
                >
                  배경 삭제 확인
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bg-danger"
                disabled={disabled}
                onClick={() => setDeleting(true)}
              >
                배경 원본 삭제
              </button>
            )}
          </div>
        )}
      </form>
    </BackgroundModal>
  );
}
