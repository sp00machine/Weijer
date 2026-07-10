import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";

// DB_PATH env lets the Docker deployment put the db on a mounted volume.
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL("./aisle.db", import.meta.url));

export interface CacheRow {
  store_id: string;
  product_id: string;
  url: string;
  title: string | null;
  aisle: string | null;
  section: string | null;
  store_name: string | null;
  fetched_at: number;
}

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS aisle_cache (
    store_id   TEXT NOT NULL,
    product_id TEXT NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT,
    aisle      TEXT,
    section    TEXT,
    store_name TEXT,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (store_id, product_id)
  );
`);

const selectOne = db.query<CacheRow, [string, string, number]>(`
  SELECT store_id, product_id, url, title, aisle, section, store_name, fetched_at
  FROM aisle_cache
  WHERE store_id = ? AND product_id = ? AND fetched_at >= ?
`);

const upsertOne = db.query<null, [string, string, string, string | null, string | null, string | null, string | null, number]>(`
  INSERT INTO aisle_cache (store_id, product_id, url, title, aisle, section, store_name, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id, product_id) DO UPDATE SET
    url = excluded.url,
    title = excluded.title,
    aisle = excluded.aisle,
    section = excluded.section,
    store_name = excluded.store_name,
    fetched_at = excluded.fetched_at
`);

/** Return fresh cache rows (fetched within maxAgeSec) for the given product ids. */
export function getFresh(
  storeId: string,
  productIds: string[],
  maxAgeSec: number,
): Map<string, CacheRow> {
  const minFetchedAt = Math.floor(Date.now() / 1000) - maxAgeSec;
  const hits = new Map<string, CacheRow>();
  for (const pid of productIds) {
    const row = selectOne.get(storeId, pid, minFetchedAt);
    if (row) hits.set(pid, row);
  }
  return hits;
}

/** Insert or refresh many rows in one transaction. */
export const upsertMany = db.transaction((rows: CacheRow[]) => {
  for (const r of rows) {
    upsertOne.run(
      r.store_id, r.product_id, r.url, r.title,
      r.aisle, r.section, r.store_name, r.fetched_at,
    );
  }
});
