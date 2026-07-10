#!/usr/bin/env python3
"""Given Meijer product page URLs, look up each item's in-store aisle/section.

Human table by default; pass --json for machine-readable output (consumed by the
Bun server). Progress goes to stderr so stdout stays clean for --json.
"""

import argparse
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

AISLE_SELECTOR = ".stock-instore-link__aisleInfo"
TITLE_SELECTOR = "h1:visible"

AISLE_RE = re.compile(r"Aisle\s+(\S+)\s*\|\s*(\d+)")
SECTION_RE = re.compile(r"Section\s+(\d+)")
PRODUCT_ID_RE = re.compile(r"/(\d+)\.html")

GOTO_ATTEMPTS = 3
GOTO_BACKOFF_SEC = 2


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def product_id_from_url(url: str) -> str | None:
    m = PRODUCT_ID_RE.search(url)
    return m.group(1) if m else None


def goto_with_retry(page, url: str):
    last_err = None
    for attempt in range(1, GOTO_ATTEMPTS + 1):
        try:
            page.goto(url, wait_until="domcontentloaded")
            return
        except Exception as e:
            last_err = e
            log(f"  goto attempt {attempt}/{GOTO_ATTEMPTS} failed: {str(e).splitlines()[0]}")
            if attempt < GOTO_ATTEMPTS:
                time.sleep(GOTO_BACKOFF_SEC * attempt)
    raise last_err


def lookup(page, url: str) -> dict:
    result = {
        "url": url,
        "product_id": product_id_from_url(url),
        "title": None,
        "aisle": None,
        "section": None,
        "store": None,
        "fetched_at": int(time.time()),
    }

    goto_with_retry(page, url)

    try:
        page.wait_for_selector(AISLE_SELECTOR, timeout=20000)
        text = page.locator(AISLE_SELECTOR).inner_text()

        aisle_match = AISLE_RE.search(text)
        if aisle_match:
            result["aisle"] = f"{aisle_match.group(1)} | {aisle_match.group(2)}"

        section_match = SECTION_RE.search(text)
        if section_match:
            result["section"] = section_match.group(1)
    except Exception as e:
        result["error"] = str(e).splitlines()[0]

    try:
        store_text = page.locator(".stock-instore-link__storeName span").inner_text()
        result["store"] = store_text.strip()
    except Exception:
        pass

    try:
        result["title"] = page.locator(TITLE_SELECTOR).first.inner_text().strip()
    except Exception:
        pass

    return result


def scrape(urls: list[str], store_id: str | None) -> list[dict]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )

        if store_id:
            context.add_cookies([{
                "name": "meijer-store",
                "value": store_id,
                "domain": ".meijer.com",
                "path": "/",
            }])

        page = context.new_page()

        results = []
        for url in urls:
            log(f"Looking up: {url}")
            results.append(lookup(page, url))
            time.sleep(1)

        browser.close()

    return results


def print_table(results: list[dict]):
    ordered = sorted(results, key=lambda r: (r["aisle"] or "zzz", r["section"] or "zzz"))
    print(f"\n{'Aisle':<12}{'Section':<10}{'Store':<20}Product")
    print("-" * 75)
    for r in ordered:
        aisle = r["aisle"] or "?"
        section = r["section"] or "?"
        store = r["store"] or "?"
        title = r["title"] or r["url"]
        print(f"{aisle:<12}{section:<10}{store:<20}{title}")


def main(urls: list[str], store_id: str | None, as_json: bool, out_path: str | None):
    results = scrape(urls, store_id)
    if out_path:
        # Robust path for the server: write JSON to a file, immune to any stray
        # stdout from xvfb-run / Chromium (xvfb-run merges child stderr into stdout).
        with open(out_path, "w") as f:
            json.dump(results, f)
    elif as_json:
        json.dump(results, sys.stdout)
        sys.stdout.write("\n")
    else:
        print_table(results)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("urls", nargs="+", help="Meijer product page URLs")
    parser.add_argument("--store", help="Store ID to set via the meijer-store cookie (e.g. 245 for Hartland)")
    parser.add_argument("--json", action="store_true", help="Emit JSON to stdout instead of a table")
    parser.add_argument("--out", help="Write JSON results to this file (preferred for programmatic use)")
    args = parser.parse_args()
    main(args.urls, args.store, args.json, args.out)
