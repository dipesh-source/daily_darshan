import json
import uuid
from datetime import date

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST

from .models import Composition, FrameConfig, UploadedPhoto
from .services.auto_color import auto_correct_image
from .services.export_image import render_composition


# ─────────────────────────────────────────────────────────────────────────────
# Page views
# ─────────────────────────────────────────────────────────────────────────────

def dashboard(request):
    configs = FrameConfig.objects.all()

    grouped = {}
    order = ["mangala", "shanagar", "shayan"]
    labels = {"mangala": "Mangala Darshan", "shanagar": "Shanagar Darshan", "shayan": "Shayan Darshan"}
    for key in order:
        grouped[key] = {
            "label": labels[key],
            "frames": [c for c in configs if c.darshan_type == key],
        }

    recent = Composition.objects.select_related("frame_config").order_by("-updated_at")[:12]

    return render(request, "editor/index.html", {
        "grouped": grouped,
        "recent": recent,
        "today": date.today(),
    })


def editor_new(request, frame_config_id):
    frame_config = get_object_or_404(FrameConfig, pk=frame_config_id)
    darshan_date = request.GET.get("date", str(date.today()))

    composition = Composition.objects.create(
        frame_config=frame_config,
        darshan_date=darshan_date,
        title=frame_config.display_name,
        canvas_json={},
    )

    return render(request, "editor/editor.html", {
        "composition": composition,
        "frame_config": frame_config,
        "frame_config_json": json.dumps(_frame_to_dict(frame_config)),
        "canvas_json": json.dumps({}),
        "is_new": True,
    })


def editor_load(request, composition_id):
    composition = get_object_or_404(Composition, pk=composition_id)
    frame_config = composition.frame_config

    return render(request, "editor/editor.html", {
        "composition": composition,
        "frame_config": frame_config,
        "frame_config_json": json.dumps(_frame_to_dict(frame_config)),
        "canvas_json": json.dumps(composition.canvas_json),
        "is_new": False,
    })


def gallery(request):
    compositions = Composition.objects.select_related("frame_config").order_by("-darshan_date", "-updated_at")
    return render(request, "editor/gallery.html", {"compositions": compositions})


# ─────────────────────────────────────────────────────────────────────────────
# API views
# ─────────────────────────────────────────────────────────────────────────────

@require_POST
def api_upload_photo(request):
    file = request.FILES.get("photo")
    if not file:
        return JsonResponse({"success": False, "error": "No file received"}, status=400)

    allowed = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        return JsonResponse({"success": False, "error": "Only JPEG/PNG/WEBP allowed"}, status=400)

    composition_id = request.POST.get("composition_id")
    slot_index = int(request.POST.get("slot_index", 0))

    composition = None
    if composition_id:
        composition = Composition.objects.filter(pk=composition_id).first()

    photo = UploadedPhoto.objects.create(
        composition=composition,
        slot_index=slot_index,
        image=file,
        original_filename=file.name,
    )

    from django.conf import settings as django_settings
    width = height = 0
    try:
        from PIL import Image as PILImage
        with PILImage.open(photo.image.path) as img:
            width, height = img.size
    except Exception:
        pass

    return JsonResponse({
        "success": True,
        "photo_id": str(photo.id),
        "url": request.build_absolute_uri(photo.image.url),
        "width": width,
        "height": height,
        "slot_index": slot_index,
    })


@require_http_methods(["GET"])
def api_auto_color(request, photo_id):
    photo = get_object_or_404(UploadedPhoto, pk=photo_id)
    try:
        adjusted_path = auto_correct_image(photo.image.path)
        from django.conf import settings as s
        rel = adjusted_path.replace(str(s.MEDIA_ROOT), "").lstrip("/\\")
        url = request.build_absolute_uri(s.MEDIA_URL + rel)
        return JsonResponse({"success": True, "url": url})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)


@csrf_exempt
@require_POST
def api_save(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    composition_id = data.get("composition_id")
    canvas_json = data.get("canvas_json", {})

    composition = get_object_or_404(Composition, pk=composition_id)
    composition.canvas_json = canvas_json
    if data.get("title"):
        composition.title = data["title"]
    composition.save()

    return JsonResponse({
        "success": True,
        "composition_id": str(composition.id),
        "updated_at": composition.updated_at.isoformat(),
    })


@require_POST
def api_export(request, composition_id):
    composition = get_object_or_404(Composition, pk=composition_id)
    try:
        export_path = render_composition(composition)
        from django.conf import settings as s
        rel = export_path.replace(str(s.MEDIA_ROOT), "").lstrip("/\\")
        url = request.build_absolute_uri(s.MEDIA_URL + rel)
        return JsonResponse({"success": True, "url": url, "filename": f"darshan_{composition.darshan_date}.png"})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)


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


@require_POST
def api_upload_overlay(request, frame_config_id):
    frame_config = get_object_or_404(FrameConfig, pk=frame_config_id)
    file = request.FILES.get("overlay")
    if not file:
        return JsonResponse({"success": False, "error": "No file"}, status=400)

    frame_config.overlay_image = file
    frame_config.save()

    return JsonResponse({
        "success": True,
        "url": request.build_absolute_uri(frame_config.overlay_image.url),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _frame_to_dict(fc):
    return {
        "id": fc.pk,
        "darshan_type": fc.darshan_type,
        "frame_type": fc.frame_type,
        "display_name": fc.display_name,
        "canvas_width": fc.canvas_width,
        "canvas_height": fc.canvas_height,
        "slots": fc.slots,
        "overlay_url": fc.overlay_image.url if fc.overlay_image else None,
    }
