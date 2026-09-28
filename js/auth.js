/* AuthSystem — salted SHA-256 local login, session persistence.
   TODO:online — to make this truly global, replace LocalStore calls with
   Firebase Auth / Supabase Auth here. The rest of the app only uses the
   public methods below, so the swap is a single-file change. */
(function (global) {
  "use strict";
  const USERS_KEY = "nebula_users_v1";
  const SESSION_KEY = "nebula_session_v1";
  const SCORES_KEY = "nebula_scores_v1";

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function randSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function validName(name) {
    return /^[a-zA-Z0-9_\-]{3,16}$/.test(name);
  }

  class AuthSystem {
    constructor() {
      this.users = loadJSON(USERS_KEY, {});
      this.session = loadJSON(SESSION_KEY, null); // { username, ts }
      if (this.session && !this.users[this.session.username]) this.session = null;
    }
    _persist() {
      saveJSON(USERS_KEY, this.users);
      saveJSON(SESSION_KEY, this.session);
    }
    currentUser() {
      if (!this.session) return null;
      const u = this.users[this.session.username];
      return u ? { username: this.session.username, ...u } : null;
    }
    isGuest() { return !this.session; }

    async register(username, password) {
      username = (username || "").trim();
      if (!validName(username)) throw new Error("Callsign must be 3–16 chars: letters, numbers, _ or -.");
      if (!password || password.length < 4) throw new Error("Password must be at least 4 characters.");
      if (this.users[username]) throw new Error("That callsign is taken. Try another or login.");
      const salt = randSalt();
      const passHash = await sha256Hex(salt + "::" + password);
      this.users[username] = {
        passHash, salt, created: Date.now(),
        stats: { games: 0, kills: 0, best: 0, timeMs: 0 }
      };
      this.session = { username, ts: Date.now() };
      this._persist();
      return this.currentUser();
    }
    async login(username, password) {
      username = (username || "").trim();
      const u = this.users[username];
      if (!u) throw new Error("Unknown callsign. Register first.");
      const h = await sha256Hex(u.salt + "::" + password);
      if (h !== u.passHash) throw new Error("Wrong password.");
      this.session = { username, ts: Date.now() };
      this._persist();
      return this.currentUser();
    }
    logout() { this.session = null; this._persist(); }

    recordGame(username, { score, wave, kills, ms }) {
      const u = this.users[username];
      if (!u) return;
      u.stats.games += 1;
      u.stats.kills += kills;
      u.stats.timeMs += ms;
      if (score > u.stats.best) u.stats.best = score;
      this._persist();
      // leaderboard
      const scores = loadJSON(SCORES_KEY, []);
      scores.push({ user: username, score, wave, kills, date: Date.now() });
      scores.sort((a, b) => b.score - a.score);
      saveJSON(SCORES_KEY, scores.slice(0, 25));
    }
    leaderboard(limit = 10) { return loadJSON(SCORES_KEY, []).slice(0, limit); }
    wipeAll() {
      localStorage.removeItem(USERS_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SCORES_KEY);
      this.users = {}; this.session = null;
    }
  }

  global.AuthSystem = AuthSystem;
})(window);
