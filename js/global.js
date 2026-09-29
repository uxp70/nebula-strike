/* GlobalBoard — shared worldwide leaderboard over ntfy.sh (no keys, no signup).
   How it works: every logged-in game-over publishes one small message to a
   public topic; reading the topic cache yields recent scores from ALL players,
   aggregated best-per-pilot. ntfy.sh keeps ~12h of history, so the Global tab
   is "top scores across all players recently" — the Personal tab is all-time.
   To reset or move the board, change TOPIC below (first publish creates it).
   Abuse note: the topic is public; entries are strictly validated on read
   (name format, sane score/wave/kills caps) and junk is dropped. */
(function (global) {
  "use strict";

  const TOPIC = "nebula-strike-v1-top-uxp70";
  const BASE = "https://ntfy.sh/" + TOPIC;
  const CACHE_KEY = "nebula_global_cache_v1";
  const QUEUE_KEY = "nebula_global_queue_v1";
  const MAX_SCORE = 5000000;
  const MAX_WAVE = 500;
  const MAX_KILLS = 200000;
  const MAX_LINES = 500;
  const MAX_ROWS = 25;

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function validEntry(e) {
    if (!e || typeof e !== "object") return null;
    const u = String(e.u || "");
    const s = Math.floor(Number(e.s));
    const w = Math.floor(Number(e.w));
    const k = Math.floor(Number(e.k));
    const t = Math.floor(Number(e.t));
    if (!/^[A-Za-z0-9_\-]{3,16}$/.test(u)) return null;
    if (!(s >= 1 && s <= MAX_SCORE)) return null;
    if (!(w >= 1 && w <= MAX_WAVE)) return null;
    if (!(k >= 0 && k <= MAX_KILLS)) return null;
    if (!(t >= 946684800000 && t <= Date.now() + 3600000)) return null; // 2000..now+1h
    return { user: u, score: s, wave: w, kills: k, date: t };
  }

  class GlobalBoard {
    constructor(fetchFn) {
      this._fetch = fetchFn || fetch.bind(window);
      const c = loadJSON(CACHE_KEY, null);
      this.cache = c && Array.isArray(c.rows) ? c : { rows: [], at: 0 };
      this.queue = loadJSON(QUEUE_KEY, []);
      if (!Array.isArray(this.queue)) this.queue = [];
    }

    async refresh(timeoutMs = 12000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await this._fetch(BASE + "/json?poll=1", { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error("http " + res.status);
        const text = await res.text();
        const best = {};
        let lines = 0;
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          if (++lines > MAX_LINES) break;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (!ev || ev.event !== "message" || typeof ev.message !== "string") continue;
          let body;
          try { body = JSON.parse(ev.message); } catch { continue; }
          const e = validEntry(body);
          if (!e) continue;
          const key = e.user.toLowerCase();
          if (!best[key] || e.score > best[key].score) best[key] = e;
        }
        const rows = Object.values(best)
          .sort((a, b) => b.score - a.score || a.date - b.date)
          .slice(0, MAX_ROWS);
        this.cache = { rows, at: Date.now() };
        saveJSON(CACHE_KEY, this.cache);
        return { rows, at: this.cache.at, live: true };
      } catch {
        return { rows: this.cache.rows, at: this.cache.at, live: false };
      } finally {
        clearTimeout(timer);
      }
    }

    async submit({ user, score, wave, kills }) {
      const entry = validEntry({ u: user, s: score, w: wave, k: kills, t: Date.now() });
      if (!entry) return { ok: false, reason: "invalid" };
      const wire = { u: entry.user, s: entry.score, w: entry.wave, k: entry.kills, t: entry.date };
      try {
        await this._post(wire);
        this.flushQueue(); // piggyback any backlog
        return { ok: true };
      } catch {
        this.queue.push(wire);
        this.queue = this.queue.slice(-10);
        saveJSON(QUEUE_KEY, this.queue);
        return { ok: false, reason: "queued" };
      }
    }

    async _post(wire) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await this._fetch(BASE, {
          method: "POST",
          body: JSON.stringify(wire),
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error("http " + res.status);
      } finally {
        clearTimeout(timer);
      }
    }

    async flushQueue() {
      if (!this.queue.length) return;
      const pending = this.queue.slice();
      this.queue = [];
      for (const wire of pending) {
        try { await this._post(wire); }
        catch { this.queue.push(wire); }
      }
      saveJSON(QUEUE_KEY, this.queue.slice(-10));
    }
  }

  global.GlobalBoard = GlobalBoard;
})(window);
