# Roadmap

Built for one non-technical Android user: import a Meijer cart with a tap, get it sorted by
aisle so a store run is one pass through the store.

**Architecture decision (July 2026):** scraping stays server-side permanently. The VPS scrapes
Meijer fine from its own IP — the earlier 403s were a temporary Akamai blacklist from load-testing,
not a standing block, and at this volume (one user) datacenter-IP detection isn't a real risk. So
the app does **not** scrape on-device. The one thing that can't move to the server is reading the
user's cart (it's behind her Meijer login) — that's the sole remaining job of the planned WebView.

## ✅ Phase 1 — Core resolver + PWA

- Bun/Hono `/resolve` API with SQLite cache (21-day TTL), Playwright scraper, SolidJS PWA
  (installable, localStorage persistence), served by the Bun server.

## ✅ Phase 2 — Service split + containerization *(July 2026)*

- Scraper is its own HTTP service (`scraper/server.py`) in Docker, deployable on a residential
  machine; the VPS reaches it over the tailnet (`SCRAPER_URL`). No more whole-VPS exit-node routing.
- VPS stack (server + db volume + built PWA) containerized (`compose.yaml`).
- Graceful degradation: scraper offline ⇒ cache hits still served, misses return `source: "none"`,
  response carries `scraper: "unavailable"`, PWA shows a notice.
- Served at `https://meijer.ashtronics.xyz` via the shared `nginx` reverse proxy (external `web`
  network); container not published to the host.

Scraper deployment: currently runs as a container on the VPS itself, which reaches Meijer fine.
It can move to a residential machine (see `scraper/README.md`) by pointing `SCRAPER_URL` at its
tailnet IP — kept as a documented fallback in case the VPS IP ever gets blocked, not a required step.

## Phase 3 — Android APK

Wrap the existing PWA in a native shell (Capacitor is the default choice; the web app ships
unchanged) plus a **controlled WebView whose only job is cart import**:

1. User logs into meijer.com in the WebView (session persists in the WebView's cookie store, so
   login is rare).
2. On the cart/list page, extract every product URL. *Prefer intercepting the cart XHR/JSON
   responses over scraping the rendered DOM* — Meijer's JSON contract changes far less often than
   their markup. Fallback: DOM scrape.
3. Hand those URLs to `/resolve` (normal mode — **the server scrapes any misses**). Show the
   aisle-sorted list. That's it: no on-device page visits, no aisle scraping on the client.

Design notes / open questions:

- UX for a non-technical user: the WebView is visible only for login and the cart tap, then hands
  back to the PWA list. No "now tap this" gymnastics.
- Store id: derive from her Meijer account/cart context if possible, else a one-time setup value.
- Failure UX: items the server can't locate (out of stock / online-only) land in a "no location"
  group at the bottom of the list, not an error.
- Distribution: sideloaded APK is fine for one user; document the install once.

## Not doing: on-device scraping

The APK will **not** scrape aisles on-device. That was worth designing for when a datacenter-IP
block looked likely, but at one-user volume the server scrapes fine, and reversibility is cheap
(residential scraper container + `SCRAPER_URL`, above). Consequence: the `scrape: false` request
flag and the `POST /update` endpoint (`UPDATE_TOKEN`) were built for that model and now have no
consumer — candidates for removal to keep the surface lean. The scraper-unavailable degradation
path is independent and stays.

## Sometime / maybe

- Store picker by name/zip instead of raw store id.
- Android share-target: share a product page from the Meijer app/browser straight into the list.
- Check-off UI for use while walking the store (persisted per trip).
- Cache warmth: periodic re-scrape of list staples before the TTL lapses.
