/** Serialize partial writes by character, merging against the latest successful snapshot. */
export class CharacterWrites<T extends { id: string }> {
  private latest = new Map<string, T>();
  private queues = new Map<string, Promise<unknown>>();
  private write: (value: T) => Promise<unknown>;
  constructor(write: (value: T) => Promise<unknown>) {
    this.write = write;
  }
  save(base: T, patch: Partial<T>): Promise<T> {
    const pending = (this.queues.get(base.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const current = this.latest.get(base.id) ?? base;
        const next = { ...current, ...patch, id: base.id };
        await this.write(next);
        this.latest.set(base.id, next);
        return next;
      });
    this.queues.set(base.id, pending);
    return pending;
  }
  async drain(id: string) {
    await this.queues.get(id);
  }
  forget(id: string) {
    this.latest.delete(id);
    this.queues.delete(id);
  }
}
