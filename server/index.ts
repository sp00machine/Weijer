import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getFresh, upsertMany, type CacheRow } from "./db.ts";
import { scrape, SCRAPER_URL } from "./scraper.ts";
import type { AisleResult, ResolveRequest, ResolveResponse, ScraperStatus } from "./types.ts";

const DEFAULT_MAX_AGE_DAYS = 21;
const PORT = Number(process.env.PORT ?? 3000);

const PRODUCT_ID_RE = /\/(\d+)\.html/;
function productIdFromUrl(url: string): string | null {
  return url.match(PRODUCT_ID_RE)?.[1] ?? null;
}

/** Aisle strings look like "B | 16"; sort by letter then the numeric part, then section. */
function aisleSortKey(r: AisleResult): [string, number, number] {
  const m = r.aisle?.match(/([A-Za-z]*)\s*\|?\s*(\d+)?/);
  const letter = m?.[1] ?? "~";
  const num = m?.[2] ? Number(m[2]) : Number.POSITIVE_INFINITY;
  const section = r.section ? Number(r.section) : Number.POSITIVE_INFINITY;
  return [letter, num, section];
}

function sortResults(results: AisleResult[]): AisleResult[] {
  return results.sort((a, b) => {
    // Unresolved rows (no aisle) always sort to the bottom, regardless of how
    // localeCompare would treat the aisle-key sentinel.
    const aNull = a.aisle == null;
    const bNull = b.aisle == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    const ka = aisleSortKey(a);
    const kb = aisleSortKey(b);
    return ka[0].localeCompare(kb[0]) || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

function unresolvedResult(url: string, productId: string | null): AisleResult {
  return {
    url, product_id: productId, title: null, aisle: null,
    section: null, store_name: null, fetched_at: 0, source: "none",
  };
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/resolve", async (c) => {
  let body: ResolveRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const { store, urls } = body;
  if (!store || !Array.isArray(urls) || urls.length === 0) {
    return c.json({ error: "body must be { store: string, urls: string[] }" }, 400);
  }
  const maxAgeSec = (body.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 86400;

  // Map each requested url -> its product id (dedupe by product id).
  const urlById = new Map<string, string>();
  const unparseable: string[] = [];
  for (const url of urls) {
    const pid = productIdFromUrl(url);
    if (pid) urlById.set(pid, url);
    else unparseable.push(url);
  }

  const productIds = [...urlById.keys()];
  const hits = getFresh(store, productIds, maxAgeSec);

  const missIds = productIds.filter((pid) => !hits.has(pid));
  const missUrls = missIds.map((pid) => urlById.get(pid)!);

  const results: AisleResult[] = [];

  // Cache hits.
  for (const [pid, row] of hits) {
    results.push({
      url: urlById.get(pid)!,
      product_id: pid,
      title: row.title,
      aisle: row.aisle,
      section: row.section,
      store_name: row.store_name,
      fetched_at: row.fetched_at,
      source: "cache",
    });
  }

  // Cache misses -> scrape. scrape() returns null when the scraper is disabled
  // (no SCRAPER_URL) or unreachable; either way the misses stay unresolved.
  let scraperStatus: ScraperStatus = SCRAPER_URL ? "ok" : "disabled";

  if (missUrls.length > 0) {
    const scraped = await scrape(store, missUrls);
    if (scraped === null) {
      if (SCRAPER_URL) scraperStatus = "unavailable";
      for (const pid of missIds) results.push(unresolvedResult(urlById.get(pid)!, pid));
    } else {
      const toCache: CacheRow[] = [];
      for (const row of scraped) {
        const pid = row.product_id;
        if (pid) {
          toCache.push({
            store_id: store,
            product_id: pid,
            url: row.url,
            title: row.title,
            aisle: row.aisle,
            section: row.section,
            store_name: row.store,
            fetched_at: row.fetched_at,
          });
        }
        results.push({
          url: row.url,
          product_id: pid,
          title: row.title,
          aisle: row.aisle,
          section: row.section,
          store_name: row.store,
          fetched_at: row.fetched_at,
          source: "scrape",
        });
      }
      if (toCache.length > 0) upsertMany(toCache);
    }
  }

  // URLs we couldn't parse a product id from: surface them, unresolved.
  for (const url of unparseable) {
    results.push(unresolvedResult(url, null));
  }

  const response: ResolveResponse = { results: sortResults(results), scraper: scraperStatus };
  return c.json(response);
});

// Serve the built SolidJS PWA (run from repo root so ./app/dist resolves).
// Registered after the API routes so /resolve and /health take precedence.
app.use("/*", serveStatic({ root: "./app/dist" }));
// SPA fallback: any unmatched GET returns the app shell.
app.get("/*", serveStatic({ path: "./app/dist/index.html" }));

console.log(`meijer-aisle server listening on :${PORT} (scraper: ${SCRAPER_URL ?? "disabled"})`);
export default { port: PORT, fetch: app.fetch };
