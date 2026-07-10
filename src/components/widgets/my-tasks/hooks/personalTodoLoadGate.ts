/**
 * Coordinates session-scoped initial loading with commit-triggered reloads.
 * A commit received while migration is in flight is folded into one final
 * authoritative read instead of invalidating the initialization itself.
 */
export class PersonalTodoLoadGate {
  private generation = 0;
  private initialToken: number | null = null;
  private deferredCommit = false;
  private sceneKeyPersistenceEnabled = false;

  get canPersistSceneKeys(): boolean {
    return this.sceneKeyPersistenceEnabled;
  }

  beginInitialLoad(): number {
    const token = ++this.generation;
    this.initialToken = token;
    this.deferredCommit = false;
    this.sceneKeyPersistenceEnabled = false;
    return token;
  }

  noteAuthoritativeCommit(): number | null {
    if (this.initialToken !== null) {
      this.deferredCommit = true;
      return null;
    }
    return ++this.generation;
  }

  consumeDeferredCommit(token: number): boolean {
    if (!this.isCurrent(token)) return false;
    const deferred = this.deferredCommit;
    this.deferredCommit = false;
    return deferred;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  finishInitialLoad(token: number): boolean {
    if (!this.isCurrent(token) || this.initialToken !== token) return false;
    this.initialToken = null;
    this.sceneKeyPersistenceEnabled = true;
    return true;
  }

  cancel(): void {
    this.generation++;
    this.initialToken = null;
    this.deferredCommit = false;
    this.sceneKeyPersistenceEnabled = false;
  }
}
