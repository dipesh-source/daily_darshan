from django.urls import path
from . import views

urlpatterns = [
    # ── Pages ──────────────────────────────────────────────────────────────────
    path("", views.root_redirect, name="dashboard"),

    # Multi-artboard editor: all frames for one darshan type on one date
    path("darshan/<str:darshan_type>/",               views.darshan_editor, name="darshan_editor"),
    path("darshan/<str:darshan_type>/<str:date>/",    views.darshan_editor, name="darshan_editor_date"),
    path("session/<uuid:session_id>/",                views.session_load,   name="session_load"),

    path("gallery/", views.gallery, name="gallery"),

    # ── API ────────────────────────────────────────────────────────────────────
    path("api/upload/",                               views.api_upload_photo,    name="api_upload_photo"),
    path("api/auto-color/<uuid:photo_id>/",           views.api_auto_color,      name="api_auto_color"),
    path("api/session/save/",                         views.api_session_save,    name="api_session_save"),
    path("api/export/<uuid:session_id>/<int:frame_id>/", views.api_export,       name="api_export"),
    path("api/delete-upload/<uuid:photo_id>/",        views.api_delete_upload,   name="api_delete_upload"),
    path("api/compress-export/",                      views.api_compress_export, name="api_compress_export"),
]
