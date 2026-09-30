/* Tiny WebAudio synth: SFX + procedural chiptune loop (no assets). */
(function (global) {
  "use strict";
  // A-minor 4-chord loop (Am F C G), 8th-note grid @140bpm.
  const STEP = 60 / 140 / 2;
  const BASS = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
  const ARPS = [
    [220, 261.63, 329.63, 440],       // Am
    [174.61, 220, 261.63, 349.23],    // F
    [261.63, 329.63, 392.0, 523.25],  // C
    [196.0, 246.94, 293.66, 392.0]    // G
  ];

  class SoundFX {
    constructor() {
      this.ctx = null; this.enabled = true;
      this.music = null;   // {timer, step, next}
      this.wantMusic = false;
      this._noise = null;
    }
    _ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }
    setEnabled(on) {
      this.enabled = on;
      if (!on) {
        if (this.music) { clearInterval(this.music.timer); this.music = null; }
      } else if (this.wantMusic && !this.music) {
        this._beginLoop();
      }
    }
    blip(freq, dur, type = "square", vol = 0.12, slide = 0) {
      if (!this.enabled) return;
      const ctx = this._ensure(); if (!ctx) return;
      this._toneAt(freq, ctx.currentTime, dur, type, vol,
        slide ? Math.max(30, freq + slide) : 0);
    }
    shoot() { this.blip(720 + Math.random() * 160, 0.08, "square", 0.05, -320); }
    hit() { this.blip(220, 0.1, "sawtooth", 0.09, -120); }
    boom() { this.blip(90, 0.35, "sawtooth", 0.16, -60); }
    pickup() { this.blip(660, 0.12, "sine", 0.12, 440); }
    level() { this.blip(520, 0.2, "triangle", 0.14, 520); }
    hurt() { this.blip(160, 0.22, "square", 0.14, -80); }

    startMusic() {
      this.wantMusic = true;
      if (!this.enabled || this.music) return;
      this._beginLoop();
    }
    stopMusic() {
      this.wantMusic = false;
      if (this.music) { clearInterval(this.music.timer); this.music = null; }
    }
    _beginLoop() {
      const ctx = this._ensure(); if (!ctx) return;
      const mus = { step: 0, next: ctx.currentTime + 0.08 };
      mus.timer = setInterval(() => {
        if (!this.enabled || !this.ctx) return;
        while (mus.next < this.ctx.currentTime + 0.3) {
          this._scheduleStep(mus.step, mus.next);
          mus.next += STEP;
          mus.step = (mus.step + 1) % 16;
        }
      }, 70);
      this.music = mus;
    }
    _scheduleStep(step, t) {
      const ci = (step >> 2) % 4;
      if (step % 4 === 0) {
        this._toneAt(120, t, 0.18, "sine", 0.22, 42);          // kick
        this._toneAt(BASS[ci], t, 0.34, "triangle", 0.13);     // bass root
      }
      if (step % 2 === 0) {
        this._toneAt(ARPS[ci][(step >> 1) % 4], t, 0.16, "triangle", 0.055); // arp
      } else {
        this._hatAt(t);                                        // offbeat hat
      }
      if (step === 14) this._toneAt(ARPS[ci][3] * 2, t, 0.2, "sine", 0.04); // sparkle
    }
    _toneAt(freq, t, dur, type, vol, slideTo) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    _hatAt(t) {
      const ctx = this.ctx;
      if (!this._noise) {
        const len = Math.floor(ctx.sampleRate * 0.3);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noise = buf;
      }
      const s = ctx.createBufferSource(); s.buffer = this._noise;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f); f.connect(g); g.connect(ctx.destination);
      s.start(t); s.stop(t + 0.08);
    }
  }
  global.SoundFX = SoundFX;
})(window);
