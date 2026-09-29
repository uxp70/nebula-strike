/* AuthSystem v2 — salted SHA-256 local login, credits, daily streak rewards.
   TODO:online — to make this truly global, replace LocalStore calls with
   Firebase Auth / Supabase Auth here. The rest of the app only uses the
   public methods below, so the swap is a single-file change. */
(function (global) {
  "use strict";
  const USERS_KEY = "nebula_users_v1";
  const SESSION_KEY = "nebula_session_v1";
  const SCORES_KEY = "nebula_scores_v1";

  const DAILY_REWARDS = [100, 150, 200, 300, 500, 750, 1000];
  const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
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
  function dayStr(d) {
    // UTC calendar day — streaks work across timezones consistently
    return d.toISOString().slice(0, 10);
  }
  function todayKey() { return dayStr(new Date()); }
  function yesterdayKey() { return dayStr(new Date(Date.now() - 86400000)); }
  function diffDays(aKey, bKey) {
    const ms = Date.parse(aKey + "T00:00:00Z") - Date.parse(bKey + "T00:00:00Z");
    return Math.round(ms / 86400000);
  }

  function passwordStrength(pw) {
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(4, score); // 0..4
  }

  function ensureShape(u) {
    if (!u.stats) u.stats = { games: 0, kills: 0, best: 0, timeMs: 0 };
    if (typeof u.credits !== "number") u.credits = 0;
    if (!u.daily) u.daily = { lastClaim: null, streak: 0 };
    if (!u.created) u.created = Date.now();
    if (!u.lastSeen) u.lastSeen = Date.now();
    return u;
  }

  class AuthSystem {
    constructor() {
      this.users = loadJSON(USERS_KEY, {});
      Object.keys(this.users).forEach(k => ensureShape(this.users[k]));
      this.session = loadJSON(SESSION_KEY, null);
      if (this.session) {
        const real = this._findKey(this.session.username);
        if (!real) this.session = null;
        else if (Date.now() - (this.session.ts || 0) > SESSION_TTL_MS) this.session = null;
        else this.session.username = real; // normalize case
      }
    }
    _persist() {
      saveJSON(USERS_KEY, this.users);
      saveJSON(SESSION_KEY, this.session);
    }
    _findKey(username) {
      const low = String(username || "").toLowerCase();
      return Object.keys(this.users).find(k => k.toLowerCase() === low) || null;
    }
    currentUser() {
      if (!this.session) return null;
      const key = this._findKey(this.session.username);
      if (!key) return null;
      return { username: key, ...this.users[key] };
    }
    isGuest() { return !this.session; }

    async register(username, password) {
      username = (username || "").trim();
      if (!validName(username)) throw new Error("Callsign must be 3–16 chars: letters, numbers, _ or -.");
      if (this._findKey(username)) throw new Error("That callsign is taken (names are case-insensitive). Try logging in.");
      if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
      const salt = randSalt();
      const passHash = await sha256Hex(salt + "::" + password);
      this.users[username] = ensureShape({
        passHash, salt, created: Date.now(), lastSeen: Date.now(),
        stats: { games: 0, kills: 0, best: 0, timeMs: 0 },
        credits: 50, // welcome bonus
        daily: { lastClaim: null, streak: 0 }
      });
      this.session = { username, ts: Date.now() };
      this._persist();
      return this.currentUser();
    }
    async login(username, password) {
      username = (username || "").trim();
      const key = this._findKey(username);
      const u = key && this.users[key];
      if (!u) throw new Error("Unknown callsign. Register first.");
      const h = await sha256Hex(u.salt + "::" + (password || ""));
      // constant-time-ish compare not critical here, but avoid early exit timing leaks
      if (h.length !== u.passHash.length || h !== u.passHash) throw new Error("Wrong password.");
      u.lastSeen = Date.now();
      this.session = { username: key, ts: Date.now() };
      this._persist();
      return this.currentUser();
    }
    logout() { this.session = null; this._persist(); }

    async changePassword(username, oldPw, newPw) {
      const key = this._findKey(username);
      const u = key && this.users[key];
      if (!u) throw new Error("Not logged in.");
      const h = await sha256Hex(u.salt + "::" + (oldPw || ""));
      if (h !== u.passHash) throw new Error("Current password is wrong.");
      if (!newPw || newPw.length < 6) throw new Error("New password must be at least 6 characters.");
      const salt = randSalt();
      u.passHash = await sha256Hex(salt + "::" + newPw);
      u.salt = salt;
      this._persist();
    }
    deleteAccount(username) {
      const key = this._findKey(username);
      if (!key) return;
      delete this.users[key];
      // remove their leaderboard entries
      const scores = loadJSON(SCORES_KEY, []);
      const arr = Array.isArray(scores) ? scores : (scores.entries || []);
      saveJSON(SCORES_KEY, arr.filter(s => s && String(s.user || "").toLowerCase() !== key.toLowerCase()));
      if (this.session && this.session.username.toLowerCase() === key.toLowerCase()) this.session = null;
      this._persist();
    }

    addCredits(username, n) {
      const key = this._findKey(username);
      if (!key) return 0;
      const u = ensureShape(this.users[key]);
      u.credits = Math.max(0, (u.credits || 0) + Math.floor(n));
      this._persist();
      return u.credits;
    }

    recordGame(username, { score, wave, kills, ms }) {
      const key = this._findKey(username);
      if (!key) return { saved: false };
      const u = ensureShape(this.users[key]);
      score = Math.max(0, Math.floor(Number(score) || 0));
      wave = Math.max(1, Math.floor(Number(wave) || 1));
      kills = Math.max(0, Math.floor(Number(kills) || 0));
      ms = Math.max(0, Math.floor(Number(ms) || 0));
      u.stats.games += 1;
      u.stats.kills += kills;
      u.stats.timeMs += ms;
      const isBest = score > u.stats.best;
      if (isBest) u.stats.best = score;
      // gameplay earnings: small credit trickle so daily streaks + play both matter
      const earned = Math.min(200, Math.floor(score / 50) + wave * 2 + Math.floor(kills / 5));
      u.credits = (u.credits || 0) + earned;
      u.lastSeen = Date.now();
      this._persist();
      this._saveBest(key, { score, wave, kills });
      return { saved: true, isBest, earned, credits: u.credits };
    }

    _saveBest(username, { score, wave, kills }) {
      // Fixed leaderboard: one entry per pilot (their personal best).
      // Migrates legacy format where every run was pushed.
      const raw = loadJSON(SCORES_KEY, []);
      const arr = Array.isArray(raw) ? raw : (raw.entries || []);
      const best = {};
      for (const s of arr) {
        if (!s || typeof s.user !== "string") continue;
        const k = s.user;
        const sc = Math.max(0, Math.floor(Number(s.score) || 0));
        if (!best[k] || sc > best[k].score) {
          best[k] = {
            user: k,
            score: sc,
            wave: Math.max(1, Math.floor(Number(s.wave) || 1)),
            kills: Math.max(0, Math.floor(Number(s.kills) || 0)),
            date: Number(s.date) || Date.now()
          };
        }
      }
      const cur = best[username];
      if (!cur || score > cur.score) {
        best[username] = { user: username, score, wave, kills, date: Date.now() };
      }
      const out = Object.values(best)
        .sort((a, b) => b.score - a.score || a.date - b.date)
        .slice(0, 50);
      saveJSON(SCORES_KEY, out);
    }

    leaderboard(limit = 10) {
      const raw = loadJSON(SCORES_KEY, []);
      const arr = (Array.isArray(raw) ? raw : (raw.entries || [])).filter(s => s && typeof s.user === "string");
      // dedupe defensively (in case an old client wrote duplicates)
      const best = {};
      for (const s of arr) {
        const sc = Math.max(0, Math.floor(Number(s.score) || 0));
        if (!best[s.user] || sc > best[s.user].score) best[s.user] = { ...s, score: sc };
      }
      return Object.values(best)
        .sort((a, b) => b.score - a.score || (a.date || 0) - (b.date || 0))
        .slice(0, Math.max(1, Math.min(50, limit || 10)));
    }
    rankOf(username) {
      const rows = this.leaderboard(50);
      const i = rows.findIndex(r => r.user.toLowerCase() === String(username || "").toLowerCase());
      return i === -1 ? null : i + 1;
    }

    // ---------- daily streak rewards ----------
    dailyStatus(username) {
      const key = this._findKey(username);
      if (!key) return { canClaim: false, reason: "login" };
      const u = ensureShape(this.users[key]);
      const today = todayKey();
      const last = u.daily.lastClaim;
      if (last === today) {
        return { canClaim: false, reason: "claimed", streak: u.daily.streak, reward: 0, nextInMs: this._msUntilTomorrowUTC() };
      }
      let streak = 1;
      if (last && diffDays(today, last) === 1) streak = (u.daily.streak || 0) + 1;
      const day = Math.min(streak, 7);
      return { canClaim: true, streak, day, reward: DAILY_REWARDS[day - 1], lastStreak: u.daily.streak || 0, reset: streak === 1 && (u.daily.streak || 0) > 0 && last !== null };
    }
    claimDaily(username) {
      const key = this._findKey(username);
      if (!key) throw new Error("Login to claim daily rewards.");
      const u = ensureShape(this.users[key]);
      const st = this.dailyStatus(key);
      if (!st.canClaim) throw new Error("Already claimed — come back tomorrow.");
      u.daily.streak = st.streak;
      u.daily.lastClaim = todayKey();
      u.credits = (u.credits || 0) + st.reward;
      // streak milestone bonus every 7th day
      let bonus = 0;
      if (st.streak % 7 === 0) { bonus = 250; u.credits += bonus; }
      u.lastSeen = Date.now();
      this._persist();
      return { streak: st.streak, reward: st.reward, bonus, credits: u.credits, table: DAILY_REWARDS.slice() };
    }
    _msUntilTomorrowUTC() {
      const now = new Date();
      const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      return Math.max(0, t - now.getTime());
    }

    wipeAll() {
      localStorage.removeItem(USERS_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SCORES_KEY);
      this.users = {}; this.session = null;
    }
  }

  global.AuthSystem = AuthSystem;
  global.NebulaDaily = { table: DAILY_REWARDS.slice(), passwordStrength };
})(window);
