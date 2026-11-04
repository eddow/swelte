#!/usr/bin/env python3
"""Build the Swelte brand assets in assets/ from the official Svelte and V logos.

Both source marks are used as-is (path data unmodified). The Svelte "S" is nested in
the valley of the "V", separated by a transparent moat so the mark reads on any
background.

Usage:
    curl -o /tmp/svelte-logo.svg https://raw.githubusercontent.com/sveltejs/branding/master/svelte-logo.svg
    curl -o /tmp/v-logo.svg https://raw.githubusercontent.com/vlang/v/master/examples/veb/veb_assets/assets/v-logo.svg
    python3 scripts/build-brand-assets.py

Override the source locations with SVELTE_LOGO=... and V_LOGO=... if needed.
"""

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets"

SVELTE_SRC = Path(os.environ.get("SVELTE_LOGO", "/tmp/svelte-logo.svg"))
V_SRC = Path(os.environ.get("V_LOGO", "/tmp/v-logo.svg"))

VIEW = 512

# Tight glyph bounds inside each source artboard, measured from the rendered paths.
S_BOX = (6.9030849536, 8.0000161024, 93.1939228416, 111.9999917056)  # Svelte, 107x128
V_BOX = (19.9995003, 20.0000076, 461.0004997, 459.9999924)  # V, 500x500

# Svelte geometry inside the 512x512 frame; the V fills the frame.
S_MAIN = dict(sx=178, sy=155, sw=164, sh=197, gap=26)
S_TILE = dict(sx=214, sy=196, sw=150, sh=180, gap=24)


def load_sources():
    for path in (SVELTE_SRC, V_SRC):
        if not path.exists():
            sys.exit(f"missing source logo: {path} (see the module docstring)")
    svelte = SVELTE_SRC.read_text()
    vlogo = V_SRC.read_text()
    # Svelte mark = orange ribbon + white flash drawn on top of it.
    s_body, s_flash = re.findall(r'<path d="([^"]+)"', svelte)
    # V mark = two mirrored arms.
    arms = re.findall(r'<path fill="#[0-9a-fA-F]{6}" d="([^"]+)"', vlogo)
    if len(arms) != 2:
        sys.exit("unexpected V logo markup: expected exactly two filled paths")
    return s_body, s_flash, arms[0], arms[1]


S_BODY, S_FLASH, V_DARK, V_LIGHT = load_sources()


def place(box, x, y, w, h):
    """Fit `box` into (x, y, w, h), preserving aspect ratio (object-fit: contain)."""
    bx, by, bw, bh = box
    s = min(w / bw, h / bh)
    return (
        f"translate({x + (w - bw * s) / 2 - bx * s:.3f} "
        f"{y + (h - bh * s) / 2 - by * s:.3f}) scale({s:.6f})"
    )


def svelte(x, y, w, h, body, flash):
    return (
        f'<g transform="{place(S_BOX, x, y, w, h)}">'
        f'<path fill="{body}" d="{S_BODY}"/>'
        + (f'<path fill="{flash}" d="{S_FLASH}"/>' if flash else "")
        + "</g>"
    )


def vlang(dark, light):
    return (
        f'<g transform="{place(V_BOX, 4, 4, 504, 504)}">'
        f'<path fill="{dark}" d="{V_DARK}"/>'
        f'<path fill="{light}" d="{V_LIGHT}"/></g>'
    )


def icon(body, flash, dark, light, geo, body_mask=None):
    """V with the Svelte S nested in its valley, separated by a transparent moat."""
    sx, sy, sw, sh, gap = geo["sx"], geo["sy"], geo["sw"], geo["sh"], geo["gap"]
    s_shape = f'<g transform="{place(S_BOX, sx, sy, sw, sh)}"><path fill="#000" d="{S_BODY}"/></g>'
    mask = (
        f'<mask id="swelte-moat" maskUnits="userSpaceOnUse" width="{VIEW}" height="{VIEW}">'
        f'<rect width="{VIEW}" height="{VIEW}" fill="#fff"/>'
        f'<g stroke="#000" stroke-width="{gap}" stroke-linejoin="round">{s_shape}</g>'
        f"</mask>"
    )
    v = vlang(dark, light).replace(
        "<g transform", '<g mask="url(#swelte-moat)" transform'
    )
    mark = svelte(sx, sy, sw, sh, body, flash)
    if body_mask:
        mark = mark.replace(
            f'<path fill="{body}" d="{S_BODY}"/>',
            f'<path fill="{body}" mask="url(#{body_mask})" d="{S_BODY}"/>',
        )
    return f"<defs>{mask}</defs>\n\t{v}\n\t{mark}"


def doc(*parts):
    body = "\n\t".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{VIEW}" height="{VIEW}" '
        f'viewBox="0 0 {VIEW} {VIEW}" role="img" aria-label="Swelte">\n'
        f"\t<title>Swelte</title>\n\t{body}\n</svg>\n"
    )


def primary():
    return doc(icon("#ff3e00", "#ffffff", "#536b8a", "#5d87be", S_MAIN))


def mono():
    # The Svelte flash becomes a real hole so a single colour works on any background.
    flash_hole = (
        f'<mask id="swelte-flash" maskUnits="userSpaceOnUse" width="{VIEW}" height="{VIEW}">'
        f'<rect width="{VIEW}" height="{VIEW}" fill="#fff"/>'
        f'<g transform="{place(S_BOX, S_MAIN["sx"], S_MAIN["sy"], S_MAIN["sw"], S_MAIN["sh"])}">'
        f'<path fill="#000" d="{S_FLASH}"/></g></mask>'
    )
    mark = icon("currentColor", None, "currentColor", "currentColor", S_MAIN, body_mask="swelte-flash")
    return doc(f"<defs>{flash_hole}</defs>", mark)


def tile():
    return doc(
        f'<rect width="{VIEW}" height="{VIEW}" rx="116" fill="#0f1218"/>',
        icon("#ff3e00", "#ffffff", "#8fa8c8", "#6f8dbb", S_TILE),
    )


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "swelte-icon.svg": primary(),
        "swelte-icon-mono.svg": mono(),
        "swelte-icon-tile.svg": tile(),
    }
    for name, content in outputs.items():
        (OUT_DIR / name).write_text(content)
        print(f"wrote assets/{name} ({len(content)} bytes)")


if __name__ == "__main__":
    main()
