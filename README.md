# Nebula Strike — GitHub Online Game

A polished neon arena shooter that runs 100% in the browser. Includes a full login system, profiles, leaderboard, and wave-based combat. Deployable to **GitHub Pages** in 2 minutes — no backend, no build step.

## Features

- **Login system** — register / login / logout / guest mode, SHA-256 salted password hashing, persistent sessions, profile stats
- **Game** — top-down arena shooter: WASD + mouse, waves, 4 enemy types, bosses every 5 waves, particles, screen shake, power-ups, level-up upgrades
- **Online-ready** — static site, works on GitHub Pages; leaderboard + accounts stored per-browser (swap in Firebase/Supabase for cross-device, see below)
- **Extras** — pause, sound (WebAudio synth, no assets), difficulty settings, mobile touch controls, high-score board

## Quick start (local)

```bash
# any static server works
npx serve .
# or
python -m http.server 8000
# open http://localhost:8000
```

No install needed. Just open `index.html` — but a local server is recommended for audio/fullscreen.

## Push to GitHub + enable online play

```bash
git init
git add .
git commit -m "Nebula Strike"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/nebula-strike.git
git push -u origin main
```

Then in GitHub repo: **Settings → Pages → Deploy from branch → `main` / `/ (root)`**. Your game is live at `https://YOUR-USERNAME.github.io/nebula-strike/`.

A workflow is included at `.github/workflows/pages.yml` — Pages deploys automatically on push.

## Controls

| Action | Key |
|---|---|
| Move | WASD / Arrows |
| Aim | Mouse |
| Shoot | Hold Left-click / Space |
| Dash | Shift (with cooldown) |
| Pause | P / Esc |
| Mute | M |

Mobile: left thumb = move, right thumb = aim + auto-fire.

## Project structure

```
index.html          — layout, menus, HUD, modals
styles.css          — full neon theme, responsive
js/auth.js          — login system (AuthSystem)
js/audio.js         — WebAudio synth SFX + music
js/game.js          — game engine (NebulaGame)
js/app.js           — UI glue, leaderboard, screens
```

## Leaderboards: Global + Personal

- **🌍 Global** — shared worldwide. Finished runs (logged in, score > 0) are published to a public ntfy.sh topic (`nebula-strike-v1-top-uxp70`, see `TOPIC` in `js/global.js`) and the tab aggregates best-per-pilot across all players. ntfy.sh keeps ~12h of message history, so Global = recent worldwide top; entries are strictly validated on read and junk is dropped. Score posts queue offline and flush on reconnect.
- **👤 Personal** — your all-time bests + last 10 runs, stored in this browser (`localStorage`), plus your live global rank.
- To reset/move the global board, change `TOPIC` in `js/global.js` (first publish creates the topic). The topic is public by design — don't put secrets in it.

## Login system details

- `localStorage` keys: `nebula_users_v1`, `nebula_session_v1`, `nebula_scores_v1`
- Passwords: random 16-byte salt + SHA-256(salt + password), never stored in plain text
- Session persists across reloads; guest accounts play without saving to leaderboard
- To make logins truly cross-device/global, plug in Firebase Auth + Firestore (search `TODO:online` in `js/auth.js` for the seam)

## Customizing

- Difficulty: menu → Settings (Rookie / Pilot / Ace affects enemy HP, speed, spawn rate)
- Balance: tweak `CONFIG` at top of `js/game.js`
- Theme: CSS variables at top of `styles.css`

## License

MIT — free for personal and commercial use.
