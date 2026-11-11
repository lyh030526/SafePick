"""SafePick app icons: a white shield with a teal check on the brand teal, matching the in-app logo."""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parent.parent / "assets"
PREVIEW = Path(__file__).resolve().parent.parent.parent.parent / "icons-preview.png"
TEAL, TEAL_DARK, TEAL_LIGHT = (13, 138, 114), (8, 98, 82), (24, 166, 136)
S = 4  # supersampling


def bezier(p0, p1, p2, p3, n=60):
    return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
             (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
            for t in (i / n for i in range(n + 1))]


def shield_points(cx, cy, w, h):
    """A shield: a gently dipping top edge, straight-ish sides, curving to a point at the bottom."""
    x0, x1, top, bottom = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    shoulder = top + h * 0.10
    pts = bezier((x0, shoulder), (cx - w * 0.22, shoulder - h * 0.02), (cx - w * 0.10, top), (cx, top))
    pts += bezier((cx, top), (cx + w * 0.10, top), (cx + w * 0.22, shoulder - h * 0.02), (x1, shoulder))[1:]
    pts += bezier((x1, shoulder), (x1, top + h * 0.55), (cx + w * 0.30, bottom - h * 0.12), (cx, bottom))[1:]
    pts += bezier((cx, bottom), (cx - w * 0.30, bottom - h * 0.12), (x0, top + h * 0.55), (x0, shoulder))[1:]
    return pts


def check(draw, cx, cy, size, width, fill):
    a = (cx - size * 0.42, cy + size * 0.02)
    b = (cx - size * 0.10, cy + size * 0.32)
    c = (cx + size * 0.45, cy - size * 0.30)
    draw.line([a, b, c], fill=fill, width=int(width), joint="curve")
    for x, y in (a, c):
        r = width / 2
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def gradient(size):
    """Diagonal teal gradient, lighter at the top left."""
    base = Image.new("RGB", (size, size), TEAL)
    px = base.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            c0, c1 = (TEAL_LIGHT, TEAL) if t < 0.5 else (TEAL, TEAL_DARK)
            u = t * 2 if t < 0.5 else (t - 0.5) * 2
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
    return base


def mark(size, scale, *, shadow=True, mono=False):
    """The shield mark on a transparent canvas; `scale` is the shield height as a share of the canvas."""
    big = size * S
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    h = big * scale
    w = h * 0.84
    cx, cy = big / 2, big / 2 + h * 0.02
    pts = shield_points(cx, cy, w, h)
    if shadow and not mono:
        shade = Image.new("L", (big, big), 0)
        ImageDraw.Draw(shade).polygon([(x, y + h * 0.035) for x, y in pts], fill=90)
        shade = shade.filter(ImageFilter.GaussianBlur(h * 0.04))
        layer.paste(Image.new("RGBA", (big, big), (4, 50, 42, 255)), (0, 0), shade)
    body = Image.new("L", (big, big), 0)
    ImageDraw.Draw(body).polygon(pts, fill=255)
    tick = Image.new("L", (big, big), 0)
    check(ImageDraw.Draw(tick), cx, cy - h * 0.03, w * 0.62, w * 0.13, 255)
    if mono:
        # One colour: the shield with the check cut out.
        alpha = ImageChops.subtract(body, tick)
        layer = Image.new("RGBA", (big, big), (255, 255, 255, 0))
        layer.putalpha(alpha)
    else:
        layer.paste(Image.new("RGBA", (big, big), (255, 255, 255, 255)), (0, 0), body)
        layer.paste(Image.new("RGBA", (big, big), (*TEAL, 255)), (0, 0), tick)
    return layer.resize((size, size), Image.LANCZOS)


def full_icon(size, scale):
    icon = gradient(size).convert("RGBA")
    icon.alpha_composite(mark(size, scale))
    return icon


# iOS and the store icon: full bleed (the system rounds the corners).
full_icon(1024, 0.58).convert("RGB").save(ASSETS / "icon.png")
# Android adaptive icon: the mark inside the 66% safe zone over a teal background layer.
mark(1024, 0.44).save(ASSETS / "android-icon-foreground.png")
gradient(1024).save(ASSETS / "android-icon-background.png")
mark(1024, 0.44, mono=True).save(ASSETS / "android-icon-monochrome.png")
# Splash: the white mark on teal, centred by the splash screen on a teal background.
mark(1024, 0.70, shadow=False).save(ASSETS / "splash-icon.png")
full_icon(48, 0.62).save(ASSETS / "favicon.png")
full_icon(512, 0.58).convert("RGB").save(ASSETS / "safepick-icon.png")

# Preview: the store icon, a round and a squircle launcher mask, the monochrome mark, and the splash.
prev = Image.new("RGBA", (1500, 320), (244, 247, 246, 255))
store = full_icon(1024, 0.58).resize((260, 260), Image.LANCZOS)
prev.alpha_composite(store, (20, 30))
adaptive = gradient(1024).convert("RGBA")
adaptive.alpha_composite(mark(1024, 0.44))
for i, radius in enumerate((130, 70)):
    m = Image.new("L", (260, 260), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, 259, 259], radius=radius, fill=255)
    tile = adaptive.resize((260, 260), Image.LANCZOS)
    tile.putalpha(m)
    prev.alpha_composite(tile, (320 + i * 300, 30))
mono = Image.new("RGBA", (260, 260), (40, 40, 40, 255))
mono.alpha_composite(mark(1024, 0.44, mono=True).resize((260, 260), Image.LANCZOS))
prev.alpha_composite(mono, (920, 30))
splash = Image.new("RGBA", (260, 260), (*TEAL, 255))
splash.alpha_composite(mark(1024, 0.70, shadow=False).resize((150, 150), Image.LANCZOS), (55, 55))
prev.alpha_composite(splash, (1220, 30))
prev.save(PREVIEW)
print("ok")
