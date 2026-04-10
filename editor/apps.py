from django.apps import AppConfig
from django.db.models.signals import post_migrate


def populate_frame_configs(sender, **kwargs):
    """Auto-populate FrameConfig table after migration if empty."""
    from editor.models import FrameConfig

    if FrameConfig.objects.exists():
        return

    # Slot coordinates measured via BFS flood-fill on actual PNG alpha channels.
    # Full/Left/Center/Right: 1153×2051 canvas  radius=139
    # Wide:                   3195×2055 canvas  radius=127
    # 3in1_L: 2189×2051 — big-left r=133, top-right r=149, bot-right r=149
    # 3in1_R: 2189×2051 — top-left r=142, bot-left  r=149, big-right r=149
    FULL_SLOT  = [{"index": 0, "x": 104, "y": 147, "w": 947, "h": 1757, "radius": 139}]
    WIDE_SLOT  = [{"index": 0, "x": 560, "y": 151, "w": 2076, "h": 1722, "radius": 127}]
    IN1L_SLOTS = [
        {"index": 0, "x": 113,  "y": 190,  "w": 928, "h": 1720, "radius": 133},
        {"index": 1, "x": 1149, "y": 190,  "w": 929, "h": 817,  "radius": 149},
        {"index": 2, "x": 1148, "y": 1043, "w": 929, "h": 817,  "radius": 149},
    ]
    IN1R_SLOTS = [
        {"index": 0, "x": 111,  "y": 190,  "w": 929, "h": 817,  "radius": 142},
        {"index": 1, "x": 113,  "y": 1043, "w": 929, "h": 817,  "radius": 149},
        {"index": 2, "x": 1151, "y": 190,  "w": 928, "h": 1720, "radius": 149},
    ]

    FRAMES = [
        # ── MANGALA ────────────────────────────────────────────────────────────
        # All four Mangala frames use the same Full.png overlay (1 slot each)
        {
            "darshan_type": "mangala", "frame_type": "full",
            "display_name": "Mangala – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/full.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "wide",
            "display_name": "Mangala – WIDE",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/wide.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "3in1_l",
            "display_name": "Mangala – 3 In 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/3in1_l.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "3in1_r",
            "display_name": "Mangala – 3 In 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/3in1_r.png",
        },
        # ── SHANAGAR ───────────────────────────────────────────────────────────
        # Shanagar has dedicated Full / Left / Center / Right PNGs
        {
            "darshan_type": "shanagar", "frame_type": "full",
            "display_name": "Shanagar – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/full.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "wide",
            "display_name": "Shanagar – WIDE",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/wide.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "3in1_l",
            "display_name": "Shanagar – 3 In 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/3in1_l.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "3in1_r",
            "display_name": "Shanagar – 3 In 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/3in1_r.png",
        },
        {
            # Left frame = 1153×2051, uses Left.png overlay (same slot as Full)
            "darshan_type": "shanagar", "frame_type": "left",
            "display_name": "Shanagar – Left",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/left.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "center",
            "display_name": "Shanagar – CENTER",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/center.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "right",
            "display_name": "Shanagar – RIGHT",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/right.png",
        },
        # ── SHAYAN ─────────────────────────────────────────────────────────────
        # Shayan Full uses Full.png, rest share Wide / 3in1 PNGs
        {
            "darshan_type": "shayan", "frame_type": "full",
            "display_name": "Shayan – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/full.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "wide",
            "display_name": "Shayan – WIDE",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/wide.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "3in1_l",
            "display_name": "Shayan – 3 In 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/3in1_l.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "3in1_r",
            "display_name": "Shayan – 3 In 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/3in1_r.png",
        },
        {
            # M2S = two-slot wide portrait, no dedicated PNG yet
            "darshan_type": "shayan", "frame_type": "m2s",
            "display_name": "Shayan – M2S",
            "canvas_width": 3191, "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 103,  "y": 146, "w": 1389, "h": 1758, "radius": 52},
                {"index": 1, "x": 1699, "y": 146, "w": 1389, "h": 1758, "radius": 52},
            ],
            "static_overlay": "",
        },
    ]

    for i, data in enumerate(FRAMES):
        data.setdefault("sort_order", i)
        # static_overlay=None → empty string (NOT NULL field)
        if data.get("static_overlay") is None:
            data["static_overlay"] = ""
        FrameConfig.objects.create(**data)


class EditorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "editor"
    verbose_name = "Daily Darshan Editor"

    def ready(self):
        post_migrate.connect(populate_frame_configs, sender=self)
