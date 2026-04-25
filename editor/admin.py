from django.contrib import admin
from .models import FrameConfig, Composition, UploadedPhoto, DarshanSession


@admin.register(DarshanSession)
class DarshanSessionAdmin(admin.ModelAdmin):
    list_display = ["darshan_type", "darshan_date", "title", "created_at"]
    list_filter = ["darshan_date", "darshan_type"]
    date_hierarchy = "darshan_date"


@admin.register(FrameConfig)
class FrameConfigAdmin(admin.ModelAdmin):
    list_display = ["display_name", "darshan_type", "frame_type", "canvas_width", "canvas_height", "slot_count"]
    list_filter = ["darshan_type"]


@admin.register(Composition)
class CompositionAdmin(admin.ModelAdmin):
    list_display = ["frame_config", "darshan_date", "title", "created_at"]
    list_filter = ["darshan_date", "frame_config__darshan_type"]
    date_hierarchy = "darshan_date"


@admin.register(UploadedPhoto)
class UploadedPhotoAdmin(admin.ModelAdmin):
    list_display = ["original_filename", "slot_index", "composition", "uploaded_at"]
