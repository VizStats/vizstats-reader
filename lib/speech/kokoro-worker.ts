import { KokoroTTS } from "kokoro-js";

import { resolveKokoroTargets } from "@/lib/speech/kokoro-config";
import type {
  KokoroTarget,
  KokoroVoiceId,
  KokoroWorkerRequest,
  KokoroWorkerResponse,
} from "@/lib/speech/kokoro-messages";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_CACHE_NAME = "kokoro-voices";
const VOICE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`;

type WebGPUAdapter = {
  features?: { has(feature: string): boolean };
};

type WebGPUNavigator = {
  gpu?: { requestAdapter(): Promise<WebGPUAdapter | null> };
};

const scope = self as unknown as {
  crossOriginIsolated?: boolean;
  postMessage(message: KokoroWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<KokoroWorkerRequest>) => void,
  ): void;
};

let ttsPromise: Promise<KokoroTTS> | null = null;
const prefetchedVoices = new Set<KokoroVoiceId>();

async function detectTargets(): Promise<KokoroTarget[]> {
  const gpu = (navigator as unknown as WebGPUNavigator).gpu;
  let hasWebGPU = false;
  let hasShaderF16 = false;

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();

      if (adapter) {
        hasWebGPU = true;
        hasShaderF16 = Boolean(adapter.features?.has("shader-f16"));
      }
    } catch {
      hasWebGPU = false;
    }
  }

  return resolveKokoroTargets({
    crossOriginIsolated: Boolean(scope.crossOriginIsolated),
    hasShaderF16,
    hasWebGPU,
  });
}

async function prefetchVoices(voices: KokoroVoiceId[]) {
  if (typeof caches === "undefined" || voices.length === 0) {
    return;
  }

  const missing = voices.filter((voice) => !prefetchedVoices.has(voice));

  if (missing.length === 0) {
    return;
  }

  let cache: Cache;

  try {
    cache = await caches.open(VOICE_CACHE_NAME);
  } catch {
    return;
  }

  await Promise.all(
    missing.map(async (voice) => {
      prefetchedVoices.add(voice);
      const url = `${VOICE_BASE_URL}/${voice}.bin`;

      try {
        const hit = await cache.match(url);

        if (hit) {
          return;
        }

        const response = await fetch(url);

        if (!response.ok) {
          prefetchedVoices.delete(voice);
          return;
        }

        await cache.put(url, response);
      } catch {
        prefetchedVoices.delete(voice);
      }
    }),
  );
}

function loadModel() {
  ttsPromise ??= (async () => {
    const targets = await detectTargets();
    let lastError: unknown;

    for (const target of targets) {
      const fileProgress = new Map<string, { loaded: number; total: number }>();

      try {
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: target.dtype,
          device: target.device,
          progress_callback: (info) => {
            if (info.status !== "progress") {
              return;
            }

            fileProgress.set(info.file, {
              loaded: info.loaded ?? 0,
              total: info.total ?? 0,
            });

            let loaded = 0;
            let total = 0;

            for (const file of fileProgress.values()) {
              loaded += file.loaded;
              total += file.total;
            }

            scope.postMessage({
              type: "progress",
              progress: total > 0 ? loaded / total : 0,
            });
          },
        });

        scope.postMessage({
          type: "ready",
          device: target.device,
          dtype: target.dtype,
        });

        return tts;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Unable to initialize natural voice engine.");
  })();

  return ttsPromise;
}

scope.addEventListener("message", (event) => {
  void handleRequest(event.data);
});

async function handleRequest(request: KokoroWorkerRequest) {
  if (request.type === "prefetch-voices") {
    await prefetchVoices(request.voices);
    return;
  }

  if (request.type === "init") {
    try {
      await loadModel();
    } catch (error) {
      ttsPromise = null;
      scope.postMessage({ type: "init-error", error: toErrorMessage(error) });
    }

    return;
  }

  try {
    const tts = await loadModel();
    const audio = await tts.generate(request.text, { voice: request.voice });
    const raw = audio.audio;
    const pcm =
      raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
        ? raw
        : new Float32Array(raw);

    scope.postMessage(
      { type: "result", id: request.id, pcm, sampleRate: audio.sampling_rate },
      [pcm.buffer],
    );
  } catch (error) {
    scope.postMessage({
      type: "generate-error",
      id: request.id,
      error: toErrorMessage(error),
    });
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
