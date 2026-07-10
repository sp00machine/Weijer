# meijer-aisle

Takes a list of Meijer product page URLs and returns each item annotated with its in-store
**aisle + section** for a given store, so a shopping list can be sorted by physical location.

See [ROADMAP.md](ROADMAP.md) for where this is heading (Android APK with on-device resolution).

![demo image](https://github.com/sp00machine/Weijer/blob/main/demo.png?raw=true)

## Layout

- `server/` — Bun + TypeScript API (Hono) + SQLite cache (`bun:sqlite`). Cache-first; forwards
  misses to the scraper service. Serves the built PWA in production.
- `scraper/` — Python + Playwright scraper, wrapped in a FastAPI HTTP service (`server.py`).
  Runs in Docker **on a residential machine**; the server reaches it over the tailnet.
- `app/` — SolidJS PWA frontend (Vite + vite-plugin-pwa, installable via Chrome). Dev server
  proxies the API; in prod the Bun server serves `app/dist` on its own origin.

## Deploying

**VPS** (server + db + PWA — one container, served at `https://meijer.ashtronics.xyz`
via the shared `nginx` reverse proxy on the external `web` network; not published to the host):

```sh
cp .env.example .env    # set SCRAPER_URL
docker compose up -d --build
```

**Residential machine** (scraper — needs Docker + Tailscale): see [`scraper/README.md`](scraper/README.md).

Env vars (VPS container, via `.env`):

| var | meaning |
|---|---|
| `SCRAPER_URL` | scraper service base URL. Default deployment: the scraper container on the VPS at `http://172.17.0.1:8044`. Unset ⇒ scraping disabled, cache-only. |
| `DB_PATH` | sqlite path (compose sets `/data/aisle.db` on a volume). |
| `PORT` | listen port (default 3000). |

## Developing

```sh
bun install
bun run server/index.ts        # API + static PWA on :3000
cd app && bun run dev          # Vite dev server, proxies /resolve to :3000
bunx tsc --noEmit              # typecheck server (app: cd app && bunx tsc --noEmit)
```

## API

`POST /resolve` — `{ store: string, urls: string[], maxAgeDays?: number }`
(default TTL 21 days; `store` is the Meijer store id, e.g. `245` = Hartland, applied via the
site's `meijer-store` cookie). Returns `{ results: AisleResult[], scraper: "ok" | "unavailable"
| "disabled" }`, sorted by aisle then section; each result has `source: "cache" | "scrape" |
"none"` (`none` = cache miss the scraper couldn't resolve).

`GET /health` — `{ ok: true }`.

```sh
curl -sX POST localhost:3000/resolve -H 'content-type: application/json' \
  -d '{"store":"245","urls":["https://www.meijer.com/shopping/product/.../19101100127.html"]}'
```

## Scraping & Akamai Bot Manager

Meijer's site is behind Akamai Bot Manager, so the scraper defends on two axes:

1. **Automation fingerprint** *(always required)* — the scraper runs **headful Chromium under
   `xvfb`** with a spoofed desktop UA and `navigator.webdriver` hidden. Headless mode is detected
   and blocked; don't "simplify" it to headless.
2. **IP reputation** *(situational)* — Akamai can `403` datacenter IPs, but this is largely
   volume-driven. At this project's one-user volume the VPS scrapes fine from its own IP. If that
   changes, run `scraper/` on a residential machine and point `SCRAPER_URL` at its tailnet IP —
   no other change needed.

If `/resolve` returns `scraper: "unavailable"`, the scraper is off/unreachable — cached results
still work. If scrapes succeed but aisle data is `null` with errors, suspect the fingerprint or IP.
