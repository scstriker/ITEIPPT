"""Crop raw screenshots and draw numbered annotation boxes from shots/meta.json.

    python manual/capture/annotate.py            # all shots
    python manual/capture/annotate.py fw-preset  # selected shots

Boxes and badges are drawn here, so changing the style never needs a re-capture.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SHOTS = Path(__file__).resolve().parents[1] / 'shots'
META = SHOTS / 'meta.json'
FINAL = SHOTS / 'final'

RED = (200, 16, 46)
MAX_WIDTH = 2000
MAX_BYTES = 700 * 1024
FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 30)


def badge(draw: ImageDraw.ImageDraw, text: str, x: float, y: float) -> None:
    size = 40
    draw.rounded_rectangle((x, y, x + size, y + size), radius=8, fill=RED)
    w = draw.textlength(text, font=FONT)
    draw.text((x + (size - w) / 2, y + 3), text, font=FONT, fill='white')


def process(name: str, item: dict) -> Path:
    raw = Image.open(SHOTS / item['raw']).convert('RGB')
    scale = item['dpr']
    cx, cy, cw, ch = item['crop']
    left, top = int(cx * scale), int(cy * scale)
    right = min(raw.width, int((cx + cw) * scale))
    bottom = min(raw.height, int((cy + ch) * scale))
    image = raw.crop((left, top, right, bottom))
    draw = ImageDraw.Draw(image)
    width = image.width
    placed: list[tuple[float, float]] = []

    for index, (mx, my, mw, mh) in enumerate(item['marks'], start=1):
        pad = 4 * scale
        x0 = mx * scale - left - pad
        y0 = my * scale - top - pad
        x1 = (mx + mw) * scale - left + pad
        y1 = (my + mh) * scale - top + pad
        x0, y0 = max(2, x0), max(2, y0)
        x1, y1 = min(image.width - 3, x1), min(image.height - 3, y1)
        draw.rounded_rectangle((x0, y0, x1, y1), radius=6 * scale, outline=RED, width=3 * scale)
        size = 40
        # Badge outside the box: left if there is room, else right, else inside the top-right corner.
        if x0 - size - 6 >= 0:
            bx = x0 - size - 6
        elif x1 + 6 + size <= width:
            bx = x1 + 6
        else:
            bx = x1 - size - 4
        by = max(0, min(y0, image.height - size))
        # Keep badges apart: slide down past any badge already placed here.
        while any(abs(bx - px) < size + 4 and abs(by - py) < size + 4 for px, py in placed):
            by += size + 6
        placed.append((bx, by))
        badge(draw, str(index), bx, by)

    if image.width > MAX_WIDTH:
        ratio = MAX_WIDTH / image.width
        image = image.resize((MAX_WIDTH, round(image.height * ratio)), Image.LANCZOS)
    FINAL.mkdir(parents=True, exist_ok=True)
    out = FINAL / f'{name}.png'
    image.save(out, optimize=True)
    if out.stat().st_size > MAX_BYTES:
        image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
    return out


# Figures built from several annotated shots, stacked top to bottom.
COMPOSITES = {
    'upload-errors': ['upload-error-format', 'upload-error-empty'],
    'gen-stale-nav': ['gen-stale', 'nav-blocked'],
}


def stack(name: str, parts: list[str], gap: int = 24) -> Path:
    images = [Image.open(FINAL / f'{part}.png').convert('RGB') for part in parts]
    width = max(image.width for image in images)
    height = sum(image.height for image in images) + gap * (len(images) - 1)
    canvas = Image.new('RGB', (width, height), 'white')
    y = 0
    for image in images:
        canvas.paste(image, (0, y))
        y += image.height + gap
    out = FINAL / f'{name}.png'
    canvas.save(out, optimize=True)
    return out


if __name__ == '__main__':
    meta = json.loads(META.read_text(encoding='utf-8'))
    names = sys.argv[1:] or list(meta)
    for name in names:
        out = process(name, meta[name])
        size = Image.open(out).size
        print(f'{name}: {size[0]}x{size[1]} {out.stat().st_size // 1024} KB')
    for name, parts in COMPOSITES.items():
        if all((FINAL / f'{part}.png').exists() for part in parts):
            print(f'{name}: stacked from {", ".join(parts)} -> {stack(name, parts).name}')
