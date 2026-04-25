# Building Daily Darshan for Windows

## Prerequisites on the Windows machine

| Requirement | Where to get it |
|-------------|-----------------|
| Python 3.11 (64-bit) | https://www.python.org/downloads/release/python-3119/ |
| Git | https://git-scm.com/download/win |
| Internet (first run only) | For pip install |

> **Python install tip:** During installation tick **"Add Python to PATH"** and
> **"Install for all users"**. Use the 64-bit installer.

---

## Steps on the Windows machine

### 1. Pull the latest code

Open **Command Prompt** or **PowerShell** and run:

```
git clone <your-github-repo-url> daily_darshan
cd daily_darshan
```

If you already have the repo cloned, just pull the latest:

```
cd daily_darshan
git pull
```

---

### 2. Run the build script

Double-click **`build_win.bat`**

or from Command Prompt:

```
build_win.bat
```

The script will automatically:
- Create a Python virtual environment (`env\`)
- Install all dependencies (Django, OpenCV, Pillow, etc.)
- Collect static files
- Run database migrations
- Build the `.exe` with PyInstaller
- Create `dist\Daily Darshan.zip`

> First run takes **5–10 minutes** (downloading packages + PyInstaller compile).
> Subsequent runs are faster.

---

### 3. Output

After the build finishes you will have:

```
dist\
  Daily Darshan\          ← run Daily Darshan.exe from here
    Daily Darshan.exe
    ... (support files)
  Daily Darshan.zip       ← send this zip to anyone who just wants to use the app
```

To **run locally**:
```
dist\Daily Darshan\Daily Darshan.exe
```

To **distribute** to other Windows users:
Send them `dist\Daily Darshan.zip`. They just unzip and double-click `Daily Darshan.exe`. No Python required.

---

## Troubleshooting

### "Python not found"
- Reinstall Python and make sure **"Add Python to PATH"** is checked.
- Open a new Command Prompt after installing.

### "pip install failed"
- Check your internet connection.
- Try running `build_win.bat` again (sometimes package servers time out).

### "PyInstaller build failed"
- Look at the error lines above the `[ERROR]` message.
- Common fix: delete the `build\` and `dist\` folders, then run again.

### App opens and immediately closes
- Run from Command Prompt to see the error:
  ```
  "dist\Daily Darshan\Daily Darshan.exe"
  ```

### Windows Defender / Antivirus warning
- This is normal for any freshly built .exe.
- Click **More info → Run anyway** (Windows SmartScreen).
- Or right-click the .exe → Properties → Unblock.

### Missing `maharaj.ico` (icon)
- The app will build without an icon if `maharaj.ico` is not in the project folder.
- To add an icon: put `maharaj.ico` (Windows icon format) in the project root and rebuild.
- You can convert `maharaj.icns` → `maharaj.ico` using any online converter.

---

## Files added for Windows support

| File | Purpose |
|------|---------|
| `daily_darshan_win.spec` | PyInstaller configuration for Windows |
| `build_win.bat` | One-click build script for Windows |
| `BUILD_WINDOWS.md` | This guide |

The Mac build files (`build_mac.sh`, `daily_darshan_mac.spec`) are unchanged.
