import type { ScraperRow, ScrapeServiceResponse } from "./types.ts";

/**
 * HTTP client for the scraper service (scraper/server.py), which runs on a
 * residential machine and is reached over the tailnet. Unset SCRAPER_URL means
 * scraping is disabled (cache-only server, e.g. once the APK client exists).
 */
export const SCRAPER_URL = process.env.SCRAPER_URL ?? null;

// Worst case per URL is ~25s (20s selector timeout + goto retries), plus
// browser startup — generous so we don't abort scrapes that would succeed.
const BASE_TIMEOUT_MS = 30_000;
const PER_URL_TIMEOUT_MS = 30_000;

/**
 * Scrape a batch of URLs at a given store via the scraper service.
 * Returns null if the scraper is disabled or unreachable — callers must treat
 * that as "misses stay unresolved", never as a request failure.
 */
export async function scrape(storeId: string, urls: string[]): Promise<ScraperRow[] | null> {
  if (urls.length === 0) return [];
  if (!SCRAPER_URL) return null;

  try {
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ store: storeId, urls }),
      signal: AbortSignal.timeout(BASE_TIMEOUT_MS + PER_URL_TIMEOUT_MS * urls.length),
    });
    if (!res.ok) {
      console.error(`scraper responded ${res.status}: ${(await res.text()).slice(0, 500)}`);
      return null;
    }
    const body = (await res.json()) as ScrapeServiceResponse;
    return body.rows;
  } catch (err) {
    console.error(`scraper unreachable at ${SCRAPER_URL}:`, err);
    return null;
  }
}
