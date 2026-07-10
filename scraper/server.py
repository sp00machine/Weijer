#!/usr/bin/env python3
"""HTTP wrapper around aisle_finder.scrape().

Runs on a residential machine (see README): the Bun server on the VPS calls
POST /scrape here over the tailnet for cache misses. Must run headful under
xvfb — see repo CLAUDE.md for the Akamai constraints.
"""

import threading

from fastapi import FastAPI
from pydantic import BaseModel

from aisle_finder import scrape

app = FastAPI()

# One browser at a time: overlapping /scrape calls would each launch a full
# Chromium and hammer Meijer in parallel — serialize them instead.
_scrape_lock = threading.Lock()


class ScrapeRequest(BaseModel):
    store: str
    urls: list[str]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape")
def scrape_endpoint(req: ScrapeRequest):
    # Sync endpoint on purpose: FastAPI runs it in a worker thread, and
    # sync_playwright must not run on the event loop.
    with _scrape_lock:
        rows = scrape(req.urls, req.store)
    return {"rows": rows}
