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
  let dailyAutoShown = false;

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $("tab-board").hidden = btn.dataset.tab !== "board";
      $("tab-how").hidden = btn.dataset.tab !== "how";
      $("tab-settings").hidden = btn.dataset.tab !== "settings";
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
    let rows = [];
    try { rows = auth.leaderboard(10); } catch { rows = []; }
    const me = auth.currentUser();
    $("statTop").textContent = rows.length ? rows[0].user + " (" + rows[0].score + ")" : "—";
    if (me) {
      const r = auth.rankOf(me.username);
      $("myRank").textContent = r ? `Your rank: #${r} • best ${me.stats.best} • ${me.credits || 0} credits` : "No ranked score yet — fly a run while logged in.";
    } else {
      $("myRank").textContent = "Login to rank. Guest runs don't appear here.";
    }
    const body = $("boardBody");
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="muted">No flights yet. Be the first.</td></tr>'; return; }
    body.innerHTML = rows.map((r, i) =>
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

  // ---------- settings ----------
  $("soundSel").addEventListener("change", e => { sfx.setEnabled(e.target.value === "on"); });
  $("wipeBtn").addEventListener("click", () => {
    if (confirm("Delete all accounts + scores in this browser?")) {
      auth.wipeAll(); dailyAutoShown = false; refreshUser(); toast("Local data wiped.");
    }
  });

  // ---------- game flow ----------
  function launch() {
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
  $("againBtn").addEventListener("click", launch);
  $("menuBtn").addEventListener("click", () => {
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

  game.onEvent = (ev, data) => {
    if (ev === "hud") {
      $("hudScore").textContent = Math.floor(game.score);
      $("hudWave").textContent = game.wave;
      $("hudKills").textContent = game.kills;
      $("hpFill").style.width = (game.p.hp / game.p.maxHp * 100) + "%";
      $("xpFill").style.width = (game.p.xp / game.p.xpNext * 100) + "%";
    }
    if (ev === "wave") {
      $("runInfo").textContent = `— wave ${data.wave} • ${game.difficulty} —`;
      toast("Wave " + data.wave + (data.wave % 5 === 0 ? " — BOSS! ☠️" : ""));
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
      const me = auth.currentUser();
      if (me) {
        const r = auth.recordGame(me.username, data);
        refreshUser();
        checkDaily(false);
        $("finalStats").textContent =
          `Score ${data.score} • Wave ${data.wave} • Kills ${data.kills}` +
          (r.isBest ? " • NEW BEST! 🏆" : "") +
          ` • +${r.earned} credits ◉ → ${r.credits}`;
      } else {
        $("finalStats").textContent = `Score ${data.score} • Wave ${data.wave} • Kills ${data.kills} • guest run (login to rank + earn credits)`;
      }
      $("upgradeOverlay").classList.add("hidden");
      $("gameOverOverlay").classList.remove("hidden");
    }
    if (ev === "start") {
      $("hudScore").textContent = "0"; $("hudWave").textContent = "1"; $("hudKills").textContent = "0";
    }
  };

  // boot
  refreshUser();
  game.render();
  checkDaily(true);
})();
