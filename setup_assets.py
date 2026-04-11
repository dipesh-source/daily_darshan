"""
setup_assets.py – Download offline JavaScript dependencies
===========================================================
Run this ONCE before first launch:
    python setup_assets.py

Downloads:
  - fabric.js 5.3.0  →  static/js/fabric.min.js
"""

import urllib.request
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent

ASSETS = [
    {
        "url": "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js",
        "dest": BASE / "static" / "js" / "fabric.min.js",
        "name": "Fabric.js 5.3.0",
    },
]


def download(url: str, dest: Path, name: str):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"  ✓  {name} already present  ({dest.name})")
        return
    print(f"  ↓  Downloading {name}…", end="", flush=True)
    try:
        urllib.request.urlretrieve(url, dest)
        size_kb = dest.stat().st_size // 1024
        print(f"  done  ({size_kb} KB)")
    except Exception as e:
        print(f"\n  ✗  Failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    print("\nJay Swaminarayan! 🙏  Setting up offline assets…\n")
    for asset in ASSETS:
        download(asset["url"], asset["dest"], asset["name"])
    print("\nAll assets ready. You can now run the app:\n")
    print("    python manage.py runserver 8765\n  or\n    python launcher.py\n")
