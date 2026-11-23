import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for the browser's Worker. A refused worker fires `error` before
// it ever answers, the way a browser does when it rejects the script.
class FakeWorker {
  static instances: FakeWorker[] = [];
  static refusals = 0;

  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  url: string;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWorker.instances.push(this);

    if (FakeWorker.refusals > 0) {
      FakeWorker.refusals -= 1;
      queueMicrotask(() => this.onerror?.(new Event("error")));
    }
  }

  answer(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const READY = { device: "webgpu", dtype: "fp32", type: "ready", upgrading: false };

async function loadEngine() {
  const { getKokoroEngine } = await import("@/lib/speech/kokoro-engine");

  return getKokoroEngine();
}

describe("a voice worker the browser refuses", () => {
  const fetchMock = vi.fn(async () => new Response(""));

  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    FakeWorker.refusals = 0;
    fetchMock.mockClear();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { href: "https://reader.test/" });
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches its script again and sends a new worker what the first never received", async () => {
    // A copy cached from a build without cross-origin isolation headers.
    FakeWorker.refusals = 1;
    const engine = await loadEngine();
    const ready = engine.ensureReady();

    engine.prefetchVoices(["af_heart"]);

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const [refused, fresh] = FakeWorker.instances;

    expect(refused!.terminated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(refused!.url.split("#")[0]!, "https://reader.test/").href,
      { cache: "reload" },
    );
    expect(fresh!.posted).toEqual([
      { mode: "auto", type: "init" },
      { type: "prefetch-voices", voices: ["af_heart"] },
    ]);

    fresh!.answer(READY);

    await expect(ready).resolves.toBeUndefined();
    expect(engine.state).toBe("ready");
  });

  it("reports the failure when the fresh script is refused too", async () => {
    FakeWorker.refusals = 2;
    const engine = await loadEngine();

    await expect(engine.ensureReady()).rejects.toThrow(
      "The voice engine crashed.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(engine.state).toBe("error");
  });

  it("does not fetch again when a worker that already answered crashes", async () => {
    const engine = await loadEngine();
    const ready = engine.ensureReady();
    const [worker] = FakeWorker.instances;

    worker!.answer({ progress: 0.2, type: "progress" });
    worker!.onerror?.(new Event("error"));

    await expect(ready).rejects.toThrow("The voice engine crashed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
