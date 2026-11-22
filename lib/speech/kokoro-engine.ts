import {
  loadPersistedAudio,
  savePersistedAudio,
} from "@/lib/speech/kokoro-cache";
import type {
  KokoroAudio,
  KokoroTarget,
  KokoroVoiceId,
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

  state: KokoroEngineState = "idle";
  progress = 0;
  runtime: KokoroTarget | null = null;

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

  /**
   * Starts loading the ONNX model and prefetches voice embeddings in the
   * background so clicking Play starts immediately instead of waiting on cold
   * worker + model initialization.
   */
  prewarm(voices: KokoroVoiceId[] = []) {
    if (!KokoroEngine.isSupported()) {
      return;
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

    this.getWorker().postMessage({ type: "prefetch-voices", voices: unique });
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

    this.getWorker().postMessage({ type: "init" });

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
      this.getWorker().postMessage({
        type: "generate",
        id,
        text: job.text,
        voice: job.voice,
      });
    });
  }

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./kokoro-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<KokoroWorkerResponse>) => {
        this.handleResponse(event.data);
      };
      this.worker.onerror = () => {
        this.failEverything(new Error("The voice engine crashed."));
      };
    }

    return this.worker;
  }

  private handleResponse(response: KokoroWorkerResponse) {
    switch (response.type) {
      case "progress": {
        this.notifyProgress(response.progress);
        return;
      }
      case "ready": {
        this.state = "ready";
        this.runtime = { device: response.device, dtype: response.dtype };
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
    this.worker?.terminate();
    this.worker = null;
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

function getCacheKey(text: string, voice: KokoroVoiceId) {
  return `v2|${voice}|${text}`;
}

let engine: KokoroEngine | null = null;

export function getKokoroEngine() {
  engine ??= new KokoroEngine();

  return engine;
}

export function isKokoroSupported() {
  return KokoroEngine.isSupported();
}
