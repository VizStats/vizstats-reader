"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  loadDeviceVoices,
  rankDeviceVoices,
} from "@/lib/speech/device-voices";
import {
  castDeviceVoices,
  castNaturalVoices,
  getCastCharacters,
  type CastCharacter,
  type CastOverrides,
} from "@/lib/speech/cast";
import { getKokoroEngine, isKokoroSupported } from "@/lib/speech/kokoro-engine";
import {
  DEFAULT_KOKORO_VOICE,
  isKokoroVoiceId,
  type KokoroVoiceId,
} from "@/lib/speech/kokoro-messages";
import {
  getSelectedChunkIndex,
  type ChunkSpeaker,
} from "@/lib/markdown/speech";

export type ReadAloudStatus =
  | "idle"
  | "playing"
  | "paused"
  | "loading"
  | "unsupported";

export type ReadAloudEngine = "device" | "natural";

const STORAGE_KEY = "markdown-reader:read-aloud";
// Table-read casting, per document name, so reopening a script keeps its cast.
const CAST_STORAGE_KEY = "markdown-reader:cast";

// Who speaks each passage of a screenplay, and which document's cast applies.
export type ReadAloudScript = {
  castKey: string;
  speakers: ChunkSpeaker[];
};

// How many passages the natural voice keeps generated ahead of the play head.
// A small rolling buffer starts playback fastest and stays well within the
// engine's audio cache — the YouTube "buffer a little ahead, then wait" model.
const BUFFER_AHEAD = 3;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type StoredPrefs = {
  engine?: ReadAloudEngine;
  deviceVoiceURI?: string | null;
  kokoroVoice?: string;
  rate?: number;
  tableRead?: boolean;
};

function readStoredPrefs(): StoredPrefs {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    return raw ? (JSON.parse(raw) as StoredPrefs) : {};
  } catch {
    return {};
  }
}

function writeStoredPrefs(partial: StoredPrefs) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readStoredPrefs(), ...partial }),
    );
  } catch {
    // Persistence is best-effort only.
  }
}

function readStoredCasts(): Record<string, CastOverrides> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CAST_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, CastOverrides>)
      : {};
  } catch {
    return {};
  }
}

function writeStoredCasts(casts: Record<string, CastOverrides>) {
  try {
    window.localStorage.setItem(CAST_STORAGE_KEY, JSON.stringify(casts));
  } catch {
    // Persistence is best-effort only.
  }
}

// The chosen device voice, or the best-ranked one when none is chosen.
function findDeviceVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI: null | string,
) {
  return (
    (preferredURI
      ? voices.find((voice) => voice.voiceURI === preferredURI)
      : undefined) ??
    voices[0] ??
    null
  );
}

function subscribeToKokoroProgress(onStoreChange: () => void) {
  if (!isKokoroSupported()) {
    return () => undefined;
  }

  return getKokoroEngine().subscribeProgress(onStoreChange);
}

function getKokoroProgressSnapshot(): number | null {
  return isKokoroSupported() ? getKokoroEngine().progress : null;
}

function getKokoroProgressServerSnapshot(): number | null {
  return null;
}

export function useReadAloud() {
  const chunksRef = useRef<string[]>([]);
  // The playing script's speakers and cast list; empty outside screenplays.
  const speakersRef = useRef<ChunkSpeaker[]>([]);
  const charactersRef = useRef<CastCharacter[]>([]);
  const castKeyRef = useRef<null | string>(null);
  const sessionRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playbackIndexRef = useRef(0);
  const [speechStatus, setSpeechStatus] =
    useState<Exclude<ReadAloudStatus, "unsupported">>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  // Highest passage index whose audio is generated (buffered) this session, or
  // -1 when nothing is buffered. Drives the lighter "download" bar. Only the
  // natural engine fills it; the device voice is streamed by the OS.
  const [bufferedIndex, setBufferedIndex] = useState(-1);
  // Which reader tab the current playback belongs to, and how many passages it
  // captured at start. These let a single lifted player keep reading one tab's
  // document while the user views another tab.
  const [sourceTabId, setSourceTabId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rate, setRateState] = useState(() => {
    const storedRate = readStoredPrefs().rate;

    return typeof storedRate === "number" && Number.isFinite(storedRate)
      ? Math.min(1.5, Math.max(0.75, storedRate))
      : 1;
  });
  const [engine, setEngineState] = useState<ReadAloudEngine>(() =>
    readStoredPrefs().engine === "natural" && isKokoroSupported()
      ? "natural"
      : "device",
  );
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoiceURI, setDeviceVoiceURIState] = useState<string | null>(
    () => readStoredPrefs().deviceVoiceURI ?? null,
  );
  const [kokoroVoice, setKokoroVoiceState] = useState<KokoroVoiceId>(() => {
    const storedVoice = readStoredPrefs().kokoroVoice;

    return storedVoice && isKokoroVoiceId(storedVoice)
      ? storedVoice
      : DEFAULT_KOKORO_VOICE;
  });
  const [tableRead, setTableReadState] = useState(
    () => readStoredPrefs().tableRead === true,
  );
  const [casts, setCasts] = useState(readStoredCasts);
  const modelProgress = useSyncExternalStore(
    subscribeToKokoroProgress,
    getKokoroProgressSnapshot,
    getKokoroProgressServerSnapshot,
  );

  const rateRef = useRef(rate);
  const engineRef = useRef(engine);
  const deviceVoicesRef = useRef(deviceVoices);
  const deviceVoiceURIRef = useRef(deviceVoiceURI);
  const kokoroVoiceRef = useRef(kokoroVoice);
  const tableReadRef = useRef(tableRead);
  const castsRef = useRef(casts);

  rateRef.current = rate;
  tableReadRef.current = tableRead;
  castsRef.current = casts;
  engineRef.current = engine;
  deviceVoicesRef.current = deviceVoices;
  deviceVoiceURIRef.current = deviceVoiceURI;
  kokoroVoiceRef.current = kokoroVoice;

  const deviceSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";
  const naturalSupported = isKokoroSupported();
  const engineSupported = engine === "device" ? deviceSupported : naturalSupported;
  const narratorDeviceVoice = findDeviceVoice(deviceVoices, deviceVoiceURI);
  const status: ReadAloudStatus = engineSupported ? speechStatus : "unsupported";

  useEffect(() => {
    if (!deviceSupported) {
      return;
    }

    let active = true;

    function refreshVoices() {
      void loadDeviceVoices().then((voices) => {
        if (active) {
          setDeviceVoices(rankDeviceVoices(voices));
        }
      });
    }

    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

    return () => {
      active = false;
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        refreshVoices,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Shared teardown for both React unmount (tab close/switch) and a hard
    // browser tab/window close, where unmount effects are not guaranteed to run
    // and speechSynthesis — a browser-global service — can keep speaking.
    function teardown() {
      sessionRef.current += 1;

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      cleanupAudio();
    }

    window.addEventListener("pagehide", teardown);

    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, []);

  function cleanupAudio() {
    const audio = audioRef.current;

    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audioRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  function finishPlayback(session: number) {
    if (session !== sessionRef.current) {
      return;
    }

    cleanupAudio();
    setCurrentIndex(0);
    setBufferedIndex(-1);
    setTotal(0);
    setSourceTabId(null);
    setSpeechStatus("idle");
  }

  // The voice for one passage: in a table read, the speaking character's
  // cast voice; otherwise, and for narration, the chosen narrator voice.
  function getChunkSpeaker(index: number) {
    return tableReadRef.current ? (speakersRef.current[index] ?? null) : null;
  }

  function getCastOverrides(): CastOverrides {
    return castKeyRef.current ? (castsRef.current[castKeyRef.current] ?? {}) : {};
  }

  function resolveNaturalVoice(index: number): KokoroVoiceId {
    const narrator = kokoroVoiceRef.current;
    const speaker = getChunkSpeaker(index);

    if (!speaker) {
      return narrator;
    }

    return (
      castNaturalVoices(
        charactersRef.current,
        narrator,
        getCastOverrides().natural,
      )[speaker] ?? narrator
    );
  }

  function resolveChunkDeviceVoice(index: number) {
    const narrator = resolveDeviceVoice();
    const speaker = getChunkSpeaker(index);

    if (!speaker) {
      return narrator;
    }

    const voiceURI = castDeviceVoices(
      charactersRef.current,
      deviceVoicesRef.current,
      narrator,
      getCastOverrides().device,
    )[speaker];

    return (
      deviceVoicesRef.current.find((voice) => voice.voiceURI === voiceURI) ??
      narrator
    );
  }

  function resolveDeviceVoice() {
    return findDeviceVoice(
      deviceVoicesRef.current,
      deviceVoiceURIRef.current,
    );
  }

  function speakDeviceChunk(index: number, session: number) {
    if (session !== sessionRef.current || !deviceSupported) {
      return;
    }

    const readableChunks = chunksRef.current;

    if (index >= readableChunks.length) {
      finishPlayback(session);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(readableChunks[index]);
    const voice = resolveChunkDeviceVoice(index);

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.rate = rateRef.current;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (session === sessionRef.current) {
        speakDeviceChunk(index + 1, session);
      }
    };
    utterance.onerror = () => {
      if (session === sessionRef.current) {
        setSpeechStatus("idle");
      }
    };

    playbackIndexRef.current = index;
    setCurrentIndex(index);
    setSpeechStatus("playing");
    window.speechSynthesis.speak(utterance);
  }

  async function playNaturalChunk(index: number, session: number) {
    if (session !== sessionRef.current) {
      return;
    }

    const readableChunks = chunksRef.current;

    if (index >= readableChunks.length) {
      finishPlayback(session);
      return;
    }

    const kokoro = getKokoroEngine();
    const voice = resolveNaturalVoice(index);
    const cached = kokoro.getCached(readableChunks[index], voice);

    playbackIndexRef.current = index;
    setCurrentIndex(index);

    if (!cached) {
      // The buffer has not caught up to the play head yet — show "buffering".
      setSpeechStatus("loading");
    }

    let blob: Blob;

    try {
      // Deduped against the buffer loop, so this reuses its in-flight job.
      blob = cached ?? (await kokoro.generate(readableChunks[index], voice));
    } catch {
      if (session === sessionRef.current) {
        setSpeechStatus("idle");
      }

      return;
    }

    if (session !== sessionRef.current) {
      return;
    }

    cleanupAudio();

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    objectUrlRef.current = url;
    audioRef.current = audio;
    audio.playbackRate = rateRef.current;
    audio.onended = () => {
      if (session === sessionRef.current) {
        void playNaturalChunk(index + 1, session);
      }
    };
    audio.onerror = () => {
      if (session === sessionRef.current) {
        setSpeechStatus("idle");
      }
    };

    setSpeechStatus("playing");
    void audio.play().catch(() => {
      if (session === sessionRef.current) {
        setSpeechStatus("idle");
      }
    });
  }

  // Generates audio ahead of the play head, staying at most BUFFER_AHEAD
  // passages in front, and advances `bufferedIndex` as each one is ready.
  async function bufferLoop(session: number, startIndex: number) {
    const kokoro = getKokoroEngine();
    const readableChunks = chunksRef.current;

    for (let index = startIndex; index < readableChunks.length; index++) {
      // Throttle: don't run more than BUFFER_AHEAD ahead of what's playing.
      // Polling keeps this deadlock-free and unparks within ~120ms of a
      // session change (stop / restart / voice or engine change / unmount).
      while (
        session === sessionRef.current &&
        index > playbackIndexRef.current + BUFFER_AHEAD
      ) {
        await delay(120);
      }

      if (session !== sessionRef.current) {
        return;
      }

      const voice = resolveNaturalVoice(index);

      if (!kokoro.getCached(readableChunks[index], voice)) {
        try {
          await kokoro.generate(readableChunks[index], voice);
        } catch {
          return;
        }
      }

      if (session !== sessionRef.current) {
        return;
      }

      setBufferedIndex((previous) => Math.max(previous, index));
    }
  }

  // Restart the active session's playback at a passage index, without touching
  // which tab/document owns it. Shared by start() and seek().
  function beginPlaybackAt(startIndex: number) {
    const readableChunks = chunksRef.current;
    const safeStartIndex = Math.min(
      Math.max(startIndex, 0),
      readableChunks.length - 1,
    );

    sessionRef.current += 1;

    const session = sessionRef.current;

    if (deviceSupported) {
      window.speechSynthesis.cancel();
    }

    cleanupAudio();
    setBufferedIndex(-1);
    playbackIndexRef.current = safeStartIndex;

    if (engineRef.current === "natural") {
      void bufferLoop(session, safeStartIndex);
      void playNaturalChunk(safeStartIndex, session);
    } else {
      speakDeviceChunk(safeStartIndex, session);
    }
  }

  function start(
    readableChunks: string[],
    sourceId: string,
    startIndex = 0,
    script?: ReadAloudScript,
  ) {
    if (!readableChunks.length || !engineSupported) {
      return;
    }

    chunksRef.current = readableChunks;
    speakersRef.current = script?.speakers ?? [];
    charactersRef.current = getCastCharacters(speakersRef.current);
    castKeyRef.current = script?.castKey ?? null;
    setSourceTabId(sourceId);
    setTotal(readableChunks.length);
    beginPlaybackAt(startIndex);
  }

  // Jump the current session to another passage (fast-forward / rewind).
  // Rewinding replays cached audio instantly; seeking past the buffer shows the
  // usual "buffering" state while that passage generates.
  function seek(targetIndex: number) {
    if (sourceTabId == null || !chunksRef.current.length || !engineSupported) {
      return;
    }

    beginPlaybackAt(targetIndex);
  }

  // Step relative to the live play head (not React state), so rapid prev/next
  // clicks accumulate correctly instead of collapsing onto one stale index.
  function seekBy(delta: number) {
    const targetIndex = playbackIndexRef.current + delta;

    if (targetIndex < 0 || targetIndex >= chunksRef.current.length) {
      return;
    }

    seek(targetIndex);
  }

  function startFromSelection(
    readableChunks: string[],
    sourceId: string,
    script?: ReadAloudScript,
  ) {
    start(
      readableChunks,
      sourceId,
      getSelectedChunkIndex(readableChunks) ?? 0,
      script,
    );
  }

  function pause() {
    if (status !== "playing") {
      return;
    }

    if (engineRef.current === "natural") {
      audioRef.current?.pause();
    } else if (deviceSupported) {
      window.speechSynthesis.pause();
    }

    setSpeechStatus("paused");
  }

  function resume() {
    if (status !== "paused") {
      return;
    }

    if (engineRef.current === "natural") {
      void audioRef.current?.play().catch(() => setSpeechStatus("idle"));
    } else if (deviceSupported) {
      window.speechSynthesis.resume();
    }

    setSpeechStatus("playing");
  }

  function stop() {
    sessionRef.current += 1;

    if (deviceSupported) {
      window.speechSynthesis.cancel();
    }

    cleanupAudio();
    setCurrentIndex(0);
    setBufferedIndex(-1);
    setTotal(0);
    setSourceTabId(null);
    setSpeechStatus("idle");
  }

  function setRate(nextRate: number) {
    const safeRate = Math.min(1.5, Math.max(0.75, nextRate));

    setRateState(safeRate);

    if (audioRef.current) {
      audioRef.current.playbackRate = safeRate;
    }

    writeStoredPrefs({ rate: safeRate });
  }

  function setEngine(nextEngine: ReadAloudEngine) {
    if (nextEngine === engineRef.current) {
      return;
    }

    stop();
    setEngineState(nextEngine);
    writeStoredPrefs({ engine: nextEngine });
  }

  function setDeviceVoiceURI(nextVoiceURI: string | null) {
    setDeviceVoiceURIState(nextVoiceURI);
    writeStoredPrefs({ deviceVoiceURI: nextVoiceURI });
  }

  function setKokoroVoice(nextVoice: KokoroVoiceId) {
    setKokoroVoiceState(nextVoice);
    writeStoredPrefs({ kokoroVoice: nextVoice });
  }

  // Turning the table read on or off changes the passages themselves (names
  // are announced only without it), so playback stops.
  function setTableRead(nextTableRead: boolean) {
    if (nextTableRead === tableReadRef.current) {
      return;
    }

    stop();
    setTableReadState(nextTableRead);
    writeStoredPrefs({ tableRead: nextTableRead });
  }

  // The current engine's cast for a script: every speaking character, leads
  // first, with the voice they will read in. A recast takes effect from the
  // next passage, even mid-read.
  function getCast(castKey: string, speakers: ChunkSpeaker[]) {
    const characters = getCastCharacters(speakers);
    const overrides = casts[castKey] ?? {};
    const voices: Record<string, string> =
      engine === "natural"
        ? castNaturalVoices(characters, kokoroVoice, overrides.natural)
        : castDeviceVoices(
            characters,
            deviceVoices,
            narratorDeviceVoice,
            overrides.device,
          );

    return { characters, voices };
  }

  function updateCast(
    castKey: string,
    update: (overrides: Record<string, string>) => Record<string, string>,
  ) {
    const engineKey = engineRef.current;
    const current = castsRef.current[castKey] ?? {};
    const next = {
      ...castsRef.current,
      [castKey]: { ...current, [engineKey]: update(current[engineKey] ?? {}) },
    };

    castsRef.current = next;
    setCasts(next);
    writeStoredCasts(next);
  }

  function setCharacterVoice(castKey: string, name: string, voice: string) {
    updateCast(castKey, (overrides) => ({ ...overrides, [name]: voice }));
  }

  function resetCast(castKey: string) {
    updateCast(castKey, () => ({}));
  }

  return {
    bufferedIndex,
    currentIndex,
    deviceSupported,
    deviceVoiceURI,
    deviceVoices,
    engine,
    getCast,
    kokoroVoice,
    narratorDeviceVoice,
    modelProgress,
    naturalSupported,
    pause,
    rate,
    resetCast,
    resume,
    seek,
    seekBy,
    setCharacterVoice,
    setDeviceVoiceURI,
    setEngine,
    setKokoroVoice,
    setRate,
    setTableRead,
    sourceTabId,
    start,
    startFromSelection,
    status,
    stop,
    tableRead,
    total,
  };
}

export type ReadAloudController = ReturnType<typeof useReadAloud>;

export function getReadAloudStatusText(
  status: ReadAloudStatus,
  currentPosition: number,
  total: number,
  modelProgress?: number | null,
) {
  if (status === "unsupported") {
    return "Voice reading is unavailable in this browser.";
  }

  if (total === 0) {
    return "No readable preview text.";
  }

  if (status === "loading") {
    return modelProgress != null && modelProgress < 1
      ? `Downloading voice model… ${Math.round(modelProgress * 100)}%`
      : "Preparing natural voice…";
  }

  if (status === "playing") {
    return `Reading ${currentPosition} of ${total}`;
  }

  if (status === "paused") {
    return `Paused at ${currentPosition} of ${total}`;
  }

  return `${total} ${total === 1 ? "passage" : "passages"} ready`;
}
