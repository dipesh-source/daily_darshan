import json
from datetime import date, datetime

from django.conf import settings as django_settings
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST

from .models import Composition, DarshanSession, FrameConfig, UploadedPhoto
from .services.auto_color import auto_correct_image
from .services.export_image import render_composition


# ─────────────────────────────────────────────────────────────────────────────
# Page views
# ─────────────────────────────────────────────────────────────────────────────

def dashboard(request):
    configs = list(FrameConfig.objects.all())

    DARSHAN_ORDER = ["mangala", "shanagar", "shayan"]
    DARSHAN_LABELS = {
        "mangala":  "Mangala Darshan",
        "shanagar": "Shanagar Darshan",
        "shayan":   "Shayan Darshan",
    }
    grouped = {}
    for key in DARSHAN_ORDER:
        grouped[key] = {
            "label":  DARSHAN_LABELS[key],
            "frames": [c for c in configs if c.darshan_type == key],
        }

    recent_sessions = DarshanSession.objects.order_by("-updated_at")[:12]

    return render(request, "editor/index.html", {
        "grouped":         grouped,
        "recent_sessions": recent_sessions,
        "today":           date.today(),
        "darshan_labels":  DARSHAN_LABELS,
    })


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
        "darshan_date":   darshan_date,
        "frames":         frames,
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
        adjusted_path = auto_correct_image(photo.image.path)
        from pathlib import Path
        rel = Path(adjusted_path).relative_to(django_settings.MEDIA_ROOT)
        url = request.build_absolute_uri(django_settings.MEDIA_URL + str(rel).replace("\\", "/"))
        return JsonResponse({"success": True, "url": url})
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
        return request.build_absolute_uri(fc.overlay_image.url)
    if fc.static_overlay:
        from django.templatetags.static import static
        return request.build_absolute_uri(static(fc.static_overlay))
    return None
