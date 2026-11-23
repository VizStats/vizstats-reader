import {
  loadPersistedAudio,
  savePersistedAudio,
} from "@/lib/speech/kokoro-cache";
import type {
  KokoroAudio,
  KokoroPerformanceMode,
  KokoroRuntime,
  KokoroVoiceId,
  KokoroWorkerRequest,
  KokoroWorkerResponse,
} from "@/lib/speech/kokoro-messages";
import {
  KokoroPriorityQueue,
  type QueuePriority,
} from "@/lib/speech/kokoro-queue";

const AUDIO_CACHE_LIMIT = 96;

type PendingWorkerJob = {
  resolve: (audio: KokoroAudio) => void;
  reject: (error: Error) => void;
};

type GenerateJob = {
  key: string;
  text: string;
  voice: KokoroVoiceId;
};

export type KokoroEngineState = "idle" | "loading" | "ready" | "error";

class KokoroEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private pending = new Map<number, PendingWorkerJob>();
  private nextRequestId = 1;
  private cache = new Map<string, KokoroAudio>();
  private progressListeners = new Set<(progress: number) => void>();
  private queue: KokoroPriorityQueue<GenerateJob, KokoroAudio>;
  // What the current worker has been sent but not yet answered. A worker
  // whose script the browser refuses never answers, and its replacement is
  // sent these again.
  private unanswered: KokoroWorkerRequest[] = [];
  private workerAnswered = false;
  private workerScriptUrl: null | string = null;
  private refetchedWorkerScript = false;
  private restarting = false;
  // Moves on whenever the worker is torn down, so a restart that finishes
  // after a reset or failure does nothing.
  private workerGeneration = 0;

  state: KokoroEngineState = "idle";
  progress = 0;
  runtime: KokoroRuntime | null = null;
  mode: KokoroPerformanceMode = "auto";

  constructor() {
    this.queue = new KokoroPriorityQueue((job) => this.runWorkerJob(job));
  }

  static isSupported() {
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof WebAssembly !== "undefined"
    );
  }

  subscribeProgress(listener: (progress: number) => void) {
    this.progressListeners.add(listener);

    return () => {
      this.progressListeners.delete(listener);
    };
  }

  setMode(nextMode: KokoroPerformanceMode, voices: KokoroVoiceId[] = []) {
    if (nextMode === this.mode) {
      return;
    }

    this.mode = nextMode;

    if (this.worker || this.readyPromise) {
      this.resetWorker();
      this.prewarm(voices);
    }
  }

  /**
   * Starts loading the ONNX model and prefetches voice embeddings in the
   * background so clicking Play starts immediately instead of waiting on cold
   * worker + model initialization.
   */
  prewarm(voices: KokoroVoiceId[] = [], mode?: KokoroPerformanceMode) {
    if (!KokoroEngine.isSupported()) {
      return;
    }

    if (mode && mode !== this.mode) {
      this.mode = mode;

      if (this.worker || this.readyPromise) {
        this.resetWorker();
      }
    }

    if (voices.length > 0) {
      this.prefetchVoices(voices);
    }

    if (this.state === "idle" || this.state === "error") {
      void this.ensureReady().catch(() => undefined);
    }
  }

  prefetchVoices(voices: KokoroVoiceId[]) {
    if (!KokoroEngine.isSupported() || voices.length === 0) {
      return;
    }

    const unique = Array.from(new Set(voices));

    this.post({ type: "prefetch-voices", voices: unique });
  }

  ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    if (!KokoroEngine.isSupported()) {
      return Promise.reject(
        new Error("Natural voices are not supported in this browser."),
      );
    }

    this.state = "loading";
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.post({ type: "init", mode: this.mode });

    return this.readyPromise;
  }

  getCached(text: string, voice: KokoroVoiceId) {
    return this.cache.get(getCacheKey(text, voice)) ?? null;
  }

  generate(
    text: string,
    voice: KokoroVoiceId,
    priority: QueuePriority = "high",
  ): Promise<KokoroAudio> {
    const key = getCacheKey(text, voice);
    const cached = this.cache.get(key);

    if (cached) {
      return Promise.resolve(cached);
    }

    return this.queue.enqueue(key, { key, text, voice }, priority);
  }

  /**
   * Drops queued look-ahead jobs so a seek, stop, or voice change never waits
   * behind stale background synthesis work.
   */
  cancelLowPriority() {
    this.queue.cancelLowPriority();
  }

  private async runWorkerJob(job: GenerateJob): Promise<KokoroAudio> {
    const cached = this.cache.get(job.key);

    if (cached) {
      return cached;
    }

    const persisted = await loadPersistedAudio(job.key);

    if (persisted) {
      this.storeInCache(job.key, persisted);
      return persisted;
    }

    await this.ensureReady();

    return new Promise<KokoroAudio>((resolve, reject) => {
      const id = this.nextRequestId++;

      this.pending.set(id, {
        resolve: (audio) => {
          this.storeInCache(job.key, audio);
          void savePersistedAudio(job.key, audio);
          resolve(audio);
        },
        reject,
      });
      this.post({
        type: "generate",
        id,
        text: job.text,
        voice: job.voice,
      });
    });
  }

  private post(message: KokoroWorkerRequest) {
    if (this.restarting) {
      // Sent to the new worker once its script is fetched again.
      this.unanswered.push(message);
      return;
    }

    const worker = this.getWorker();

    if (!this.workerAnswered) {
      this.unanswered.push(message);
    }

    worker.postMessage(message);
  }

  private getWorker() {
    if (!this.worker) {
      const { scriptUrl, worker } = createVoiceWorker();

      this.worker = worker;
      this.workerScriptUrl = scriptUrl;
      this.workerAnswered = false;
      worker.onmessage = (event: MessageEvent<KokoroWorkerResponse>) => {
        this.workerAnswered = true;
        this.unanswered = [];
        this.handleResponse(event.data);
      };
      worker.onerror = () => {
        if (
          !this.workerAnswered &&
          !this.refetchedWorkerScript &&
          this.workerScriptUrl
        ) {
          void this.restartWithFreshScript(this.workerScriptUrl);
          return;
        }

        this.failEverything(new Error("The voice engine crashed."));
      };
    }

    return this.worker;
  }

  // A browser that cached the worker's script from a build served without
  // cross-origin isolation headers refuses that copy now: the file keeps its
  // name across deploys and may be cached for a year. Fetching it again
  // replaces the cached copy; a new worker then gets what the refused one
  // never received. Tried once per page load.
  private async restartWithFreshScript(scriptUrl: string) {
    const generation = this.workerGeneration;
    const freshUrl = new URL(scriptUrl, location.href);

    freshUrl.hash = "";
    this.refetchedWorkerScript = true;
    this.restarting = true;
    this.worker?.terminate();
    this.worker = null;

    try {
      await fetch(freshUrl.href, { cache: "reload" });
    } catch {
      // The new worker is refused too, and reports the failure.
    }

    if (generation !== this.workerGeneration) {
      return;
    }

    const messages = this.unanswered;

    this.restarting = false;
    this.unanswered = [];

    for (const message of messages) {
      this.post(message);
    }
  }

  private handleResponse(response: KokoroWorkerResponse) {
    switch (response.type) {
      case "progress": {
        this.notifyProgress(response.progress);
        return;
      }
      case "ready": {
        this.state = "ready";
        this.runtime = {
          device: response.device,
          dtype: response.dtype,
          upgrading: response.upgrading,
        };
        this.notifyProgress(1);
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        return;
      }
      case "init-error": {
        this.failEverything(new Error(response.error));
        return;
      }
      case "result": {
        const request = this.pending.get(response.id);

        this.pending.delete(response.id);
        request?.resolve({
          pcm: response.pcm,
          sampleRate: response.sampleRate,
        });
        return;
      }
      case "generate-error": {
        const request = this.pending.get(response.id);

        this.pending.delete(response.id);
        request?.reject(new Error(response.error));
        return;
      }
    }
  }

  private notifyProgress(progress: number) {
    this.progress = progress;

    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private resetWorker() {
    const error = new Error("Switching natural voice runtime.");

    this.state = "idle";
    this.runtime = null;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;

    for (const request of this.pending.values()) {
      request.reject(error);
    }

    this.pending.clear();
    this.queue.failAll(error);
    this.dropWorker();
    this.notifyProgress(0);
  }

  private dropWorker() {
    this.workerGeneration += 1;
    this.restarting = false;
    this.unanswered = [];
    this.workerAnswered = false;
    this.worker?.terminate();
    this.worker = null;
  }

  private failEverything(error: Error) {
    this.state = "error";
    this.runtime = null;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;

    for (const request of this.pending.values()) {
      request.reject(error);
    }

    this.pending.clear();
    this.queue.failAll(error);
    this.dropWorker();
  }

  private storeInCache(key: string, audio: KokoroAudio) {
    if (this.cache.has(key)) {
      return;
    }

    if (this.cache.size >= AUDIO_CACHE_LIMIT) {
      const oldestKey = this.cache.keys().next().value;

      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, audio);
  }
}

// Turbopack compiles `new Worker(new URL(...))` into a loader that calls the
// global Worker with its own bootstrap script. Note the URL it passes: when
// the browser refuses that script, the page has no other way to learn it.
function createVoiceWorker() {
  const NativeWorker = globalThis.Worker;
  const seen: { url: null | string } = { url: null };

  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      seen.url = String(url);
    }
  };

  try {
    const worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), {
      type: "module",
    });

    return { scriptUrl: seen.url, worker };
  } finally {
    globalThis.Worker = NativeWorker;
  }
}

function getCacheKey(text: string, voice: KokoroVoiceId) {
  return `v3|${voice}|${text}`;
}

let engine: KokoroEngine | null = null;

export function getKokoroEngine() {
  engine ??= new KokoroEngine();

  return engine;
}

export function isKokoroSupported() {
  return KokoroEngine.isSupported();
}
