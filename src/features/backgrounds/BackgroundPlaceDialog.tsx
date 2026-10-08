import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { BackgroundPlace, BackgroundSnapshot } from "./types";
import {
  BackgroundModal,
  Field,
  PlaceOptions,
  type RunCommand,
} from "./BackgroundUI";

export function PlaceDialog({
  place,
  parentId,
  snapshot,
  pending,
  execute,
  onClose,
  onSaved,
}: {
  place: BackgroundPlace | null;
  parentId: string | null;
  snapshot: BackgroundSnapshot;
  pending: boolean;
  execute: RunCommand;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<BackgroundPlace>(
    place || {
      id: crypto.randomUUID(),
      revision: 1,
      name: "",
      parentId,
      folderPath: "",
    },
  );
  const [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [choosing, setChoosing] = useState(false);
  const save = async (remove = false) => {
    setError("");
    try {
      if (remove && place)
        await execute({
          type: "delete",
          kind: "place",
          id: place.id,
          expectedRevision: place.revision,
        });
      else {
        await execute({
          type: "save",
          kind: "place",
          entity: { ...draft, name: draft.name.trim() },
          expectedRevision: place?.revision ?? null,
        });
        onSaved(draft.id);
      }
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const chooseFolder = async () => {
    setChoosing(true);
    setError("");
    try {
      const path = await window.electronAPI.chooseFolderPath?.();
      if (path) setDraft((previous) => ({ ...previous, folderPath: path }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setChoosing(false);
    }
  };
  return (
    <BackgroundModal
      title={place ? "장소 폴더 편집" : "새 장소 폴더"}
      onClose={() => {
        if (!pending && !choosing) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="장소 이름">
          <input
            autoFocus
            required
            maxLength={160}
            value={draft.name}
            disabled={pending}
            placeholder="예: 학교 / 2-1 교실"
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </Field>
        <Field label="상위 장소">
          <select
            value={draft.parentId || ""}
            disabled={pending}
            onChange={(event) =>
              setDraft({ ...draft, parentId: event.target.value || null })
            }
          >
            <option value="">최상위 장소</option>
            <PlaceOptions places={snapshot.places} exclude={draft.id} />
          </select>
        </Field>
        <Field label="작업 폴더">
          <div className="bg-input-action">
            <input
              value={draft.folderPath}
              disabled={pending || choosing}
              placeholder="폴더를 선택하거나 경로를 입력하세요."
              onChange={(event) =>
                setDraft({ ...draft, folderPath: event.target.value })
              }
            />
            <button
              type="button"
              disabled={pending || choosing}
              onClick={() => void chooseFolder()}
            >
              <FolderOpen size={16} />
              찾기
            </button>
          </div>
        </Field>
        <p className="bg-note">
          이 장소의 작업 폴더를 연결합니다. 배경별 작업파일과 이미지파일은 배경 상세에서 연결할 수 있습니다.
        </p>
        {error && (
          <p className="bg-error" role="alert">
            {error}
          </p>
        )}
        <div className="bg-actions">
          <button
            type="button"
            disabled={pending || choosing}
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="bg-primary"
            disabled={pending || choosing || !draft.name.trim()}
          >
            장소 저장
          </button>
        </div>
        {place && (
          <div className="bg-delete-section">
            {deleting ? (
              <>
                <p>
                  장소 폴더를 삭제할까요? 연결된 배경·도면·묶음·사용 기록이
                  있으면 삭제할 수 없습니다.
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
                장소 삭제
              </button>
            )}
          </div>
        )}
      </form>
    </BackgroundModal>
  );
}
