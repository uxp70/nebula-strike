/* App glue: auth UI, leaderboard, game events. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 2200);
  };

  const auth = new AuthSystem();
  const sfx = new SoundFX();
  const game = new NebulaGame($("game"), sfx);

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
  const openAuth = () => { modal.classList.remove("hidden"); $("authErr").textContent = ""; };
  const closeAuth = () => modal.classList.add("hidden");
  $("loginBtn").addEventListener("click", openAuth);
  $("overlayLogin").addEventListener("click", openAuth);
  $("closeAuth").addEventListener("click", closeAuth);
  modal.addEventListener("click", e => { if (e.target === modal) closeAuth(); });

  async function doAuth(mode) {
    const u = $("authUser").value, p = $("authPass").value;
    $("authErr").textContent = "";
    try {
      if (mode === "register") await auth.register(u, p);
      else await auth.login(u, p);
      closeAuth();
      toast("Welcome, " + auth.currentUser().username + " 🚀");
      refreshUser();
    } catch (err) { $("authErr").textContent = err.message; }
  }
  $("doLogin").addEventListener("click", () => doAuth("login"));
  $("doRegister").addEventListener("click", () => doAuth("register"));
  $("authPass").addEventListener("keydown", e => { if (e.key === "Enter") doAuth("login"); });
  $("logoutBtn").addEventListener("click", () => { auth.logout(); refreshUser(); toast("Logged out."); });

  function refreshUser() {
    const me = auth.currentUser();
    $("loginBtn").hidden = !!me;
    $("logoutBtn").hidden = !me;
    $("userChip").hidden = !me;
    if (me) {
      $("chipName").textContent = me.username;
      $("chipSub").textContent = me.stats.games + " flights • best " + me.stats.best;
      $("avatar").textContent = me.username[0].toUpperCase();
      $("statBest").textContent = me.stats.best;
      $("statGames").textContent = me.stats.games;
      $("statKills").textContent = me.stats.kills;
    } else {
      $("statBest").textContent = "0";
      $("statGames").textContent = "0";
      $("statKills").textContent = "0";
    }
    renderBoard();
  }

  function renderBoard() {
    const rows = auth.leaderboard(10);
    const me = auth.currentUser();
    $("statTop").textContent = rows.length ? rows[0].user + " (" + rows[0].score + ")" : "—";
    const body = $("boardBody");
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="muted">No flights yet. Be the first.</td></tr>'; return; }
    body.innerHTML = rows.map((r, i) =>
      `<tr class="${me && r.user === me.username ? "me" : ""}"><td>${i + 1}</td><td>${escapeHtml(r.user)}</td><td><b>${r.score}</b></td><td>${r.wave}</td><td>${r.kills}</td></tr>`
    ).join("");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- settings ----------
  $("soundSel").addEventListener("change", e => {
    sfx.setEnabled(e.target.value === "on");
  });
  $("wipeBtn").addEventListener("click", () => {
    if (confirm("Delete all accounts + scores in this browser?")) {
      auth.wipeAll(); refreshUser(); toast("Local data wiped.");
    }
  });

  // ---------- game flow ----------
  function launch() {
    const diff = $("difficulty").value;
    $("menuOverlay").classList.add("hidden");
    $("gameOverOverlay").classList.add("hidden");
    $("upgradeOverlay").classList.add("hidden");
    game.start(diff);
    sfx.startMusic();
    $("runInfo").textContent = "— wave 1 • " + diff + " • " + (auth.currentUser() ? auth.currentUser().username : "guest") + " —";
  }
  $("playBtn").addEventListener("click", launch);
  $("overlayPlay").addEventListener("click", launch);
  $("guestBtn").addEventListener("click", launch);
  $("againBtn").addEventListener("click", launch);
  $("menuBtn").addEventListener("click", () => {
    $("gameOverOverlay").classList.add("hidden");
    $("menuOverlay").classList.remove("hidden");
    game.state = "menu";
  });
  $("restartBtn").addEventListener("click", launch);
  $("pauseBtn").addEventListener("click", () => game.togglePause());
  $("howBtn").addEventListener("click", () => {
    document.querySelector('[data-tab="how"]').click();
    toast("Move: WASD • Aim: mouse • Fire: click/space");
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
    if (ev === "pause") toast("Paused — P to resume");
    if (ev === "mute") {
      const sel = $("soundSel");
      sel.value = sel.value === "on" ? "off" : "on";
      sfx.setEnabled(sel.value === "on");
    }
    if (ev === "over") {
      sfx.stopMusic();
      const me = auth.currentUser();
      if (me) {
        auth.recordGame(me.username, data);
        refreshUser();
      }
      $("finalStats").textContent =
        `Score ${data.score} • Wave ${data.wave} • Kills ${data.kills}` +
        (me ? ` • saved to ${me.username}` : " • guest run (login to rank)");
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
})();
