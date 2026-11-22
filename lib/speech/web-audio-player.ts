import { encodePcm16 } from "@/lib/speech/kokoro-cache";
import type { KokoroAudio } from "@/lib/speech/kokoro-messages";

/**
 * Encodes mono Float32 PCM into a standard 16-bit PCM WAV buffer.
 */
export function encodeWavFromPcm(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const pcm16 = encodePcm16(samples);
  const dataBytes = pcm16.byteLength;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * 1ch * 2B)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  new Uint8Array(buffer, 44).set(new Uint8Array(pcm16));

  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Plays synthesized natural-voice PCM through HTMLAudioElement so reading-speed
 * adjustments (`playbackRate`) always preserve natural vocal pitch without
 * Web Audio pitch-shifting or buffer-boundary clicks.
 */
export class WebAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private playbackRate = 1;

  unlock() {
    // HTMLAudioElement playback is initiated from user gestures in start/seek/resume.
  }

  async play(
    clip: KokoroAudio,
    rate: number,
    onEnded: () => void,
  ): Promise<void> {
    this.stop();

    if (clip.pcm.length === 0) {
      onEnded();
      return;
    }

    const wav = encodeWavFromPcm(clip.pcm, clip.sampleRate);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    this.objectUrl = url;
    this.audio = audio;
    this.playbackRate = rate;
    audio.preservesPitch = true;
    audio.playbackRate = rate;

    audio.onended = () => {
      if (this.audio !== audio) {
        return;
      }

      this.stop();
      onEnded();
    };

    audio.onerror = () => {
      if (this.audio !== audio) {
        return;
      }

      this.stop();
    };

    await audio.play();
  }

  pause() {
    this.audio?.pause();
  }

  async resume(): Promise<void> {
    if (!this.audio) {
      return;
    }

    this.audio.playbackRate = this.playbackRate;
    await this.audio.play();
  }

  setRate(rate: number) {
    this.playbackRate = rate;

    if (this.audio) {
      this.audio.preservesPitch = true;
      this.audio.playbackRate = rate;
    }
  }

  stop() {
    const audio = this.audio;

    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      this.audio = null;
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  dispose() {
    this.stop();
  }
}
