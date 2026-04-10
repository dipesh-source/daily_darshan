import uuid
from django.db import models


class FrameConfig(models.Model):
    DARSHAN_CHOICES = [
        ("mangala",  "Mangala Darshan"),
        ("shanagar", "Shanagar Darshan"),
        ("shayan",   "Shayan Darshan"),
    ]

    darshan_type   = models.CharField(max_length=20, choices=DARSHAN_CHOICES)
    frame_type     = models.CharField(max_length=20)
    display_name   = models.CharField(max_length=60)
    canvas_width   = models.PositiveIntegerField()
    canvas_height  = models.PositiveIntegerField()
    # JSON array: [{index, x, y, w, h, radius}, ...]  — pixel-accurate from PNG analysis
    slots          = models.JSONField(default=list)
    # Relative path inside static/ for the bundled frame PNG (e.g. "frames/3in1_l.png")
    static_overlay = models.CharField(max_length=120, blank=True, default="")
    # Optional user-uploaded overlay (overrides static_overlay when set)
    overlay_image  = models.ImageField(upload_to="frame_overlays/", null=True, blank=True)
    # Display order within its darshan group
    sort_order     = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["darshan_type", "sort_order", "frame_type"]
        unique_together = [("darshan_type", "frame_type")]

    def __str__(self):
        return self.display_name

    @property
    def slot_count(self):
        return len(self.slots)

    @property
    def darshan_label(self):
        return dict(self.DARSHAN_CHOICES).get(self.darshan_type, self.darshan_type)

    @property
    def short_name(self):
        """Name without the darshan prefix, e.g. 'Full', 'WIDE', '3 In 1 L'"""
        parts = self.display_name.split("–")
        return parts[-1].strip() if len(parts) > 1 else self.display_name


class DarshanSession(models.Model):
    """One editing session = one darshan type on one date. Holds all artboard states."""
    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    darshan_type = models.CharField(max_length=20, choices=FrameConfig.DARSHAN_CHOICES)
    darshan_date = models.DateField()
    title        = models.CharField(max_length=120, blank=True)
    # JSON keyed by frame_config pk → {canvas_json, slot_states}
    artboards    = models.JSONField(default=dict)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-darshan_date", "-created_at"]

    def __str__(self):
        label = dict(FrameConfig.DARSHAN_CHOICES).get(self.darshan_type, self.darshan_type)
        return f"{label} — {self.darshan_date}"


class Composition(models.Model):
    """Single-frame composition (kept for backward compat + per-frame export)."""
    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    frame_config = models.ForeignKey(
        FrameConfig, on_delete=models.PROTECT, related_name="compositions"
    )
    session      = models.ForeignKey(
        DarshanSession, on_delete=models.CASCADE, related_name="compositions",
        null=True, blank=True,
    )
    darshan_date = models.DateField()
    title        = models.CharField(max_length=120, blank=True)
    canvas_json  = models.JSONField(default=dict)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)
    export_path  = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-darshan_date", "-created_at"]

    def __str__(self):
        return f"{self.frame_config.display_name} — {self.darshan_date}"


class UploadedPhoto(models.Model):
    id                = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    composition       = models.ForeignKey(
        Composition, on_delete=models.CASCADE, related_name="photos",
        null=True, blank=True,
    )
    frame_config_id   = models.IntegerField(null=True, blank=True)  # which artboard
    slot_index        = models.PositiveSmallIntegerField(default=0)
    image             = models.ImageField(upload_to="uploads/%Y/%m/%d/")
    original_filename = models.CharField(max_length=255)
    uploaded_at       = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Slot {self.slot_index} — {self.original_filename}"
