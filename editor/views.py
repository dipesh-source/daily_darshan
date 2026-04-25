import json
import os
from datetime import datetime
from time import time

from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST

from .models import Composition, DarshanSession, FrameConfig, UploadedPhoto
from .services.auto_color import compute_auto_correct_params
from .services.export_image import compress_image_bytes, render_composition


# ─────────────────────────────────────────────────────────────────────────────
# Page views
# ─────────────────────────────────────────────────────────────────────────────

def root_redirect(_request):
    from django.shortcuts import redirect
    return redirect("darshan_editor", darshan_type="mangala")


def darshan_editor(request, darshan_type, date=None):
    """Open all frames for one darshan type as a multi-artboard editor."""
    VALID = {"mangala", "shanagar", "shayan"}
    if darshan_type not in VALID:
        from django.http import Http404
        raise Http404

    # Parse date
    from datetime import date as date_cls
    if date:
        try:
            darshan_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            darshan_date = date_cls.today()
    else:
        darshan_date = date_cls.today()

    LABELS = {"mangala": "Mangala Darshan", "shanagar": "Shanagar Darshan", "shayan": "Shayan Darshan"}

    # Reuse existing session for same type+date, or create a new one
    session = DarshanSession.objects.filter(
        darshan_type=darshan_type,
        darshan_date=darshan_date,
    ).order_by("-updated_at").first()

    if not session:
        session = DarshanSession.objects.create(
            darshan_type=darshan_type,
            darshan_date=darshan_date,
            title=f"{LABELS[darshan_type]} – {darshan_date.strftime('%d %b %Y')}",
            artboards={},
        )

    frames = list(FrameConfig.objects.filter(darshan_type=darshan_type))

    # Build artboard config list for JS
    artboards_js = []
    for fc in frames:
        artboard = {
            "id":             fc.pk,
            "darshan_type":   fc.darshan_type,
            "frame_type":     fc.frame_type,
            "display_name":   fc.display_name,
            "short_name":     fc.short_name,
            "canvas_width":   fc.canvas_width,
            "canvas_height":  fc.canvas_height,
            "slots":          fc.slots,
            "static_overlay": fc.static_overlay,
            "overlay_url":    _overlay_url(request, fc),
            "canvas_json":    session.artboards.get(str(fc.pk), {}),
        }
        artboards_js.append(artboard)

    return render(request, "editor/editor.html", {
        "session":        session,
        "darshan_type":   darshan_type,
        "darshan_label":  LABELS[darshan_type],
        "darshan_labels": LABELS,
        "darshan_date":   darshan_date,
        "frames":         frames,
        "asset_version":  int(time()),
        "artboards_json": json.dumps(artboards_js),
        "session_json":   json.dumps({
            "id":           str(session.id),
            "darshan_type": session.darshan_type,
            "darshan_date": str(session.darshan_date),
            "title":        session.title,
        }),
    })


def session_load(request, session_id):
    session = get_object_or_404(DarshanSession, pk=session_id)
    return darshan_editor(request, session.darshan_type, str(session.darshan_date))


def gallery(request):
    sessions = DarshanSession.objects.order_by("-darshan_date", "-updated_at")
    return render(request, "editor/gallery.html", {
        "sessions": sessions,
        "darshan_labels": {
            "mangala":  "Mangala Darshan",
            "shanagar": "Shanagar Darshan",
            "shayan":   "Shayan Darshan",
        },
    })


# ─────────────────────────────────────────────────────────────────────────────
# API views
# ─────────────────────────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def api_upload_photo(request):
    file = request.FILES.get("photo")
    if not file:
        return JsonResponse({"success": False, "error": "No file received"}, status=400)

    allowed = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        return JsonResponse({"success": False, "error": "Only JPEG/PNG/WEBP allowed"}, status=400)

    frame_config_id = request.POST.get("frame_config_id")
    slot_index      = int(request.POST.get("slot_index", 0))

    photo = UploadedPhoto.objects.create(
        frame_config_id=frame_config_id,
        slot_index=slot_index,
        image=file,
        original_filename=file.name,
    )

    width = height = 0
    try:
        from PIL import Image as PILImage, ImageOps as PILImageOps
        with PILImage.open(photo.image.path) as img:
            # Fix EXIF rotation so the stored file is always correctly oriented.
            # This prevents photos shot in portrait mode on phones from appearing
            # rotated when displayed in the browser / canvas.
            corrected = PILImageOps.exif_transpose(img)
            if corrected is not img:
                # Only re-save if rotation was actually needed
                corrected.save(photo.image.path)
            width, height = corrected.size
    except Exception:
        pass

    return JsonResponse({
        "success":    True,
        "photo_id":   str(photo.id),
        "url":        request.build_absolute_uri(photo.image.url),
        "width":      width,
        "height":     height,
        "slot_index": slot_index,
    })


@require_http_methods(["GET"])
def api_auto_color(request, photo_id):
    photo = get_object_or_404(UploadedPhoto, pk=photo_id)
    try:
        params = compute_auto_correct_params(photo.image.path)
        return JsonResponse({"success": True, "filter_params": params})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)


@csrf_exempt
@require_POST
def api_session_save(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    session_id  = data.get("session_id")
    artboards   = data.get("artboards", {})  # {frame_config_pk: canvas_json}
    title       = data.get("title", "")

    session = get_object_or_404(DarshanSession, pk=session_id)
    session.artboards = artboards
    if title:
        session.title = title
    session.save()

    return JsonResponse({
        "success":    True,
        "session_id": str(session.id),
        "updated_at": session.updated_at.isoformat(),
    })


@csrf_exempt
@require_POST
def api_export(request, session_id, frame_id):
    session      = get_object_or_404(DarshanSession, pk=session_id)
    frame_config = get_object_or_404(FrameConfig, pk=frame_id)
    canvas_json  = session.artboards.get(str(frame_id), {})

    if not canvas_json:
        return JsonResponse({"success": False, "error": "No canvas data for this frame"}, status=400)

    # Create a temporary Composition for the export service
    comp = Composition(
        frame_config=frame_config,
        session=session,
        darshan_date=session.darshan_date,
        title=session.title,
        canvas_json=canvas_json,
    )
    comp.id = __import__("uuid").uuid4()

    try:
        export_path = render_composition(comp)
        from pathlib import Path
        rel = Path(export_path).relative_to(django_settings.MEDIA_ROOT)
        url = request.build_absolute_uri(django_settings.MEDIA_URL + str(rel).replace("\\", "/"))
        filename = f"darshan_{frame_config.frame_type}_{session.darshan_date}.png"
        return JsonResponse({"success": True, "url": url, "filename": filename})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)


@csrf_exempt
@require_POST
def api_compress_export(request):
    """
    Receive a base64-encoded PNG from the client canvas, apply quality settings
    using Pillow, and return the compressed image as a base64 data-URI.

    Request JSON:
        image_data     : "data:image/png;base64,..."  (canvas toDataURL output)
        format         : "jpeg" | "webp" | "png"       (default: "jpeg")
        quality        : 1-100                          (default: 85)
        sharpen        : true | false                   (default: false)
        target_size_kb : int | null  — binary-search quality to hit this size
        filename       : suggested download filename (returned as-is)
    """
    import base64

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    image_data  = data.get("image_data", "")
    fmt         = (data.get("format", "jpeg") or "jpeg").upper()
    quality     = max(1, min(100, int(data.get("quality", 85))))
    sharpen     = bool(data.get("sharpen", False))
    target_kb   = data.get("target_size_kb")
    filename    = data.get("filename", "darshan_export")

    if target_kb is not None:
        target_kb = int(target_kb)

    # Decode base64 data-URI  → raw bytes
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        raw_bytes = base64.b64decode(image_data)
    except Exception as e:
        return JsonResponse({"success": False, "error": f"Bad image data: {e}"}, status=400)

    try:
        compressed, mime = compress_image_bytes(
            raw_bytes,
            fmt=fmt,
            quality=quality,
            sharpen=sharpen,
            target_size_kb=target_kb,
        )
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

    # Return as base64 data-URI so the browser can download without an extra request
    ext_map = {"JPEG": "jpg", "WEBP": "webp", "PNG": "png"}
    ext = ext_map.get(fmt, "jpg")
    b64 = base64.b64encode(compressed).decode()
    data_uri = f"data:{mime};base64,{b64}"

    return JsonResponse({
        "success":    True,
        "data_uri":   data_uri,
        "mime":       mime,
        "size_bytes": len(compressed),
        "size_kb":    round(len(compressed) / 1024, 1),
        "filename":   f"{filename}.{ext}",
    })


@csrf_exempt
@require_http_methods(["DELETE"])
def api_delete_upload(request, photo_id):
    photo = get_object_or_404(UploadedPhoto, pk=photo_id)
    try:
        import os
        if photo.image and os.path.exists(photo.image.path):
            os.remove(photo.image.path)
        photo.delete()
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _overlay_url(request, fc: FrameConfig) -> str | None:
    """Return absolute URL for the frame overlay image."""
    if fc.overlay_image:
        version = int(os.path.getmtime(fc.overlay_image.path)) if fc.overlay_image.path and os.path.exists(fc.overlay_image.path) else int(time())
        return request.build_absolute_uri(f"{fc.overlay_image.url}?v={version}")
    if fc.static_overlay:
        from django.templatetags.static import static
        static_url = static(fc.static_overlay)
        static_path = finders.find(fc.static_overlay)
        version = int(os.path.getmtime(static_path)) if static_path and os.path.exists(static_path) else int(time())
        return request.build_absolute_uri(f"{static_url}?v={version}")
    return None
