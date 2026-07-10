#!/usr/bin/env python3
"""Generate placeholder PWA icons (no third-party deps).

Draws a brand-blue rounded-ish square with a lighter centered bar, purely so the
manifest has valid installable PNGs. Swap for a real icon later.
"""
import struct
import zlib
from pathlib import Path

BRAND = (12, 96, 165)      # #0c60a5
ACCENT = (255, 255, 255)

OUT = Path(__file__).resolve().parent.parent / "public"


def make_png(size: int) -> bytes:
    # RGBA pixel buffer.
    px = bytearray()
    m = size // 8  # margin for a centered accent bar
    for y in range(size):
        px.append(0)  # PNG filter type 0 per scanline
        for x in range(size):
            in_bar = (m * 3 <= x < size - m * 3) and (size * 0.44 <= y < size * 0.56)
            r, g, b = ACCENT if in_bar else BRAND
            px.extend((r, g, b, 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(px), 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = OUT / f"pwa-{size}x{size}.png"
        path.write_bytes(make_png(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
