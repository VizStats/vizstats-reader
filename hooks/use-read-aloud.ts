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
  getSharedVoicePitches,
  type CastCharacter,
  type CastOverrides,
  type CharacterGender,
} from "@/lib/speech/cast";
import { splitForFastStart } from "@/lib/speech/kokoro-config";
import { getKokoroEngine, isKokoroSupported } from "@/lib/speech/kokoro-engine";
import {
  DEFAULT_KOKORO_VOICE,
  isKokoroVoiceId,
  type KokoroAudio,
  type KokoroTarget,
  type KokoroVoiceId,
} from "@/lib/speech/kokoro-messages";
import { CancelledError } from "@/lib/speech/kokoro-queue";
import { WebAudioPlayer } from "@/lib/speech/web-audio-player";
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
  // Per passage: whether it is flagged, or null where it cannot be.
  flags: (boolean | null)[];
  genders: Record<string, CharacterGender>;
  // Flags or unflags a passage of the document on screen, without stopping
  // the read.
  onToggleFlag: (index: number) => void;
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

function getKokoroRuntimeSnapshot(): KokoroTarget | null {
  return isKokoroSupported() ? getKokoroEngine().runtime : null;
}

function getKokoroRuntimeServerSnapshot(): KokoroTarget | null {
  return null;
}

export function useReadAloud() {
  const chunksRef = useRef<string[]>([]);
  // The playing script's speakers and cast list; empty outside screenplays.
  const speakersRef = useRef<ChunkSpeaker[]>([]);
  const charactersRef = useRef<CastCharacter[]>([]);
  const castKeyRef = useRef<null | string>(null);
  const sessionRef = useRef(0);
  const webAudioRef = useRef<WebAudioPlayer | null>(null);
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
  const kokoroRuntime = useSyncExternalStore(
    subscribeToKokoroProgress,
    getKokoroRuntimeSnapshot,
    getKokoroRuntimeServerSnapshot,
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

  // Prewarm the natural voice worker, ONNX model, and active voice embedding
  // immediately on mount whenever the user has selected the natural engine, so
  // clicking Play starts without cold model initialization delay.
  useEffect(() => {
    if (engine !== "natural" || !naturalSupported) {
      return;
    }

    getKokoroEngine().prewarm([kokoroVoiceRef.current]);
  }, [engine, naturalSupported]);

  useEffect(() => {
    // Shared teardown for both React unmount (tab close/switch) and a hard
    // browser tab/window close, where unmount effects are not guaranteed to run
    // and speechSynthesis — a browser-global service — can keep speaking.
    function teardown() {
      sessionRef.current += 1;

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      if (isKokoroSupported()) {
        getKokoroEngine().cancelLowPriority();
      }

      cleanupAudio();
    }

    window.addEventListener("pagehide", teardown);

    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
      webAudioRef.current?.dispose();
      webAudioRef.current = null;
    };
  }, []);

  function getWebAudioPlayer() {
    webAudioRef.current ??= new WebAudioPlayer();

    return webAudioRef.current;
  }

  function cleanupAudio() {
    webAudioRef.current?.stop();
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

  // A device voice and its pitch: characters who share a voice are pitched
  // apart.
  function resolveChunkDeviceVoice(index: number) {
    const narrator = resolveDeviceVoice();
    const speaker = getChunkSpeaker(index);

    if (!speaker) {
      return { pitch: 1, voice: narrator };
    }

    const cast = castDeviceVoices(
      charactersRef.current,
      deviceVoicesRef.current,
      narrator,
      getCastOverrides().device,
    );
    const pitch =
      getSharedVoicePitches(charactersRef.current, cast, narrator?.voiceURI)[
        speaker
      ] ?? 1;

    return {
      pitch,
      voice:
        deviceVoicesRef.current.find(
          (voice) => voice.voiceURI === cast[speaker],
        ) ?? narrator,
    };
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
    const { pitch, voice } = resolveChunkDeviceVoice(index);

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.rate = rateRef.current;
    utterance.pitch = pitch;
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

  function playAudioClip(
    audio: KokoroAudio,
    session: number,
    onEnded: () => void,
  ) {
    setSpeechStatus("playing");
    void getWebAudioPlayer()
      .play(audio, rateRef.current, () => {
        if (session === sessionRef.current) {
          onEnded();
        }
      })
      .catch(() => {
        if (session === sessionRef.current) {
          setSpeechStatus("idle");
        }
      });
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
    const text = readableChunks[index];
    const voice = resolveNaturalVoice(index);
    const cached = kokoro.getCached(text, voice);

    playbackIndexRef.current = index;
    setCurrentIndex(index);

    if (cached) {
      setBufferedIndex((previous) => Math.max(previous, index));
      playAudioClip(cached, session, () => {
        void playNaturalChunk(index + 1, session);
      });
      return;
    }

    // Fast-start: when the play head hits an uncached multi-sentence passage,
    // synthesize its short opening sentence first and immediately queue the
    // remainder behind it so audio starts speaking 2–3× sooner.
    const segments = splitForFastStart(text);
    const [firstSegment, restSegment] = segments;

    if (!firstSegment) {
      void playNaturalChunk(index + 1, session);
      return;
    }

    const cachedFirst = kokoro.getCached(firstSegment, voice);

    if (!cachedFirst) {
      setSpeechStatus("loading");
    }

    let firstAudio: KokoroAudio;

    try {
      firstAudio =
        cachedFirst ?? (await kokoro.generate(firstSegment, voice, "high"));
    } catch {
      if (session === sessionRef.current) {
        setSpeechStatus("idle");
      }

      return;
    }

    if (session !== sessionRef.current) {
      return;
    }

    if (!restSegment) {
      setBufferedIndex((previous) => Math.max(previous, index));
      playAudioClip(firstAudio, session, () => {
        void playNaturalChunk(index + 1, session);
      });
      return;
    }

    // Synthesize the rest of this passage at high priority while the opening
    // sentence plays, so the second half starts with zero wait.
    const restPromise = kokoro.generate(restSegment, voice, "high");

    void restPromise.catch(() => undefined);

    playAudioClip(firstAudio, session, () => {
      void (async () => {
        if (session !== sessionRef.current) {
          return;
        }

        const cachedRest = kokoro.getCached(restSegment, voice);

        if (!cachedRest) {
          setSpeechStatus("loading");
        }

        let restAudio: KokoroAudio;

        try {
          restAudio = cachedRest ?? (await restPromise);
        } catch {
          if (session === sessionRef.current) {
            setSpeechStatus("idle");
          }

          return;
        }

        if (session !== sessionRef.current) {
          return;
        }

        setBufferedIndex((previous) => Math.max(previous, index));
        playAudioClip(restAudio, session, () => {
          void playNaturalChunk(index + 1, session);
        });
      })();
    });
  }

  // Generates audio ahead of the play head at low priority, staying at most
  // BUFFER_AHEAD passages in front, and advances `bufferedIndex` as each one is
  // ready. Starts at `startIndex + 1` so the play head owns `startIndex` at
  // high priority without racing.
  async function bufferLoop(session: number, startIndex: number) {
    const kokoro = getKokoroEngine();
    const readableChunks = chunksRef.current;

    for (let index = startIndex + 1; index < readableChunks.length; index++) {
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
          await kokoro.generate(readableChunks[index], voice, "low");
        } catch (error) {
          if (error instanceof CancelledError) {
            return;
          }

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
      // Unlock Web Audio synchronously inside the user gesture and drop any
      // stale look-ahead jobs from the previous position.
      getWebAudioPlayer().unlock();
      getKokoroEngine().cancelLowPriority();
      void playNaturalChunk(safeStartIndex, session);
      void bufferLoop(session, safeStartIndex);
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
    charactersRef.current = getCastCharacters(
      speakersRef.current,
      script?.genders,
    );
    castKeyRef.current = script?.castKey ?? null;
    setSourceTabId(sourceId);
    setTotal(readableChunks.length);

    if (engineRef.current === "natural") {
      const voicesToWarm: KokoroVoiceId[] = [kokoroVoiceRef.current];

      if (tableReadRef.current && charactersRef.current.length > 0) {
        const cast = castNaturalVoices(
          charactersRef.current,
          kokoroVoiceRef.current,
          getCastOverrides().natural,
        );

        voicesToWarm.push(...Object.values(cast));
      }

      getKokoroEngine().prefetchVoices(voicesToWarm);
    }

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
      webAudioRef.current?.pause();
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
      void getWebAudioPlayer()
        .resume()
        .catch(() => setSpeechStatus("idle"));
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

    if (isKokoroSupported()) {
      getKokoroEngine().cancelLowPriority();
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
    webAudioRef.current?.setRate(safeRate);

    writeStoredPrefs({ rate: safeRate });
  }

  function setEngine(nextEngine: ReadAloudEngine) {
    if (nextEngine === engineRef.current) {
      return;
    }

    stop();
    setEngineState(nextEngine);
    writeStoredPrefs({ engine: nextEngine });

    if (nextEngine === "natural" && isKokoroSupported()) {
      getKokoroEngine().prewarm([kokoroVoiceRef.current]);
    }
  }

  function setDeviceVoiceURI(nextVoiceURI: string | null) {
    setDeviceVoiceURIState(nextVoiceURI);
    writeStoredPrefs({ deviceVoiceURI: nextVoiceURI });
  }

  function setKokoroVoice(nextVoice: KokoroVoiceId) {
    setKokoroVoiceState(nextVoice);
    writeStoredPrefs({ kokoroVoice: nextVoice });

    if (isKokoroSupported()) {
      const kokoro = getKokoroEngine();

      kokoro.cancelLowPriority();
      kokoro.prefetchVoices([nextVoice]);
    }
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
  function getCast({ castKey, genders, speakers }: ReadAloudScript) {
    const characters = getCastCharacters(speakers, genders);
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

    if (
      engineRef.current === "natural" &&
      isKokoroSupported() &&
      isKokoroVoiceId(voice)
    ) {
      getKokoroEngine().prefetchVoices([voice]);
    }
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
    kokoroRuntime,
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
