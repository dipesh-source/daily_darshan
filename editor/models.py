import uuid
from django.db import models


class FrameConfig(models.Model):
    DARSHAN_CHOICES = [
        ("mangala", "Mangala Darshan"),
        ("shanagar", "Shanagar Darshan"),
        ("shayan", "Shayan Darshan"),
    ]

    darshan_type = models.CharField(max_length=20, choices=DARSHAN_CHOICES)
    frame_type = models.CharField(max_length=20)
    display_name = models.CharField(max_length=60)
    canvas_width = models.PositiveIntegerField()
    canvas_height = models.PositiveIntegerField()
    # JSON array: [{index, x, y, w, h, shape, radius}, ...]
    slots = models.JSONField(default=list)
    # Optional PNG overlay image (transparent frame artwork)
    overlay_image = models.ImageField(
        upload_to="frame_overlays/", null=True, blank=True
    )

    class Meta:
        ordering = ["darshan_type", "frame_type"]
        unique_together = [("darshan_type", "frame_type")]

    def __str__(self):
        return self.display_name

    @property
    def slot_count(self):
        return len(self.slots)

    @property
    def darshan_label(self):
        return dict(self.DARSHAN_CHOICES).get(self.darshan_type, self.darshan_type)


class Composition(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    frame_config = models.ForeignKey(
        FrameConfig, on_delete=models.PROTECT, related_name="compositions"
    )
    darshan_date = models.DateField()
    title = models.CharField(max_length=120, blank=True)
    # Full Fabric.js canvas.toJSON() snapshot
    canvas_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    export_path = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-darshan_date", "-created_at"]

    def __str__(self):
        return f"{self.frame_config.display_name} — {self.darshan_date}"


class UploadedPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    composition = models.ForeignKey(
        Composition,
        on_delete=models.CASCADE,
        related_name="photos",
        null=True,
        blank=True,
    )
    slot_index = models.PositiveSmallIntegerField(default=0)
    image = models.ImageField(upload_to="uploads/%Y/%m/%d/")
    original_filename = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Slot {self.slot_index} — {self.original_filename}"
