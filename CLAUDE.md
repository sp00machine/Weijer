# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Takes a list of Meijer product page URLs and returns each item annotated with its in-store **aisle + section** for a given store, so a shopping list can be sorted by physical location. Built for one non-technical Android user; `ROADMAP.md` has the trajectory (an APK whose WebView imports the user's Meijer cart, then hands the URLs to `/resolve` — scraping stays server-side). Three parts:

- `server/` — Bun + Hono API with a SQLite cache (`bun:sqlite`, WAL mode). Cache-first; forwards misses to the scraper service over HTTP. Serves the built PWA from `app/dist` in production. Deployed as a Docker container on the VPS (root `Dockerfile` + `compose.yaml`).
- `scraper/` — Python Playwright scraper (`aisle_finder.py`, also a standalone CLI) wrapped in a FastAPI service (`server.py`). Runs in Docker **on a residential machine**, reached over the tailnet; `scraper/compose.yaml` binds the port to the tailnet IP via `SCRAPER_BIND`.
- `app/` — SolidJS PWA (Vite + vite-plugin-pwa), installable via Chrome.

## Commands

```sh
bun install                       # installs all workspaces

bun run server/index.ts           # API + static PWA on :3000 (env: PORT, SCRAPER_URL, DB_PATH)

cd app && bun run dev             # Vite dev server; proxies /resolve and /health to :3000
cd app && bun run build           # builds to app/dist (what the Bun server serves)

bunx tsc --noEmit                 # typecheck server (root tsconfig excludes app/, which has its own)
cd app && bunx tsc --noEmit       # typecheck app (Solid JSX config lives in app/tsconfig.json)

docker compose up -d --build      # VPS deployment (reads .env; see .env.example)
cd scraper && docker compose up -d --build   # scraper deployment (residential machine)

# Scraper standalone (human-readable table output):
scraper/.venv/bin/python scraper/aisle_finder.py --store 245 <product-url>...

# End-to-end verification: drives the PWA at localhost:3000 headlessly, prints
# rendered rows, screenshots, and checks localStorage persistence:
scraper/.venv/bin/python scraper/drive_ui.py [/path/to/screenshot.png]
```

There are no tests or linters configured. Quick API smoke test:

```sh
curl -sX POST localhost:3000/resolve -H 'content-type: application/json' \
  -d '{"store":"245","urls":["https://www.meijer.com/shopping/product/.../19101100127.html"]}'
```

## ⚠️ Critical: scraping constraints (Akamai)

Meijer's site is behind Akamai Bot Manager. Two axes:

1. **Automation fingerprint** *(always required)* — the scraper runs **headful Chromium under `xvfb`** with a spoofed desktop UA and `navigator.webdriver` hidden. Headless is detected and blocked. Do not "simplify" it to headless.
2. **IP reputation** *(situational)* — Akamai can `403` datacenter IPs, but it's largely volume-driven; at this project's one-user volume the VPS scrapes fine from its own IP. Fallback if that ever changes: run `scraper/` on a residential machine and point `SCRAPER_URL` at its tailnet IP (no code change). Scraping does **not** require a Meijer login — just the `meijer-store` cookie.

(`drive_ui.py` is exempt — it hits localhost only, so headless is fine there.)

## Architecture / data flow

`POST /resolve` with `{ store, urls, maxAgeDays? }` (default TTL 21 days; `store` is the Meijer store id, e.g. `245` = Hartland, applied via the site's `meijer-store` cookie):

1. `server/index.ts` extracts a product id from each URL (`/(\d+)\.html`), dedupes by id.
2. `server/db.ts` returns cache hits fresh within `maxAgeDays`, keyed on `(store_id, product_id)`.
3. Misses: `server/scraper.ts` POSTs `{store, urls}` to `${SCRAPER_URL}/scrape` (long timeout, scales with URL count). **On any failure it returns `null`, never throws** — `/resolve` then emits misses as `source: "none"` rows and sets `scraper: "unavailable"`. Unset `SCRAPER_URL` ⇒ scraping skipped entirely (`scraper: "disabled"`, cache-only server).
4. Successful scrapes are upserted into the cache; results sorted by aisle letter, aisle number, then section. Aisle strings look like `"B | 16"`.

Scraping is **server-side only** by design (see `ROADMAP.md`): the planned APK's WebView imports the user's Meijer cart and hands the URLs to `/resolve` — it does not scrape aisles on-device. (An earlier `scrape: false` flag and `POST /update` endpoint built for on-device scraping were removed when that approach was cut.)

The SQLite cache path comes from `DB_PATH` (compose mounts a volume at `/data`); default is `server/aisle.db` (gitignored).

### Cross-language/workspace contracts

- `server/types.ts` is the single source of truth for API shapes. The app imports it **type-only** (`app/src/api.ts`) so there's no runtime coupling — keep it importable that way.
- The scraper service response (`{rows: [...]}` from `scraper/server.py`) must match `ScraperRow` in `server/types.ts`. Gotcha: the scraper emits `store`, which the server maps to `store_name` in responses/cache.
- Rows where the scrape failed have `error` set and `aisle: null`; they still get cached (so a broken page isn't re-scraped for the TTL).

### Frontend

- Dev: Vite proxies `/resolve` + `/health` to `:3000`. Prod: the Bun server serves `app/dist` on the same origin (API routes are registered first; unmatched GETs fall back to `index.html` for SPA routing), so the app uses relative fetches — keep it origin-relative.
- App state (store id, URLs, last results) persists in `localStorage`. The `scraper: "unavailable"` response status renders a notice banner.
- After changing the app, rebuild (`cd app && bun run build`) before verifying against the Bun server — it serves `dist`, not source. The Docker image build does this itself.

## Deployment notes

- VPS: `docker compose up -d --build` at repo root; config in `.env` (gitignored — see `.env.example`). Use the scraper machine's **raw tailnet IP** in `SCRAPER_URL`; MagicDNS names don't resolve inside containers.
- The server container is **not published to the host** — it joins the external `web` Docker network and is served at `https://meijer.ashtronics.xyz` by the shared `nginx` reverse proxy (`/home/ash/apps/nginx/conf.d/meijer.conf`), which reaches it by the `meijer-aisle` service-name alias. So to smoke-test the deployed container, go through the vhost (or `docker exec nginx wget -qO- http://meijer-aisle:3000/health`), not `localhost:3000`. `bun run server/index.ts` locally still binds `:3000` as normal. The nginx vhost sets a 600s `proxy_read_timeout` because cold-cache `/resolve` scrapes synchronously.
- Residential machine: `cd scraper && SCRAPER_BIND=$(tailscale ip -4) docker compose up -d --build` (see `scraper/README.md`).
- The scraper Docker image tag (`mcr.microsoft.com/playwright/python:v1.61.0-noble`) must match the `playwright` pin in `scraper/requirements.txt`.
