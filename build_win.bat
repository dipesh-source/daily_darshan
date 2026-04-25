@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  Daily Darshan Editor  –  Windows Build Script
REM  Run this file on Windows to produce the distributable .exe
REM
REM  Usage:  Double-click build_win.bat   OR   run it from Command Prompt
REM  Output: dist\Daily Darshan\Daily Darshan.exe  (+ supporting files)
REM          dist\Daily Darshan.zip                (send THIS to users)
REM ─────────────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion

echo.
echo ======================================================
echo   Jay Swaminarayan   Daily Darshan - Windows Build
echo ======================================================
echo.

REM -- Move to the folder that contains this script ----------------------------
cd /d "%~dp0"

REM ── STEP 0: Verify Python is installed ───────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH.
    echo         Please install Python 3.11 from https://www.python.org/downloads/
    echo         Make sure to tick "Add Python to PATH" during installation.
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Python %PY_VER% detected.

REM ── STEP 1: Create virtual environment (skip if already exists) ───────────────
echo.
if not exist "env\Scripts\activate.bat" (
    echo [Step 1] Creating virtual environment...
    python -m venv env
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
) else (
    echo [Step 1] Virtual environment already exists — reusing.
)

REM ── STEP 2: Activate virtual environment ─────────────────────────────────────
echo.
echo [Step 2] Activating virtual environment...
call env\Scripts\activate.bat
if errorlevel 1 (
    echo [ERROR] Could not activate virtual environment.
    pause
    exit /b 1
)
echo [OK] Virtual environment active.

REM ── STEP 3: Install / update dependencies ────────────────────────────────────
echo.
echo [Step 3] Installing dependencies (this may take a few minutes on first run)...
python -m pip install --upgrade pip --quiet
if errorlevel 1 goto pip_error

pip install -r requirements.txt --quiet
if errorlevel 1 goto pip_error

REM Install exact PyInstaller version used for the build
pip install "pyinstaller==6.19.0" --quiet
if errorlevel 1 goto pip_error

echo [OK] All dependencies installed.
goto after_pip

:pip_error
echo [ERROR] pip install failed. Check your internet connection and try again.
pause
exit /b 1

:after_pip

REM ── STEP 4: Collect static files ─────────────────────────────────────────────
echo.
echo [Step 4] Collecting static files...
python manage.py collectstatic --noinput
if errorlevel 1 (
    echo [ERROR] collectstatic failed.
    pause
    exit /b 1
)
echo [OK] Static files collected.

REM ── STEP 5: Run database migrations ──────────────────────────────────────────
echo.
echo [Step 5] Running database migrations...
python manage.py migrate --run-syncdb
if errorlevel 1 (
    echo [ERROR] Database migration failed.
    pause
    exit /b 1
)
echo [OK] Database ready.

REM ── STEP 6: Build .exe with PyInstaller ──────────────────────────────────────
echo.
echo [Step 6] Building Windows .exe with PyInstaller (takes 2-5 minutes)...
pyinstaller daily_darshan_win.spec --clean --noconfirm
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed. See output above for details.
    pause
    exit /b 1
)
echo [OK] Build complete.

REM ── STEP 7: Create distribution ZIP ──────────────────────────────────────────
echo.
echo [Step 7] Creating distribution ZIP...
if exist "dist\Daily Darshan.zip" del /f /q "dist\Daily Darshan.zip"

powershell -NoProfile -Command ^
  "Compress-Archive -Path 'dist\Daily Darshan' -DestinationPath 'dist\Daily Darshan.zip' -Force"

if errorlevel 1 (
    echo [WARN] Could not create ZIP ^(PowerShell not available^).
    echo        Manually zip the folder: dist\Daily Darshan\
) else (
    echo [OK] ZIP created: dist\Daily Darshan.zip
)

REM ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ======================================================
echo   Build COMPLETE!
echo.
echo   EXE location : dist\Daily Darshan\Daily Darshan.exe
echo   ZIP to send  : dist\Daily Darshan.zip
echo.
echo   To run locally:
echo     dist\Daily Darshan\Daily Darshan.exe
echo.
echo   To distribute: send dist\Daily Darshan.zip
echo   Recipient extracts and runs Daily Darshan.exe
echo   (no Python or extra software needed)
echo ======================================================
echo.
pause
