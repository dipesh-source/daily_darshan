"""
Daily Darshan Editor – Application Launcher
============================================
Entry point for both development and PyInstaller-bundled distribution.

Usage (development):  python launcher.py
Usage (production):   ./DailyDarshan  (PyInstaller exe)
"""

import os
import sys
import time
import threading
import webbrowser
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# Path resolution (works both in dev and inside PyInstaller bundle)
# ─────────────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle
    BASE_PATH = Path(sys._MEIPASS)
else:
    BASE_PATH = Path(__file__).resolve().parent

# Add project root to path so Django can find the packages
sys.path.insert(0, str(BASE_PATH))

# Place database and media in user's home directory so they persist
# across app updates and are writable in any installation directory.
USER_DATA = Path.home() / ".daily_darshan"
USER_DATA.mkdir(parents=True, exist_ok=True)
(USER_DATA / "media" / "uploads").mkdir(parents=True, exist_ok=True)
(USER_DATA / "media" / "exports").mkdir(parents=True, exist_ok=True)

# Override paths if frozen (so settings.py picks up correct dirs)
os.environ["DARSHAN_DB_PATH"]    = str(USER_DATA / "db.sqlite3")
os.environ["DARSHAN_MEDIA_ROOT"] = str(USER_DATA / "media")
os.environ["DARSHAN_BASE_DIR"]   = str(BASE_PATH)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "daily_darshan.settings")

PORT = 8765
URL  = f"http://127.0.0.1:{PORT}"


def run_django():
    """Run Django's development server (blocking)."""
    from django.core.management import execute_from_command_line

    # Run migrations on first launch
    execute_from_command_line(["manage.py", "migrate", "--run-syncdb"])

    # Start server
    execute_from_command_line([
        "manage.py", "runserver",
        f"127.0.0.1:{PORT}",
        "--noreload",
        "--nothreading",
    ])


def open_browser():
    """Wait briefly then open the browser."""
    time.sleep(1.8)
    webbrowser.open_new_tab(URL)


if __name__ == "__main__":
    print("=" * 60)
    print("  Jay Swaminarayan 🙏")
    print("  Daily Darshan Editor")
    print(f"  Starting at {URL}")
    print("=" * 60)

    # Open browser in background thread
    t = threading.Thread(target=open_browser, daemon=True)
    t.start()

    # Run Django (this blocks until Ctrl+C or window close)
    try:
        run_django()
    except KeyboardInterrupt:
        print("\nShutting down. Jay Swaminarayan!")
        sys.exit(0)
