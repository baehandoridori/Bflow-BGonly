import fs from 'node:fs/promises';
import path from 'node:path';

export type PersonalTodoRecoveryPhase =
  | 'received'
  | 'prepared'
  | 'db_committed'
  | 'calendar_unknown'
  | 'compensating'
  | 'aborted';

export interface PersonalTodoRecoveryEntry {
  operationId: string;
  userId: string;
  todoId: string;
  desiredPatch: Record<string, unknown>;
  targetCalendarId: string | null;
  candidateSourceCalendarIds: string[];
  deterministicEventId: string;
  phase: PersonalTodoRecoveryPhase;
  previousCanonical: Record<string, unknown> | null;
  dbCommittedUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PersonalTodoRecoveryDocument {
  version: 1;
  entries: PersonalTodoRecoveryEntry[];
}

const EMPTY_DOCUMENT: PersonalTodoRecoveryDocument = { version: 1, entries: [] };

function isRecoveryEntry(value: unknown): value is PersonalTodoRecoveryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersonalTodoRecoveryEntry>;
  return typeof candidate.operationId === 'string'
    && typeof candidate.userId === 'string'
    && typeof candidate.todoId === 'string'
    && typeof candidate.phase === 'string';
}

/**
 * A process-local mutex protects the complete read/modify/write cycle. Every
 * write is committed through a sibling temp file and rename, so a crash cannot
 * expose a partially written JSON document.
 */
export class PersonalTodoRecoveryJournal {
  private tail: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) { this.filePath = filePath; }

  private runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readUnlocked(): Promise<PersonalTodoRecoveryDocument> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersonalTodoRecoveryDocument>;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { ...EMPTY_DOCUMENT, entries: [] };
      return { version: 1, entries: parsed.entries.filter(isRecoveryEntry) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_DOCUMENT, entries: [] };
      throw error;
    }
  }

  private async writeUnlocked(document: PersonalTodoRecoveryDocument): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(document, null, 2), 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  read(): Promise<PersonalTodoRecoveryEntry[]> {
    return this.runExclusive(async () => (await this.readUnlocked()).entries.map((entry) => ({ ...entry })));
  }

  get(operationId: string): Promise<PersonalTodoRecoveryEntry | null> {
    return this.runExclusive(async () => {
      const entry = (await this.readUnlocked()).entries.find((candidate) => candidate.operationId === operationId);
      return entry ? { ...entry } : null;
    });
  }

  upsert(entry: PersonalTodoRecoveryEntry): Promise<void> {
    return this.runExclusive(async () => {
      const document = await this.readUnlocked();
      const index = document.entries.findIndex((candidate) => candidate.operationId === entry.operationId);
      if (index >= 0) document.entries[index] = { ...entry };
      else document.entries.push({ ...entry });
      await this.writeUnlocked(document);
    });
  }

  updatePhase(
    operationId: string,
    phase: PersonalTodoRecoveryPhase,
    patch: Partial<Omit<PersonalTodoRecoveryEntry, 'operationId' | 'phase'>> = {},
  ): Promise<void> {
    return this.runExclusive(async () => {
      const document = await this.readUnlocked();
      const index = document.entries.findIndex((candidate) => candidate.operationId === operationId);
      if (index < 0) throw new Error(`Recovery entry not found: ${operationId}`);
      document.entries[index] = {
        ...document.entries[index],
        ...patch,
        operationId,
        phase,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      };
      await this.writeUnlocked(document);
    });
  }

  remove(operationId: string): Promise<void> {
    return this.runExclusive(async () => {
      const document = await this.readUnlocked();
      const nextEntries = document.entries.filter((candidate) => candidate.operationId !== operationId);
      if (nextEntries.length === document.entries.length) return;
      await this.writeUnlocked({ version: 1, entries: nextEntries });
    });
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}
