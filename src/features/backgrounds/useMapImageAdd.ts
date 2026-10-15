import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundCommand, BackgroundSnapshot } from './types';
import { uploadBackgroundImage } from './BackgroundUI';
import { useBackgroundStore } from './useBackgroundStore';
import { MAP_IMAGE_ADD, MAP_IMAGE_REFUSAL_TEXT, mapImageBusyText, mapImageCauseText, mapImageLinkWanted, mapImageSaves, mapImageSummary } from './mapImageDrop';
import type { MapImageLink, MapImageOutcome, MapImagePlan, MapImageStep } from './mapImageDrop';

/** A picture on its way in: a file of the page (dropped, pasted or picked), or a file the main process reads from its path (copied in Explorer). */
export type MapImageSource = { kind: 'file'; file: File; path: string; pasted: boolean } | { kind: 'path'; path: string };
/** How the link to the map was made, and whether all of it could be. */
export type MapImageLinked = { how: 'none' | 'draft' | 'saved'; complete: boolean };
/** `id` is the id of the background the picture becomes: the list draws a saved one as its ghost until the batch ends. */
export type MapImageJob = { id: string; name: string; step: MapImageStep; imageUrl: string };
/** `live`: a batch that reached its save run, with what it tied to the map. The line of such a batch is written anew at every draw, from how it stands by then (mapImageOutcomeNow): its link still to be saved, saved since or taken back, its pictures deleted. */
export type MapImageNotice = { mapId: string; text: string; failed: { name: string; reason: string }[]; live?: { outcome: MapImageOutcome; link: MapImageLink } };
/** What the image list draws. `mapId`: the map the running batch belongs to. `recent`: added since the screen was opened, newest first. `marked`: those that still wear 추가됨.
 *  `seq`: goes up when a batch starts and when `say` speaks, the two moments the line is brought into view. Never as a batch ends. */
export type MapImageAddView = { mapId: string | null; running: boolean; jobs: MapImageJob[]; notice: MapImageNotice | null; recent: readonly string[]; marked: readonly string[]; seq: number };
export const MAP_IMAGE_IDLE: MapImageAddView = { mapId: null, running: false, jobs: [], notice: null, recent: [], marked: [], seq: 0 };

/** The ids of the variant and the revision of each background saved: the editor makes those of the plan with the same call (5.1). */
const uuid = () => crypto.randomUUID();
/** A pause of the wait for rest: the run of saves looks again at the store and the editor after it. */
const sleep = (ms: number) => new Promise<void>(done => window.setTimeout(done, ms));
/** A picture file copied in Explorer (K6): the main process reads it from its path and checks it, then it goes up in the order 이미지파일 연결
 *  of a background takes. An answer with no address throws: no save goes out for a picture that did not go up. */
async function uploadFromPath(path: string): Promise<string> {
  const read = await window.electronAPI.backgroundReadImageFile(path), result = await window.electronAPI.backgroundUploadImage(read.dataUrl);
  if (!result.ok || !result.url) throw new Error(result.error || '이미지를 올리지 못했습니다. 다시 시도해 주세요.');
  return result.url;
}
/** Where a file of the page lies on this PC: '' for one that has no path (a pasted picture) and when asking throws. */
export function mapImageFilePath(file: File): string { try { return window.electronAPI.getPathForFile(file) || ''; } catch { return ''; } }

/** The controller of adding pictures (5.2), one batch at a time: its pictures go up one after another while the editor stays in use, then, once
 *  the editor is at rest, it is locked for the saves (the new place, then the backgrounds, one command at a time) and the tie to the map comes
 *  last. React state alone: the image list draws `view`, and nothing outlives the screen. */
export function useMapImageAdd(deps: {
  execute(command: BackgroundCommand): Promise<void>;
  /** The editor is at rest: nothing is dragged, drawn or being named, it runs nothing of its own, no dialog is open. */
  idle(): boolean;
  lock(on: boolean): void;
  link(mapId: string, link: MapImageLink, library: BackgroundSnapshot): Promise<MapImageLinked>;
}): { view: MapImageAddView; start(plan: MapImagePlan, sources: readonly MapImageSource[]): void;
  say(mapId: string, text: string, failed?: { name: string; reason: string }[]): void; dismiss(): void } {
  const [view, setView] = useState<MapImageAddView>(MAP_IMAGE_IDLE);
  const latest = useRef(deps); latest.current = deps;        // after a wait: the functions of the editor as it is rendered now
  const alive = useRef(true), running = useRef(false);        // refs: a second batch can be asked for before `view` is drawn
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // 추가됨 leaves by itself. Timed here, not in CSS: with reduced motion a CSS timer ends on its first frame.
  useEffect(() => {
    if (!view.marked.length) return;
    const timer = window.setTimeout(() => setView(now => ({ ...now, marked: [] })), MAP_IMAGE_ADD.addedMarkMs);
    return () => window.clearTimeout(timer);
  }, [view.marked]);

  async function run(plan: MapImagePlan, sources: readonly MapImageSource[]) {
    if (running.current) return;
    running.current = true;
    const actor = useBackgroundStore.getState().actorId;
    /** The screen was left or the account changed: nothing more is sent, nothing more is drawn. */
    const gone = () => !alive.current || useBackgroundStore.getState().actorId !== actor;
    /** The library's own error line is not left up for a save of this feature: the line of the image list says why, in plain words. Never once the screen was left: the store may be another session's by then. */
    const hush = () => { if (!gone()) useBackgroundStore.setState({ error: null }); };
    const step = (id: string, patch: Partial<MapImageJob>) => setView(now => ({ ...now, jobs: now.jobs.map(job => job.id === id ? { ...job, ...patch } : job) }));
    const failed = plan.refused.map(item => ({ name: item.name, reason: MAP_IMAGE_REFUSAL_TEXT[item.reason] }));
    const uploads: { viewId: string; name: string; imageUrl: string; sourceImagePath: string }[] = [], added: string[] = [];
    let tie: Pick<MapImageOutcome, 'link' | 'partial' | 'linkCause'> = { link: 'none' }, link: MapImageLink | null = null;
    setView(now => ({ ...now, mapId: plan.mapId, running: true, jobs: plan.items.map(item => ({ id: item.viewId, name: item.name, step: 'ready', imageUrl: '' })),
      notice: { mapId: plan.mapId, text: mapImageBusyText(plan.scope, plan.targetName, plan.items.length + plan.reused.length), failed: [] }, seq: now.seq + 1 }));
    try {
      // 1. The previews, one after another. The editor stays in use.
      for (const item of plan.items) {
        const source = sources[item.index];
        step(item.viewId, { step: 'uploading' });
        try {
          const imageUrl = source.kind === 'file' ? await uploadBackgroundImage(source.file) : await uploadFromPath(source.path);
          if (gone()) return;
          uploads.push({ viewId: item.viewId, name: item.name, imageUrl, sourceImagePath: source.path });
          step(item.viewId, { step: 'waiting', imageUrl });
        } catch (cause) {
          if (gone()) return;
          failed.push({ name: item.name, reason: mapImageCauseText(cause) }); step(item.viewId, { step: 'failed' });
        }
      }
      if (uploads.length || plan.reused.length) {
        // 2. The saves, in one run during which the editor is locked as during any save. It starts only when nothing is dragged,
        // nothing is being saved and no dialog is open: starting it never cancels a drag.
        const quiet = () => { const store = useBackgroundStore.getState(); return !store.loading && !store.pending && latest.current.idle(); };
        while (!quiet()) { await sleep(120); if (gone()) return; }
        latest.current.lock(true);
        try {
          /** One command. A reply that was lost is no failure when the library that was read again holds what was saved. */
          const save = async (command: BackgroundCommand, held: (library: BackgroundSnapshot) => boolean) => {
            try { await latest.current.execute(command); return ''; }
            catch (cause) { hush(); return !gone() && held(useBackgroundStore.getState().snapshot) ? '' : mapImageCauseText(cause); }
          };
          let stopped = '';
          for (const command of mapImageSaves(plan, uploads, new Date().toISOString(), uuid)) {
            if (command.type !== 'save') continue;
            const id = command.entity.id, job = uploads.find(upload => upload.viewId === id);      // none: the new place, which comes first
            if (stopped) { if (job) { failed.push({ name: job.name, reason: stopped }); step(id, { step: 'failed' }); } continue; }
            if (job) step(id, { step: 'saving' });
            const why = await save(command, library => (command.kind === 'place' ? library.places : library.views).some(item => item.id === id));
            if (gone()) return;
            if (!why) { if (job) added.push(id); continue; }
            if (job) { failed.push({ name: job.name, reason: why }); step(id, { step: 'failed' }); }
            stopped = why;      // what failed this save (the connection, the server, a place that is gone) fails the next one as well: the rest is not sent
          }
          // 3. The link, last: every background it names is in the library by now, and what is gone from it meanwhile is left out by linkMapImages.
          // Asked for only when there is something to tie: not for a new place that could not be saved, and not for a place that was there with no picture put in.
          const library = useBackgroundStore.getState().snapshot;
          link = { place: plan.place, placeId: plan.placeId, cameraId: plan.cameraId, viewIds: [...plan.reused, ...added] };
          if (mapImageLinkWanted(link, library)) {
            try {
              const done = await latest.current.link(plan.mapId, link, library);
              tie = done.how === 'none' ? { link: done.complete ? 'none' : 'missed' } : { link: done.how, partial: !done.complete };
            } catch (cause) { hush(); tie = { link: 'failed', linkCause: mapImageCauseText(cause) }; }
          }
        } finally { latest.current.lock(false); }
      }
      if (gone()) return;
      const outcome: MapImageOutcome = { scope: plan.scope, targetName: plan.targetName, placeName: plan.placeName, added: added.length, reused: plan.reused.length, reusedName: plan.reusedNames[0],
        failed: failed.length, over: plan.over, byPath: sources.some(source => source.kind === 'path'), ...tie };
      // `seq` stays as it is: nothing is scrolled as a batch ends. The plan may be under a drag just then.
      setView(now => ({ ...now, running: false, jobs: [], recent: [...added, ...now.recent], marked: added,
        notice: { mapId: plan.mapId, text: mapImageSummary(outcome), failed, ...(link ? { live: { outcome, link } } : {}) } }));
    } finally {
      running.current = false;
      if (alive.current) setView(now => now.running ? { ...now, running: false, jobs: [], notice: null } : now);
    }
  }

  /** A batch runs by itself: what it comes to is drawn in `view`, never handed back. */
  const start = (plan: MapImagePlan, sources: readonly MapImageSource[]) => { void run(plan, sources); };
  /** The line of the image list says this at once (a refusal, a reason) and is brought into view. `say` and `dismiss` stay the same functions: the memo of the image list holds. */
  const say = useCallback((mapId: string, text: string, failed: { name: string; reason: string }[] = []) => setView(now => ({ ...now, notice: { mapId, text, failed }, seq: now.seq + 1 })), []);
  /** 닫기 (×): the line goes, unless a batch is running. */
  const dismiss = useCallback(() => setView(now => now.running ? now : { ...now, notice: null }), []);
  return { view, start, say, dismiss };
}
