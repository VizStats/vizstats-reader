export type QueuePriority = "high" | "low";

export class CancelledError extends Error {
  constructor() {
    super("Voice generation cancelled.");
    this.name = "CancelledError";
  }
}

type QueueEntry<TJob, TResult> = {
  job: TJob;
  key: string;
  priority: QueuePriority;
  promise: Promise<TResult>;
  reject: (error: Error) => void;
  resolve: (result: TResult) => void;
};

/**
 * Single-concurrency priority queue for the Kokoro worker.
 *
 * - Keeps at most one job running on the worker at any time so newly requested
 *   play-head passages never get stuck behind a backlog of look-ahead jobs.
 * - Always dispatches "high" (play-head) jobs ahead of "low" (buffer-ahead).
 * - Deduplicates concurrent requests by key, promoting a queued "low" entry to
 *   "high" if the play head requests the same passage.
 * - Drops queued "low" entries immediately on seek, stop, or voice change.
 */
export class KokoroPriorityQueue<TJob, TResult> {
  private active: QueueEntry<TJob, TResult> | null = null;
  private queued: QueueEntry<TJob, TResult>[] = [];
  private byKey = new Map<string, QueueEntry<TJob, TResult>>();
  private runner: (job: TJob) => Promise<TResult>;

  constructor(runner: (job: TJob) => Promise<TResult>) {
    this.runner = runner;
  }

  enqueue(
    key: string,
    job: TJob,
    priority: QueuePriority = "high",
  ): Promise<TResult> {
    const existing = this.byKey.get(key);

    if (existing) {
      if (priority === "high" && existing.priority === "low") {
        existing.priority = "high";
      }

      return existing.promise;
    }

    let resolve!: (result: TResult) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<TResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Prevent unhandled-rejection noise when a queued low-priority job is
    // cancelled before any caller awaits it.
    void promise.catch(() => undefined);

    const entry: QueueEntry<TJob, TResult> = {
      job,
      key,
      priority,
      promise,
      reject,
      resolve,
    };

    this.byKey.set(key, entry);
    this.queued.push(entry);
    this.pump();

    return promise;
  }

  cancelLowPriority() {
    const remaining: QueueEntry<TJob, TResult>[] = [];

    for (const entry of this.queued) {
      if (entry.priority === "low") {
        this.byKey.delete(entry.key);
        entry.reject(new CancelledError());
      } else {
        remaining.push(entry);
      }
    }

    this.queued = remaining;
  }

  failAll(error: Error) {
    const entries = [...this.queued];

    if (this.active) {
      entries.push(this.active);
    }

    this.queued = [];
    this.active = null;
    this.byKey.clear();

    for (const entry of entries) {
      entry.reject(error);
    }
  }

  get pendingCount() {
    return this.queued.length + (this.active ? 1 : 0);
  }

  private pump() {
    if (this.active || this.queued.length === 0) {
      return;
    }

    const highIndex = this.queued.findIndex(
      (entry) => entry.priority === "high",
    );
    const nextIndex = highIndex >= 0 ? highIndex : 0;
    const [next] = this.queued.splice(nextIndex, 1);

    if (!next) {
      return;
    }

    this.active = next;

    void this.runner(next.job).then(
      (result) => {
        if (this.active === next) {
          this.active = null;
          this.byKey.delete(next.key);
          next.resolve(result);
          this.pump();
        }
      },
      (error: unknown) => {
        if (this.active === next) {
          this.active = null;
          this.byKey.delete(next.key);
          next.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
          this.pump();
        }
      },
    );
  }
}
