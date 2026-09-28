/* Tiny WebAudio synth — no assets needed. */
(function (global) {
  "use strict";
  class SoundFX {
    constructor() {
      this.ctx = null; this.enabled = true; this.musicTimer = null; this.step = 0;
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
      if (!on) this.stopMusic();
      else this.startMusic();
    }
    blip(freq, dur, type = "square", vol = 0.12, slide = 0) {
      if (!this.enabled) return;
      const ctx = this._ensure(); if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    }
    shoot() { this.blip(720 + Math.random() * 160, 0.08, "square", 0.05, -320); }
    hit() { this.blip(220, 0.1, "sawtooth", 0.09, -120); }
    boom() { this.blip(90, 0.35, "sawtooth", 0.16, -60); }
    pickup() { this.blip(660, 0.12, "sine", 0.12, 440); }
    level() { this.blip(520, 0.2, "triangle", 0.14, 520); }
    hurt() { this.blip(160, 0.22, "square", 0.14, -80); }
    startMusic() {
      if (!this.enabled || this.musicTimer) return;
      const bass = [55, 55, 65.4, 49];
      this.musicTimer = setInterval(() => {
        if (!this.enabled) return;
        this.blip(bass[this.step % bass.length], 0.4, "triangle", 0.035);
        if (this.step % 2 === 0) this.blip(440 * Math.pow(2, (this.step % 8) / 12), 0.15, "sine", 0.02);
        this.step++;
      }, 320);
    }
    stopMusic() {
      if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    }
  }
  global.SoundFX = SoundFX;
})(window);
