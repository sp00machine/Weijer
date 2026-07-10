// Shared request/response types for the API.
// Imported (type-only) by the SolidJS frontend so both ends stay in sync.

export interface ResolveRequest {
  store: string;
  urls: string[];
  /** Cache entries older than this are treated as misses and re-scraped. Default 21. */
  maxAgeDays?: number;
}

/** Where a result row came from. "none" = unresolved (cache miss, not scraped). */
export type ResultSource = "cache" | "scrape" | "none";

export interface AisleResult {
  url: string;
  product_id: string | null;
  title: string | null;
  aisle: string | null;
  section: string | null;
  store_name: string | null;
  /** Epoch seconds when this data was scraped. 0 for unresolved rows. */
  fetched_at: number;
  source: ResultSource;
}

/** Scraper backend status for this request. */
export type ScraperStatus =
  | "ok" // scraper reachable (or not needed this request)
  | "unavailable" // scraper configured but unreachable/failed; misses returned unresolved
  | "disabled"; // no SCRAPER_URL configured (cache-only server)

export interface ResolveResponse {
  results: AisleResult[];
  scraper: ScraperStatus;
}

/** Shape emitted by scraper/aisle_finder.py (note: `store`, not `store_name`). */
export interface ScraperRow {
  url: string;
  product_id: string | null;
  title: string | null;
  aisle: string | null;
  section: string | null;
  store: string | null;
  fetched_at: number;
  error?: string;
}

/** POST /scrape body/response on the scraper service. */
export interface ScrapeServiceResponse {
  rows: ScraperRow[];
}
