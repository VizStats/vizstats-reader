import type { KokoroAudio } from "@/lib/speech/kokoro-messages";

/**
 * Plays raw Float32 PCM from the Kokoro worker directly through Web Audio API.
 *
 * Avoids WAV header encoding, Blob URL creation, and HTMLAudioElement decoding
 * overhead, reducing playback start latency and inter-chunk gaps while still
 * supporting live speed adjustments, pause, resume, and immediate stop.
 */
export class WebAudioPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private onEnded: (() => void) | null = null;
  private playbackRate = 1;
  private startedAt = 0;
  private offsetSeconds = 0;
  private playing = false;
  private paused = false;

  /**
   * Creates or resumes the AudioContext synchronously inside a user gesture so
   * playback that starts after an async generation step is never blocked by
   * browser autoplay policies.
   */
  unlock() {
    const context = this.getContext();

    if (context && context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  async play(
    audio: KokoroAudio,
    rate: number,
    onEnded: () => void,
  ): Promise<void> {
    const context = this.getContext();

    if (!context) {
      throw new Error("Web Audio is not available in this browser.");
    }

    this.stop();

    if (audio.pcm.length === 0) {
      onEnded();
      return;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    const buffer = context.createBuffer(1, audio.pcm.length, audio.sampleRate);

    buffer.getChannelData(0).set(audio.pcm);

    this.currentBuffer = buffer;
    this.playbackRate = rate;
    this.offsetSeconds = 0;
    this.onEnded = onEnded;
    this.paused = false;

    this.startFromOffset(context, buffer, 0);
  }

  pause() {
    if (!this.playing || !this.context || !this.currentBuffer) {
      return;
    }

    const elapsed =
      (this.context.currentTime - this.startedAt) * this.playbackRate;

    this.offsetSeconds = Math.min(
      this.currentBuffer.duration,
      this.offsetSeconds + Math.max(0, elapsed),
    );
    this.detachSource();
    this.playing = false;
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.paused || !this.context || !this.currentBuffer) {
      return;
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.paused = false;
    this.startFromOffset(this.context, this.currentBuffer, this.offsetSeconds);
  }

  setRate(rate: number) {
    if (this.playing && this.context && this.currentBuffer) {
      const elapsed =
        (this.context.currentTime - this.startedAt) * this.playbackRate;

      this.offsetSeconds = Math.min(
        this.currentBuffer.duration,
        this.offsetSeconds + Math.max(0, elapsed),
      );
      this.startedAt = this.context.currentTime;
    }

    this.playbackRate = rate;

    if (this.source) {
      this.source.playbackRate.value = rate;
    }
  }

  stop() {
    this.detachSource();
    this.currentBuffer = null;
    this.onEnded = null;
    this.offsetSeconds = 0;
    this.playing = false;
    this.paused = false;
  }

  dispose() {
    this.stop();

    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") {
      return null;
    }

    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!Ctor) {
        return null;
      }

      this.context = new Ctor();
    }

    return this.context;
  }

  private startFromOffset(
    context: AudioContext,
    buffer: AudioBuffer,
    offset: number,
  ) {
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(context.destination);

    source.onended = () => {
      if (this.source !== source) {
        return;
      }

      const callback = this.onEnded;

      this.source = null;
      this.currentBuffer = null;
      this.onEnded = null;
      this.playing = false;
      this.paused = false;
      callback?.();
    };

    this.source = source;
    this.startedAt = context.currentTime;
    this.playing = true;
    source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.001)));
  }

  private detachSource() {
    const source = this.source;

    if (!source) {
      return;
    }

    this.source = null;
    source.onended = null;

    try {
      source.stop();
    } catch {
      // Already stopped.
    }

    source.disconnect();
  }
}
