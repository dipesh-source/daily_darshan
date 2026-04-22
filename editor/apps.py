from django.apps import AppConfig
from django.db.models.signals import post_migrate


def populate_frame_configs(sender, **kwargs):
    """Auto-populate FrameConfig table after migration if empty."""
    from editor.models import FrameConfig

    if FrameConfig.objects.exists():
        return

    # ── Slot coordinates measured via BFS flood-fill on actual PNG alpha channels ──
    # All three Darshan types share identical transparent-window geometry.
    # Each darshan has its own dedicated PNG per frame type (different colors).
    #
    # Full / Left / Center / Right  canvas=1153x2051
    FULL_SLOT = [{"index": 0, "x": 104, "y": 147, "w": 947, "h": 1757, "radius": 139}]
    #
    # Wide  canvas=3195x2055
    WIDE_SLOT = [{"index": 0, "x": 560, "y": 151, "w": 2076, "h": 1722, "radius": 127}]
    #
    # 3-in-1 Left  canvas=2189x2051
    #   slot 0 = big left pane,  slots 1+2 = two right panes stacked
    IN1L_SLOTS = [
        {"index": 0, "x": 113,  "y": 190,  "w": 928, "h": 1720, "radius": 133},
        {"index": 1, "x": 1149, "y": 190,  "w": 929, "h": 817,  "radius": 149},
        {"index": 2, "x": 1148, "y": 1043, "w": 929, "h": 817,  "radius": 149},
    ]
    #
    # 3-in-1 Right  canvas=2189x2051
    #   slot 0 = big right pane (Slot 1),  slot 1 = top-left (Slot 2),  slot 2 = bottom-left (Slot 3)
    IN1R_SLOTS = [
        {"index": 0, "x": 1151, "y": 190,  "w": 928, "h": 1720, "radius": 149},
        {"index": 1, "x": 111,  "y": 190,  "w": 929, "h": 817,  "radius": 142},
        {"index": 2, "x": 113,  "y": 1043, "w": 929, "h": 817,  "radius": 149},
    ]

    FRAMES = [
        # ── MANGALA DARSHAN ───────────────────────────────────────────────────────
        {
            "darshan_type": "mangala", "frame_type": "full",
            "display_name": "Mangala – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/mangala_full.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "wide",
            "display_name": "Mangala – Wide",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/mangala_wide.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "3in1_l",
            "display_name": "Mangala – 3 in 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/mangala_3in1_l.png",
        },
        {
            "darshan_type": "mangala", "frame_type": "3in1_r",
            "display_name": "Mangala – 3 in 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/mangala_3in1_r.png",
        },

        # ── SHANAGAR DARSHAN ──────────────────────────────────────────────────────
        {
            "darshan_type": "shanagar", "frame_type": "full",
            "display_name": "Shanagar – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/shanagar_full.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "wide",
            "display_name": "Shanagar – Wide",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/shanagar_wide.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "3in1_l",
            "display_name": "Shanagar – 3 in 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/shanagar_3in1_l.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "3in1_r",
            "display_name": "Shanagar – 3 in 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/shanagar_3in1_r.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "left",
            "display_name": "Shanagar – Left",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/shanagar_left.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "center",
            "display_name": "Shanagar – Center",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/shanagar_center.png",
        },
        {
            "darshan_type": "shanagar", "frame_type": "right",
            "display_name": "Shanagar – Right",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/shanagar_right.png",
        },

        # ── SHAYAN DARSHAN ────────────────────────────────────────────────────────
        {
            "darshan_type": "shayan", "frame_type": "full",
            "display_name": "Shayan – Full",
            "canvas_width": 1153, "canvas_height": 2051,
            "slots": FULL_SLOT,
            "static_overlay": "frames/shayan_full.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "wide",
            "display_name": "Shayan – Wide",
            "canvas_width": 3195, "canvas_height": 2055,
            "slots": WIDE_SLOT,
            "static_overlay": "frames/shayan_wide.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "3in1_l",
            "display_name": "Shayan – 3 in 1 L",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1L_SLOTS,
            "static_overlay": "frames/shayan_3in1_l.png",
        },
        {
            "darshan_type": "shayan", "frame_type": "3in1_r",
            "display_name": "Shayan – 3 in 1 R",
            "canvas_width": 2189, "canvas_height": 2051,
            "slots": IN1R_SLOTS,
            "static_overlay": "frames/shayan_3in1_r.png",
        },
    ]

    for i, data in enumerate(FRAMES):
        data.setdefault("sort_order", i)
        if data.get("static_overlay") is None:
            data["static_overlay"] = ""
        FrameConfig.objects.create(**data)


class EditorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "editor"
    verbose_name = "Daily Darshan Editor"

    def ready(self):
        post_migrate.connect(populate_frame_configs, sender=self)
