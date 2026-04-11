"""
Auto colour correction using Pillow.

Given the path to an uploaded photo, applies:
  1. Auto-contrast (histogram stretch, 0.5 % cutoff each end)
  2. Slight saturation boost (+20 %)
  3. Sharpening  (+10 %)

Saves the result as  <original_stem>_auto.<ext>  alongside the original and
returns the absolute path to the new file.
"""

from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps


def auto_correct_image(image_path: str) -> str:
    src = Path(image_path)
    dest = src.with_name(src.stem + "_auto" + src.suffix)

    with Image.open(src) as img:
        # Apply EXIF orientation first so the image is physically rotated
        # to match what the camera intended. Without this, photos shot in
        # portrait mode on phones (which store rotation in EXIF tag 0x0112)
        # come back rotated 90° after the save strips the EXIF data.
        img = ImageOps.exif_transpose(img)

        # Work in RGB so all operations are consistent
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        # 1. Auto-contrast — stretches histogram, 0.5 % clip each tail
        img = ImageOps.autocontrast(img, cutoff=0.5)

        # 2. Saturation boost
        img = ImageEnhance.Color(img).enhance(1.20)

        # 3. Sharpness
        img = ImageEnhance.Sharpness(img).enhance(1.15)

        img.save(dest, quality=95)

    return str(dest)
