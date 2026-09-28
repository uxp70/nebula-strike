/* NebulaGame — canvas arena shooter engine. No dependencies. */
(function (global) {
  "use strict";

  const CONFIG = {
    rookie: { enemyHp: 0.7, enemySpeed: 0.85, spawnGap: 1.25, enemyDmg: 0.7 },
    pilot:  { enemyHp: 1.0, enemySpeed: 1.0,  spawnGap: 1.0,  enemyDmg: 1.0 },
    ace:    { enemyHp: 1.45, enemySpeed: 1.15, spawnGap: 0.75, enemyDmg: 1.4 }
  };

  const UPGRADES = [
    { id: "rapid",   name: "⚡ Overclock",   desc: "+22% fire rate", apply(p) { p.fireCdMax *= 0.82; } },
    { id: "dmg",     name: "💥 Heavy rounds", desc: "+30% damage", apply(p) { p.dmg *= 1.3; } },
    { id: "speed",   name: "🌀 Ion thrusters", desc: "+12% speed, +dash recharge", apply(p) { p.speed *= 1.12; p.dashCdMax *= 0.9; } },
    { id: "hull",    name: "🛡️ Nano hull",  desc: "+30 max HP + full repair", apply(p) { p.maxHp += 30; p.hp = p.maxHp; } },
    { id: "multi",   name: "🔱 Split cannon", desc: "+1 projectile", apply(p) { p.streams = Math.min(4, p.streams + 1); } },
    { id: "magnet",  name: "🧲 Tractor core", desc: "bigger pickup radius", apply(p) { p.magnet += 60; } }
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  class NebulaGame {
    constructor(canvas, sfx) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.sfx = sfx;
      this.W = canvas.width; this.H = canvas.height;
      this.keys = {};
      this.mouse = { x: this.W / 2, y: this.H / 2, down: false };
      this.state = "menu"; // menu | playing | paused | upgrade | over
      this.difficulty = "pilot";
      this.onEvent = function () {};
      this._bind();
      this._stars = Array.from({ length: 120 }, () => ({ x: Math.random() * this.W, y: Math.random() * this.H, z: rand(0.2, 1) }));
      this.reset();
    }

    _bind() {
      window.addEventListener("keydown", e => {
        this.keys[e.key.toLowerCase()] = true;
        if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
        if (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "escape") this.togglePause();
        if (e.key.toLowerCase() === "m") this.onEvent("mute");
      });
      window.addEventListener("keyup", e => { this.keys[e.key.toLowerCase()] = false; });
      const rect = () => this.cv.getBoundingClientRect();
      this.cv.addEventListener("mousemove", e => {
        const r = rect();
        this.mouse.x = (e.clientX - r.left) * (this.W / r.width);
        this.mouse.y = (e.clientY - r.top) * (this.H / r.height);
      });
      this.cv.addEventListener("mousedown", () => { this.mouse.down = true; });
      window.addEventListener("mouseup", () => { this.mouse.down = false; });
      // touch: left half move, right half aim+fire
      this.touch = { moveId: null, aimId: null, mx: 0, my: 0, ax: 1, ay: 0 };
      this.cv.addEventListener("touchstart", e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const r = rect();
          const x = (t.clientX - r.left) * (this.W / r.width);
          if (x < this.W / 2 && this.touch.moveId === null) { this.touch.moveId = t.identifier; this.touch.mx = t.clientX; this.touch.my = t.clientY; }
          else if (this.touch.aimId === null) { this.touch.aimId = t.identifier; }
        }
      }, { passive: false });
      this.cv.addEventListener("touchmove", e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const r = rect();
          const x = (t.clientX - r.left) * (this.W / r.width);
          const y = (t.clientY - r.top) * (this.H / r.height);
          if (t.identifier === this.touch.moveId) {
            const dx = t.clientX - this.touch.mx, dy = t.clientY - this.touch.my;
            this.touch.ox = dx; this.touch.oy = dy;
          }
          if (t.identifier === this.touch.aimId) {
            this.mouse.x = x; this.mouse.y = y; this.mouse.down = true;
          }
        }
      }, { passive: false });
      const endTouch = e => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.touch.moveId) { this.touch.moveId = null; this.touch.ox = 0; this.touch.oy = 0; }
          if (t.identifier === this.touch.aimId) { this.touch.aimId = null; this.mouse.down = false; }
        }
      };
      this.cv.addEventListener("touchend", endTouch);
      this.cv.addEventListener("touchcancel", endTouch);
    }

    reset() {
      this.p = {
        x: this.W / 2, y: this.H / 2, r: 14,
        hp: 100, maxHp: 100, speed: 260, angle: 0,
        fireCd: 0, fireCdMax: 0.16, dmg: 12, streams: 1,
        level: 1, xp: 0, xpNext: 30, magnet: 90,
        shield: 0, doubleT: 0, dashCd: 0, dashCdMax: 2.2, dashT: 0,
        inv: 0
      };
      this.bullets = []; this.enemies = []; this.parts = [];
      this.pickups = []; this.ebullets = [];
      this.score = 0; this.kills = 0; this.wave = 1;
      this.spawnT = 0; this.spawned = 0; this.waveTotal = 8;
      this.time = 0; this.shake = 0; this.startMs = Date.now();
    }

    start(diff) {
      if (diff) this.difficulty = diff;
      this.reset();
      this.state = "playing";
      this.onEvent("start");
      if (!this.loopOn) { this.loopOn = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
    }
    togglePause() {
      if (this.state === "playing") { this.state = "paused"; this.onEvent("pause"); }
      else if (this.state === "paused") { this.state = "playing"; this.onEvent("resume"); }
    }
    gameOver() {
      this.state = "over";
      this.onEvent("over", { score: Math.floor(this.score), wave: this.wave, kills: this.kills, ms: Date.now() - this.startMs });
    }

    pendingUpgrades() { return this._pendingUps || null; }
    chooseUpgrade(id) {
      const ups = this._pendingUps; if (!ups) return;
      const u = ups.find(x => x.id === id); if (!u) return;
      u.apply(this.p);
      this._pendingUps = null;
      this.state = "playing";
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
      const hpMul = cfg.enemyHp * (1 + (this.wave - 1) * 0.22);
      if (type === "chaser") Object.assign(base, { type, r: 14, hp: 26 * hpMul, speed: 105 * cfg.enemySpeed, dmg: 12 * cfg.enemyDmg, score: 50, color: "#f472b6" });
      if (type === "speeder") Object.assign(base, { type, r: 10, hp: 14 * hpMul, speed: 185 * cfg.enemySpeed, dmg: 8 * cfg.enemyDmg, score: 70, color: "#5eeaff" });
      if (type === "splitter") Object.assign(base, { type, r: 18, hp: 44 * hpMul, speed: 80 * cfg.enemySpeed, dmg: 14 * cfg.enemyDmg, score: 90, color: "#a78bfa" });
      if (type === "sniper") Object.assign(base, { type, r: 13, hp: 30 * hpMul, speed: 90 * cfg.enemySpeed, dmg: 10 * cfg.enemyDmg, score: 120, color: "#fbbf24" });
      if (type === "mini") Object.assign(base, { type, r: 8, hp: 8 * hpMul, speed: 200 * cfg.enemySpeed, dmg: 6 * cfg.enemyDmg, score: 25, color: "#c4b5fd" });
      if (type === "boss") Object.assign(base, { type, r: 34, hp: 420 * hpMul, speed: 62 * cfg.enemySpeed, dmg: 22 * cfg.enemyDmg, score: 800, color: "#fb7185" });
      this.enemies.push(base);
      this.spawned++;
    }

    explode(x, y, color, n = 14, power = 220) {
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
      this.time += dt;
      const p = this.p;

      // --- movement ---
      let mx = 0, my = 0;
      if (this.keys["w"] || this.keys["arrowup"]) my -= 1;
      if (this.keys["s"] || this.keys["arrowdown"]) my += 1;
      if (this.keys["a"] || this.keys["arrowleft"]) mx -= 1;
      if (this.keys["d"] || this.keys["arrowright"]) mx += 1;
      if (this.touch.moveId !== null && (this.touch.ox || this.touch.oy)) {
        mx = this.touch.ox / 40; my = this.touch.oy / 40;
        const m = Math.hypot(mx, my) || 1;
        if (m > 1) { mx /= m; my /= m; }
      }
      const dashing = p.dashT > 0;
      const spd = p.speed * (dashing ? 2.6 : 1);
      const ml = Math.hypot(mx, my) || 1;
      p.x = Math.max(p.r, Math.min(this.W - p.r, p.x + (mx / ml) * spd * dt * (mx || my ? 1 : 0)));
      p.y = Math.max(p.r, Math.min(this.H - p.r, p.y + (my / ml) * spd * dt * (mx || my ? 1 : 0)));
      p.dashT = Math.max(0, p.dashT - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);
      if ((this.keys["shift"]) && p.dashCd <= 0 && (mx || my)) {
        p.dashT = 0.16; p.dashCd = p.dashCdMax;
        this.explode(p.x, p.y, "#5eeaff", 10, 160);
        this.sfx.blip(300, 0.15, "sine", 0.1, 300);
        this.keys["shift"] = false;
      }
      p.inv = Math.max(0, p.inv - dt);
      p.shield = Math.max(0, p.shield - dt);
      p.doubleT = Math.max(0, p.doubleT - dt);

      // aim
      p.angle = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);

      // --- fire ---
      p.fireCd -= dt;
      const firing = this.mouse.down || this.keys[" "];
      if (firing && p.fireCd <= 0) {
        p.fireCd = p.fireCdMax;
        const n = p.streams + (p.doubleT > 0 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.12;
          const a = p.angle + off;
          this.bullets.push({ x: p.x + Math.cos(a) * 20, y: p.y + Math.sin(a) * 20, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, life: 1.1, dmg: p.dmg });
        }
        this.sfx.shoot();
      }

      // --- waves ---
      this.waveTotal = 6 + this.wave * 2;
      this.spawnT -= dt;
      if (this.spawned < this.waveTotal && this.spawnT <= 0) {
        this.spawnT = 0.55 * cfg.spawnGap;
        this.spawnEnemy();
      } else if (this.spawned >= this.waveTotal && this.enemies.length === 0) {
        this.wave++;
        this.spawned = 0;
        p.hp = Math.min(p.maxHp, p.hp + 15);
        this.onEvent("wave", { wave: this.wave });
      }

      // --- enemies ---
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.t += dt;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (e.type === "sniper") {
          if (d > 320) { e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; }
          else if (d < 220) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
          e.fireT -= dt;
          if (e.fireT <= 0 && d < 560) {
            e.fireT = 1.6;
            const a = Math.atan2(dy, dx);
            this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 3, dmg: e.dmg });
            this.sfx.blip(180, 0.12, "sawtooth", 0.06);
          }
        } else if (e.type === "boss") {
          e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = 1.1;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2 + e.t;
              this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, life: 3.2, dmg: e.dmg * 0.6 });
            }
            this.sfx.blip(120, 0.25, "sawtooth", 0.1);
          }
        } else {
          const wob = e.type === "speeder" ? Math.sin(e.t * 6) * 40 : 0;
          const nx = dx / d, ny = dy / d;
          e.x += (nx * e.speed - ny * wob * 0.3) * dt;
          e.y += (ny * e.speed + nx * wob * 0.3) * dt;
        }
        // touch player
        if (d < e.r + p.r && p.inv <= 0 && p.dashT <= 0) {
          let dmg = e.dmg;
          if (p.shield > 0) dmg *= 0.25;
          p.hp -= dmg;
          p.inv = 0.5;
          this.shake = 8;
          this.explode(p.x, p.y, "#fb7185", 12, 260);
          this.sfx.hurt();
          this.onEvent("hud");
          if (p.hp <= 0) { p.hp = 0; this.explode(p.x, p.y, "#fff", 40, 380); this.sfx.boom(); this.gameOver(); return; }
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
        const dd = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
        if (dd < (p.r) ** 2 && p.inv <= 0 && p.dashT <= 0) {
          let dmg = b.dmg;
          if (p.shield > 0) dmg *= 0.25;
          p.hp -= dmg; p.inv = 0.5; this.shake = 6;
          this.sfx.hurt();
          this.ebullets.splice(i, 1);
          if (p.hp <= 0) { p.hp = 0; this.gameOver(); return; }
          continue;
        }
        if (b.life <= 0) this.ebullets.splice(i, 1);
      }

      // --- pickups ---
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i];
        k.life -= dt;
        const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.magnet) { k.x += (dx / d) * 260 * dt; k.y += (dy / d) * 260 * dt; }
        if (d < p.r + 10) {
          if (k.kind === "hp") p.hp = Math.min(p.maxHp, p.hp + 25);
          if (k.kind === "shield") p.shield = 6;
          if (k.kind === "double") p.doubleT = 10;
          if (k.kind === "xp") this.gainXp(8);
          this.sfx.pickup();
          this.explode(k.x, k.y, "#34d399", 8, 150);
          this.pickups.splice(i, 1);
          continue;
        }
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
      // stars drift
      for (const s of this._stars) {
        s.y += s.z * 18 * dt;
        if (s.y > this.H) { s.y = -2; s.x = Math.random() * this.W; }
      }
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
    }

    gainXp(n) {
      const p = this.p;
      p.xp += n;
      if (p.xp >= p.xpNext) {
        p.xp -= p.xpNext;
        p.level++;
        p.xpNext = Math.floor(p.xpNext * 1.35);
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
      // bg
      const g = c.createRadialGradient(this.W / 2, this.H / 2, 80, this.W / 2, this.H / 2, 700);
      g.addColorStop(0, "#0a1030"); g.addColorStop(1, "#04060d");
      c.fillStyle = g; c.fillRect(-20, -20, this.W + 40, this.H + 40);
      for (const s of this._stars) {
        c.globalAlpha = 0.25 + s.z * 0.6;
        c.fillStyle = "#cfe9ff";
        c.fillRect(s.x, s.y, s.z * 2, s.z * 2);
      }
      c.globalAlpha = 1;
      // grid
      c.strokeStyle = "rgba(94,234,255,0.07)"; c.lineWidth = 1;
      for (let x = 0; x < this.W; x += 56) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke(); }
      for (let y = 0; y < this.H; y += 56) { c.beginPath(); c.moveTo(0, y); c.lineTo(this.W, y); c.stroke(); }

      const drawGlow = (x, y, r, color) => {
        const rg = c.createRadialGradient(x, y, 0, x, y, r * 3);
        rg.addColorStop(0, color + "55"); rg.addColorStop(1, "transparent");
        c.fillStyle = rg; c.beginPath(); c.arc(x, y, r * 3, 0, 7); c.fill();
      };

      // pickups
      for (const k of this.pickups) {
        const col = k.kind === "hp" ? "#34d399" : k.kind === "shield" ? "#5eeaff" : k.kind === "double" ? "#fbbf24" : "#a78bfa";
        drawGlow(k.x, k.y, 8, col);
        c.fillStyle = col;
        c.save(); c.translate(k.x, k.y); c.rotate(this.time * 2);
        c.fillRect(-6, -6, 12, 12);
        c.fillStyle = "#04121a"; c.font = "bold 10px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(k.kind === "hp" ? "+" : k.kind === "shield" ? "S" : k.kind === "double" ? "2x" : "★", 0, 1);
        c.restore();
      }

      // enemies
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
        // hp mini-bar for tough ones
        if (e.type === "boss" || e.type === "splitter") {
          c.fillStyle = "rgba(255,255,255,.15)";
          c.fillRect(e.x - 20, e.y - e.r - 10, 40, 4);
          c.fillStyle = e.color;
          const max = e.type === "boss" ? 420 : 44;
          c.fillRect(e.x - 20, e.y - e.r - 10, 40 * Math.max(0, e.hp / (max * 1.5)), 4);
        }
      }

      // bullets
      c.fillStyle = "#8ef6ff";
      for (const b of this.bullets) {
        drawGlow(b.x, b.y, 3, "#5eeaff");
        c.beginPath(); c.arc(b.x, b.y, 3.4, 0, 7); c.fill();
      }
      c.fillStyle = "#fda4af";
      for (const b of this.ebullets) { c.beginPath(); c.arc(b.x, b.y, 4, 0, 7); c.fill(); }

      // player
      if (this.state !== "over") {
        const p = this.p;
        drawGlow(p.x, p.y, p.r, "#5eeaff");
        if (p.shield > 0) {
          c.strokeStyle = "rgba(94,234,255,.8)"; c.lineWidth = 2;
          c.beginPath(); c.arc(p.x, p.y, p.r + 8 + Math.sin(this.time * 6) * 2, 0, 7); c.stroke();
        }
        c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
        const grad = c.createLinearGradient(-14, 0, 18, 0);
        grad.addColorStop(0, "#818cf8"); grad.addColorStop(1, "#5eeaff");
        c.fillStyle = grad;
        c.strokeStyle = "#fff"; c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(18, 0); c.lineTo(-10, -11); c.lineTo(-5, 0); c.lineTo(-10, 11);
        c.closePath(); c.fill(); c.stroke();
        c.fillStyle = "#0b1228"; c.beginPath(); c.arc(2, 0, 4, 0, 7); c.fill();
        c.restore();
        if (p.dashCd > 0) {
          c.fillStyle = "rgba(255,255,255,.25)";
          c.fillRect(p.x - 14, p.y + 18, 28 * (1 - p.dashCd / p.dashCdMax), 3);
        }
      }

      // particles
      for (const q of this.parts) {
        c.globalAlpha = Math.max(0, q.life / q.max);
        c.fillStyle = q.color;
        c.beginPath(); c.arc(q.x, q.y, q.r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;

      // paused tint
      if (this.state === "paused") {
        c.fillStyle = "rgba(3,5,12,.55)"; c.fillRect(0, 0, this.W, this.H);
        c.fillStyle = "#fff"; c.font = "800 34px system-ui"; c.textAlign = "center";
        c.fillText("PAUSED — press P", this.W / 2, this.H / 2);
      }
      c.restore();
    }
  }

  global.NebulaGame = NebulaGame;
})(window);
