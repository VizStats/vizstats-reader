import { describe, expect, it } from "vitest";

import {
  CancelledError,
  KokoroPriorityQueue,
} from "@/lib/speech/kokoro-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

describe("KokoroPriorityQueue", () => {
  it("dispatches high-priority play-head jobs ahead of queued low-priority buffer jobs", async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();

    const queue = new KokoroPriorityQueue<string, string>((job) => {
      started.push(job);
      const gate = deferred<string>();

      gates.set(job, gate);
      return gate.promise;
    });

    const p1 = queue.enqueue("a", "a", "low");
    const p2 = queue.enqueue("b", "b", "low");
    const p3 = queue.enqueue("c", "c", "high");

    expect(started).toEqual(["a"]);

    gates.get("a")!.resolve("A");
    expect(await p1).toBe("A");
    expect(started).toEqual(["a", "c"]);

    gates.get("c")!.resolve("C");
    expect(await p3).toBe("C");
    expect(started).toEqual(["a", "c", "b"]);

    gates.get("b")!.resolve("B");
    expect(await p2).toBe("B");
  });

  it("promotes a deduplicated low-priority job to high priority when the play head asks for it", async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();

    const queue = new KokoroPriorityQueue<string, string>((job) => {
      started.push(job);
      const gate = deferred<string>();

      gates.set(job, gate);
      return gate.promise;
    });

    const p1 = queue.enqueue("active", "active", "low");
    const p2 = queue.enqueue("other", "other", "low");
    const p3Low = queue.enqueue("target", "target", "low");
    const p3High = queue.enqueue("target", "target", "high");

    expect(p3High).toBe(p3Low);

    gates.get("active")!.resolve("OK");
    await p1;
    expect(started).toEqual(["active", "target"]);

    gates.get("target")!.resolve("TARGET");
    expect(await p3High).toBe("TARGET");

    gates.get("other")!.resolve("OTHER");
    expect(await p2).toBe("OTHER");
  });

  it("cancels queued low-priority jobs on seek while preserving active and high-priority jobs", async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();

    const queue = new KokoroPriorityQueue<string, string>((job) => {
      started.push(job);
      const gate = deferred<string>();

      gates.set(job, gate);
      return gate.promise;
    });

    const active = queue.enqueue("active", "active", "low");
    const stale = queue.enqueue("stale", "stale", "low");
    const urgent = queue.enqueue("urgent", "urgent", "high");

    queue.cancelLowPriority();

    await expect(stale).rejects.toBeInstanceOf(CancelledError);

    gates.get("active")!.resolve("ACTIVE");
    expect(await active).toBe("ACTIVE");
    expect(started).toEqual(["active", "urgent"]);

    gates.get("urgent")!.resolve("URGENT");
    expect(await urgent).toBe("URGENT");
  });
});
