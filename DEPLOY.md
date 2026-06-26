# Deploy — Fly app (client + websocket) + optional Vercel domain

This game is a **Colyseus websocket server** + a **Three.js static client**. The Fly app
runs ONE machine that serves both on a single URL. Vercel optionally hosts the client under
your own domain, connecting the websocket straight to Fly (browser → Fly directly — Vercel
can't proxy persistent sockets, so the client points at Fly's `wss://`).

Everything below is the parts that need YOUR accounts — the code/config is already wired
(`Dockerfile`, `fly.toml`, `vercel.json`, `.github/workflows/fly-deploy.yml`). Verified
locally: the server serves the client and the same-origin websocket connects + the agents
render.

---

## 1. Fly app (the playable URL) — required

**One-time, from a terminal** (needs the `flyctl` CLI + your existing Fly login):

```bash
# Pick a unique app name and your region, then create the app:
fly apps create <your-app-name>
# Edit fly.toml: set `app = "<your-app-name>"` and `primary_region = "<your-region>"`.
fly deploy
```

That gives you `https://<your-app-name>.fly.dev` — open it and play. Costs ~nothing when
idle (`auto_stop_machines`/`min_machines_running = 0` scale it to zero; it wakes on the next
connection, ~a few seconds cold start).

### Auto-deploy on push (phone-friendly, no CLI after setup)

The included GitHub Action redeploys on every push (and on-demand from the **Actions** tab).
One-time setup:

1. Create a Fly deploy token: `fly tokens create deploy` (copy it).
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   name `FLY_API_TOKEN`, value = the token. *(Doable from the GitHub mobile site.)*

After that, pushes auto-deploy; no terminal needed.

---

## 2. Vercel (your custom domain) — optional

Gives you a nice domain + CDN for the client; the websocket still goes to Fly.

1. Vercel → **Add New… → Project** → import this repo. *(Phone web works.)*
2. Leave the build settings as detected (`vercel.json` sets them: build the client to
   `packages/client/dist`).
3. **Project → Settings → Environment Variables**, add:
   - `VITE_SERVER_URL` = `wss://<your-app-name>.fly.dev`
4. **Deploy.** Add your custom domain under **Settings → Domains**.

The client reads `VITE_SERVER_URL` at build time and connects there for multiplayer.

### Pages on the Vercel deploy

- `/` — the **game** (connects to the Fly websocket via `VITE_SERVER_URL`).
- `/preview` — the **map preview harness** (the orbit-able facility view). It is
  backend-free (loads the content pack itself), so it works standalone with no server —
  handy for sharing the map/art without spinning anything up. (`/preview.html` also works.)
- `?server=mock` on the game URL forces the offline scene (no server needed).

---

## How the client picks its server (no surprises)

`packages/client/src/main.ts` resolves the endpoint in this order:
1. `?server=ws://…` query override (`?server=mock` forces the offline scene).
2. `VITE_SERVER_URL` build env (Vercel).
3. Vite dev → `ws://localhost:2567`.
4. Otherwise → **same origin** (the Fly app serving the page → its own `wss://`).
