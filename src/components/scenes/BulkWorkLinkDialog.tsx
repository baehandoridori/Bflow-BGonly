import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import {
  BULK_LINK_TEXT, bulkLinkConfirmLabel, bulkLinkLayoutHeading, bulkLinkLead, bulkLinkNotFoundText, bulkLinkReplaceNote, bulkLinkRowParts,
  type BulkLinkCandidate, type BulkLinkOffer,
} from '@/utils/sceneBulkWorkLink';

type Pending = { offer: BulkLinkOffer; resolve: (keys: string[] | null) => void };

let externalShow: ((offer: BulkLinkOffer) => Promise<string[] | null>) | null = null;
/** 지금 떠 있는 창의 요청. "떠 있는가"는 이것 하나로 안다 — 따로 켜고 끄는 값을 두지 않는다. */
let pending: Pending | null = null;

/** 창이 닫히는 한 길. 버튼·Esc·바깥 누름·호스트가 사라질 때 모두 여기를 지난다. 두 번 불려도 둘째는 아무 일도 하지 않는다. */
function settle(keys: string[] | null): void {
  const current = pending;
  pending = null;
  current?.resolve(keys);
}

export const BulkWorkLinkDialog = {
  /** 지금 창이 떠 있는가. */
  isOpen: (): boolean => pending !== null,
  /** 창을 띄운다. 고른 줄의 열쇠 배열, 또는 '이 씬만'(Esc·바깥 누름 포함)이면 null. */
  show(offer: BulkLinkOffer): Promise<string[] | null> {
    if (!externalShow) {
      console.warn('[BulkWorkLinkDialog] 호스트가 없어 제안을 건너뜁니다');
      return Promise.resolve(null);
    }
    return externalShow(offer);
  },
};

export function BulkWorkLinkDialogHost() {
  const [offer, setOffer] = useState<BulkLinkOffer | null>(null);
  useEffect(() => {
    externalShow = (next) => new Promise<string[] | null>((resolve) => {
      if (pending) { resolve(null); return; }   // 이미 떠 있으면 덮어쓰지 않는다
      pending = { offer: next, resolve };
      setOffer(next);
    });
    return () => {
      externalShow = null;
      settle(null);   // 호스트가 사라지면 기다리던 쪽을 풀고, "떠 있음"도 함께 내린다
    };
  }, []);
  const close = (keys: string[] | null) => { settle(keys); setOffer(null); };
  if (!offer) return null;
  return <BulkWorkLinkWindow offer={offer} onClose={close} />;
}

/** 뒤에 깔린 상세 창이 창 단위(window)로 듣는 단축키·붙여넣기에 닿지 않게 한다. */
const stop = (event: React.SyntheticEvent) => { event.stopPropagation(); };

function BulkWorkLinkWindow({ offer, onClose }: { offer: BulkLinkOffer; onClose: (keys: string[] | null) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const leadId = useId();
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(
    () => new Set(offer.candidates.filter((row) => row.checked).map((row) => row.key)),
  );
  const previousRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      previousRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
    dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')?.focus();
    return () => {
      const previous = previousRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const stopPasteAtWindow = (pasted: ClipboardEvent) => { pasted.stopPropagation(); };
    window.addEventListener('paste', stopPasteAtWindow, true);
    return () => window.removeEventListener('paste', stopPasteAtWindow, true);
  }, []);
  useEffect(() => {
    // Tab이 마지막 버튼을 지나면 포커스가 한 번 창 밖(body)에 놓인다. 그때의 키는 창의 onKeyDown을 지나지 않으므로, 뒤의 상세 창에 닿기 전에 여기서 멈춘다.
    const stopOutsideKeyAtWindow = (pressed: KeyboardEvent) => {
      if (!dialogRef.current?.contains(pressed.target as Node | null)) pressed.stopPropagation();
    };
    window.addEventListener('keydown', stopOutsideKeyAtWindow, true);
    return () => window.removeEventListener('keydown', stopOutsideKeyAtWindow, true);
  }, []);
  const toggle = (key: string) => setCheckedKeys((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const picked = offer.candidates.filter((row) => checkedKeys.has(row.key) && (row.state === 'empty' || row.state === 'replace'));
  const count = picked.length;
  const replaceCount = picked.filter((row) => row.state === 'replace').length;
  const submit = () => { if (count > 0) onClose(picked.map((row) => row.key)); };
  const renderRow = (row: BulkLinkCandidate) => {
    const checked = checkedKeys.has(row.key);
    const disabled = row.state === 'same' || row.state === 'unavailable';
    const parts = bulkLinkRowParts(row, checked);
    return (
      <label key={row.key} className={cn(
        'flex select-none items-start gap-2.5 rounded-lg border px-2.5 py-2 text-[12px]',
        disabled ? 'border-bg-border/30 text-text-secondary/60'
          : checked ? 'cursor-pointer border-accent/35 bg-accent/10'
          : 'cursor-pointer border-bg-border/40 bg-bg-primary/30 hover:bg-bg-primary/50',
      )}>
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" checked={checked} disabled={disabled} onChange={() => toggle(row.key)} />
        <span className="shrink-0 font-mono font-semibold text-text-primary">{row.sceneId}</span>
        <span className="min-w-0 flex-1">
          <span className="block break-all text-text-secondary">{parts.text}</span>
          {parts.path && <span className="mt-0.5 block break-all text-[10.5px] text-text-secondary/80">{parts.path}</span>}
        </span>
        {parts.mark && (
          <span className={cn(
            'shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px]',
            checked ? 'border-text-primary/25 bg-text-primary/10 font-semibold text-text-primary' : 'border-transparent text-text-secondary',
          )}>{parts.mark}</span>
        )}
      </label>
    );
  };
  const renderGroup = (group: BulkLinkCandidate['group'], legend: string) => {
    const rows = offer.candidates.filter((row) => row.group === group);
    if (rows.length === 0) return null;
    return (
      <fieldset className="mt-2 min-w-0 border-0 p-0">
        <legend className="mb-1.5 text-[10.5px] font-bold text-text-secondary">{legend}</legend>
        <div className="flex flex-col gap-1.5">{rows.map(renderRow)}</div>
      </fieldset>
    );
  };
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={leadId}
      className="bf-modal-in m-auto w-[min(520px,calc(100vw-32px))] max-w-none overflow-hidden rounded-lg border border-bg-border bg-bg-card p-0 text-text-primary shadow-xl backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); onClose(null); }}
      onKeyDown={stop}
      onPaste={stop}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(null); }}
    >
      <div className="flex max-h-[min(640px,calc(100vh-48px))] flex-col">
        <header className="px-6 pt-5 pb-3">
          <h2 id={titleId} className="text-sm font-bold text-text-primary">{BULK_LINK_TEXT.title}</h2>
          <p id={leadId} className="mt-1 text-[11.5px] text-text-secondary">{bulkLinkLead(offer)}</p>
          <div className="mt-2 rounded-md bg-bg-primary/60 px-2.5 py-1.5">
            <p className="break-all text-[12px] font-medium text-text-primary">{offer.fileName || offer.path}</p>
            {offer.fileName && offer.fileName !== offer.path && (
              <p className="mt-0.5 break-all text-[10.5px] text-text-secondary">{offer.path}</p>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3">
          {renderGroup('named', BULK_LINK_TEXT.named)}
          {renderGroup('layout', bulkLinkLayoutHeading(offer.layout))}
          {offer.notFound.length > 0 && <p className="mt-3 text-[11px] text-text-secondary">{bulkLinkNotFoundText(offer.notFound)}</p>}
        </div>
        <footer className="border-t border-bg-border/60 px-6 py-3.5">
          {/* 체크된 것 가운데 파일이 바뀌는 씬의 수. 목록이 스크롤돼 그 줄이 가려져 있어도 버튼 바로 위에 늘 보인다. 0이면 빈 글이라 자리를 차지하지 않는다. */}
          <p aria-live="polite" className={cn('text-right text-[11px] font-medium text-text-primary', replaceCount > 0 && 'mb-2.5')}>{bulkLinkReplaceNote(replaceCount)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-4 py-2 rounded text-sm text-text-secondary hover:bg-bg-border hover:text-text-primary" onClick={() => onClose(null)}>{BULK_LINK_TEXT.only}</button>
            <button type="button" disabled={count === 0} className={cn('px-4 py-2 rounded text-sm font-medium', count === 0 ? 'cursor-not-allowed bg-bg-border/40 text-text-secondary' : 'bg-accent text-on-accent hover:brightness-110')} onClick={submit}>{bulkLinkConfirmLabel(count)}</button>
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
