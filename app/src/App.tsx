import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { resolve, type AisleResult, type ScraperStatus } from "./api.ts";

const LS_STORE = "meijer-aisle:store";
const LS_URLS = "meijer-aisle:urls";
const LS_RESULTS = "meijer-aisle:results";
const LS_QTY = "meijer-aisle:qty";
const LS_PICKED = "meijer-aisle:picked";
const LS_NAMES = "meijer-aisle:names";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function ageLabel(fetchedAt: number): string {
  if (!fetchedAt) return "";
  const days = Math.floor((Date.now() / 1000 - fetchedAt) / 86400);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const PRODUCT_ID_RE = /\/(\d+)\.html/;
function productIdFromUrl(url: string): string | null {
  return url.match(PRODUCT_ID_RE)?.[1] ?? null;
}

/** Stable per-row key for picked-state: product id when known, else the URL. */
function rowKey(r: AisleResult): string {
  return r.product_id ?? r.url;
}

export default function App() {
  const [store, setStore] = createSignal(load<string>(LS_STORE, "245"));
  const [urlsText, setUrlsText] = createSignal(load<string>(LS_URLS, ""));
  const [results, setResults] = createSignal<AisleResult[] | null>(
    load<AisleResult[] | null>(LS_RESULTS, null),
  );
  // product_id -> quantity in the cart (absent = 1).
  const [qtyById, setQtyById] = createSignal<Record<string, number>>(load(LS_QTY, {}));
  // product_id -> name from the imported cart (fallback title when scraping fails).
  const [nameById, setNameById] = createSignal<Record<string, string>>(load(LS_NAMES, {}));
  // Keys (see rowKey) of items already picked into the physical cart.
  const [picked, setPicked] = createSignal<string[]>(load<string[]>(LS_PICKED, []));
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [scraperStatus, setScraperStatus] = createSignal<ScraperStatus | null>(null);
  // True when running inside the Android shell (which injects window.Android).
  const [inApp, setInApp] = createSignal(false);

  const unresolvedCount = () =>
    (results() ?? []).filter((r) => r.source === "none").length;

  const isPicked = (r: AisleResult) => picked().includes(rowKey(r));

  // Prefer the scraped title; fall back to the cart name, then the raw URL.
  const titleFor = (r: AisleResult) => r.title ?? nameById()[r.product_id ?? ""] ?? r.url;

  // Drive the native shell's overlay (bouncing logo) around a resolve. No-ops in a browser.
  const showNativeOverlay = () => (window as any).Android?.showOverlay?.();
  const hideNativeOverlay = () => (window as any).Android?.hideOverlay?.();

  // Unpicked rows grouped by aisle (results() is already aisle-sorted, so we can group
  // consecutively); picked items collect separately at the bottom.
  type AisleGroup = { aisle: string | null; rows: AisleResult[] };
  const unpickedGroups = (): AisleGroup[] => {
    const groups: AisleGroup[] = [];
    for (const r of results() ?? []) {
      if (isPicked(r)) continue;
      const last = groups[groups.length - 1];
      if (last && last.aisle === r.aisle) last.rows.push(r);
      else groups.push({ aisle: r.aisle, rows: [r] });
    }
    return groups;
  };
  const pickedItems = () => (results() ?? []).filter(isPicked);
  const pickedCount = () => pickedItems().length;

  function togglePicked(key: string) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Persist inputs, results, and shopping progress across reloads.
  createEffect(() => localStorage.setItem(LS_STORE, JSON.stringify(store())));
  createEffect(() => localStorage.setItem(LS_URLS, JSON.stringify(urlsText())));
  createEffect(() => localStorage.setItem(LS_RESULTS, JSON.stringify(results())));
  createEffect(() => localStorage.setItem(LS_QTY, JSON.stringify(qtyById())));
  createEffect(() => localStorage.setItem(LS_NAMES, JSON.stringify(nameById())));
  createEffect(() => localStorage.setItem(LS_PICKED, JSON.stringify(picked())));

  async function runResolve(
    storeVal: string,
    urls: string[],
    qty: Record<string, number> = {},
    names: Record<string, string> = {},
  ) {
    setError(null);
    if (urls.length === 0) {
      setError("Add at least one product URL.");
      hideNativeOverlay();
      return;
    }
    setLoading(true);
    showNativeOverlay();
    try {
      const res = await resolve(storeVal.trim(), urls);
      setQtyById(qty);
      setNameById(names);
      setResults(res.results);
      setScraperStatus(res.scraper);
      setPicked([]); // a fresh list is a fresh shopping trip
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      hideNativeOverlay();
    }
  }

  function findAisles(e: Event) {
    e.preventDefault();
    const urls = urlsText()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    runResolve(store(), urls);
  }

  // The Android shell delivers an imported Meijer cart through this hook. Payload is
  //   {"store":"245","items":[{"url":"...","quantity":2,"name":"..."}]}
  // (legacy `qty` key and {"store","urls":[...]} are still accepted).
  onMount(() => {
    (window as any).__deliverCart = (payloadJson: string) => {
      try {
        const parsed = JSON.parse(payloadJson) as {
          store: string;
          items?: { url: string; quantity?: number; qty?: number; name?: string }[];
          urls?: string[];
        };
        const items: { url: string; quantity?: number; qty?: number; name?: string }[] =
          parsed.items ?? (parsed.urls ?? []).map((url) => ({ url }));
        if (items.length === 0) {
          setError("Your Meijer cart looks empty — add items and import again.");
          hideNativeOverlay();
          return;
        }
        const urls = items.map((i) => i.url);
        const qty: Record<string, number> = {};
        const names: Record<string, string> = {};
        for (const it of items) {
          const pid = productIdFromUrl(it.url);
          if (!pid) continue;
          qty[pid] = it.quantity ?? it.qty ?? 1;
          if (it.name) names[pid] = it.name;
        }
        setStore(parsed.store);
        setUrlsText(urls.join("\n"));
        runResolve(parsed.store, urls, qty, names);
      } catch {
        setError("Couldn't read the imported cart.");
        hideNativeOverlay();
      }
    };
    setInApp(typeof (window as any).Android?.startCartImport === "function");
  });

  const Row = (props: { r: AisleResult }) => {
    const r = props.r;
    const key = rowKey(r);
    const qty = () => qtyById()[r.product_id ?? ""] ?? 1;
    return (
      <li
        classList={{ row: true, unresolved: r.aisle === null, picked: isPicked(r) }}
        onClick={() => togglePicked(key)}
      >
        <input
          type="checkbox"
          class="check"
          checked={isPicked(r)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => togglePicked(key)}
        />
        <div class="loc">
          <Show when={r.section}>
            <span class="section">Sec {r.section}</span>
          </Show>
        </div>
        <div class="meta">
          <span class="title">
            {titleFor(r)}
            <Show when={qty() > 1}>
              <span class="qty">×{qty()}</span>
            </Show>
          </span>
          <Show when={r.fetched_at}>
            <span class="age">
              {r.source === "cache" ? "cached" : "fresh"} · {ageLabel(r.fetched_at)}
            </span>
          </Show>
        </div>
      </li>
    );
  };

  return (
    <div class="app">
          <header>
              <img src="/weijer.svg" alt="Weijer Logo" />
              <h1>Meijer Aisle Finder</h1>
              <Show when={!inApp()}>
                <p class="sub">Paste product URLs, get an aisle-sorted shopping list.</p>
              </Show>
              <Show when={inApp()}>
                <p class="sub">Clicky the button</p>
              </Show>
      </header>

      <Show when={inApp()}>
        <button
          type="button"
          class="import"
          disabled={loading()}
          onClick={() => (window as any).Android.startCartImport()}
        >
          Import my Meijer cart
        </button>
      </Show>

      <Show when={!inApp()}>
        <form onSubmit={findAisles}>
          <label class="field">
            <span>Store ID</span>
            <input
              type="text"
              inputmode="numeric"
              value={store()}
              onInput={(e) => setStore(e.currentTarget.value)}
              placeholder="245"
            />
          </label>

          <label class="field">
            <span>Product URLs (one per line)</span>
            <textarea
              rows="6"
              value={urlsText()}
              onInput={(e) => setUrlsText(e.currentTarget.value)}
              placeholder="https://www.meijer.com/shopping/product/.../19101100127.html"
            />
          </label>

          <button type="submit" disabled={loading()}>
            {loading() ? "Fetching locations…" : "Find aisles (or get the app instead!)"}
          </button>

        </form>
      </Show>


      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <Show when={scraperStatus() === "unavailable" && unresolvedCount() > 0}>
        <p class="notice">
          Scraper is offline — {unresolvedCount()}{" "}
          {unresolvedCount() === 1 ? "item" : "items"} couldn't be located this time.
          Cached results are still shown.
        </p>
      </Show>

      <Show when={(results()?.length ?? 0) > 0}>
        <p class="progress">
          {pickedCount()} of {results()!.length} picked
        </p>
        <ul class="results">
          <For each={unpickedGroups()}>
            {(group) => (
              <>
                <li class="aisle-header">
                  {group.aisle ? `Aisle ${group.aisle}` : "Location unknown"}
                </li>
                <For each={group.rows}>{(r) => <Row r={r} />}</For>
              </>
            )}
          </For>
          <Show when={pickedItems().length > 0}>
            <li class="aisle-header picked-header">Picked ({pickedItems().length})</li>
            <For each={pickedItems()}>{(r) => <Row r={r} />}</For>
          </Show>
        </ul>
        <button type="button" class="reset" onClick={() => setPicked([])}>
          Reset picked
        </button>
      </Show>

      <Show when={loading()}>
        <div class="overlay">
          <div class="spinner" />
          <p>Fetching locations…</p>
        </div>
      </Show>
    </div>
  );
}
