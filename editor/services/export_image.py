"""
High-resolution export of a Composition.

Reconstructs the final image at native canvas dimensions using Pillow by
reading the Fabric.js canvas JSON stored in the Composition record.

Object types handled:
  - "image"   → slot photo  (scaled, rotated, clipped to slot bounds)
  - "i-text" / "text" → text overlay (font, color, shadow, stroke)
  - frame overlay PNG (composited last, on top)
"""

import math
import os
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageDraw, ImageFont


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def render_composition(composition) -> str:
    """
    Render the composition to a PNG and return its absolute path.
    """
    frame_config = composition.frame_config
    native_w = frame_config.canvas_width
    native_h = frame_config.canvas_height

    canvas_json = composition.canvas_json
    objects = canvas_json.get("objects", [])

    # Display dimensions stored by the JS side (fallback: native)
    display_w = canvas_json.get("display_width", native_w)
    scale = native_w / display_w if display_w else 1.0

    # Base: white RGBA canvas
    base = Image.new("RGBA", (native_w, native_h), (255, 255, 255, 255))

    # Draw objects in order (bottom → top)
    for obj in objects:
        obj_type = obj.get("type", "")
        obj_data = obj.get("data", {}) or {}

        if obj_type == "image" and obj_data.get("type") == "slot-image":
            _paste_slot_image(base, obj, scale, frame_config)

        elif obj_type in ("i-text", "text") and obj_data.get("type") == "text-overlay":
            _draw_text(base, obj, scale)

    # Frame overlay on top
    if frame_config.overlay_image:
        overlay_path = Path(settings.MEDIA_ROOT) / frame_config.overlay_image.name
        if overlay_path.exists():
            with Image.open(overlay_path).convert("RGBA") as overlay:
                overlay = overlay.resize((native_w, native_h), Image.LANCZOS)
                base = Image.alpha_composite(base, overlay)

    # Convert to RGB for final PNG save (lossless, no compression)
    final = base.convert("RGB")

    export_dir = Path(settings.MEDIA_ROOT) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    out_path = export_dir / f"{composition.id}.png"
    final.save(str(out_path), "PNG", compress_level=0)  # 0 = no compression, fastest

    return str(out_path)


# ─────────────────────────────────────────────────────────────────────────────
# Image slot rendering
# ─────────────────────────────────────────────────────────────────────────────

def _paste_slot_image(base: Image.Image, obj: dict, scale: float, frame_config) -> None:
    src_url = obj.get("src", "")
    if not src_url:
        return

    # Resolve to a local path
    image_path = _url_to_path(src_url)
    if not image_path or not os.path.exists(image_path):
        return

    # Clip rectangle from object's clipPath
    clip = obj.get("clipPath")
    if clip:
        cx = round(clip.get("left", 0) * scale)
        cy = round(clip.get("top", 0) * scale)
        cw = round(clip.get("width", base.width) * scale)
        ch = round(clip.get("height", base.height) * scale)
        cr = round(clip.get("rx", 0) * scale)
    else:
        slot_data = _find_slot(frame_config, obj.get("data", {}).get("slotIndex", 0))
        cx = slot_data.get("x", 0)
        cy = slot_data.get("y", 0)
        cw = slot_data.get("w", base.width)
        ch = slot_data.get("h", base.height)
        cr = slot_data.get("radius", 0)

    with Image.open(image_path).convert("RGBA") as photo:
        # Apply scale & rotation from Fabric object
        scale_x = obj.get("scaleX", 1) * scale
        scale_y = obj.get("scaleY", 1) * scale
        angle = obj.get("angle", 0)
        opacity = round(obj.get("opacity", 1) * 255)

        new_w = max(1, round(photo.width * scale_x))
        new_h = max(1, round(photo.height * scale_y))
        photo = photo.resize((new_w, new_h), Image.LANCZOS)

        if angle:
            photo = photo.rotate(-angle, expand=True, resample=Image.BICUBIC)

        # Center position in native coords
        cx_center = round(obj.get("left", cx + cw / 2) * scale)
        cy_center = round(obj.get("top", cy + ch / 2) * scale)
        paste_x = cx_center - photo.width // 2
        paste_y = cy_center - photo.height // 2

        # Create rounded-corner clip mask
        mask = Image.new("L", (cw, ch), 0)
        draw = ImageDraw.Draw(mask)
        if cr > 0:
            draw.rounded_rectangle([(0, 0), (cw - 1, ch - 1)], radius=cr, fill=255)
        else:
            draw.rectangle([(0, 0), (cw - 1, ch - 1)], fill=255)

        # Crop the photo to the slot region
        # Offset from clip top-left to photo top-left
        rel_x = paste_x - cx
        rel_y = paste_y - cy
        crop_left = max(0, math.floor(-rel_x))
        crop_top = max(0, math.floor(-rel_y))
        crop_right = min(photo.width, math.ceil(-rel_x + cw))
        crop_bottom = min(photo.height, math.ceil(-rel_y + ch))
        if crop_right <= crop_left or crop_bottom <= crop_top:
            return

        cropped = photo.crop((crop_left, crop_top, crop_right, crop_bottom))
        if cropped.size != (cw, ch):
            cropped = cropped.resize((cw, ch), Image.LANCZOS)

        # Apply opacity to alpha
        if opacity < 255:
            r, g, b, a = cropped.split()
            a = a.point(lambda v: round(v * opacity / 255))
            cropped = Image.merge("RGBA", (r, g, b, a))

        # Composite onto base with rounded mask
        region = base.crop((cx, cy, cx + cw, cy + ch))
        region = Image.composite(cropped, region, mask)
        base.paste(region, (cx, cy))

def _find_slot(frame_config, slot_index: int) -> dict:
    for s in frame_config.slots:
        if s.get("index") == slot_index:
            return s
    return {"x": 0, "y": 0, "w": frame_config.canvas_width, "h": frame_config.canvas_height, "radius": 0}


# ─────────────────────────────────────────────────────────────────────────────
# Text rendering
# ─────────────────────────────────────────────────────────────────────────────

def _draw_text(base: Image.Image, obj: dict, scale: float) -> None:
    draw = ImageDraw.Draw(base, "RGBA")

    text = obj.get("text", "")
    if not text:
        return

    font_size = max(8, round(obj.get("fontSize", 36) * scale))
    fill = _hex_to_rgba(obj.get("fill", "#FFFFFF"), obj.get("opacity", 1))
    font_family = obj.get("fontFamily", "Arial")
    bold = obj.get("fontWeight", "") == "bold"
    italic = obj.get("fontStyle", "") == "italic"

    font = _load_font(font_family, font_size, bold, italic)

    x = round(obj.get("left", 0) * scale)
    y = round(obj.get("top", 0) * scale)

    # Shadow
    shadow = obj.get("shadow")
    if shadow and isinstance(shadow, dict):
        sx = x + round(shadow.get("offsetX", 2) * scale)
        sy = y + round(shadow.get("offsetY", 2) * scale)
        shadow_color = _hex_to_rgba(shadow.get("color", "#000000"), 0.5)
        draw.text((sx, sy), text, font=font, fill=shadow_color)

    # Stroke
    stroke_w = round(obj.get("strokeWidth", 0) * scale)
    if stroke_w > 0:
        stroke_color = _hex_to_rgba(obj.get("stroke", "#000000"), 1)
        for dx in range(-stroke_w, stroke_w + 1):
            for dy in range(-stroke_w, stroke_w + 1):
                if abs(dx) == stroke_w or abs(dy) == stroke_w:
                    draw.text((x + dx, y + dy), text, font=font, fill=stroke_color)

    # Main text
    draw.text((x, y), text, font=font, fill=fill)


def _load_font(family: str, size: int, bold: bool, italic: bool) -> ImageFont.ImageFont:
    # Try bundled fonts first, then system fallback
    font_dir = Path(settings.BASE_DIR) / "static" / "fonts"
    candidates = []
    if bold and italic:
        candidates = [f"{family}-BoldItalic.ttf", f"{family}-Bold.ttf"]
    elif bold:
        candidates = [f"{family}-Bold.ttf", f"{family}.ttf"]
    elif italic:
        candidates = [f"{family}-Italic.ttf", f"{family}.ttf"]
    else:
        candidates = [f"{family}-Regular.ttf", f"{family}.ttf"]

    for name in candidates:
        path = font_dir / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:
                continue

    # Fallback: Pillow default
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────

def _url_to_path(url: str) -> str | None:
    """Convert a /media/... URL to an absolute filesystem path."""
    from django.conf import settings as s
    media_url = s.MEDIA_URL.rstrip("/")
    if url.startswith(media_url):
        rel = url[len(media_url):].lstrip("/")
        return str(Path(s.MEDIA_ROOT) / rel)
    # Already an absolute path?
    if os.path.isabs(url):
        return url
    return None


def _hex_to_rgba(color: str, opacity: float = 1.0) -> tuple:
    """Convert hex / rgb string + opacity to an RGBA tuple."""
    opacity = max(0.0, min(1.0, float(opacity)))
    a = round(opacity * 255)
    color = (color or "#FFFFFF").strip()
    if color.startswith("#"):
        color = color.lstrip("#")
        if len(color) == 3:
            color = "".join(c * 2 for c in color)
        r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
        return (r, g, b, a)
    if color.startswith("rgb"):
        parts = color.replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",")
        r, g, b = int(parts[0]), int(parts[1]), int(parts[2])
        return (r, g, b, a)
    return (255, 255, 255, a)
