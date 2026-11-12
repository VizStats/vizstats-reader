// Kokoro's English voices, best first within each group by the model's own
// quality grades.
export const KOKORO_VOICES = [
  { accent: "American", gender: "female", id: "af_heart", name: "Heart" },
  { accent: "American", gender: "female", id: "af_bella", name: "Bella" },
  { accent: "American", gender: "female", id: "af_nicole", name: "Nicole" },
  { accent: "British", gender: "female", id: "bf_emma", name: "Emma" },
  { accent: "American", gender: "female", id: "af_aoede", name: "Aoede" },
  { accent: "American", gender: "female", id: "af_kore", name: "Kore" },
  { accent: "American", gender: "female", id: "af_sarah", name: "Sarah" },
  { accent: "American", gender: "female", id: "af_nova", name: "Nova" },
  { accent: "American", gender: "female", id: "af_alloy", name: "Alloy" },
  { accent: "British", gender: "female", id: "bf_isabella", name: "Isabella" },
  { accent: "American", gender: "female", id: "af_sky", name: "Sky" },
  { accent: "American", gender: "female", id: "af_jessica", name: "Jessica" },
  { accent: "American", gender: "female", id: "af_river", name: "River" },
  { accent: "British", gender: "female", id: "bf_alice", name: "Alice" },
  { accent: "British", gender: "female", id: "bf_lily", name: "Lily" },
  { accent: "American", gender: "male", id: "am_michael", name: "Michael" },
  { accent: "American", gender: "male", id: "am_fenrir", name: "Fenrir" },
  { accent: "American", gender: "male", id: "am_puck", name: "Puck" },
  { accent: "British", gender: "male", id: "bm_george", name: "George" },
  { accent: "British", gender: "male", id: "bm_fable", name: "Fable" },
  { accent: "British", gender: "male", id: "bm_lewis", name: "Lewis" },
  { accent: "American", gender: "male", id: "am_echo", name: "Echo" },
  { accent: "American", gender: "male", id: "am_eric", name: "Eric" },
  { accent: "American", gender: "male", id: "am_liam", name: "Liam" },
  { accent: "American", gender: "male", id: "am_onyx", name: "Onyx" },
  { accent: "British", gender: "male", id: "bm_daniel", name: "Daniel" },
  { accent: "American", gender: "male", id: "am_santa", name: "Santa" },
  { accent: "American", gender: "male", id: "am_adam", name: "Adam" },
] as const;

export type KokoroVoice = (typeof KOKORO_VOICES)[number];

export type KokoroVoiceId = KokoroVoice["id"];

export const DEFAULT_KOKORO_VOICE: KokoroVoiceId = "af_heart";

export function isKokoroVoiceId(value: string): value is KokoroVoiceId {
  return KOKORO_VOICES.some((voice) => voice.id === value);
}

// "Heart · American", for voice pickers grouped by gender.
export function getKokoroVoiceLabel(voice: KokoroVoice) {
  return `${voice.name} · ${voice.accent}`;
}

export type KokoroWorkerRequest =
  | { type: "init" }
  | { type: "generate"; id: number; text: string; voice: KokoroVoiceId };

export type KokoroWorkerResponse =
  | { type: "progress"; progress: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "init-error"; error: string }
  | { type: "result"; id: number; wav: ArrayBuffer }
  | { type: "generate-error"; id: number; error: string };
