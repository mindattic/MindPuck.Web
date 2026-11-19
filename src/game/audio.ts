/** A few synthesized sounds, so the game ships no audio files. Silent until the first user gesture. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Call from a click or key press: browsers only allow sound to start from one. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** A wall hit. `impact` is the speed into the wall. */
  bounce(impact: number): void {
    if (impact < 0.4) return;
    const level = Math.min(impact / 10, 1);
    this.tone(150 + level * 170, 0.09, 0.05 + level * 0.16, 'triangle');
  }

  goal(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.5, 0.11, 'sine', i * 0.085));
  }
}
