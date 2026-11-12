import {
  isKokoroVoiceId,
  type KokoroVoiceId,
} from "@/lib/speech/kokoro-messages";

// A table read gives each speaking character a voice of their own, while the
// narrator voice reads scene headings, action, and transitions.

export type CharacterGender = "female" | "male";

export type CastCharacter = {
  // Read from the script when it says; characters without one are cast from
  // every voice.
  gender?: CharacterGender;
  // How many passages the character speaks; leads are cast first.
  lines: number;
  name: string;
};

// Voice choices the reader made, per engine, keyed by character name.
export type CastOverrides = {
  device?: Record<string, string>;
  natural?: Record<string, string>;
};

type VoicePools<T> = Record<CharacterGender | "any", T[]>;

// Natural voices in casting order: the strongest first, alternating accents
// so neighbouring leads sound unlike each other. Santa is left to the reader.
const FEMALE_CAST_ORDER: KokoroVoiceId[] = [
  "af_heart",
  "bf_emma",
  "af_bella",
  "af_aoede",
  "bf_isabella",
  "af_kore",
  "af_sarah",
  "af_nova",
  "af_nicole",
  "af_alloy",
  "af_sky",
  "bf_alice",
  "af_jessica",
  "af_river",
  "bf_lily",
];

const MALE_CAST_ORDER: KokoroVoiceId[] = [
  "am_michael",
  "bm_george",
  "am_fenrir",
  "bm_fable",
  "am_puck",
  "bm_lewis",
  "am_echo",
  "am_eric",
  "am_liam",
  "am_onyx",
  "bm_daniel",
  "am_adam",
];

// Device voices shared by several characters are told apart by pitch: the
// first speaker keeps the voice as it is, the next lower, the next higher.
const SHARED_VOICE_PITCHES = [1, 0.82, 1.18, 0.7, 1.3];

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

// Device voices are named after people, so the name says whether a voice is
// female or male. Covers the English voices of macOS, iOS, Windows, Edge and
// Chrome; a voice not listed is cast for any character.
const FEMALE_DEVICE_VOICES = [
  "abbi",
  "aditi",
  "agnes",
  "alice",
  "allison",
  "amber",
  "amy",
  "ana",
  "aria",
  "ashley",
  "ava",
  "bella",
  "catherine",
  "clara",
  "cora",
  "eliza",
  "elizabeth",
  "ellie",
  "emily",
  "emma",
  "fiona",
  "hazel",
  "heather",
  "heera",
  "hollie",
  "isha",
  "ivy",
  "jane",
  "jenny",
  "joanna",
  "joelle",
  "karen",
  "kate",
  "kendra",
  "kimberly",
  "leah",
  "libby",
  "linda",
  "maisie",
  "martha",
  "matilda",
  "michelle",
  "moira",
  "molly",
  "monica",
  "nancy",
  "natasha",
  "neerja",
  "nicky",
  "nicole",
  "noelle",
  "olivia",
  "raveena",
  "rosa",
  "ruth",
  "salli",
  "samantha",
  "sangeeta",
  "sara",
  "serena",
  "sonia",
  "stephanie",
  "susan",
  "tessa",
  "veena",
  "vicki",
  "victoria",
  "yan",
  "zira",
  "zoe",
];

const MALE_DEVICE_VOICES = [
  "aaron",
  "alex",
  "alfie",
  "andrew",
  "arthur",
  "brandon",
  "brian",
  "bruce",
  "christopher",
  "connor",
  "daniel",
  "david",
  "davis",
  "elliot",
  "eric",
  "ethan",
  "evan",
  "george",
  "gordon",
  "guy",
  "jacob",
  "james",
  "jamie",
  "jason",
  "joey",
  "justin",
  "kai",
  "kevin",
  "lee",
  "liam",
  "luke",
  "malcolm",
  "mark",
  "matthew",
  "mitchell",
  "nathan",
  "noah",
  "oliver",
  "prabhat",
  "ravi",
  "richard",
  "rishi",
  "roger",
  "russell",
  "ryan",
  "sean",
  "steffan",
  "thomas",
  "tom",
  "tony",
  "william",
];

const DEVICE_VOICE_GENDERS = new Map<string, CharacterGender>([
  ...FEMALE_DEVICE_VOICES.map((name) => [name, "female"] as const),
  ...MALE_DEVICE_VOICES.map((name) => [name, "male"] as const),
]);

// The cast list, leads first: most passages, then first to speak.
export function getCastCharacters(
  speakers: readonly (null | string)[],
  genders: Readonly<Record<string, CharacterGender>> = {},
): CastCharacter[] {
  const lines = new Map<string, number>();

  for (const speaker of speakers) {
    if (speaker) {
      lines.set(speaker, (lines.get(speaker) ?? 0) + 1);
    }
  }

  return Array.from(lines, ([name, count]) => {
    const gender = genders[name];

    return gender
      ? { gender, lines: count, name }
      : { lines: count, name };
  }).sort((a, b) => b.lines - a.lines);
}

// Each character a natural voice of their gender, a different one for every
// character until the voices run out. The narrator's voice is never cast.
export function castNaturalVoices(
  characters: CastCharacter[],
  narrator: KokoroVoiceId,
  overrides: Record<string, string> = {},
): Record<string, KokoroVoiceId> {
  const female = FEMALE_CAST_ORDER.filter((voice) => voice !== narrator);
  const male = MALE_CAST_ORDER.filter((voice) => voice !== narrator);

  return assignVoices(
    characters,
    { any: interleave(male, female), female, male },
    (name) => {
      const chosen = overrides[name];

      return chosen && isKokoroVoiceId(chosen) ? chosen : undefined;
    },
  );
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

// Device voices by voiceURI. A device rarely has a voice per character, so
// once a gender's voices are all cast they are shared, narrator's included,
// and getSharedVoicePitches tells the sharers apart.
export function castDeviceVoices(
  characters: CastCharacter[],
  voices: SpeechSynthesisVoice[],
  narrator: SpeechSynthesisVoice | null,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const castable = getCastableDeviceVoices(voices, narrator).map(
    (voice) => voice.voiceURI,
  );
  const narratorURI = narrator?.voiceURI ?? voices[0]?.voiceURI;
  const others = castable.filter((voiceURI) => voiceURI !== narratorURI);
  const genderOf = new Map(
    voices.map((voice) => [voice.voiceURI, getDeviceVoiceGender(voice)]),
  );
  const ofGender = (gender: CharacterGender | undefined) => [
    ...others.filter((voiceURI) => genderOf.get(voiceURI) === gender),
    ...(narratorURI && genderOf.get(narratorURI) === gender
      ? [narratorURI]
      : []),
  ];
  const female = ofGender("female");
  const male = ofGender("male");
  const any = [
    ...interleave(
      others.filter((voiceURI) => genderOf.get(voiceURI) === "male"),
      others.filter((voiceURI) => genderOf.get(voiceURI) === "female"),
      others.filter((voiceURI) => !genderOf.get(voiceURI)),
    ),
    ...(narratorURI ? [narratorURI] : []),
  ];
  const available = new Set(voices.map((voice) => voice.voiceURI));

  return assignVoices(
    characters,
    { any, female, male },
    (name) => {
      const chosen = overrides[name];

      return chosen && available.has(chosen) ? chosen : undefined;
    },
    narratorURI,
  );
}

// Pitch per character, so characters sharing a device voice with the
// narrator or with a bigger part still sound like different people.
export function getSharedVoicePitches(
  characters: CastCharacter[],
  cast: Record<string, string>,
  narratorURI: null | string | undefined,
): Record<string, number> {
  const uses = new Map<string, number>();
  const pitches: Record<string, number> = {};

  if (narratorURI) {
    uses.set(narratorURI, 1);
  }

  for (const character of characters) {
    const voice = cast[character.name];

    if (!voice) {
      continue;
    }

    const count = uses.get(voice) ?? 0;

    pitches[character.name] =
      SHARED_VOICE_PITCHES[count % SHARED_VOICE_PITCHES.length]!;
    uses.set(voice, count + 1);
  }

  return pitches;
}

export function getDeviceVoiceGender(
  voice: Pick<SpeechSynthesisVoice, "name">,
): CharacterGender | undefined {
  const name = voice.name.toLowerCase();

  if (/\bfemale\b/.test(name)) {
    return "female";
  }

  if (/\bmale\b/.test(name)) {
    return "male";
  }

  // Chrome's "Google US English" is a female voice.
  if (/^google us english\b/.test(name)) {
    return "female";
  }

  const firstName = name
    .replace(/^(?:apple|google|microsoft)\s+/, "")
    .match(/\p{L}+/u)?.[0];

  return firstName ? DEVICE_VOICE_GENDERS.get(firstName) : undefined;
}

// Chosen voices first, so automatic casting steers around them; then each
// character, leads first, takes the least used voice in their pool, in the
// pool's order. Once a pool is spent its voices are shared evenly.
function assignVoices<T>(
  characters: CastCharacter[],
  pools: VoicePools<T>,
  getChosen: (name: string) => T | undefined,
  reserved?: T,
): Record<string, T> {
  const cast: Record<string, T> = {};
  const uses = new Map<T, number>(
    reserved === undefined ? [] : [[reserved, 1]],
  );
  const addUse = (voice: T) => uses.set(voice, (uses.get(voice) ?? 0) + 1);

  for (const character of characters) {
    const chosen = getChosen(character.name);

    if (chosen !== undefined) {
      cast[character.name] = chosen;
      addUse(chosen);
    }
  }

  for (const character of characters) {
    if (character.name in cast) {
      continue;
    }

    const pool =
      character.gender && pools[character.gender].length > 0
        ? pools[character.gender]
        : pools.any;

    if (pool.length === 0) {
      continue;
    }

    const voice = pool.reduce((least, candidate) =>
      (uses.get(candidate) ?? 0) < (uses.get(least) ?? 0) ? candidate : least,
    );

    cast[character.name] = voice;
    addUse(voice);
  }

  return cast;
}

// [a1, b1, c1, a2, b2, …], so neighbouring entries differ.
function interleave<T>(...lists: T[][]): T[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const result: T[] = [];

  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      if (index < list.length) {
        result.push(list[index]!);
      }
    }
  }

  return result;
}

// "Samantha (Enhanced)" and "Eddy (English (US))" are cast by their base name.
function getBaseVoiceName(name: string) {
  return name
    .replace(/\s*\(.*$/, "")
    .trim()
    .toLowerCase();
}
