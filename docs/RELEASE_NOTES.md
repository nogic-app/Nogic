# Nogic v1.1.0 Beta (The UX & Control Update)

This is a massive Quality of Life and UX upgrade for Nogic. While the core "honest RAG" engine remains the same, V1.1 gives you total control over how the AI behaves, how it uses your hardware, and how you interact with your data.

## ✨ What's New
- **AI-Generated Chat Titles**: The sidebar now automatically summarizes your first prompt into a clean 2-4 word title.
- **Message Editing & Regeneration**: Edit your prompts and re-run the AI without starting a new chat. *(Note: Deferred to V1.2)*
- **VRAM Control (`keep_alive`)**: You can now tell Ollama to unload the model immediately to save VRAM, or keep it loaded forever for instant responses.
- **Model Deletion**: Delete models directly from the Settings → Models screen to free up disk space.
- **System Persona**: Customize the AI's tone in Settings → General (e.g., "You are a strict academic tutor").
- **Temperature & Context Sliders**: Adjust the AI's creativity (Temperature) and short-term memory (Context Window) in Settings → Models.
- **Deterministic Plant Comparison**: Select 2-3 plants in the chat using the checkboxes to instantly generate a side-by-side comparison table (no hallucination).
- **Copy & Markdown Export**: Copy any AI message with one click, or export an entire chat as Markdown for Notion/Obsidian.
- **Clear Context (Eraser)**: Keep your visual chat history but wipe the AI's short-term memory to save VRAM and improve speed.
- **Persistent Hardware & Model Stats**: The Usage dashboard and Model Advisor now reliably detect your GPU and VRAM, and show *only* the app's usage.

## 🐛 What's Fixed
- Fixed the Startup Error screen so it works even if the backend is dead.
- Fixed the Tesseract OCR portable downloader and licensing.
- Fixed the empty Sources page in PDF/Word exports.
- Fixed the `/site` map export to capture the actual Leaflet map from the UI.
- Fixed the chat sidebar search so `Escape` closes it.
- Fixed the UI lag when sending messages.

## ⚠️ Important Notes
- **Windows SmartScreen**: Because Nogic is an independent, open-source project, the installer is not code-signed. Click **More info** → **Run anyway**.
- **Upgrading**: Your SQLite database, law library, and chats are preserved.

## 📦 Installation
1. Download the `.exe` below.
2. Ensure [Ollama](https://ollama.com) is installed and running.
3. Run the installer.
