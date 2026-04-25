"""
Photoshop-grade image-adaptive colour correction.

Key design decisions
────────────────────
• Underexposed images  → gamma > 1 (lifts shadows far more than highlights,
                         exactly like Lightroom's "Exposure" + "Shadows" lift)
• Overexposed images   → linear brightness pull-down (gamma < 1 would crush
                         already-thin shadow detail)
• Well-exposed images  → only white-balance + gentle vibrance

White balance uses the Shades-of-Gray algorithm (Minkowski p = 6), which is
far more robust than plain Gray World on complex colourful scenes.

Saturation uses a Vibrance-style weighted model: pixels that are already
vivid (S > 0.60) are nearly untouched; dull areas receive the full boost.

Sharpness is measured with the Tenengrad operator (sum of squared Sobel
gradients) — more reliable than plain Laplacian for print-quality images.

All output values are in Fabric.js filter units:
  brightness : −1 … 1    pixel += value × 255
  contrast   : −1 … 1    sigmoid-like stretch around 0.5
  saturation : −1 … 1    −1 = grey, 0 = unchanged, +1 = max boost
  gamma_r/g/b: 0.1 … 2.2  pow(pixel/255, 1/gamma) × 255
                            gamma > 1 → brighter  |  gamma < 1 → darker
"""

import math


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_auto_correct_params(image_path: str) -> dict:
    """
    Analyse *image_path* and return Fabric.js-compatible filter params.
    Falls back gracefully when OpenCV is unavailable.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return _pillow_fallback(image_path)

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        return _mild_preset()

    # ── Downsample to 1000 px on longest edge for fast analysis ──────────────
    h, w = img_bgr.shape[:2]
    scale = min(1000 / max(h, w, 1), 1.0)
    img = (cv2.resize(img_bgr, None, fx=scale, fy=scale,
                      interpolation=cv2.INTER_AREA)
           if scale < 1.0 else img_bgr.copy())

    img_rgb_f = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    img_lab   = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    img_hsv   = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # ── STEP 1: Luminance zone analysis (LAB L, 0–255 in OpenCV) ─────────────
    l_ch = img_lab[:, :, 0].astype(np.float32)

    p05 = float(np.percentile(l_ch, 5))
    p20 = float(np.percentile(l_ch, 20))
    p50 = float(np.percentile(l_ch, 50))   # scene "brightness" key
    p80 = float(np.percentile(l_ch, 80))
    p95 = float(np.percentile(l_ch, 95))

    dyn_range    = p95 - p05
    underexposed = p50 < 95
    overexposed  = p50 > 165
    low_contrast = dyn_range < 110

    TARGET_MEDIAN = 128.0

    # ── STEP 2: Tone correction — strategy depends on exposure state ──────────
    #
    # UNDEREXPOSED  → Gamma > 1
    #   pow(x, 1/2) lifts shadows proportionally more than highlights:
    #   input 20  → 71   (+255 %)
    #   input 128 → 181  ( +41 %)
    #   input 230 → 243  (  +6 %)
    #   This is Lightroom "Exposure + Shadows" behaviour.
    #
    # OVEREXPOSED   → Linear brightness (negative)
    #   Gamma < 1 crushes thin shadow detail; a linear shift preserves it.
    #
    # WELL-EXPOSED  → Only white-balance gammas + minor brightness tweak

    if underexposed:
        # Compute the gamma that maps the current median to TARGET_MEDIAN
        if 1 < p50 < 254:
            # Fabric: median_out = (median_in/255)^(1/gamma) × 255
            # Solve: 1/gamma = log(target/255) / log(p50/255)
            log_ratio = math.log(TARGET_MEDIAN / 255.0) / math.log(p50 / 255.0)
            raw_tone_gamma = 1.0 / log_ratio   # = log(p50/255)/log(target/255)
        else:
            raw_tone_gamma = 2.0

        # Apply at strength proportional to how underexposed the image is
        severity      = max(0.0, (95.0 - p50) / 95.0)   # 0=borderline, 1=very dark
        tone_strength = 0.65 + severity * 0.25
        tone_gamma    = 1.0 + (raw_tone_gamma - 1.0) * tone_strength
        tone_gamma    = float(np.clip(tone_gamma, 1.0, 2.20))  # only brighten

        # Fine-tune brightness for any residual after gamma is clamped
        predicted_mid = (max(p50, 1) / 255.0) ** (1.0 / tone_gamma) * 255.0
        brightness    = float(np.clip((TARGET_MEDIAN - predicted_mid) / 255.0 * 0.55,
                                      -0.10, 0.20))

    elif overexposed:
        # Linear pull-down: preserves whatever shadow detail exists
        tone_gamma = 1.0
        excess     = (p50 - TARGET_MEDIAN) / 255.0
        severity   = max(0.0, (p50 - 165.0) / 90.0)  # 0=borderline, 1=severely blown
        strength   = 0.65 + severity * 0.25
        brightness = float(np.clip(-excess * strength, -0.45, 0.0))

    else:
        # Well-exposed — negligible tone gamma; tiny brightness nudge if off-centre
        tone_gamma = 1.0
        brightness = float(np.clip((TARGET_MEDIAN - p50) / 255.0 * 0.30, -0.08, 0.10))

    # ── STEP 3: Contrast — histogram spread ───────────────────────────────────
    TARGET_RANGE = 195.0
    raw_contrast = (TARGET_RANGE - dyn_range) / (TARGET_RANGE * 2.0)

    if low_contrast:
        c_strength = 0.80
    elif dyn_range > 215:
        c_strength = 0.30     # already wide — gentle reduction only
    else:
        c_strength = 0.28

    contrast = float(np.clip(raw_contrast * c_strength, -0.25, 0.35))

    # ── STEP 4: White balance — Shades of Gray (Minkowski p = 6) ─────────────
    # p = 6 is far more scene-robust than plain Grey World (p = 1).
    max_ch  = img_rgb_f.max(axis=2)
    wb_mask = (max_ch > 0.05) & (max_ch < 0.95)     # exclude clip/black

    if wb_mask.sum() > 300:
        PN = 6.0
        rv = img_rgb_f[:, :, 0][wb_mask].astype(np.float64)
        gv = img_rgb_f[:, :, 1][wb_mask].astype(np.float64)
        bv = img_rgb_f[:, :, 2][wb_mask].astype(np.float64)
        r_m = float(np.mean(rv ** PN) ** (1.0 / PN))
        g_m = float(np.mean(gv ** PN) ** (1.0 / PN))
        b_m = float(np.mean(bv ** PN) ** (1.0 / PN))
    else:
        r_m = float(img_rgb_f[:, :, 0].mean())
        g_m = float(img_rgb_f[:, :, 1].mean())
        b_m = float(img_rgb_f[:, :, 2].mean())

    overall_m = (r_m + g_m + b_m) / 3.0
    wb_r = overall_m / max(r_m, 1e-7)
    wb_g = overall_m / max(g_m, 1e-7)
    wb_b = overall_m / max(b_m, 1e-7)

    # Normalise so WB correction does not shift overall exposure
    peak   = max(wb_r, wb_g, wb_b)
    wb_r  /= peak;  wb_g /= peak;  wb_b /= peak

    # Adaptive strength: bigger colour cast → stronger correction
    cast    = max(abs(1.0 - wb_r), abs(1.0 - wb_g), abs(1.0 - wb_b))
    wb_str  = float(np.clip(0.40 + cast * 1.80, 0.35, 0.90))

    wb_gamma_r = 1.0 + (wb_r - 1.0) * wb_str
    wb_gamma_g = 1.0 + (wb_g - 1.0) * wb_str
    wb_gamma_b = 1.0 + (wb_b - 1.0) * wb_str

    # Combine: sequential gammas multiply  (pow(x,1/A) then pow(·,1/B) = pow(x,1/(A·B)))
    gamma_r = float(np.clip(tone_gamma * wb_gamma_r, 0.40, 2.20))
    gamma_g = float(np.clip(tone_gamma * wb_gamma_g, 0.40, 2.20))
    gamma_b = float(np.clip(tone_gamma * wb_gamma_b, 0.40, 2.20))

    # ── STEP 5: Vibrance-style saturation ─────────────────────────────────────
    # Photoshop Vibrance: vivid pixels are protected; dull pixels get the boost.
    s_ch = img_hsv[:, :, 1].astype(np.float32) / 255.0   # 0–1
    v_ch = img_hsv[:, :, 2].astype(np.float32)
    active = v_ch > 30                                      # skip near-black

    if active.sum() > 100:
        s_active     = s_ch[active]
        mean_s       = float(s_active.mean())
        vivid_frac   = float((s_active > 0.60).mean())   # already-vivid pixels
        muted_frac   = float((s_active < 0.22).mean())   # dull pixels

        TARGET_S = 0.44

        if vivid_frac > 0.50:
            sat_weight = 0.15    # mostly vivid scene (strong garments) — barely touch
        elif muted_frac > 0.55:
            sat_weight = 0.90    # mostly muted — full vibrance boost
        elif muted_frac > 0.35:
            sat_weight = 0.60    # mixed — moderate
        else:
            sat_weight = 0.35    # reasonably saturated — gentle

        saturation = float(np.clip((TARGET_S - mean_s) * sat_weight, -0.25, 0.42))
    else:
        saturation = 0.08

    # ── STEP 6: Sharpness — Tenengrad (Sobel-based, more robust than Laplacian)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    sx   = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sy   = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    # Normalise by number of pixels so resolution doesn't bias the score
    norm_tenengrad = float(np.mean(sx ** 2 + sy ** 2)) / (img.shape[0] * img.shape[1] / 10_000)
    sharpen = norm_tenengrad < 120    # soft image → apply sharpen filter

    return {
        "brightness": round(brightness, 3),
        "contrast":   round(contrast,   3),
        "saturation": round(saturation, 3),
        "gamma_r":    round(gamma_r,    3),
        "gamma_g":    round(gamma_g,    3),
        "gamma_b":    round(gamma_b,    3),
        "sharpen":    sharpen,
        # Neutral defaults for all other filters
        "hue":        0.0,
        "blur":       0,
        "noise":      0,
        "grayscale":  False,
        "sepia":      False,
        "invert":     False,
        "vintage":    False,
        "polaroid":   False,
        "kodachrome": False,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Fallbacks (Pillow-only or unreadable file)
# ─────────────────────────────────────────────────────────────────────────────

def _pillow_fallback(image_path: str) -> dict:
    """Pillow-only fallback when OpenCV is not installed."""
    try:
        from PIL import Image, ImageStat
        with Image.open(image_path).convert("RGB") as img:
            stat = ImageStat.Stat(img)
            r_m, g_m, b_m = stat.mean
            overall = (r_m + g_m + b_m) / 3.0
            lum     = 0.299 * r_m + 0.587 * g_m + 0.114 * b_m

            # Tone
            if lum < 90:
                brightness = round(float(min(0.35, (115 - lum) / 255)), 3)
                tone_gamma = 1.40
            elif lum > 165:
                brightness = round(float(max(-0.35, (140 - lum) / 255)), 3)
                tone_gamma = 1.0
            else:
                brightness = round(float((128 - lum) / 255 * 0.30), 3)
                tone_gamma = 1.0

            # WB
            peak  = max(overall / max(r_m, 1), overall / max(g_m, 1), overall / max(b_m, 1))
            wb_r_ = (overall / max(r_m, 1)) / peak
            wb_g_ = (overall / max(g_m, 1)) / peak
            wb_b_ = (overall / max(b_m, 1)) / peak
            gamma_r = round(float(min(2.2, max(0.4, tone_gamma * (1 + (wb_r_ - 1) * 0.6)))), 3)
            gamma_g = round(float(min(2.2, max(0.4, tone_gamma * (1 + (wb_g_ - 1) * 0.6)))), 3)
            gamma_b = round(float(min(2.2, max(0.4, tone_gamma * (1 + (wb_b_ - 1) * 0.6)))), 3)

            avg_std  = sum(stat.stddev) / 3.0
            contrast = round(float(max(-0.25, min(0.30, (55 - avg_std) / 150))), 3)

            return {
                "brightness": brightness, "contrast": contrast,
                "saturation": 0.15,
                "gamma_r": gamma_r, "gamma_g": gamma_g, "gamma_b": gamma_b,
                "sharpen": True,
                "hue": 0.0, "blur": 0, "noise": 0,
                "grayscale": False, "sepia": False, "invert": False,
                "vintage": False, "polaroid": False, "kodachrome": False,
            }
    except Exception:
        return _mild_preset()


def _mild_preset() -> dict:
    return {
        "brightness": 0.05, "contrast": 0.10, "saturation": 0.12,
        "gamma_r": 1.0,     "gamma_g": 1.0,   "gamma_b": 1.0,
        "sharpen": True,
        "hue": 0.0, "blur": 0, "noise": 0,
        "grayscale": False, "sepia": False, "invert": False,
        "vintage": False, "polaroid": False, "kodachrome": False,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Legacy shim (kept so any stale import doesn't crash)
# ─────────────────────────────────────────────────────────────────────────────

def auto_correct_image(image_path: str) -> str:
    """Deprecated — corrections are now applied as Fabric.js canvas filters."""
    return image_path
