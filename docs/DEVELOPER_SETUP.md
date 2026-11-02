# Nogic Developer Setup

## Python dependencies

From the repository root, create and activate a virtual environment, then
install the pinned sidecar dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m pip install pyinstaller
```

## Build the Python sidecar

Build the one-file backend executable before starting the packaged sidecar:

```powershell
pyinstaller --clean --noconfirm backend\nogic-backend.spec
```

This writes `backend\dist\nogic-backend.exe`, which Tauri uses for release
packaging.

## Run the Tauri development app

Install the frontend dependencies and start the desktop app:

```powershell
cd Nogic
npm install
npm run tauri dev
```
