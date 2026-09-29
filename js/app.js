/* App glue: auth UI, fixed leaderboard, daily streaks, mobile wiring. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 2400);
  };

  const auth = new AuthSystem();
  const sfx = new SoundFX();
  const game = new NebulaGame($("game"), sfx);
  const board = new GlobalBoard();
  let dailyAutoShown = false;
  let globalRows = [];
  let globalLive = false;
  let globalAt = 0;

  // ---------- board sub-tabs (Global / Personal) ----------
  document.querySelectorAll(".subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".subtab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const isGlobal = btn.dataset.board === "global";
      $("pane-global").hidden = !isGlobal;
      $("pane-personal").hidden = isGlobal;
      if (isGlobal) refreshGlobal(false);
    });
  });

  function agoText(at) {
    if (!at) return "never";
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    return Math.floor(m / 60) + "h ago";
  }
  function setBoardStatus() {
    const el = $("boardStatus");
    if (globalLive) { el.textContent = "🌍 live • " + agoText(globalAt); el.classList.add("live"); }
    else if (globalAt) { el.textContent = "offline • cached " + agoText(globalAt); el.classList.remove("live"); }
    else { el.textContent = "connecting…"; el.classList.remove("live"); }
  }
  async function refreshGlobal(force) {
    if (!force && refreshGlobal._busy) return;
    refreshGlobal._busy = true;
    setBoardStatus();
    try {
      const r = await board.refresh();
      globalRows = r.rows; globalLive = r.live; globalAt = r.at;
      renderGlobal();
      const me = auth.currentUser();
      if (me) {
        const i = globalRows.findIndex(x => x.user.toLowerCase() === me.username.toLowerCase());
        $("statTop").textContent = globalRows.length ? globalRows[0].user + " (" + globalRows[0].score + ")" : "—";
        if (i >= 0) $("myRank").textContent = `🌍 Global rank #${i + 1} • best ${me.stats.best} • ${me.credits || 0} credits`;
      } else if (globalRows.length) {
        $("statTop").textContent = globalRows[0].user + " (" + globalRows[0].score + ")";
      }
    } finally {
      refreshGlobal._busy = false;
      setBoardStatus();
    }
  }
  setInterval(() => { if (!$("tab-board").hidden) refreshGlobal(false); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { board.flushQueue(); refreshGlobal(false); }
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      ["board", "squad", "how", "settings"].forEach(t => { $("tab-" + t).hidden = btn.dataset.tab !== t; });
      if (btn.dataset.tab === "squad") renderSquad();
    });
  });

  // ---------- auth modal ----------
  const modal = $("authModal");
  const openAuth = () => { modal.classList.remove("hidden"); $("authErr").textContent = ""; setTimeout(() => $("authUser").focus(), 50); };
  const closeAuth = () => modal.classList.add("hidden");
  $("loginBtn").addEventListener("click", openAuth);
  $("overlayLogin").addEventListener("click", openAuth);
  $("closeAuth").addEventListener("click", closeAuth);
  modal.addEventListener("click", e => { if (e.target === modal) closeAuth(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeAuth(); });

  $("pwToggle").addEventListener("click", () => {
    const inp = $("authPass");
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    $("pwToggle").textContent = show ? "Hide" : "Show";
  });
  $("authPass").addEventListener("input", () => {
    const s = (window.NebulaDaily && window.NebulaDaily.passwordStrength(String($("authPass").value || ""))) || 0;
    const bar = $("pwStrength");
    bar.style.width = (s / 4 * 100) + "%";
    bar.style.background = s <= 1 ? "var(--red)" : s === 2 ? "var(--gold)" : "var(--green)";
  });

  let authBusy = false;
  async function doAuth(mode) {
    if (authBusy) return;
    const u = $("authUser").value, p = $("authPass").value;
    $("authErr").textContent = "";
    authBusy = true;
    $("doLogin").disabled = true; $("doRegister").disabled = true;
    try {
      if (mode === "register") await auth.register(u, p);
      else await auth.login(u, p);
      $("authPass").value = "";
      closeAuth();
      toast("Welcome, " + auth.currentUser().username + " 🚀");
      refreshUser();
      checkDaily(true);
    } catch (err) { $("authErr").textContent = err.message; }
    finally { authBusy = false; $("doLogin").disabled = false; $("doRegister").disabled = false; }
  }
  $("doLogin").addEventListener("click", () => doAuth("login"));
  $("doRegister").addEventListener("click", () => doAuth("register"));
  $("authPass").addEventListener("keydown", e => { if (e.key === "Enter") doAuth("login"); });
  $("authUser").addEventListener("keydown", e => { if (e.key === "Enter") doAuth("login"); });
  $("logoutBtn").addEventListener("click", () => {
    const me = auth.currentUser();
    if (me) {
      const refund = loadout.hull * SHOP.hull.cost + loadout.dmg * SHOP.dmg.cost + loadout.shield * SHOP.shield.cost;
      if (refund > 0) auth.addCredits(me.username, refund);
    }
    loadout.hull = loadout.dmg = loadout.shield = 0;
    auth.logout(); dailyAutoShown = false; refreshUser(); toast("Logged out.");
  });

  $("changePwBtn").addEventListener("click", async () => {
    const me = auth.currentUser();
    if (!me) return;
    const cur = prompt("Enter current password:");
    if (cur === null) return;
    const np = $("newPass").value;
    try {
      await auth.changePassword(me.username, cur, np);
      $("newPass").value = "";
      toast("Password updated.");
    } catch (e) { toast(e.message); }
  });
  $("deleteAcctBtn").addEventListener("click", () => {
    const me = auth.currentUser();
    if (!me) return;
    if (confirm(`Delete pilot "${me.username}" + their scores forever?`)) {
      auth.deleteAccount(me.username);
      refreshUser();
      toast("Account deleted.");
    }
  });

  // ---------- perks from credits ----------
  function bonusHpFor(credits) {
    return Math.min(30, Math.floor((credits || 0) / 100) * 2);
  }

  // ---------- pre-flight shop (coins get a real use) ----------
  const SHOP = {
    hull: { cost: 150, hp: 20, max: 5, name: "+20 Hull" },
    dmg: { cost: 200, mult: 0.15, max: 4, name: "+15% Damage" },
    shield: { cost: 100, secs: 8, max: 2, name: "8s Shield" }
  };
  const loadout = { hull: 0, dmg: 0, shield: 0 };
  function renderLoadout() {
    const me = auth.currentUser();
    const box = $("loadoutBox");
    if (!me) {
      $("loadCredits").textContent = "0";
      $("loadoutSummary").textContent = "Login to spend coins on Hull / Damage / Shield.";
      ["buyHullBtn", "buyDmgBtn", "buyShieldBtn"].forEach(id => { $(id).disabled = true; });
      return;
    }
    $("loadCredits").textContent = me.credits || 0;
    const parts = [];
    if (loadout.hull) parts.push(`❤️ +${loadout.hull * SHOP.hull.hp} Hull`);
    if (loadout.dmg) parts.push(`💥 +${loadout.dmg * 15}% Damage`);
    if (loadout.shield) parts.push(`🛡️ ${loadout.shield * SHOP.shield.secs}s Shield`);
    $("loadoutSummary").textContent = parts.length ? ("Fitted: " + parts.join(" • ") + " (used on next launch)") : "No extras fitted.";
    $("buyHullBtn").disabled = loadout.hull >= SHOP.hull.max || (me.credits || 0) < SHOP.hull.cost;
    $("buyDmgBtn").disabled = loadout.dmg >= SHOP.dmg.max || (me.credits || 0) < SHOP.dmg.cost;
    $("buyShieldBtn").disabled = loadout.shield >= SHOP.shield.max || (me.credits || 0) < SHOP.shield.cost;
    $("buyHullBtn").innerHTML = `❤️ +20 Hull${loadout.hull ? ` x${loadout.hull}` : ""}<br /><span>◉${SHOP.hull.cost}</span>`;
    $("buyDmgBtn").innerHTML = `💥 +15% Damage${loadout.dmg ? ` x${loadout.dmg}` : ""}<br /><span>◉${SHOP.dmg.cost}</span>`;
    $("buyShieldBtn").innerHTML = `🛡️ 8s Shield${loadout.shield ? ` x${loadout.shield}` : ""}<br /><span>◉${SHOP.shield.cost}</span>`;
  }
  function buy(item) {
    const me = auth.currentUser();
    if (!me) { toast("Login to spend coins."); openAuth(); return; }
    const s = SHOP[item];
    if (loadout[item] >= s.max) { toast("Maxed out for this flight."); return; }
    if ((me.credits || 0) < s.cost) { toast("Not enough credits — play runs + claim dailies."); return; }
    auth.addCredits(me.username, -s.cost);
    loadout[item]++;
    sfx.pickup();
    refreshUser();
  }
  $("buyHullBtn").addEventListener("click", () => buy("hull"));
  $("buyDmgBtn").addEventListener("click", () => buy("dmg"));
  $("buyShieldBtn").addEventListener("click", () => buy("shield"));
  $("clearLoadoutBtn").addEventListener("click", () => {
    const me = auth.currentUser();
    if (!me) return;
    const refund = loadout.hull * SHOP.hull.cost + loadout.dmg * SHOP.dmg.cost + loadout.shield * SHOP.shield.cost;
    if (refund > 0) auth.addCredits(me.username, refund);
    loadout.hull = loadout.dmg = loadout.shield = 0;
    refreshUser();
    toast(refund > 0 ? `Loadout cleared, ◉${refund} refunded.` : "Loadout cleared.");
  });

  function refreshUser() {
    const me = auth.currentUser();
    $("loginBtn").hidden = !!me;
    $("logoutBtn").hidden = !me;
    $("userChip").hidden = !me;
    $("dailyBtn").hidden = !me;
    $("accountBox").hidden = !me;
    $("creditsPill").hidden = !me;
    if (me) {
      $("chipName").textContent = me.username;
      $("chipSub").textContent = `${me.stats.games} flights • best ${me.stats.best} • 🔥${(me.daily && me.daily.streak) || 0}`;
      $("avatar").textContent = me.username[0].toUpperCase();
      $("statBest").textContent = me.stats.best;
      $("statGames").textContent = me.stats.games;
      $("statKills").textContent = me.stats.kills;
      $("creditsVal").textContent = me.credits || 0;
      const b = bonusHpFor(me.credits);
      $("perkLine").textContent = b > 0
        ? `◉ ${me.credits} credits → passive +${b} hull every run, plus pre-flight shop below Launch.`
        : "Earn credits by playing + daily streaks, then spend them in the pre-flight shop below Launch.";
      // FIX: don't show Login next to Launch when already logged in
      $("overlayLogin").hidden = true;
      $("overlayTitle").textContent = `Ready, ${me.username}?`;
      $("overlaySub").textContent = `Ranked • ${me.credits || 0} credits • streak ${(me.daily && me.daily.streak) || 0}🔥 — fit your ship below, then Launch.`;
    } else {
      $("statBest").textContent = "0";
      $("statGames").textContent = "0";
      $("statKills").textContent = "0";
      $("perkLine").textContent = "Login to earn credits, streaks, and leaderboard rank.";
      $("overlayLogin").hidden = false;
      $("overlayTitle").textContent = "Ready for launch?";
      $("overlaySub").textContent = "Login to rank on the leaderboard. Guests can still fly.";
    }
    renderBoard();
    renderLoadout();
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch { return ""; }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function renderBoard() {
    // Personal pane (all-time, this browser) + top-pilot stat.
    // Global pane is rendered by renderGlobal() from network/cache.
    const me = auth.currentUser();
    if (me) {
      const runs = auth.history(me.username, 10);
      const body = $("personalBody");
      if (!runs.length) {
        body.innerHTML = '<tr><td colspan="5" class="muted">No runs yet — launch a flight.</td></tr>';
      } else {
        body.innerHTML = runs.map((r, i) =>
          `<tr${r.best ? ' class="me"' : ""} title="${r.date ? escapeHtml(fmtDate(r.date)) : ""}"><td>${i + 1}</td><td><b>${r.score}</b>${r.best ? " 🏆" : ""}</td><td>${r.wave}</td><td>${r.kills}</td><td>${r.date ? escapeHtml(fmtDate(r.date)) : "—"}</td></tr>`
        ).join("");
      }
      if (globalRows.length) {
        const gi = globalRows.findIndex(x => x.user.toLowerCase() === me.username.toLowerCase());
        $("myRank").textContent = gi >= 0
          ? `🌍 Global rank #${gi + 1} • best ${me.stats.best} • ${me.credits || 0} credits`
          : `Not on the global board yet — finish a run to post your score. Best ${me.stats.best} • ${me.credits || 0} credits`;
      } else {
        $("myRank").textContent = `Best ${me.stats.best} • ${me.credits || 0} credits • global board loading…`;
      }
    } else {
      $("myRank").textContent = "Login to rank. Guest runs don't appear anywhere.";
      $("personalBody").innerHTML = '<tr><td colspan="5" class="muted">Login to track your runs.</td></tr>';
    }
  }

  function renderGlobal() {
    const me = auth.currentUser();
    const body = $("boardBody");
    if (!globalRows.length) {
      body.innerHTML = globalLive
        ? '<tr><td colspan="5" class="muted">No global scores yet. Be the first today.</td></tr>'
        : '<tr><td colspan="5" class="muted">Could not reach the global board. Check connection.</td></tr>';
      return;
    }
    body.innerHTML = globalRows.slice(0, 10).map((r, i) =>
      `<tr class="${me && r.user.toLowerCase() === me.username.toLowerCase() ? "me" : ""}" title="${r.date ? escapeHtml(fmtDate(r.date)) : ""}"><td>${i + 1}</td><td>${escapeHtml(r.user)}</td><td><b>${r.score}</b></td><td>${r.wave}</td><td>${r.kills}</td></tr>`
    ).join("");
  }

  // ---------- daily rewards ----------
  const DAILY_TABLE = (window.NebulaDaily && window.NebulaDaily.table) || [100, 150, 200, 300, 500, 750, 1000];
  function openDaily() { renderDaily(); $("dailyModal").classList.remove("hidden"); }
  function closeDaily() { $("dailyModal").classList.add("hidden"); }
  $("dailyBtn").addEventListener("click", openDaily);
  $("closeDailyBtn").addEventListener("click", closeDaily);
  $("dailyModal").addEventListener("click", e => { if (e.target === $("dailyModal")) closeDaily(); });

  function renderDaily() {
    const me = auth.currentUser();
    if (!me) return;
    const st = auth.dailyStatus(me.username);
    $("dailyErr").textContent = "";
    const grid = $("streakGrid");
    grid.innerHTML = "";
    const curDay = st.canClaim ? st.day : Math.min(st.streak || 0, 7);
    for (let d = 1; d <= 7; d++) {
      const div = document.createElement("div");
      const done = (st.streak || 0) >= d && !st.canClaim ? true : (st.canClaim && d < st.day ? true : false);
      const isToday = st.canClaim && d === st.day;
      div.className = "streak-day" + (isToday ? " today" : "") + (done ? " done" : "");
      div.innerHTML = `Day ${d}<b>◉${DAILY_TABLE[d - 1]}</b>${isToday ? "TODAY" : done ? "✓" : ""}`;
      grid.appendChild(div);
    }
    if (!st.canClaim) {
      const hrs = Math.ceil((st.nextInMs || 0) / 3600000);
      $("dailySub").textContent = `Streak: ${st.streak || 0} 🔥 claimed for today. Next reward in ~${hrs}h.`;
      $("claimDailyBtn").disabled = true;
      $("claimDailyBtn").textContent = "Claimed ✓";
    } else {
      $("dailySub").textContent = st.reset
        ? `Streak reset — claim Day 1 (+${st.reward}) to restart. Come back daily to climb to Day 7 (+1000 +250 bonus).`
        : `Day ${st.day} ready: +${st.reward} credits${st.day === 7 ? " +250 streak bonus" : ""}. Current streak: ${st.lastStreak || 0} 🔥`;
      $("claimDailyBtn").disabled = false;
      $("claimDailyBtn").textContent = `Claim +${st.reward}`;
    }
  }
  $("claimDailyBtn").addEventListener("click", () => {
    const me = auth.currentUser();
    if (!me) return;
    try {
      const r = auth.claimDaily(me.username);
      toast(`Day ${Math.min(r.streak, 7)} claimed: +${r.reward}${r.bonus ? ` +${r.bonus} bonus` : ""} ◉ (streak ${r.streak}🔥)`);
      refreshUser();
      renderDaily();
    } catch (e) { $("dailyErr").textContent = e.message; }
  });
  function checkDaily(auto) {
    const me = auth.currentUser();
    if (!me) return;
    let st;
    try { st = auth.dailyStatus(me.username); } catch { return; }
    const btn = $("dailyBtn");
    btn.textContent = st.canClaim ? "🎁 Daily ready!" : `🔥 ${st.streak || 0}`;
    if (auto && st.canClaim && !dailyAutoShown) {
      dailyAutoShown = true;
      setTimeout(openDaily, 600);
    }
  }

  // ---------- online squad (co-op) ----------
  let squad = null;
  let squadRun = null; // {isHost}
  let lastSnap = null;
  function ensureSquad() {
    if (squad) { squad.name = auth.currentUser().username; return squad; }
    squad = new SquadNet({
      name: auth.currentUser().username,
      onRoster: (members, hostId) => { renderSquad(members, hostId); checkSquad(members, hostId); },
      onSnap: (snap) => {
        if (!squadRun || squadRun.isHost) return;
        lastSnap = snap;
        if (game.squad && game.applySnap(snap)) { /* rendered next frame */ }
      },
      onEvent: (ev) => onSquadNet(ev),
      onStatus: (s) => {
        $("squadStatus").textContent = (squad && squad.code) ? `Room ${squad.code} • ${s}` : s;
      }
    });
    return squad;
  }
  function renderSquad(members, hostId) {
    members = members || (squad ? squad.roster() : []);
    hostId = hostId || (squad ? squad.hostId() : null);
    const me = auth.currentUser();
    const box = $("memberList");
    if (!squad || !squad.code) {
      box.innerHTML = "";
      $("leaveSquadBtn").disabled = true;
      $("squadLaunchBtn").disabled = true;
      return;
    }
    box.innerHTML = members.map(m =>
      `<div class="member"><b>${escapeHtml(m.name)}</b>
       ${m.id === hostId ? '<span class="crown">👑 host</span>' : ""}
       ${me && m.name === me.username && m.id === squad.id ? '<span class="youmark">• you</span>' : ""}</div>`
    ).join("") || '<div class="muted">Waiting for pilots…</div>';
    $("leaveSquadBtn").disabled = false;
    const canLaunch = squad.amHost() && members.length >= 1 && !squadRun;
    $("squadLaunchBtn").disabled = !canLaunch;
  }
  function checkSquad(members, hostId) {
    if (!squad || !squad.code) return;
    // host prunes ships of departed pilots mid-run
    if (squadRun && squadRun.isHost && game.squad && game.squad.isHost && game.state !== "over") {
      const ids = new Set(members.map(m => m.id));
      const before = game.players.length;
      game.players = game.players.filter(p => ids.has(p.id));
      if (!game.players.length) { endSquadRun("Squad disbanded."); return; }
      if (game.players.length !== before) toast("A pilot disconnected — their ship is gone.");
    }
    // host migration: I'm the new host and have a snapshot → resume the sim
    if (squadRun && !squadRun.isHost && squad.amHost() && game.state === "remote" && lastSnap) {
      if (game.takeOver(lastSnap)) {
        squadRun.isHost = true;
        squad.sendEvent({ t: "msg", text: auth.currentUser().username + " took over the run" });
        toast("You are now the host — run resumed.");
      }
    }
    if (squadRun && !squad.amHost()) squadRun.isHost = false;
    if (squadRun && squad.amHost()) squadRun.isHost = true;
  }
  function onSquadNet(ev) {
    if (!ev || !ev.t) return;
    if (ev.t === "input" && squadRun && squadRun.isHost && game.squad) {
      const pl = game.players.find(p => p.id === ev.from);
      if (pl && ev.data) {
        pl.input.mx = Number(ev.data.mx) || 0; pl.input.my = Number(ev.data.my) || 0;
        pl.input.ax = Number(ev.data.ax) || 0; pl.input.ay = Number(ev.data.ay) || 0;
        pl.input.fire = !!ev.data.f; pl.input.dash = !!ev.data.d;
      }
      return;
    }
    if (ev.t === "start") {
      startSquadRun(ev, false);
      return;
    }
    if (ev.t === "over") {
      endSquadRun(null, ev);
      return;
    }
    if (ev.t === "wave" && squadRun && !squadRun.isHost) {
      $("runInfo").textContent = `— SQUAD ${squad.code} • wave ${ev.wave} —`;
      toast("Wave " + ev.wave + (ev.wave % 5 === 0 ? " — BOSS! ☠️" : ""));
      return;
    }
    if (ev.t === "msg") { toast(ev.text || ""); return; }
  }
  function startSquadRun(ev, isHost) {
    const diff = ev.diff || $("difficulty").value;
    const members = ev.members || [];
    if (!members.length) { toast("No squad members."); return; }
    const me = auth.currentUser();
    // host's fitted loadout benefits the whole squad (single-use, consumed)
    let bonusHp = me && isHost ? bonusHpFor(me.credits) : 0;
    let bonusDmg = 1, startShield = 0;
    if (me && isHost) {
      bonusHp += loadout.hull * 20;
      bonusDmg = 1 + loadout.dmg * 0.15;
      startShield = loadout.shield * 8;
      loadout.hull = loadout.dmg = loadout.shield = 0;
      if (me.daily && me.daily.lastClaim) {
        try {
          const today = new Date().toISOString().slice(0, 10);
          if (me.daily.lastClaim === today && (me.daily.streak || 0) >= 3) startShield += 6;
        } catch {}
      }
    }
    $("menuOverlay").classList.add("hidden");
    $("gameOverOverlay").classList.add("hidden");
    $("upgradeOverlay").classList.add("hidden");
    game.startSquad({ isHost, members, diff, myId: squad.id, bonusHp, bonusDmg, startShield });
    sfx.startMusic();
    squadRun = { isHost };
    lastSnap = null;
    $("runInfo").textContent = `— SQUAD ${squad.code} • wave 1 • ${isHost ? "👑 host" : "guest"} —`;
    $("squadLaunchBtn").disabled = true;
    if (me) refreshUser();
    toast(isHost ? "Squad run started — you're the host" : "Joined squad run!");
  }
  function endSquadRun(localMsg, ev) {
    sfx.stopMusic();
    const wasHost = squadRun && squadRun.isHost;
    squadRun = null;
    const me = auth.currentUser();
    const stats = ev || { score: Math.floor(game.score), wave: game.wave, kills: game.kills, coins: game.coinMap };
    const myCoins = (stats.coins && me && stats.coins[squad ? squad.id : "local"]) || game.coins || 0;
    if (me) {
      const r = auth.recordGame(me.username, { score: stats.score, wave: stats.wave, kills: stats.kills, ms: 0 });
      const coinBonus = Math.min(200, Math.max(0, Math.floor(myCoins)) * 5);
      const total = coinBonus ? auth.addCredits(me.username, coinBonus) : r.credits;
      refreshUser();
      board.submit({ user: me.username, score: stats.score, wave: stats.wave, kills: stats.kills })
        .then(res => { if (res.ok) refreshGlobal(false); });
      $("finalStats").textContent =
        `🤝 Squad score ${stats.score} • Wave ${stats.wave} • Kills ${stats.kills}` +
        ` • +${r.earned} run ◉${coinBonus ? ` +${coinBonus} coins ◉` : ""} → ${total} • posted 🌍`;
    } else {
      $("finalStats").textContent = `🤝 Squad score ${stats.score} • Wave ${stats.wave}`;
    }
    game.state = "over";
    $("upgradeOverlay").classList.add("hidden");
    $("gameOverOverlay").classList.remove("hidden");
    // stay in the room for another run
    game.squad = game.squad || { active: true, isHost: !!wasHost };
    renderSquad();
    if (localMsg) toast(localMsg);
  }
  function leaveSquadRun() {
    squadRun = null;
    lastSnap = null;
    game.endSquad();
    $("menuOverlay").classList.remove("hidden");
    $("gameOverOverlay").classList.add("hidden");
    $("upgradeOverlay").classList.add("hidden");
    refreshUser();
  }

  $("createSquadBtn").addEventListener("click", async () => {
    const me = auth.currentUser();
    if (!me) { toast("Login to squad up."); openAuth(); return; }
    $("createSquadBtn").disabled = true;
    try {
      const s = ensureSquad();
      const code = await s.create();
      toast("Room " + code + " — share the code!");
      renderSquad();
    } catch { toast("Could not reach squad relay. Try again."); }
    $("createSquadBtn").disabled = false;
  });
  $("joinSquadBtn").addEventListener("click", async () => {
    const me = auth.currentUser();
    if (!me) { toast("Login to squad up."); openAuth(); return; }
    const code = $("roomCode").value;
    if (!code.trim()) { toast("Enter a room code."); return; }
    $("joinSquadBtn").disabled = true;
    try {
      const s = ensureSquad();
      await s.join(code);
      toast("Joined room " + s.code);
      renderSquad();
    } catch { toast("Could not reach squad relay. Try again."); }
    $("joinSquadBtn").disabled = false;
  });
  $("leaveSquadBtn").addEventListener("click", () => {
    if (squadRun) leaveSquadRun();
    if (squad) { squad.leave(); squad = null; }
    $("squadStatus").textContent = "Login, then create or join a squad room to fight together (up to 4).";
    renderSquad();
    toast("Left squad.");
  });
  $("squadLaunchBtn").addEventListener("click", () => {
    if (!squad || !squad.amHost() || squadRun) return;
    const members = squad.roster().slice(0, 4).map(m => ({ id: m.id, name: m.name }));
    squad.sendEvent({ t: "start", diff: $("difficulty").value, members });
    startSquadRun({ diff: $("difficulty").value, members }, true);
  });

  // squad network pumps: host sends snapshots, guests send inputs
  setInterval(() => {
    if (!squad || !squad.code || !squadRun || !game.squad) return;
    try {
      if (squadRun.isHost && squad.amHost() && game.state !== "over" && game.state !== "menu") {
        squad.sendSnap(game.genSnap());
      } else if (!squadRun.isHost && game.state === "remote") {
        const inp = game.sampleInput();
        squad.sendInput({ mx: +inp.mx.toFixed(2), my: +inp.my.toFixed(2), ax: +inp.ax.toFixed(2), ay: +inp.ay.toFixed(2), f: inp.fire ? 1 : 0, d: inp.dash ? 1 : 0 });
      }
    } catch {}
  }, 100);

  // ---------- controller status ----------
  window.addEventListener("gamepadconnected", (e) => {
    toast("Controller on: left move • right aim • RT fire • RB dash");
  });
  window.addEventListener("gamepaddisconnected", () => toast("Controller disconnected."));

  // ---------- settings ----------
  $("soundSel").addEventListener("change", e => { sfx.setEnabled(e.target.value === "on"); });
  $("wipeBtn").addEventListener("click", () => {
    if (confirm("Delete all accounts + scores in this browser?")) {
      auth.wipeAll(); dailyAutoShown = false; refreshUser(); toast("Local data wiped.");
    }
  });

  // ---------- game flow ----------
  function launch() {
    if (squadRun) { toast("Finish or leave the squad run first (Squad tab → Leave)."); return; }
    const diff = $("difficulty").value;
    const me = auth.currentUser();
    const passiveHp = me ? bonusHpFor(me.credits) : 0;
    const bonusHp = passiveHp + (me ? loadout.hull * SHOP.hull.hp : 0);
    const bonusDmg = me && loadout.dmg ? 1 + loadout.dmg * SHOP.dmg.mult : 1;
    // streak perk: claimed today + streak>=3 → start with shield
    let startShield = me ? loadout.shield * SHOP.shield.secs : 0;
    if (me && me.daily && me.daily.lastClaim) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        if (me.daily.lastClaim === today && (me.daily.streak || 0) >= 3) startShield += 6;
      } catch {}
    }
    // single-use loadout, consumed on launch (already folded into bonuses above)
    loadout.hull = loadout.dmg = loadout.shield = 0;
    $("menuOverlay").classList.add("hidden");
    $("gameOverOverlay").classList.add("hidden");
    $("upgradeOverlay").classList.add("hidden");
    game.start(diff, { bonusHp, bonusDmg, startShield });
    sfx.startMusic();
    try { if (document.activeElement) document.activeElement.blur(); } catch {}
    $("runInfo").textContent = `— wave 1 • ${diff} • ${me ? me.username : "guest"}${bonusHp ? ` • +${bonusHp} hull` : ""}${bonusDmg > 1 ? ` • +${Math.round((bonusDmg - 1) * 100)}% dmg` : ""}${startShield ? " • 🛡️ shield" : ""} —`;
    if (me) refreshUser(); // refresh shop/credits after consuming loadout
    if (game.isMobile) toast("Left stick: move • Right stick: aim+fire");
  }
  $("playBtn").addEventListener("click", launch);
  $("overlayPlay").addEventListener("click", launch);
  $("guestBtn").addEventListener("click", launch);
  $("againBtn").addEventListener("click", () => {
    if (squadRun) {
      if (squad && squad.amHost()) {
        const members = squad.roster().slice(0, 4).map(m => ({ id: m.id, name: m.name }));
        squad.sendEvent({ t: "start", diff: $("difficulty").value, members });
        startSquadRun({ diff: $("difficulty").value, members }, true);
      } else toast("Only the host can relaunch — wait for them.");
      return;
    }
    launch();
  });
  $("menuBtn").addEventListener("click", () => {
    if (squadRun) { leaveSquadRun(); return; }
    $("gameOverOverlay").classList.add("hidden");
    $("menuOverlay").classList.remove("hidden");
    game.state = "menu";
    refreshUser();
  });
  $("restartBtn").addEventListener("click", launch);
  const pauseBtn = $("pauseBtn");
  pauseBtn.addEventListener("click", () => game.togglePause());
  $("dashBtn").addEventListener("touchstart", e => { e.preventDefault(); game.tryDash(); }, { passive: false });
  $("dashBtn").addEventListener("mousedown", e => { e.preventDefault(); game.tryDash(); });
  $("howBtn").addEventListener("click", () => {
    document.querySelector('[data-tab="how"]').click();
    toast(game.isMobile ? "Left: move • Right: aim+fire • DASH button" : "Move: WASD • Aim: mouse • Fire: click/space");
  });

  // ---------- fullscreen ----------
  const fsBtn = $("fsBtn");
  const fsTarget = () => $("canvasWrap");
  function fsLabel() {
    fsBtn.textContent = document.fullscreenElement ? "⛶ Exit Full" : "⛶ Fullscreen";
  }
  fsBtn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (fsTarget().requestFullscreen) await fsTarget().requestFullscreen();
      else toast("Fullscreen not supported here.");
    } catch { toast("Fullscreen blocked by browser."); }
    try { game.resize(false); } catch {}
  });
  document.addEventListener("fullscreenchange", () => {
    fsLabel();
    try { game.resize(false); } catch {}
  });
  fsLabel();

  game.onEvent = (ev, data) => {
    if (ev === "hud") {
      $("hudScore").textContent = Math.floor(game.score);
      $("hudWave").textContent = game.wave;
      $("hudKills").textContent = game.kills;
      $("hudCoins").textContent = game.coins || 0;
      $("hudLevel").textContent = game.p.level || 1;
      $("hpFill").style.width = (game.p.hp / game.p.maxHp * 100) + "%";
      $("xpFill").style.width = (game.p.xp / game.p.xpNext * 100) + "%";
    }
    if (ev === "wave") {
      $("runInfo").textContent = squadRun ? `— SQUAD ${squad.code} • wave ${data.wave} —` : `— wave ${data.wave} • ${game.difficulty} —`;
      toast("Wave " + data.wave + (data.wave % 5 === 0 ? " — BOSS! ☠️" : ""));
      if (squadRun && squadRun.isHost && squad) squad.sendEvent({ t: "wave", wave: data.wave });
    }
    if (ev === "upgrade") {
      const grid = $("upgradeGrid");
      grid.innerHTML = "";
      data.forEach(u => {
        const d = document.createElement("button");
        d.className = "up-card";
        d.innerHTML = `<b>${u.name}</b><span>${u.desc}</span>`;
        d.addEventListener("click", () => {
          game.chooseUpgrade(u.id);
          $("upgradeOverlay").classList.add("hidden");
        });
        grid.appendChild(d);
      });
      $("upgradeOverlay").classList.remove("hidden");
    }
    if (ev === "pause") { toast(game.isMobile ? "Paused" : "Paused — P to resume"); pauseBtn.textContent = "Resume"; }
    if (ev === "resume") { pauseBtn.textContent = "Pause"; }
    if (ev === "mute") {
      const sel = $("soundSel");
      sel.value = sel.value === "on" ? "off" : "on";
      sfx.setEnabled(sel.value === "on");
    }
    if (ev === "over") {
      sfx.stopMusic();
      pauseBtn.textContent = "Pause";
      if (squadRun && squad) {
        // squad run ended on the host sim → broadcast + settle locally
        const evOut = { t: "over", score: Math.floor(game.score), wave: game.wave, kills: game.kills, coins: { ...game.coinMap } };
        if (squadRun.isHost) squad.sendEvent(evOut);
        endSquadRun(null, evOut);
        return;
      }
      const me = auth.currentUser();
      if (me) {
        const r = auth.recordGame(me.username, data);
        // coins grabbed mid-run convert to shop credits (5 each, capped)
        const coins = Math.max(0, Math.floor(Number(data.coins) || 0));
        const coinBonus = Math.min(200, coins * 5);
        const total = coinBonus ? auth.addCredits(me.username, coinBonus) : r.credits;
        refreshUser();
        checkDaily(false);
        // post to the worldwide board (fire-and-forget; queued offline)
        board.submit({ user: me.username, score: data.score, wave: data.wave, kills: data.kills })
          .then(res => { if (res.ok) refreshGlobal(false); });
        $("finalStats").textContent =
          `Score ${data.score} • Wave ${data.wave} • Kills ${data.kills}` +
          (r.isBest ? " • NEW BEST! 🏆" : "") +
          ` • +${r.earned} run ◉${coinBonus ? ` +${coinBonus} coins ◉` : ""} → ${total} • posted 🌍`;
      } else {
        $("finalStats").textContent = `Score ${data.score} • Wave ${data.wave} • Kills ${data.kills} • guest run (login to rank + earn credits)`;
      }
      $("upgradeOverlay").classList.add("hidden");
      $("gameOverOverlay").classList.remove("hidden");
    }
    if (ev === "start") {
      $("hudScore").textContent = "0"; $("hudWave").textContent = "1"; $("hudKills").textContent = "0"; $("hudCoins").textContent = "0"; $("hudLevel").textContent = "1";
      $("hpFill").style.width = "100%"; $("xpFill").style.width = "0%";
    }
  };

  // boot
  refreshUser();
  game.render();
  checkDaily(true);
  board.flushQueue();
  refreshGlobal(true);
})();
