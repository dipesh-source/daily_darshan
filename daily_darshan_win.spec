# -*- mode: python ; coding: utf-8 -*-
# ─────────────────────────────────────────────────────────────────────────────
#  Daily Darshan Editor  –  Windows PyInstaller Spec
#  Build:  pyinstaller daily_darshan_win.spec --clean --noconfirm
#  Output: dist\Daily Darshan\Daily Darshan.exe   (+ supporting files)
# ─────────────────────────────────────────────────────────────────────────────

import sysconfig
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

HERE = Path(SPECPATH)                          # folder containing this .spec
SP   = Path(sysconfig.get_path('purelib'))     # active venv site-packages

# ── 1. Bundle OpenCV + NumPy (binary wheels with DLLs) ───────────────────────
# collect_all is the only reliable way to bundle cv2/numpy on Windows.
cv2_datas,   cv2_bins,   cv2_hidden   = collect_all('cv2')
np_datas,    np_bins,    np_hidden    = collect_all('numpy')

# ── 2. Application + Django data files ───────────────────────────────────────
app_datas = [
    # Django internals (admin UI, contrib apps, templates)
    (str(SP / "django"),        "django"),
    # Pillow (image processing)
    (str(SP / "PIL"),           "PIL"),
    # Django SQL formatter
    (str(SP / "sqlparse"),      "sqlparse"),
    # Django async helpers
    (str(SP / "asgiref"),       "asgiref"),
    # Project source
    (str(HERE / "daily_darshan"), "daily_darshan"),
    (str(HERE / "editor"),        "editor"),
    # Static assets (JS, CSS, frame PNGs)
    (str(HERE / "static"),        "static"),
    (str(HERE / "staticfiles"),   "staticfiles"),
    # HTML templates
    (str(HERE / "templates"),     "templates"),
]

all_datas    = app_datas + cv2_datas + np_datas
all_binaries = cv2_bins  + np_bins

# ── 3. Hidden imports ─────────────────────────────────────────────────────────
hidden = list(set(cv2_hidden + np_hidden + [
    # ── Django core ────────────────────────────────────────────────────────
    "django",
    "django.core",
    "django.core.management",
    "django.core.management.commands.migrate",
    "django.core.management.commands.runserver",
    "django.contrib.staticfiles",
    "django.contrib.staticfiles.finders",
    "django.contrib.staticfiles.handlers",
    "django.templatetags.static",
    "django.contrib.contenttypes",
    "django.contrib.contenttypes.apps",
    "django.contrib.sessions",
    "django.contrib.sessions.backends.db",
    "django.contrib.messages",
    "django.contrib.messages.storage.fallback",
    "django.contrib.auth",
    "django.contrib.admin",
    "django.db.backends.sqlite3",
    "django.template",
    "django.template.loaders.filesystem",
    "django.template.loaders.app_directories",
    "django.template.context_processors",
    # ── Project apps ───────────────────────────────────────────────────────
    "editor",
    "editor.models",
    "editor.views",
    "editor.urls",
    "editor.admin",
    "editor.apps",
    "editor.services",
    "editor.services.auto_color",
    "editor.services.export_image",
    # ── Pillow ─────────────────────────────────────────────────────────────
    "PIL",
    "PIL.Image",
    "PIL.ImageOps",
    "PIL.ImageFilter",
    "PIL.ImageEnhance",
    "PIL.ImageStat",
    "PIL.ImageDraw",
    "PIL.ImageFont",
    # ── OpenCV / NumPy ─────────────────────────────────────────────────────
    "cv2",
    "numpy",
    "numpy.core",
    "numpy.core._multiarray_umath",
    "numpy.core._methods",
    # ── Standard library ───────────────────────────────────────────────────
    "uuid", "json", "threading", "webbrowser",
    "sqlite3", "_sqlite3",
    "pathlib", "io", "base64", "zipfile", "math",
    "email", "email.mime", "email.mime.text",
    "http", "http.server",
    "urllib", "urllib.parse", "urllib.request",
    "logging", "logging.handlers",
    "encodings", "encodings.utf_8", "encodings.ascii", "encodings.latin_1",
    "encodings.cp1252",   # common Windows code page
    "ctypes", "ctypes.util",
    "socket", "socketserver",
    "wsgiref", "wsgiref.simple_server", "wsgiref.handlers",
    "importlib", "importlib.util",
    # ── Windows-specific stdlib ────────────────────────────────────────────
    "winreg",
    "nt",
]))

# ── 4. Icon (Windows .ico — optional) ────────────────────────────────────────
_ico = HERE / "maharaj.ico"
icon_path = str(_ico) if _ico.exists() else None

# ── 5. Analysis ───────────────────────────────────────────────────────────────
a = Analysis(
    [str(HERE / "launcher.py")],
    pathex        = [str(HERE)],
    binaries      = all_binaries,
    datas         = all_datas,
    hiddenimports = hidden,
    hookspath     = [],
    hooksconfig   = {},
    runtime_hooks = [],
    excludes      = [
        "tkinter", "unittest", "test",
        "pandas", "matplotlib", "IPython",
        "PyQt5", "PyQt6", "wx",
        "scipy", "skimage",     # not used at runtime
    ],
    noarchive     = False,
    optimize      = 0,
)

pyz = PYZ(a.pure)

# ── 6. EXE ────────────────────────────────────────────────────────────────────
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries              = True,
    name                          = "Daily Darshan",
    debug                         = False,
    bootloader_ignore_signals     = False,
    strip                         = False,
    upx                           = False,   # UPX can corrupt cv2 DLLs on Windows
    console                       = False,   # no terminal window
    disable_windowed_traceback    = False,
    icon                          = icon_path,
)

# ── 7. COLLECT — one folder that contains the .exe + all dependencies ─────────
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip       = False,
    upx         = False,
    upx_exclude = [],
    name        = "Daily Darshan",
)
