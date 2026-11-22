import type { KokoroAudio } from "@/lib/speech/kokoro-messages";

const DATABASE_NAME = "vizstats-reader-speech";
// Bumped to v2 to clear any v1 clips generated under WebGPU fp16.
const DATABASE_VERSION = 2;
const STORE_NAME = "chunks";
const MAX_PERSISTED_CHUNKS = 256;

type CachedAudioRecord = {
  key: string;
  pcm16: ArrayBuffer;
  sampleRate: number;
  updatedAt: number;
};

export function encodePcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));

    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  return out.buffer;
}

export function decodePcm16(buffer: ArrayBuffer): Float32Array {
  const input = new Int16Array(buffer);
  const out = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const value = input[i] ?? 0;

    out[i] = value < 0 ? value / 32768 : value / 32767;
  }

  return out;
}

function getIndexedDB(): IDBFactory | null {
  if (typeof globalThis === "undefined" || !("indexedDB" in globalThis)) {
    return null;
  }

  return globalThis.indexedDB ?? null;
}

function openSpeechDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();

  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = idb.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });

          store.createIndex("updatedAt", "updatedAt", { unique: false });
        } else if (event.oldVersion < 2 && request.transaction) {
          request.transaction.objectStore(STORE_NAME).clear();
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadPersistedAudio(
  key: string,
): Promise<KokoroAudio | null> {
  const db = await openSpeechDatabase();

  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as CachedAudioRecord | undefined;

        if (
          !record ||
          !(record.pcm16 instanceof ArrayBuffer) ||
          typeof record.sampleRate !== "number"
        ) {
          resolve(null);
          return;
        }

        resolve({
          pcm: decodePcm16(record.pcm16),
          sampleRate: record.sampleRate,
        });
      };
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function savePersistedAudio(
  key: string,
  audio: KokoroAudio,
  maxEntries = MAX_PERSISTED_CHUNKS,
): Promise<void> {
  const db = await openSpeechDatabase();

  if (!db) {
    return;
  }

  const record: CachedAudioRecord = {
    key,
    pcm16: encodePcm16(audio.pcm),
    sampleRate: audio.sampleRate,
    updatedAt: Date.now(),
  };

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      store.put(record);

      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const overflow = countRequest.result - maxEntries;

        if (overflow <= 0) {
          return;
        }

        let removed = 0;
        const index = store.index("updatedAt");
        const cursorRequest = index.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;

          if (!cursor || removed >= overflow) {
            return;
          }

          cursor.delete();
          removed += 1;
          cursor.continue();
        };
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
