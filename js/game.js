/* NebulaGame — canvas arena shooter engine. No dependencies. Mobile-friendly. */
(function (global) {
  "use strict";

  const CONFIG = {
    rookie: { enemyHp: 0.7, enemySpeed: 0.85, spawnGap: 1.25, enemyDmg: 0.7 },
    pilot:  { enemyHp: 1.0, enemySpeed: 1.0,  spawnGap: 1.0,  enemyDmg: 1.0 },
    ace:    { enemyHp: 1.45, enemySpeed: 1.15, spawnGap: 0.75, enemyDmg: 1.4 }
  };

  const UPGRADES = [
    { id: "rapid",   name: "⚡ Overclock",   desc: "+22% fire rate (squad)", apply(a) { a.fireCdMax *= 0.82; } },
    { id: "dmg",     name: "💥 Heavy rounds", desc: "+30% damage (squad)", apply(a) { a.dmg *= 1.3; } },
    { id: "speed",   name: "🌀 Ion thrusters", desc: "+12% speed, +dash recharge", apply(a) { a.speed *= 1.12; a.dashCdMax *= 0.9; } },
    { id: "hull",    name: "🛡️ Nano hull",  desc: "+30 max HP + full repair (squad)", apply(a, g) { a.maxHp += 30; if (g) g.healAll(); } },
    { id: "multi",   name: "🔱 Split cannon", desc: "+1 projectile (squad)", apply(a) { a.streams = Math.min(4, a.streams + 1); } },
    { id: "magnet",  name: "🧲 Tractor core", desc: "bigger pickup radius", apply(a) { a.magnet += 60; } }
  ];

  const SQUAD_COLORS = ["#5eeaff", "#34d399", "#f472b6", "#fbbf24"];
  const SQUAD_ARENA = { w: 960, h: 540 };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dead(v, dz) { return Math.abs(v) < dz ? 0 : v; }

  // Overall wave scaling: every wave hits harder, moves faster, spawns
  // quicker and shoots more often. Caps keep late waves fierce but fair.
  function waveMul(wave) {
    const w = Math.max(1, Math.floor(wave || 1)) - 1;
    return {
      hp: 1 + w * 0.22,
      dmg: Math.min(3, 1 + w * 0.07),
      spd: Math.min(1.35, 1 + w * 0.02),
      gap: Math.max(0.4, 1 - w * 0.035),
      fire: Math.max(0.55, 1 - w * 0.03),
      shot: Math.min(1.5, 1 + w * 0.02)
    };
  }
  function isCoarse() {
    return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || ("ontouchstart" in window);
  }

  class NebulaGame {
    constructor(canvas, sfx) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.sfx = sfx;
      this.isMobile = isCoarse();
      this.keys = {};
      this.mouse = { x: 0, y: 0, down: false };
      this.state = "menu"; // menu | playing | paused | upgrade | over
      this.difficulty = "pilot";
      this.onEvent = function () {};
      this.touch = {
        moveId: null, aimId: null,
        moveBase: null, aimBase: null,
        mx: 0, my: 0, aimActive: false,
        ox: 0, oy: 0
      };
      this.requestDash = false;
      this._bind();
      this.resize(true);
      this.mouse.x = this.W / 2; this.mouse.y = this.H / 2;
      const starCount = this.isMobile ? 70 : 120;
      this._stars = Array.from({ length: starCount }, () => ({ x: Math.random() * this.W, y: Math.random() * this.H, z: rand(0.2, 1) }));
      this.reset();
    }

    resize(first) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const parent = this.cv.parentElement;
      const cssW = Math.max(300, Math.floor(parent ? parent.clientWidth : 1120));
      let cssH;
      if (document.fullscreenElement && parent) {
        cssH = Math.max(300, Math.floor(parent.clientHeight));
      } else if (window.innerWidth < 640) cssH = clamp(Math.floor(window.innerHeight * 0.58), 380, 520);
      else if (window.innerWidth < 920) cssH = 500;
      else cssH = 560;
      // canvas CSS is 100% width; set explicit height for consistent touch mapping
      this.cv.style.height = cssH + "px";
      this.cv.width = Math.floor(cssW * dpr);
      this.cv.height = Math.floor(cssH * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const oldW = this.W || cssW, oldH = this.H || cssH;
      this.W = cssW; this.H = cssH;
      if (!first && this.p) {
        this.p.x = clamp(this.p.x * (cssW / oldW), 20, cssW - 20);
        this.p.y = clamp(this.p.y * (cssH / oldH), 20, cssH - 20);
      }
    }

    _bind() {
      window.addEventListener("keydown", e => {
        const k = e.key.toLowerCase();
        this.keys[k] = true;
        if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
        if (k === "p" || k === "escape") this.togglePause();
        if (k === "m") this.onEvent("mute");
      });
      window.addEventListener("keyup", e => { this.keys[e.key.toLowerCase()] = false; });
      const toGame = (clientX, clientY) => {
        const r = this.cv.getBoundingClientRect();
        return {
          x: (clientX - r.left) * (this.W / r.width),
          y: (clientY - r.top) * (this.H / r.height),
          rect: r
        };
      };
      this.cv.addEventListener("mousemove", e => {
        const p = toGame(e.clientX, e.clientY);
        this.mouse.x = p.x; this.mouse.y = p.y;
      });
      this.cv.addEventListener("mousedown", () => { this.mouse.down = true; });
      window.addEventListener("mouseup", () => { this.mouse.down = false; });
      this.cv.addEventListener("contextmenu", e => e.preventDefault());

      // Proper dual virtual sticks. Left = move, right = aim + autofire.
      const stickL = () => document.getElementById("stickL");
      const stickR = () => document.getElementById("stickR");
      const knobL = () => document.getElementById("stickLKnob");
      const knobR = () => document.getElementById("stickRKnob");
      const showStick = (el, cx, cy) => {
        if (!el) return;
        const wrap = this.cv.getBoundingClientRect();
        el.style.display = "block";
        el.style.left = (cx - wrap.left - 55) + "px";
        el.style.top = (cy - wrap.top - 55) + "px";
      };
      const hideStick = (el) => { if (el && this.isMobile) { /* keep docked */ } };
      const moveKnob = (knob, dx, dy) => {
        if (!knob) return;
        knob.style.transform = `translate(${clamp(dx, -34, 34)}px,${clamp(dy, -34, 34)}px)`;
      };

      this.cv.addEventListener("touchstart", e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const p = toGame(t.clientX, t.clientY);
          if (p.x < this.W / 2 && this.touch.moveId === null) {
            this.touch.moveId = t.identifier;
            this.touch.moveBase = { x: p.x, y: p.y, cx: t.clientX, cy: t.clientY };
            this.touch.mx = 0; this.touch.my = 0;
            showStick(stickL(), t.clientX, t.clientY);
            const k = knobL(); if (k) k.style.transform = "translate(0px,0px)";
          } else if (this.touch.aimId === null) {
            this.touch.aimId = t.identifier;
            this.touch.aimBase = { x: p.x, y: p.y };
            this.touch.aimActive = true;
            this.mouse.x = p.x; this.mouse.y = p.y;
            showStick(stickR(), t.clientX, t.clientY);
          }
        }
      }, { passive: false });
      this.cv.addEventListener("touchmove", e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const p = toGame(t.clientX, t.clientY);
          if (t.identifier === this.touch.moveId && this.touch.moveBase) {
            // pixel-space delta mapped to game space, normalized with deadzone
            const r = p.rect;
            const scaleX = this.W / r.width, scaleY = this.H / r.height;
            let dx = (t.clientX - this.touch.moveBase.cx) * scaleX;
            let dy = (t.clientY - this.touch.moveBase.cy) * scaleY;
            const m = Math.hypot(dx, dy);
            const dead = 8;
            if (m < dead) { dx = 0; dy = 0; }
            else {
              const max = 60;
              const cl = Math.min(m, max);
              dx = (dx / m) * cl / max;
              dy = (dy / m) * cl / max;
            }
            this.touch.mx = clamp(dx, -1, 1);
            this.touch.my = clamp(dy, -1, 1);
            this.touch.ox = this.touch.mx * 60; this.touch.oy = this.touch.my * 60;
            moveKnob(knobL(), this.touch.mx * 34, this.touch.my * 34);
          }
          if (t.identifier === this.touch.aimId && this.touch.aimBase) {
            this.mouse.x = p.x; this.mouse.y = p.y;
            const dx = p.x - this.touch.aimBase.x, dy = p.y - this.touch.aimBase.y;
            moveKnob(knobR(), dx, dy);
          }
        }
      }, { passive: false });
      const endTouch = e => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.touch.moveId) {
            this.touch.moveId = null; this.touch.moveBase = null;
            this.touch.mx = 0; this.touch.my = 0; this.touch.ox = 0; this.touch.oy = 0;
            const k = knobL(); if (k) k.style.transform = "translate(0px,0px)";
            hideStick(stickL());
          }
          if (t.identifier === this.touch.aimId) {
            this.touch.aimId = null; this.touch.aimBase = null;
            this.touch.aimActive = false;
            const k = knobR(); if (k) k.style.transform = "translate(0px,0px)";
            hideStick(stickR());
          }
        }
      };
      this.cv.addEventListener("touchend", endTouch);
      this.cv.addEventListener("touchcancel", endTouch);

      let rzT = null;
      window.addEventListener("resize", () => {
        clearTimeout(rzT);
        rzT = setTimeout(() => this.resize(false), 150);
      });
      window.addEventListener("orientationchange", () => setTimeout(() => this.resize(false), 300));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.state === "playing") this.togglePause();
      });
    }

    tryDash() { this.requestDash = true; }

    _mkPlayer(id, name, color, x, y) {
      return {
        id, name, color, x, y, r: 14, hp: 100, maxHp: 100,
        angle: 0, fireCd: 0, shield: 0, doubleT: 0,
        dashCd: 0, dashT: 0, inv: 0, alive: true,
        input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false }
      };
    }
    localPlayer() {
      return this.players.find(pl => pl.id === this.localId) || this.players[0];
    }
    syncMirrors() {
      // keep this.p / this.coins pointing at the LOCAL player for HUD + solo code
      this.p = this.localPlayer();
      if (this.p) {
        this.p.maxHp = this.arm.maxHp;
        this.p.level = this.lvl.level; this.p.xp = this.lvl.xp; this.p.xpNext = this.lvl.xpNext;
      }
      this.coins = (this.coinMap && this.p && this.coinMap[this.p.id]) || 0;
    }
    healAll() {
      for (const pl of this.players) { pl.maxHp = this.arm.maxHp; pl.hp = this.arm.maxHp; }
    }

    // ---------- unified input: keyboard + touch + controller ----------
    pollPad() {
      try {
        const gps = (typeof navigator !== "undefined" && navigator.getGamepads) ? navigator.getGamepads() : [];
        for (const gp of gps) {
          if (gp && gp.connected) return gp;
        }
      } catch {}
      return null;
    }
    sampleInput() {
      // returns {mx,my,ax,ay,fire,dash} merged across devices; edge-triggers dash/pause/mute
      let mx = 0, my = 0;
      if (this.keys["w"] || this.keys["arrowup"]) my -= 1;
      if (this.keys["s"] || this.keys["arrowdown"]) my += 1;
      if (this.keys["a"] || this.keys["arrowleft"]) mx -= 1;
      if (this.keys["d"] || this.keys["arrowright"]) mx += 1;
      if (this.touch.moveId !== null) { mx = this.touch.mx; my = this.touch.my; }
      let ax = 0, ay = 0, aimPad = false;
      let fire = !!(this.mouse.down || this.keys[" "] || this.touch.aimActive);
      let dash = !!(this.keys["shift"] || this.requestDash);
      this.requestDash = false;
      this.keys["shift"] = false;
      const gp = this.pollPad();
      this.padActive = !!gp;
      if (gp) {
        try {
          const lx = dead(gp.axes[0] || 0, 0.18), ly = dead(gp.axes[1] || 0, 0.18);
          if (lx || ly) {
            const m = Math.hypot(lx, ly);
            mx = m > 1 ? lx / m : lx; my = m > 1 ? ly / m : ly;
          }
          const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
          if (Math.hypot(rx, ry) > 0.3) { ax = rx; ay = ry; aimPad = true; }
          const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
          const bv = (i) => (gp.buttons[i] && gp.buttons[i].value) || 0;
          if (bv(7) > 0.25 || b(0)) fire = true;
          const dashNow = b(5) || b(1) || b(4);
          if (dashNow && !this._padDashPrev) dash = true;
          this._padDashPrev = dashNow;
          if (b(9) && !this._padPausePrev) this.togglePause();
          this._padPausePrev = b(9);
          if (b(8) && !this._padMutePrev) this.onEvent("mute");
          this._padMutePrev = b(8);
        } catch {}
      }
      return { mx, my, ax, ay, aimPad, fire, dash };
    }

    reset() {
      // shared squad-wide combat stats (upgrades mutate these)
      this.arm = { dmg: 12, streams: 1, fireCdMax: 0.16, speed: 260, magnet: 90, maxHp: 100, dashCdMax: 2.2 };
      this.lvl = { level: 1, xp: 0, xpNext: 30 };
      this.players = [this._mkPlayer("local", "You", SQUAD_COLORS[0], this.W / 2, this.H / 2)];
      this.localId = "local";
      this.coinMap = { local: 0 };
      this.squad = null;
      this.bullets = []; this.enemies = []; this.parts = [];
      this.pickups = []; this.ebullets = [];
      this.score = 0; this.kills = 0; this.wave = 1; this.coins = 0;
      this.spawnT = 0; this.spawned = 0; this.waveTotal = 8;
      this.time = 0; this.shake = 0; this.startMs = Date.now();
      this.touch.mx = 0; this.touch.my = 0; this.touch.aimActive = false;
      this.requestDash = false;
      this.syncMirrors();
    }

    start(diff, opts) {
      if (diff) this.difficulty = diff;
      this.resize(false);
      this.reset();
      if (opts && opts.bonusHp) this.arm.maxHp += opts.bonusHp;
      if (opts && opts.bonusDmg) this.arm.dmg *= opts.bonusDmg;
      this.healAll();
      if (opts && opts.startShield) this.p.shield = opts.startShield;
      this.state = "playing";
      this.onEvent("start");
      if (!this.loopOn) { this.loopOn = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
    }
    togglePause() {
      if (this.state === "playing") { this.state = "paused"; this.onEvent("pause"); }
      else if (this.state === "paused") { this.state = "playing"; this.last = performance.now(); this.onEvent("resume"); }
    }
    gameOver() {
      this.state = "over";
      this.syncMirrors();
      this.onEvent("over", { score: Math.floor(this.score), wave: this.wave, kills: this.kills, ms: Date.now() - this.startMs, coins: this.coins || 0, squad: !!(this.squad && this.squad.active) });
    }

    // ---------- squad (online co-op) ----------
    setArena(w, h) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = w; this.H = h;
      this.cv.width = Math.floor(w * dpr); this.cv.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cv.style.height = "";
      this._stars = Array.from({ length: this.isMobile ? 70 : 120 },
        () => ({ x: Math.random() * w, y: Math.random() * h, z: rand(0.2, 1) }));
    }
    startSquad(opts) {
      // opts: {isHost, members:[{id,name}], diff, myId, bonusHp, bonusDmg, startShield}
      this.difficulty = opts.diff || "pilot";
      this.setArena(SQUAD_ARENA.w, SQUAD_ARENA.h);
      this.arm = { dmg: 12, streams: 1, fireCdMax: 0.16, speed: 260, magnet: 90, maxHp: 100, dashCdMax: 2.2 };
      this.lvl = { level: 1, xp: 0, xpNext: 30 };
      this.coinMap = {};
      this.bullets = []; this.enemies = []; this.parts = [];
      this.pickups = []; this.ebullets = [];
      this.score = 0; this.kills = 0; this.wave = 1;
      this.spawnT = 0; this.spawned = 0; this.waveTotal = 8;
      this.time = 0; this.shake = 0; this.startMs = Date.now();
      this.localId = opts.myId;
      this.players = opts.members.map((m, i) => {
        const pl = this._mkPlayer(m.id, m.name, SQUAD_COLORS[i % SQUAD_COLORS.length],
          this.W / 2 + (i - (opts.members.length - 1) / 2) * 60, this.H / 2);
        this.coinMap[m.id] = 0;
        return pl;
      });
      if (opts.bonusHp) this.arm.maxHp += opts.bonusHp;
      if (opts.bonusDmg) this.arm.dmg *= opts.bonusDmg;
      this.healAll();
      const me = this.localPlayer();
      if (me && opts.startShield) me.shield = opts.startShield;
      this.squad = { active: true, isHost: !!opts.isHost };
      this.state = opts.isHost ? "playing" : "remote";
      this.syncMirrors();
      this.onEvent("start");
      if (!this.loopOn) { this.loopOn = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
    }
    endSquad() {
      this.squad = null;
      this.state = "menu";
      this.resize(false);
      this.reset();
    }
    genSnap() {
      const R = (n) => Math.round(n * 10) / 10;
      return {
        v: 1, wave: this.wave, score: Math.floor(this.score), kills: this.kills,
        lvl: { ...this.lvl }, arm: { ...this.arm },
        spawned: this.spawned, waveTotal: this.waveTotal,
        coins: { ...this.coinMap },
        players: this.players.map(p => ({
          id: p.id, name: p.name, color: p.color,
          x: R(p.x), y: R(p.y), hp: Math.ceil(p.hp), angle: R(p.angle),
          alive: p.alive, shield: R(p.shield), doubleT: R(p.doubleT),
          dashT: R(p.dashT), ax: R(p.input.ax || 0), ay: R(p.input.ay || 0)
        })),
        enemies: this.enemies.slice(0, 48).map(e => ({ ...e, x: R(e.x), y: R(e.y), hp: Math.ceil(e.hp), t: R(e.t), fireT: R(e.fireT) })),
        bullets: this.bullets.slice(0, 80).map(b => [R(b.x), R(b.y), R(b.vx), R(b.vy), R(b.life), b.dmg]),
        ebullets: this.ebullets.slice(0, 80).map(b => [R(b.x), R(b.y), R(b.vx), R(b.vy), R(b.life), b.dmg]),
        pickups: this.pickups.slice(0, 60)
      };
    }
    applySnap(s) {
      if (!s || s.v !== 1) return false;
      this.wave = s.wave; this.score = s.score; this.kills = s.kills;
      this.lvl = { ...s.lvl }; this.arm = { ...s.arm };
      this.spawned = s.spawned; this.waveTotal = s.waveTotal;
      this.coinMap = { ...s.coins };
      this.players = s.players.map(p => {
        const pl = this._mkPlayer(p.id, p.name, p.color, p.x, p.y);
        Object.assign(pl, {
          hp: p.hp, maxHp: this.arm.maxHp, angle: p.angle, alive: p.alive,
          shield: p.shield, doubleT: p.doubleT, dashT: p.dashT
        });
        pl.input.ax = p.ax; pl.input.ay = p.ay;
        return pl;
      });
      this.enemies = s.enemies.map(e => ({ ...e }));
      this.bullets = s.bullets.map(b => ({ x: b[0], y: b[1], vx: b[2], vy: b[3], life: b[4], dmg: b[5] }));
      this.ebullets = s.ebullets.map(b => ({ x: b[0], y: b[1], vx: b[2], vy: b[3], life: b[4], dmg: b[5] }));
      this.pickups = s.pickups.map(k => ({ ...k }));
      this.syncMirrors();
      return true;
    }
    takeOver(snap) {
      if (!this.applySnap(snap)) return false;
      if (this.squad) this.squad.isHost = true;
      this.state = "playing";
      this.last = performance.now();
      return true;
    }

    pendingUpgrades() { return this._pendingUps || null; }
    chooseUpgrade(id) {
      const ups = this._pendingUps; if (!ups) return;
      const u = ups.find(x => x.id === id); if (!u) return;
      u.apply(this.arm, this);
      this.syncMirrors();
      this._pendingUps = null;
      this.state = "playing";
      this.last = performance.now();
      this.sfx.level();
      this.onEvent("resume");
    }

    spawnEnemy(force) {
      const cfg = CONFIG[this.difficulty];
      const edge = Math.floor(rand(0, 4));
      let x, y;
      if (edge === 0) { x = rand(0, this.W); y = -20; }
      else if (edge === 1) { x = this.W + 20; y = rand(0, this.H); }
      else if (edge === 2) { x = rand(0, this.W); y = this.H + 20; }
      else { x = -20; y = rand(0, this.H); }
      const bossWave = this.wave % 5 === 0;
      let type = force || "chaser";
      if (!force) {
        const r = Math.random();
        if (bossWave && this.spawned === 0) type = "boss";
        else if (this.wave >= 3 && r < 0.16) type = "sniper";
        else if (this.wave >= 2 && r < 0.34) type = "splitter";
        else if (r < 0.52) type = "speeder";
        else type = "chaser";
      }
      const base = { x, y, t: 0, fireT: rand(1, 2.5) };
      const wm = waveMul(this.wave);
      const hpMul = cfg.enemyHp * wm.hp * (1 + 0.25 * (this.players.length - 1));
      const dmgMul = cfg.enemyDmg * wm.dmg;
      const spdMul = cfg.enemySpeed * wm.spd;
      if (type === "chaser") Object.assign(base, { type, r: 14, hp: 26 * hpMul, speed: 105 * spdMul, dmg: 12 * dmgMul, score: 50, color: "#f472b6" });
      if (type === "speeder") Object.assign(base, { type, r: 10, hp: 14 * hpMul, speed: 185 * spdMul, dmg: 8 * dmgMul, score: 70, color: "#5eeaff" });
      if (type === "splitter") Object.assign(base, { type, r: 18, hp: 44 * hpMul, speed: 80 * spdMul, dmg: 14 * dmgMul, score: 90, color: "#a78bfa" });
      if (type === "sniper") Object.assign(base, { type, r: 13, hp: 30 * hpMul, speed: 90 * spdMul, dmg: 10 * dmgMul, score: 120, color: "#fbbf24" });
      if (type === "mini") Object.assign(base, { type, r: 8, hp: 8 * hpMul, speed: 200 * spdMul, dmg: 6 * dmgMul, score: 25, color: "#c4b5fd" });
      if (type === "boss") Object.assign(base, { type, r: 34, hp: 420 * hpMul, speed: 62 * spdMul, dmg: 22 * dmgMul, score: 800, color: "#fb7185" });
      this.enemies.push(base);
      this.spawned++;
    }

    explode(x, y, color, n = 14, power = 220) {
      const cap = this.isMobile ? 220 : 400;
      if (this.parts.length > cap) this.parts.splice(0, this.parts.length - cap);
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), s = rand(power * 0.3, power);
        this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), max: 0.8, color, r: rand(2, 4.5) });
      }
    }

    loop(t) {
      if (!this.loopOn) return;
      const dt = Math.min(0.033, (t - this.last) / 1000);
      this.last = t;
      if (this.state === "playing") this.update(dt);
      this.render();
      requestAnimationFrame(tt => this.loop(tt));
    }

    update(dt) {
      const cfg = CONFIG[this.difficulty];
      const arm = this.arm;
      this.time += dt;
      const nP = this.players.length;
      const wm = waveMul(this.wave); // full difficulty scaling for this wave
      const me = this.localPlayer();
      const lin = this.sampleInput();
      if (me) { me.input.mx = lin.mx; me.input.my = lin.my; }

      // --- per-player movement / aim / fire ---
      for (const pl of this.players) {
        if (!pl.alive) continue;
        const isMe = (pl === me);
        const inp = isMe ? lin : pl.input;
        const ml = Math.hypot(inp.mx, inp.my);
        const dashing = pl.dashT > 0;
        const spd = arm.speed * (dashing ? 2.6 : 1);
        if (ml > 0.05) {
          const nx = inp.mx / (ml > 1 ? ml : 1), ny = inp.my / (ml > 1 ? ml : 1);
          pl.x = clamp(pl.x + nx * spd * dt, pl.r, this.W - pl.r);
          pl.y = clamp(pl.y + ny * spd * dt, pl.r, this.H - pl.r);
        }
        pl.dashT = Math.max(0, pl.dashT - dt);
        pl.dashCd = Math.max(0, pl.dashCd - dt);
        if (inp.dash && pl.dashCd <= 0 && ml > 0.15) {
          pl.dashT = 0.16; pl.dashCd = arm.dashCdMax;
          this.explode(pl.x, pl.y, pl.color, 10, 160);
          this.sfx.blip(300, 0.15, "sine", 0.1, 300);
        }
        pl.inv = Math.max(0, pl.inv - dt);
        pl.shield = Math.max(0, pl.shield - dt);
        pl.doubleT = Math.max(0, pl.doubleT - dt);

        // aim
        if (isMe) {
          if (lin.aimPad) {
            pl.angle = Math.atan2(lin.ay, lin.ax);
          } else {
            if (!(this.touch.aimId !== null) && (this.isMobile || this.padActive) && !this.mouse.down && !lin.fire) {
              let best = null, bd = Infinity;
              for (const e of this.enemies) {
                const d = (e.x - pl.x) ** 2 + (e.y - pl.y) ** 2;
                if (d < bd) { bd = d; best = e; }
              }
              if (best) { this.mouse.x = best.x; this.mouse.y = best.y; }
            }
            pl.angle = Math.atan2(this.mouse.y - pl.y, this.mouse.x - pl.x);
          }
        } else if (Math.hypot(inp.ax, inp.ay) > 0.25) {
          pl.angle = Math.atan2(inp.ay, inp.ax);
        }

        // fire
        pl.fireCd -= dt;
        const firing = isMe ? lin.fire : !!inp.fire;
        if (firing && pl.fireCd <= 0) {
          pl.fireCd = arm.fireCdMax;
          const n = arm.streams + (pl.doubleT > 0 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * 0.12;
            const a = pl.angle + off;
            this.bullets.push({ x: pl.x + Math.cos(a) * 20, y: pl.y + Math.sin(a) * 20, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, life: 1.1, dmg: arm.dmg });
          }
          if (isMe) this.sfx.shoot();
        }
      }

      // --- waves (scaled for squad size) ---
      this.waveTotal = 6 + this.wave * 2 + 3 * (nP - 1);
      this.spawnT -= dt;
      if (this.spawned < this.waveTotal && this.spawnT <= 0) {
        this.spawnT = 0.55 * cfg.spawnGap * wm.gap;
        this.spawnEnemy();
      } else if (this.spawned >= this.waveTotal && this.enemies.length === 0) {
        this.wave++;
        this.spawned = 0;
        for (const pl of this.players) pl.hp = Math.min(arm.maxHp, pl.hp + 15);
        this.onEvent("wave", { wave: this.wave });
      }

      const alivePlayers = () => this.players.filter(pl => pl.alive);
      const nearest = (x, y) => {
        let best = null, bd = Infinity;
        for (const pl of this.players) {
          if (!pl.alive) continue;
          const d = (pl.x - x) ** 2 + (pl.y - y) ** 2;
          if (d < bd) { bd = d; best = pl; }
        }
        return best;
      };
      const hurt = (pl, dmg) => {
        if (pl.shield > 0) dmg *= 0.25;
        pl.hp -= dmg;
        pl.inv = 0.5;
        this.shake = this.isMobile ? 5 : 8;
        this.explode(pl.x, pl.y, "#fb7185", 12, 260);
        this.sfx.hurt();
        this.onEvent("hud");
        if (pl.hp <= 0) {
          pl.hp = 0; pl.alive = false;
          this.explode(pl.x, pl.y, "#fff", 40, 380); this.sfx.boom();
          if (!alivePlayers().length) { this.gameOver(); return true; }
        }
        return false;
      };

      // --- enemies (target nearest alive player) ---
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.t += dt;
        const tgt = nearest(e.x, e.y);
        if (!tgt) continue;
        const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (e.type === "sniper") {
          if (d > 320) { e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; }
          else if (d < 220) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
          e.fireT -= dt;
          if (e.fireT <= 0 && d < 560) {
            e.fireT = 1.6 * wm.fire;
            const a = Math.atan2(dy, dx);
            this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260 * wm.shot, vy: Math.sin(a) * 260 * wm.shot, life: 3, dmg: e.dmg });
            this.sfx.blip(180, 0.12, "sawtooth", 0.06);
          }
        } else if (e.type === "boss") {
          e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = 1.1 * wm.fire;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2 + e.t;
              this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190 * wm.shot, vy: Math.sin(a) * 190 * wm.shot, life: 3.2, dmg: e.dmg * 0.6 });
            }
            this.sfx.blip(120, 0.25, "sawtooth", 0.1);
          }
        } else {
          const wob = e.type === "speeder" ? Math.sin(e.t * 6) * 40 : 0;
          const nx = dx / d, ny = dy / d;
          e.x += (nx * e.speed - ny * wob * 0.3) * dt;
          e.y += (ny * e.speed + nx * wob * 0.3) * dt;
        }
        for (const pl of alivePlayers()) {
          const pd = Math.hypot(pl.x - e.x, pl.y - e.y);
          if (pd < e.r + pl.r && pl.inv <= 0 && pl.dashT <= 0) {
            if (hurt(pl, e.dmg)) return;
            break;
          }
        }
      }

      // --- player bullets ---
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        let dead = b.life <= 0 || b.x < -20 || b.x > this.W + 20 || b.y < -20 || b.y > this.H + 20;
        if (!dead) {
          for (let j = this.enemies.length - 1; j >= 0; j--) {
            const e = this.enemies[j];
            const dd = (b.x - e.x) ** 2 + (b.y - e.y) ** 2;
            if (dd < (e.r + 4) ** 2) {
              e.hp -= b.dmg;
              dead = true;
              this.explode(b.x, b.y, "#5eeaff", 4, 140);
              if (e.hp <= 0) this.killEnemy(j);
              else this.sfx.hit();
              break;
            }
          }
        }
        if (dead) this.bullets.splice(i, 1);
      }

      // --- enemy bullets ---
      for (let i = this.ebullets.length - 1; i >= 0; i--) {
        const b = this.ebullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        let consumed = false;
        for (const pl of alivePlayers()) {
          const dd = (b.x - pl.x) ** 2 + (b.y - pl.y) ** 2;
          if (dd < (pl.r) ** 2 && pl.inv <= 0 && pl.dashT <= 0) {
            if (hurt(pl, b.dmg)) return;
            consumed = true;
            break;
          }
        }
        if (consumed) { this.ebullets.splice(i, 1); continue; }
        if (b.life <= 0) this.ebullets.splice(i, 1);
      }

      // --- pickups (any alive player grabs) ---
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i];
        k.life -= dt;
        let taken = false;
        for (const pl of alivePlayers()) {
          const dx = pl.x - k.x, dy = pl.y - k.y, d = Math.hypot(dx, dy) || 1;
          if (d < arm.magnet) { k.x += (dx / d) * 260 * dt; k.y += (dy / d) * 260 * dt; }
          if (d < pl.r + 10) {
            if (k.kind === "hp") pl.hp = Math.min(arm.maxHp, pl.hp + 25);
            if (k.kind === "shield") pl.shield = 6;
            if (k.kind === "double") pl.doubleT = 10;
            if (k.kind === "xp") this.gainXp(8);
            if (k.kind === "coin") {
              this.coinMap[pl.id] = (this.coinMap[pl.id] || 0) + 1;
              if (pl === me) { this.syncMirrors(); this.onEvent("hud"); }
            }
            this.sfx.pickup();
            this.explode(k.x, k.y, k.kind === "coin" ? "#fbbf24" : "#34d399", 8, 150);
            taken = true;
            break;
          }
        }
        if (taken) { this.pickups.splice(i, 1); continue; }
        if (k.life <= 0) this.pickups.splice(i, 1);
      }

      // --- particles ---
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.vx *= 0.96; q.vy *= 0.96;
        q.life -= dt;
        if (q.life <= 0) this.parts.splice(i, 1);
      }
      this.shake = Math.max(0, this.shake - dt * 30);
      for (const s of this._stars) {
        s.y += s.z * 18 * dt;
        if (s.y > this.H) { s.y = -2; s.x = Math.random() * this.W; }
      }
      this.syncMirrors();
      this.onEvent("hud");
    }

    killEnemy(j) {
      const e = this.enemies[j];
      this.enemies.splice(j, 1);
      this.kills++;
      this.score += e.score * (1 + (this.wave - 1) * 0.08);
      this.explode(e.x, e.y, e.color, e.type === "boss" ? 40 : 14, 260);
      this.sfx.boom();
      this.shake = Math.min(12, this.shake + (e.type === "boss" ? 10 : 3));
      if (e.type === "splitter") {
        for (let k = 0; k < 3; k++) {
          this.enemies.push({ type: "mini", x: e.x + rand(-12, 12), y: e.y + rand(-12, 12), r: 8, hp: 8 * CONFIG[this.difficulty].enemyHp, speed: 200, dmg: 6, score: 25, color: "#c4b5fd", t: 0, fireT: 0 });
        }
      }
      this.gainXp(e.type === "boss" ? 60 : e.type === "sniper" ? 16 : 10);
      const roll = Math.random();
      if (roll < 0.12) {
        const kinds = ["hp", "shield", "double", "xp"];
        this.pickups.push({ x: e.x, y: e.y, kind: kinds[Math.floor(Math.random() * kinds.length)], life: 9 });
      }
      // coin drops: steady income through actual gameplay (bosses shower coins)
      if (e.type === "boss") {
        for (let k = 0; k < 8; k++) {
          this.pickups.push({ x: e.x + rand(-26, 26), y: e.y + rand(-26, 26), kind: "coin", life: 12 });
        }
      } else if (Math.random() < 0.35) {
        this.pickups.push({ x: e.x, y: e.y, kind: "coin", life: 9 });
      }
    }

    gainXp(n) {
      this.lvl.xp += n;
      if (this.lvl.xp >= this.lvl.xpNext) {
        this.lvl.xp -= this.lvl.xpNext;
        this.lvl.level++;
        this.lvl.xpNext = Math.floor(this.lvl.xpNext * 1.35);
        this.syncMirrors();
        // squad guests don't pick — the host's choice applies to everyone
        if (this.squad && !this.squad.isHost) return;
        const pool = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
        this._pendingUps = pool;
        this.state = "upgrade";
        this.onEvent("upgrade", pool);
      }
    }

    render() {
      const c = this.ctx;
      c.save();
      if (this.shake > 0) c.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
      const g = c.createRadialGradient(this.W / 2, this.H / 2, 80, this.W / 2, this.H / 2, 700);
      g.addColorStop(0, "#0a1030"); g.addColorStop(1, "#04060d");
      c.fillStyle = g; c.fillRect(-20, -20, this.W + 40, this.H + 40);
      for (const s of this._stars) {
        c.globalAlpha = 0.25 + s.z * 0.6;
        c.fillStyle = "#cfe9ff";
        c.fillRect(s.x, s.y, s.z * 2, s.z * 2);
      }
      c.globalAlpha = 1;
      c.strokeStyle = "rgba(94,234,255,0.07)"; c.lineWidth = 1;
      for (let x = 0; x < this.W; x += 56) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke(); }
      for (let y = 0; y < this.H; y += 56) { c.beginPath(); c.moveTo(0, y); c.lineTo(this.W, y); c.stroke(); }

      const drawGlow = (x, y, r, color) => {
        const rg = c.createRadialGradient(x, y, 0, x, y, r * 3);
        rg.addColorStop(0, color + "55"); rg.addColorStop(1, "transparent");
        c.fillStyle = rg; c.beginPath(); c.arc(x, y, r * 3, 0, 7); c.fill();
      };

      for (const k of this.pickups) {
        if (k.kind === "coin") {
          drawGlow(k.x, k.y, 7, "#fbbf24");
          c.fillStyle = "#fbbf24";
          c.beginPath(); c.arc(k.x, k.y, 7 + Math.sin(this.time * 5 + k.x) * 1.2, 0, 7); c.fill();
          c.fillStyle = "#7c4a03";
          c.beginPath(); c.arc(k.x, k.y, 3.4, 0, 7); c.fill();
          continue;
        }
        const col = k.kind === "hp" ? "#34d399" : k.kind === "shield" ? "#5eeaff" : k.kind === "double" ? "#fbbf24" : "#a78bfa";
        drawGlow(k.x, k.y, 8, col);
        c.fillStyle = col;
        c.save(); c.translate(k.x, k.y); c.rotate(this.time * 2);
        c.fillRect(-6, -6, 12, 12);
        c.fillStyle = "#04121a"; c.font = "bold 10px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(k.kind === "hp" ? "+" : k.kind === "shield" ? "S" : k.kind === "double" ? "2x" : "★", 0, 1);
        c.restore();
      }

      for (const e of this.enemies) {
        drawGlow(e.x, e.y, e.r, e.color);
        c.save(); c.translate(e.x, e.y); c.rotate(e.t * (e.type === "boss" ? 0.6 : 1.5));
        c.fillStyle = e.color;
        c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 1.5;
        const sides = e.type === "boss" ? 6 : e.type === "splitter" ? 5 : e.type === "sniper" ? 3 : 4;
        c.beginPath();
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath(); c.fill(); c.stroke();
        c.fillStyle = "#06121f"; c.beginPath(); c.arc(0, 0, e.r * 0.35, 0, 7); c.fill();
        c.restore();
        if (e.type === "boss" || e.type === "splitter") {
          c.fillStyle = "rgba(255,255,255,.15)";
          c.fillRect(e.x - 20, e.y - e.r - 10, 40, 4);
          c.fillStyle = e.color;
          const max = e.type === "boss" ? 420 : 44;
          c.fillRect(e.x - 20, e.y - e.r - 10, 40 * Math.max(0, e.hp / (max * 1.5)), 4);
        }
      }

      c.fillStyle = "#8ef6ff";
      for (const b of this.bullets) {
        drawGlow(b.x, b.y, 3, "#5eeaff");
        c.beginPath(); c.arc(b.x, b.y, 3.4, 0, 7); c.fill();
      }
      c.fillStyle = "#fda4af";
      for (const b of this.ebullets) { c.beginPath(); c.arc(b.x, b.y, 4, 0, 7); c.fill(); }

      if (this.state !== "over") {
        const me = this.localPlayer();
        for (const p of this.players) {
          if (!p.alive) continue;
          const isMe = (p === me) || (!me && p === this.players[0]);
          drawGlow(p.x, p.y, p.r, p.color);
          if (p.shield > 0) {
            c.strokeStyle = "rgba(94,234,255,.8)"; c.lineWidth = 2;
            c.beginPath(); c.arc(p.x, p.y, p.r + 8 + Math.sin(this.time * 6) * 2, 0, 7); c.stroke();
          }
          c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
          const grad = c.createLinearGradient(-14, 0, 18, 0);
          grad.addColorStop(0, "#818cf8"); grad.addColorStop(1, p.color);
          c.fillStyle = grad;
          c.strokeStyle = isMe ? "#fff" : p.color; c.lineWidth = isMe ? 1.5 : 1;
          c.beginPath();
          c.moveTo(18, 0); c.lineTo(-10, -11); c.lineTo(-5, 0); c.lineTo(-10, 11);
          c.closePath(); c.fill(); c.stroke();
          c.fillStyle = "#0b1228"; c.beginPath(); c.arc(2, 0, 4, 0, 7); c.fill();
          c.restore();
          // name tag + hp bar for squadmates
          if (this.squad && this.squad.active) {
            c.fillStyle = isMe ? "#fff" : p.color;
            c.font = "700 11px system-ui"; c.textAlign = "center";
            c.fillText((p.name || "?").slice(0, 12), p.x, p.y - p.r - 12);
            c.fillStyle = "rgba(255,255,255,.18)";
            c.fillRect(p.x - 16, p.y - p.r - 8, 32, 3);
            c.fillStyle = p.color;
            c.fillRect(p.x - 16, p.y - p.r - 8, 32 * Math.max(0, p.hp / this.arm.maxHp), 3);
          }
          if (isMe && p.dashCd > 0) {
            c.fillStyle = "rgba(255,255,255,.25)";
            c.fillRect(p.x - 14, p.y + 18, 28 * (1 - p.dashCd / this.arm.dashCdMax), 3);
          }
        }
      }

      for (const q of this.parts) {
        c.globalAlpha = Math.max(0, q.life / q.max);
        c.fillStyle = q.color;
        c.beginPath(); c.arc(q.x, q.y, q.r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;

      if (this.state === "paused") {
        c.fillStyle = "rgba(3,5,12,.55)"; c.fillRect(0, 0, this.W, this.H);
        c.fillStyle = "#fff"; c.font = "800 30px system-ui"; c.textAlign = "center";
        c.fillText(this.isMobile ? "PAUSED — tap Resume" : "PAUSED — press P", this.W / 2, this.H / 2);
      }
      c.restore();
    }
  }

  global.NebulaGame = NebulaGame;
})(window);
