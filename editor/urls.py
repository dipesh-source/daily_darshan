from django.urls import path
from . import views

urlpatterns = [
    # ── Pages ──────────────────────────────────────────────────────────────────
    path("", views.dashboard, name="dashboard"),
    path("editor/<int:frame_config_id>/", views.editor_new, name="editor_new"),
    path("editor/load/<uuid:composition_id>/", views.editor_load, name="editor_load"),
    path("gallery/", views.gallery, name="gallery"),

    # ── API ────────────────────────────────────────────────────────────────────
    path("api/upload/", views.api_upload_photo, name="api_upload_photo"),
    path("api/auto-color/<uuid:photo_id>/", views.api_auto_color, name="api_auto_color"),
    path("api/save/", views.api_save, name="api_save"),
    path("api/export/<uuid:composition_id>/", views.api_export, name="api_export"),
    path("api/delete-upload/<uuid:photo_id>/", views.api_delete_upload, name="api_delete_upload"),
    path("api/upload-overlay/<int:frame_config_id>/", views.api_upload_overlay, name="api_upload_overlay"),
]
