import { KokoroTTS } from "kokoro-js";

import {
  resolveKokoroPlan,
  trimSilence,
} from "@/lib/speech/kokoro-config";
import type {
  KokoroPerformanceMode,
  KokoroTarget,
  KokoroVoiceId,
  KokoroWorkerRequest,
  KokoroWorkerResponse,
} from "@/lib/speech/kokoro-messages";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_CACHE_NAME = "kokoro-voices";
const VOICE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`;
// transformers.js keeps downloaded model files in Cache Storage under this
// name, keyed by their Hub URL. The fp32 weights are `onnx/model.onnx`.
const MODEL_CACHE_NAME = "transformers-cache";
const FULL_MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model.onnx`;

type WebGPUNavigator = {
  gpu?: { requestAdapter(): Promise<unknown> };
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
let loadedMode: KokoroPerformanceMode = "auto";
// The model that speaks. A background upgrade replaces it; the one it replaces
// is released once no passage is still being generated on it.
let activeTts: KokoroTTS | null = null;
let retiredTts: KokoroTTS | null = null;
let generating = 0;
const prefetchedVoices = new Set<KokoroVoiceId>();

async function hasWebGPUAdapter() {
  const gpu = (navigator as unknown as WebGPUNavigator).gpu;

  if (!gpu) {
    return false;
  }

  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function isFullModelCached() {
  if (typeof caches === "undefined") {
    return false;
  }

  try {
    const cache = await caches.open(MODEL_CACHE_NAME);

    return Boolean(await cache.match(FULL_MODEL_URL));
  } catch {
    return false;
  }
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

function postProgress(fileProgress: Map<string, { loaded: number; total: number }>) {
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
}

function loadTarget(target: KokoroTarget, reportProgress: boolean) {
  const fileProgress = new Map<string, { loaded: number; total: number }>();

  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: target.dtype,
    device: target.device,
    progress_callback: reportProgress
      ? (info) => {
          if (info.status !== "progress") {
            return;
          }

          fileProgress.set(info.file, {
            loaded: info.loaded ?? 0,
            total: info.total ?? 0,
          });
          postProgress(fileProgress);
        }
      : undefined,
  });
}

function sameTarget(a: KokoroTarget, b: KokoroTarget) {
  return a.device === b.device && a.dtype === b.dtype;
}

function releaseRetired() {
  if (!retiredTts || generating > 0) {
    return;
  }

  const retired = retiredTts;

  retiredTts = null;
  void retired.model.dispose().catch(() => undefined);
}

// Loads the faster runtime while the first one keeps speaking, then swaps it
// in. On failure the first runtime simply carries on.
async function upgradeTo(target: KokoroTarget, current: KokoroTarget) {
  try {
    const tts = await loadTarget(target, false);

    retiredTts = activeTts;
    activeTts = tts;
    scope.postMessage({ type: "ready", ...target, upgrading: false });
    releaseRetired();
  } catch {
    scope.postMessage({ type: "ready", ...current, upgrading: false });
  }
}

function loadModel(mode: KokoroPerformanceMode = loadedMode) {
  loadedMode = mode;
  ttsPromise ??= (async () => {
    const [hasWebGPU, fullModelCached] = await Promise.all([
      hasWebGPUAdapter(),
      isFullModelCached(),
    ]);
    const plan = resolveKokoroPlan({
      crossOriginIsolated: Boolean(scope.crossOriginIsolated),
      fullModelCached,
      hasWebGPU,
      mode,
    });
    let lastError: unknown;

    for (const target of plan.targets) {
      try {
        const tts = await loadTarget(target, true);
        const upgrade =
          plan.upgrade && !sameTarget(plan.upgrade, target)
            ? plan.upgrade
            : null;

        activeTts = tts;
        scope.postMessage({
          type: "ready",
          ...target,
          upgrading: Boolean(upgrade),
        });

        if (upgrade) {
          void upgradeTo(upgrade, target);
        }

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
      await loadModel(request.mode);
    } catch (error) {
      ttsPromise = null;
      scope.postMessage({ type: "init-error", error: toErrorMessage(error) });
    }

    return;
  }

  generating += 1;

  try {
    const loaded = await loadModel();
    const tts = activeTts ?? loaded;
    const audio = await tts.generate(request.text, { voice: request.voice });
    const trimmed = trimSilence(audio.audio, audio.sampling_rate);
    const pcm =
      trimmed.byteOffset === 0 &&
      trimmed.byteLength === trimmed.buffer.byteLength
        ? trimmed
        : new Float32Array(trimmed);

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
  } finally {
    generating -= 1;
    releaseRetired();
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
