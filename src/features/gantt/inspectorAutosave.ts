export interface InspectorSource { key: string; revision: number; values: Record<string, unknown> }
export type InspectorSaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'blocked' | 'error' | 'conflict';
interface SaveConfig {
  fields: readonly string[];
  prepare(values: Record<string, unknown>): { values: Record<string, unknown>; error?: string };
  save(patch: Record<string, unknown>, expectedRevision: number): Promise<InspectorSource>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function changes(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => !same(before[key], after[key])).map(key => [key, after[key]]));
}

/** One serial writer owns the draft. Canonical rollback never replaces unsaved input. */
export class InspectorAutosave {
  private source: InspectorSource | null = null;
  private observed: InspectorSource | null = null;
  private values: Record<string, unknown> = {};
  private config: SaveConfig | null = null;
  private status: InspectorSaveStatus = 'idle';
  private error = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<boolean> | null = null;
  private paused = false;
  private epoch = 0;
  private disposed = false;
  private failureBase: InspectorSource | null = null;
  private changed: () => void;
  private preview: (progress: number | null) => void;
  constructor(changed: () => void, preview: (progress: number | null) => void = () => {}) {this.changed = changed;this.preview = preview;}
  snapshot() { return { key: this.source?.key, values: this.values, dirty: this.dirty(), status: this.status, error: this.error }; }
  isSaving() { return this.flight !== null; }
  private dirty() { return !!this.source && !!this.config && Object.keys(changes(this.source.values, this.values, this.config.fields)).length > 0; }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer);this.timer = null; }
  receive(source: InspectorSource, config: SaveConfig) {
    this.config = config;this.disposed = false;
    if (source.key !== this.source?.key) {
      this.epoch++;this.cancelTimer();this.preview(null);this.source = structuredClone(source);this.observed = structuredClone(source);this.values = structuredClone(source.values);this.status = 'idle';this.error = '';this.failureBase = null;this.changed();return;
    }
    if (source.revision < this.source.revision) return;
    this.observed = structuredClone(source);
    if (this.flight || this.status === 'saving') return;
    if (same(source, this.source)) {
      if (this.status === 'conflict' && this.failureBase && same(source, this.failureBase)) {this.status = 'error';this.changed();}
      return;
    }
    if (this.dirty()) {this.status = 'conflict';this.error = '다른 변경이 도착했습니다. 입력은 보관했습니다.';this.cancelTimer();this.preview(null);}
    else {this.source = structuredClone(source);this.values = structuredClone(source.values);this.status = 'idle';this.error = '';}
    this.changed();
  }
  change(patch: Record<string, unknown>, immediate = false) {
    if (!this.source || this.disposed) return;
    this.values = { ...this.values, ...patch };this.cancelTimer();
    if ('progress' in patch) this.preview(this.status !== 'error' && this.status !== 'conflict' && typeof patch.progress === 'number' && Number.isFinite(patch.progress) && patch.progress >= 0 && patch.progress <= 100 ? patch.progress : null);
    if (this.status !== 'error' && this.status !== 'conflict') {this.status = this.flight ? 'saving' : 'waiting';this.error = '';}
    this.changed();
    if (this.status === 'error' || this.status === 'conflict') return;
    this.timer = setTimeout(() => {this.timer = null;void this.flush();}, immediate ? 0 : 450);
  }
  setPaused(paused: boolean) {
    const resume = this.paused && !paused;this.paused = paused;
    if (resume && this.dirty() && this.status === 'waiting') {this.cancelTimer();this.timer = setTimeout(() => {this.timer = null;void this.flush();}, 0);}
  }
  async flush(): Promise<boolean> {
    this.cancelTimer();
    if (this.disposed || !this.source || !this.config) return false;
    if (this.flight) {const saved = await this.flight;return saved && !this.disposed && this.dirty() ? this.flush() : saved;}
    if (!this.dirty()) return true;
    if (this.paused || this.status === 'error' || this.status === 'conflict') return false;
    const prepared = this.config.prepare(structuredClone(this.values));
    if (prepared.error) {this.status = 'blocked';this.error = prepared.error;this.preview(null);this.changed();return false;}
    const patch = changes(this.source.values, prepared.values, this.config.fields);
    if (!Object.keys(patch).length) {this.values = structuredClone(this.source.values);this.status = 'saved';this.preview(null);this.changed();return true;}
    const epoch = this.epoch, source = structuredClone(this.source), sent = structuredClone(this.values), config = this.config;
    this.status = 'saving';this.error = '';this.failureBase = null;this.changed();
    const save = async () => {
      try {
        const canonical = await config.save(patch, source.revision);
        if (this.disposed || this.epoch !== epoch) return false;
        if (canonical.key !== source.key || canonical.revision !== source.revision + 1) {
          if (canonical.key === source.key) this.observed = structuredClone(canonical);
          this.status = 'conflict';throw new Error('다른 변경이 저장 중 도착했습니다. 최신 내용을 확인해 주세요.');
        }
        const later = changes(sent, this.values, config.fields);
        this.source = structuredClone(canonical);this.values = { ...structuredClone(canonical.values), ...later };
        if (this.observed && this.observed.revision > canonical.revision) {this.status = 'conflict';this.error = '다른 변경이 저장 중 도착했습니다. 입력은 보관했습니다.';return false;}
        this.observed = structuredClone(canonical);
        this.status = this.dirty() ? 'waiting' : 'saved';this.error = '';return true;
      } catch (cause) {
        if (this.disposed || this.epoch !== epoch) return false;
        this.failureBase = source;
        const conflict = this.status === 'conflict' || this.observed && (this.observed.revision !== source.revision || !same(this.observed.values, source.values));
        this.status = conflict ? 'conflict' : 'error';this.error = cause instanceof Error ? cause.message : '저장하지 못했습니다.';return false;
      } finally { if (this.epoch === epoch) {this.preview(null);this.changed();} }
    };
    this.flight = save();const saved = await this.flight;this.flight = null;
    if (this.epoch !== epoch || this.disposed) return false;
    this.changed();return saved && this.dirty() ? this.flush() : saved;
  }
  retry() {if (this.status === 'conflict') return Promise.resolve(false);this.status = 'waiting';this.error = '';this.changed();return this.flush();}
  reload() {if (!this.observed || this.flight) return;this.source = structuredClone(this.observed);this.values = structuredClone(this.observed.values);this.status = 'idle';this.error = '';this.failureBase = null;this.cancelTimer();this.preview(null);this.changed();}
  dispose() {this.disposed = true;this.epoch++;this.cancelTimer();this.preview(null);}
}
