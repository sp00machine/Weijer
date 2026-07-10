# scraper service

HTTP wrapper around the Playwright aisle scraper. Runs on a **residential** machine
(datacenter IPs get 403'd by Akamai); the VPS server calls it over the tailnet.

## Deploy (residential Linux box with Docker + Tailscale)

```sh
cd scraper
SCRAPER_BIND=$(tailscale ip -4) docker compose up -d --build
curl http://$(tailscale ip -4):8044/health   # {"ok":true}
```

Then on the VPS, set `SCRAPER_URL=http://<this machine's tailnet IP>:8044` for the server.

## API

- `GET /health` → `{"ok": true}`
- `POST /scrape` `{"store": "245", "urls": ["https://www.meijer.com/shopping/product/.../123.html"]}`
  → `{"rows": [ScraperRow...]}` (shape defined in `server/types.ts`)

`aisle_finder.py` is still usable standalone (table output):

```sh
.venv/bin/python aisle_finder.py --store 245 <product-url>...
```
