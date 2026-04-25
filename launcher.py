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
import socket
import threading
import webbrowser
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# Path resolution (works both in dev and inside PyInstaller bundle)
# ─────────────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    BASE_PATH = Path(sys._MEIPASS)
else:
    BASE_PATH = Path(__file__).resolve().parent

sys.path.insert(0, str(BASE_PATH))

# Place database and media in user's home directory so they persist
# across app updates and are writable in any installation directory.
USER_DATA = Path.home() / ".daily_darshan"
USER_DATA.mkdir(parents=True, exist_ok=True)
(USER_DATA / "media" / "uploads").mkdir(parents=True, exist_ok=True)
(USER_DATA / "media" / "exports").mkdir(parents=True, exist_ok=True)

# ── Windows windowed-exe fix ───────────────────────────────────────────────────
# When built with console=False on Windows, PyInstaller sets sys.stdout and
# sys.stderr to None.  Django's management commands (migrate, runserver) call
# self.stdout.write(...) and crash immediately with:
#   AttributeError: 'NoneType' object has no attribute 'write'
# Fix: redirect both streams to a persistent log file so they are never None.
# The log is useful for diagnosing any future issues on end-user machines.
if getattr(sys, "frozen", False) and sys.stdout is None:
    _log_path = USER_DATA / "darshan.log"
    _log = open(_log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = _log
    sys.stderr = _log

os.environ["DARSHAN_DB_PATH"]    = str(USER_DATA / "db.sqlite3")
os.environ["DARSHAN_MEDIA_ROOT"] = str(USER_DATA / "media")
os.environ["DARSHAN_BASE_DIR"]   = str(BASE_PATH)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "daily_darshan.settings")


# ─────────────────────────────────────────────────────────────────
# Find a free port starting from preferred port 8765
# ─────────────────────────────────────────────────────────────────
def find_free_port(preferred=8765):
    """
    If the app is already running on the preferred port, just open the
    browser pointing to it instead of starting a second server.
    Otherwise find the next available port.
    """
    # Check if preferred port is already serving *our* app
    try:
        sock = socket.create_connection(("127.0.0.1", preferred), timeout=1)
        sock.close()
        # Something is already listening — assume it's a previous instance
        return preferred, True   # (port, already_running)
    except (ConnectionRefusedError, OSError):
        pass

    # Preferred port is free — use it
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", preferred))
        s.close()
        return preferred, False
    except OSError:
        pass

    # Fall back: let OS pick any free port
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port, False


def run_django(port):
    """Run Django's development server (blocking)."""
    from django.core.management import execute_from_command_line

    # Run migrations on first launch (no-op if already up to date)
    execute_from_command_line(["manage.py", "migrate", "--run-syncdb"])

    execute_from_command_line([
        "manage.py", "runserver",
        f"127.0.0.1:{port}",
        "--noreload",
        "--nothreading",
    ])


def open_browser(url, delay=1.8):
    """Wait briefly then open the browser."""
    time.sleep(delay)
    webbrowser.open_new_tab(url)


if __name__ == "__main__":
    PORT, already_running = find_free_port(8765)
    URL = f"http://127.0.0.1:{PORT}"

    print("=" * 60)
    print("  Jay Swaminarayan 🙏")
    print("  Daily Darshan Editor")
    print(f"  Opening at {URL}")
    print("=" * 60)

    if already_running:
        # Another instance is already serving — just open the browser
        print("  (Server already running — opening browser)")
        webbrowser.open_new_tab(URL)
        sys.exit(0)

    # Open browser in background thread after server starts
    t = threading.Thread(target=open_browser, args=(URL,), daemon=True)
    t.start()

    try:
        run_django(PORT)
    except KeyboardInterrupt:
        print("\nShutting down. Jay Swaminarayan!")
        sys.exit(0)
