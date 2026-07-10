#!/usr/bin/env python3
"""Verification helper: drive the local PWA end-to-end and screenshot the result.

Headless is fine here — we're hitting localhost, not Meijer (no Akamai).
"""
import sys

from playwright.sync_api import sync_playwright

APP = "http://localhost:3000/"
URLS = [
    "https://www.meijer.com/shopping/product/just-egg-plant-based-egg-16-oz-/19101100127.html",
    "https://www.meijer.com/shopping/product/meijer-white-distilled-vinegar-64-oz/4125096470.html",
]
SHOT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui.png"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 420, "height": 860})
        page.goto(APP, wait_until="networkidle")

        page.fill("input[type=text]", "245")
        page.fill("textarea", "\n".join(URLS))
        page.click("button[type=submit]")

        # Wait for result rows to render.
        page.wait_for_selector("ul.results li.row", timeout=30000)
        rows = page.locator("ul.results li.row").all_inner_texts()
        print("RENDERED ROWS:")
        for r in rows:
            print("  |", " / ".join(line.strip() for line in r.splitlines() if line.strip()))

        page.screenshot(path=SHOT, full_page=True)
        print(f"screenshot: {SHOT}")

        # Reload and confirm persistence from localStorage.
        page.reload(wait_until="networkidle")
        persisted_store = page.input_value("input[type=text]")
        persisted_rows = page.locator("ul.results li.row").count()
        print(f"AFTER RELOAD: store={persisted_store!r}, result rows present={persisted_rows}")

        browser.close()


if __name__ == "__main__":
    main()
