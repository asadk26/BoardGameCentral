// Procedural sound: everything is synthesised with Web Audio, so there are
// no audio files, licences or remote fetches. Nothing plays until the first
// user gesture, and a failure here never blocks play.

type Sound =
  | 'dice'
  | 'step'
  | 'candy'
  | 'bank'
  | 'ghost'
  | 'catch'
  | 'card'
  | 'bell'
  | 'decoy'
  | 'whoosh'
  | 'drop'
  | 'creak'
  | 'fanfare'
  | 'click';

class Audio {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  sfxVolume = 0.8;
  musicVolume = 0.35;
  muted = false;
  midnight = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain.connect(this.ctx.destination);
        this.musicGain.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        this.startMusic();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  applyVolumes() {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.muted ? 0 : this.musicVolume * 0.5, t, 0.2);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number; out?: AudioNode } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.out ?? this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, opts: { freq?: number; q?: number; gain?: number; at?: number; type?: BiquadFilterType; sweep?: number } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxGain!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(sound: Sound | string) {
    if (!this.ctx || this.muted) return;
    try {
      switch (sound as Sound) {
        case 'dice':
          for (let i = 0; i < 7; i++) this.burst(0.05, { freq: 2500 + Math.random() * 1500, q: 3, gain: 0.25, at: i * 0.08 + Math.random() * 0.03 });
          break;
        case 'step':
          this.burst(0.07, { freq: 380, q: 2, gain: 0.18 });
          this.tone(110, 0.06, { gain: 0.08 });
          break;
        case 'candy':
          [880, 1109, 1319].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.12, at: i * 0.06 }));
          break;
        case 'bank':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.12, at: i * 0.07 }));
          this.burst(0.2, { freq: 6000, q: 4, gain: 0.08, at: 0.2 });
          break;
        case 'ghost':
          this.burst(1.2, { freq: 300, sweep: 1400, q: 6, gain: 0.12, type: 'bandpass' });
          this.tone(330, 1.1, { type: 'sine', gain: 0.06, slide: 0.7 });
          this.tone(336, 1.1, { type: 'sine', gain: 0.05, slide: 0.72 });
          break;
        case 'catch':
          this.tone(520, 0.5, { type: 'sawtooth', gain: 0.07, slide: 0.4 });
          this.tone(260, 0.6, { type: 'square', gain: 0.05, slide: 0.5, at: 0.05 });
          this.burst(0.3, { freq: 800, sweep: 200, gain: 0.15 });
          break;
        case 'card':
          [1568, 1976, 2349, 3136].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', gain: 0.07, at: i * 0.05 }));
          break;
        case 'bell':
          [0, 1.6].forEach((at) => {
            [220, 440 * 1.19, 660 * 1.01, 880 * 1.5, 1320].forEach((f, i) => this.tone(f, 2.8 - i * 0.3, { gain: 0.12 / (i + 1), at }));
          });
          break;
        case 'decoy':
          this.tone(660, 0.2, { type: 'triangle', gain: 0.1 });
          this.tone(990, 0.3, { type: 'triangle', gain: 0.08, at: 0.1 });
          break;
        case 'whoosh':
          this.burst(0.5, { freq: 400, sweep: 3000, q: 1.5, gain: 0.2 });
          break;
        case 'drop':
          [700, 520, 400].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.1, at: i * 0.07 }));
          break;
        case 'creak':
          this.tone(90, 0.9, { type: 'sawtooth', gain: 0.05, slide: 1.6 });
          this.burst(0.8, { freq: 500, sweep: 900, q: 12, gain: 0.1 });
          break;
        case 'fanfare':
          [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.12, at: i * 0.12 }));
          break;
        case 'click':
          this.tone(1200, 0.04, { type: 'square', gain: 0.03 });
          break;
      }
    } catch {
      /* never let sound break play */
    }
  }

  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    // A slow, quiet music-box figure over a soft drone, in D minor.
    const scale = [293.66, 349.23, 440, 523.25, 587.33, 698.46, 880];
    const pattern = [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 6, 5, 3, 1, -1];
    const drone = this.ctx.createOscillator();
    const dg = this.ctx.createGain();
    drone.type = 'sine';
    drone.frequency.value = 73.42;
    dg.gain.value = 0.05;
    drone.connect(dg).connect(this.musicGain!);
    drone.start();
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || this.muted || this.musicVolume <= 0) return;
      const idx = pattern[this.musicStep % pattern.length];
      this.musicStep++;
      if (idx < 0) return;
      const f = scale[idx] * (this.midnight ? 0.5 : 1);
      this.tone(f, 1.6, { type: 'sine', gain: 0.07, out: this.musicGain! });
      this.tone(f * 2, 0.9, { type: 'triangle', gain: 0.015, out: this.musicGain! });
    }, 620);
  }
}

export const audio = new Audio();
