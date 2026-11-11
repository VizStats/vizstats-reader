import {
  KOKORO_VOICES,
  type KokoroVoiceId,
} from "@/lib/speech/kokoro-messages";

// A table read gives each speaking character a voice of their own, while the
// narrator voice reads scene headings, action, and transitions.

export type CastCharacter = {
  // How many passages the character speaks; leads are cast first.
  lines: number;
  name: string;
};

// Voice choices the reader made, per engine, keyed by character name.
export type CastOverrides = {
  device?: Record<string, string>;
  natural?: Record<string, string>;
};

// Natural voices in casting order: the strongest first, alternating so
// neighbouring leads sound unlike each other.
const NATURAL_CAST_ORDER: KokoroVoiceId[] = [
  "am_michael",
  "af_heart",
  "bm_george",
  "af_bella",
  "am_fenrir",
  "bf_emma",
  "bm_fable",
  "af_nicole",
  "af_sky",
  "bf_lily",
];

// macOS novelty and effect voices: fine for a joke, wrong for a table read.
const NOVELTY_DEVICE_VOICES = new Set([
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "deranged",
  "eddy",
  "flo",
  "fred",
  "good news",
  "grandma",
  "grandpa",
  "hysterical",
  "jester",
  "junior",
  "kathy",
  "organ",
  "pipe organ",
  "princess",
  "ralph",
  "reed",
  "rocko",
  "sandy",
  "shelley",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
]);

// The cast list, leads first: most passages, then first to speak.
export function getCastCharacters(
  speakers: readonly (null | string)[],
): CastCharacter[] {
  const lines = new Map<string, number>();

  for (const speaker of speakers) {
    if (speaker) {
      lines.set(speaker, (lines.get(speaker) ?? 0) + 1);
    }
  }

  return Array.from(lines, ([name, count]) => ({ lines: count, name })).sort(
    (a, b) => b.lines - a.lines,
  );
}

export function castNaturalVoices(
  characters: CastCharacter[],
  narrator: KokoroVoiceId,
  overrides: Record<string, string> = {},
): Record<string, KokoroVoiceId> {
  const voices = NATURAL_CAST_ORDER.filter((voice) => voice !== narrator);
  const cast: Record<string, KokoroVoiceId> = {};

  characters.forEach((character, index) => {
    const chosen = overrides[character.name];

    cast[character.name] = isNaturalVoice(chosen)
      ? chosen
      : voices[index % voices.length]!;
  });

  return cast;
}

// Device voices for casting: the narrator's language, no novelty voices, in
// the reader's ranked order.
export function getCastableDeviceVoices(
  voices: SpeechSynthesisVoice[],
  narrator: SpeechSynthesisVoice | null,
) {
  const language = (narrator?.lang ?? voices[0]?.lang ?? "en")
    .slice(0, 2)
    .toLowerCase();

  return voices.filter(
    (voice) =>
      voice.lang.toLowerCase().startsWith(language) &&
      !NOVELTY_DEVICE_VOICES.has(getBaseVoiceName(voice.name)),
  );
}

export function castDeviceVoices(
  characters: CastCharacter[],
  voices: SpeechSynthesisVoice[],
  narrator: SpeechSynthesisVoice | null,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const castable = getCastableDeviceVoices(voices, narrator);
  const pool = castable.filter(
    (voice) => voice.voiceURI !== narrator?.voiceURI,
  );
  const available = new Set(voices.map((voice) => voice.voiceURI));
  const cast: Record<string, string> = {};

  characters.forEach((character, index) => {
    const chosen = overrides[character.name];
    const fallback =
      pool[index % Math.max(pool.length, 1)] ?? narrator ?? voices[0];

    if (chosen && available.has(chosen)) {
      cast[character.name] = chosen;
    } else if (fallback) {
      cast[character.name] = fallback.voiceURI;
    }
  });

  return cast;
}

// "Samantha (Enhanced)" and "Eddy (English (US))" are cast by their base name.
function getBaseVoiceName(name: string) {
  return name
    .replace(/\s*\(.*$/, "")
    .trim()
    .toLowerCase();
}

function isNaturalVoice(value: string | undefined): value is KokoroVoiceId {
  return KOKORO_VOICES.some((voice) => voice.id === value);
}
