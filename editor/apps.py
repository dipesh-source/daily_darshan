from django.apps import AppConfig
from django.db.models.signals import post_migrate


def populate_frame_configs(sender, **kwargs):
    """Auto-populate FrameConfig table after migration if empty."""
    from editor.models import FrameConfig

    if FrameConfig.objects.exists():
        return

    FRAMES = [
        # ── MANGALA ────────────────────────────────────────────────────────────
        {
            "darshan_type": "mangala",
            "frame_type": "full",
            "display_name": "Mangala – Full",
            "canvas_width": 1153,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 56, "y": 100, "w": 1041, "h": 1851, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "mangala",
            "frame_type": "wide",
            "display_name": "Mangala – WIDE",
            "canvas_width": 3195,
            "canvas_height": 2055,
            "slots": [
                {"index": 0, "x": 97, "y": 97, "w": 3001, "h": 1861, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "mangala",
            "frame_type": "3in1_l",
            "display_name": "Mangala – 3 In 1 L",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,   "y": 44, "w": 1253, "h": 1963, "shape": "rounded", "radius": 20},
                {"index": 1, "x": 1337, "y": 44, "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 1337, "y": 1052, "w": 808, "h": 955, "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "mangala",
            "frame_type": "3in1_r",
            "display_name": "Mangala – 3 In 1 R",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,  "y": 44,   "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 1, "x": 44,  "y": 1052,  "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 902, "y": 44,    "w": 1243, "h": 1963, "shape": "rounded", "radius": 20},
            ],
        },
        # ── SHANAGAR ───────────────────────────────────────────────────────────
        {
            "darshan_type": "shanagar",
            "frame_type": "full",
            "display_name": "Shanagar – Full",
            "canvas_width": 1153,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 56, "y": 100, "w": 1041, "h": 1851, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "wide",
            "display_name": "Shanagar – WIDE",
            "canvas_width": 3195,
            "canvas_height": 2055,
            "slots": [
                {"index": 0, "x": 97, "y": 97, "w": 3001, "h": 1861, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "3in1_l",
            "display_name": "Shanagar – 3 In 1 L",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,   "y": 44,   "w": 1253, "h": 1963, "shape": "rounded", "radius": 20},
                {"index": 1, "x": 1337, "y": 44,   "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 1337, "y": 1052, "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "3in1_r",
            "display_name": "Shanagar – 3 In 1 R",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,  "y": 44,   "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 1, "x": 44,  "y": 1052, "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 902, "y": 44,   "w": 1243, "h": 1963, "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "left",
            "display_name": "Shanagar – Left",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,   "y": 44, "w": 1047, "h": 1963, "shape": "rounded", "radius": 20},
                {"index": 1, "x": 1141, "y": 44, "w": 1004, "h": 1963, "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "center",
            "display_name": "Shanagar – CENTER",
            "canvas_width": 1153,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 56, "y": 100, "w": 1041, "h": 1851, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "shanagar",
            "frame_type": "right",
            "display_name": "Shanagar – RIGHT",
            "canvas_width": 1153,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 56, "y": 100, "w": 1041, "h": 1851, "shape": "rounded", "radius": 18},
            ],
        },
        # ── SHAYAN ─────────────────────────────────────────────────────────────
        {
            "darshan_type": "shayan",
            "frame_type": "full",
            "display_name": "Shayan – Full",
            "canvas_width": 1153,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 56, "y": 100, "w": 1041, "h": 1851, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "shayan",
            "frame_type": "wide",
            "display_name": "Shayan – WIDE",
            "canvas_width": 3195,
            "canvas_height": 2055,
            "slots": [
                {"index": 0, "x": 97, "y": 97, "w": 3001, "h": 1861, "shape": "rounded", "radius": 18},
            ],
        },
        {
            "darshan_type": "shayan",
            "frame_type": "3in1_l",
            "display_name": "Shayan – 3 In 1 L",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,   "y": 44,   "w": 1253, "h": 1963, "shape": "rounded", "radius": 20},
                {"index": 1, "x": 1337, "y": 44,   "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 1337, "y": 1052, "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "shayan",
            "frame_type": "3in1_r",
            "display_name": "Shayan – 3 In 1 R",
            "canvas_width": 2189,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,  "y": 44,   "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 1, "x": 44,  "y": 1052, "w": 808,  "h": 955,  "shape": "rounded", "radius": 20},
                {"index": 2, "x": 902, "y": 44,   "w": 1243, "h": 1963, "shape": "rounded", "radius": 20},
            ],
        },
        {
            "darshan_type": "shayan",
            "frame_type": "m2s",
            "display_name": "Shayan – M2S",
            "canvas_width": 3191,
            "canvas_height": 2051,
            "slots": [
                {"index": 0, "x": 44,   "y": 44, "w": 1548, "h": 1963, "shape": "rounded", "radius": 20},
                {"index": 1, "x": 1644, "y": 44, "w": 1503, "h": 1963, "shape": "rounded", "radius": 20},
            ],
        },
    ]

    for data in FRAMES:
        FrameConfig.objects.create(**data)


class EditorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "editor"
    verbose_name = "Daily Darshan Editor"

    def ready(self):
        post_migrate.connect(populate_frame_configs, sender=self)
