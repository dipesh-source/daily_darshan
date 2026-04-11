"""
URL configuration for daily_darshan project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("editor.urls")),
    # Serve media files (uploads, exports)
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Explicitly serve /static/ from each STATICFILES_DIRS entry.
# This is a belt-and-suspenders approach so frame PNGs are always reachable
# in both the dev server and the PyInstaller frozen executable.
for _static_dir in settings.STATICFILES_DIRS:
    urlpatterns += [
        path(
            settings.STATIC_URL.lstrip("/") + "<path:path>",
            serve,
            {"document_root": _static_dir},
        ),
    ]
