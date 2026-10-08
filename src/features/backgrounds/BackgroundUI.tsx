import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { resizeBlob } from "@/utils/imageUtils";
import type {
  BackgroundCommand,
  BackgroundPlace,
  BackgroundVariant,
  BackgroundView,
} from "./types";

export type RunCommand = (command: BackgroundCommand) => Promise<void>;

export function BackgroundModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={cn("bg-library bg-modal", wide && "bg-modal-wide")}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="bg-modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="bg-icon"
          title="닫기"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div className="bg-modal-content">{children}</div>
    </dialog>,
    document.body,
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="bg-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="bg-empty">
      <ImageIcon size={28} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export function Thumbnail({
  view,
  variant = view.variants[0],
  className,
}: {
  view: BackgroundView;
  variant?: BackgroundVariant;
  className?: string;
}) {
  const revision = variant?.revisions.find(
    (item) => item.id === variant.activeRevisionId,
  );
  return (
    <div className={cn("bg-thumbnail", className)}>
      {revision?.imageUrl ? (
        <img
          src={revision.imageUrl}
          alt={`${view.name} · ${variant.name}`}
          loading="lazy"
        />
      ) : (
        <span>
          <ImageIcon size={25} />
          <small>이미지 미등록</small>
        </span>
      )}
    </div>
  );
}

export async function uploadBackgroundImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("PNG, JPG, WebP 이미지를 선택해 주세요.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("이미지는 20MB 이하로 등록해 주세요.");
  // Keep transparent artwork intact. The original remains at the separately stored file path.
  const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  let data = "";
  try {
    for (const maxSize of [1600, 1200, 900, 650]) {
      data = await resizeBlob(file, maxSize, 0.86, mime);
      if (data.length <= 2_000_000) break;
    }
  } catch {
    throw new Error(
      "이미지를 읽을 수 없습니다. 다른 이미지 파일을 선택해 주세요.",
    );
  }
  if (data.length > 2_000_000)
    throw new Error(
      "미리보기 이미지 용량이 너무 큽니다. 이미지 크기를 줄여 다시 등록해 주세요.",
    );
  const result = await window.electronAPI.backgroundUploadImage(data);
  if (!result.ok || !result.url)
    throw new Error(
      result.error || "이미지를 올리지 못했습니다. 다시 시도해 주세요.",
    );
  return result.url;
}

export function placeLabel(
  places: BackgroundPlace[],
  id: string | null,
): string {
  const names: string[] = [],
    visited = new Set<string>();
  let current = places.find((place) => place.id === id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = places.find((place) => place.id === current?.parentId);
  }
  return names.join(" / ");
}

export function PlaceOptions({
  places,
  exclude,
}: {
  places: BackgroundPlace[];
  exclude?: string;
}) {
  const excluded = new Set(exclude ? [exclude] : []);
  for (let pass = 0; pass < places.length; pass++)
    for (const place of places)
      if (place.parentId && excluded.has(place.parentId))
        excluded.add(place.id);
  return (
    <>
      {places
        .filter((place) => !excluded.has(place.id))
        .map((place) => (
          <option key={place.id} value={place.id}>
            {placeLabel(places, place.id)}
          </option>
        ))}
    </>
  );
}

export function PlaceChecks({
  label,
  places,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  places: BackgroundPlace[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="bg-check-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="bg-check-list">
        {places.length ? (
          places.map((place) => (
            <label key={place.id}>
              <input
                type="checkbox"
                checked={value.includes(place.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, place.id]
                      : value.filter((id) => id !== place.id),
                  )
                }
              />
              {placeLabel(places, place.id)}
            </label>
          ))
        ) : (
          <small>등록된 장소가 없습니다.</small>
        )}
      </div>
    </fieldset>
  );
}

export const timeLabel = { day: "낮", night: "밤", other: "기타" } as const;
export const shotLabel = {
  wide: "전체 전경",
  medium: "중간 구도",
  closeup: "클로즈업",
  detail: "부분·디테일",
} as const;
