Nogic v1.1.0-beta: Comprehensive Handover Report
1. Project Overview & Philosophy
Nogic is a local-first AI colleague for landscape architecture. It runs entirely on the user's machine (via Ollama), prioritizing provenance over fluency. It cites laws by article/page, verifies plants with source URLs/quotes, and calmly refuses when it doesn't know the answer.

Built by: A non-programmer founder using AI agents (Cline, Copilot, OpenCode, Tabbit, Claude, Qwen) in a "vibe-coding" workflow.

License: GPL-3.0.

Tech Stack: Tauri 2 (Rust) + React 19 (TS) + Tailwind CSS v3 + Python 3.11 (Sidecar) + SQLite.

2. Current State (v1.1.0-beta)
V1.1 was a massive UX and Control update. The core RAG engine remains the same, but users now have total control over hardware and AI behavior.

AI Chat Titles: Auto-renames chats based on the first message. Runs in a daemon thread after chat_done with num_ctx: 512 to prevent VRAM lag.

VRAM Control (keep_alive): Users can set the model to unload immediately, stay for 5m/30m/1h, or stay forever. Includes an "Unload Model" button.

Model Deletion: Trash icon in Settings → Models to free up disk space.

Model Behavior Settings: Temperature slider, Context Window dropdown, and Custom AI Persona.

Deterministic Plant Comparison: Users can select 2-3 plant cards to generate a side-by-side Markdown table (zero hallucination).

Clear Context: An eraser icon in the chat header. The backend applies a context_start_id boundary so the AI forgets the history, but the UI keeps the visual transcript.

Usage Dashboard: Settings → Usage now shows Nogic + Ollama specific RAM/CPU and Ollama Model VRAM (using NVML), not whole-system usage. Includes a Speed Test.

Site Memo Exports: PDF/Word exports now capture the actual Leaflet map using html2canvas on the frontend and embed it into the memo.

3. The Roadmap Ahead
We have split the future features into three manageable releases to avoid overwhelming the codebase.

V1.2 Beta — UX & Advisor Update (Next Chat)
Message Management: G2 (Message Editing & Regeneration), G7 (Save/Load Prompt Library), G12 (Full-Text Global Search).

Data & Documents: G11 (Law/Plant Library Manager in Settings), G13 (Native PDF Viewer: "Open at page N").

Model Advisor & Performance: Redesign Model Advisor UI (Hardware Snapshot, "Recommended for You", Capabilities, Alternatives). Implement Semantic Response Caching in SQLite to instantly answer repeated questions.

V1.3 Beta — The Intelligence Update (Nogic-LA)
Advanced RAG: Extract rules from technical books (Neufert, Karsenty) using PyMuPDF into CSV/Markdown.

Few-Shot Prompting: Create 150 Q&As (Perfect Match, Strict Refusal, Complex Reasoning, Diagram).

Retriever: Implement a TF-IDF Few-Shot Retriever (scikit-learn) to inject 2-3 examples into the prompt.

V2.0 — The Generation Update
Hardware-Gated Vision (Requires 2GB+ VRAM; recommend Qwen3-VL 2B or Moondream).

Hardware-Gated Image Generation (Requires 4GB+ VRAM; use diffusers).

Prompt Fallback for image generation if hardware is insufficient.

4. Core Architecture & Constraints (DO NOT BREAK)
Stdio JSON-RPC: The Tauri shell (Rust) communicates with Python via stdin/stdout. No HTTP servers. CREATE_NO_WINDOW is applied in lib.rs to hide the Python terminal.

SQLite Only: All persistence (chats, projects, settings, laws, plants, paths) lives in %APPDATA%\com.nogic.app\nogic.db. No localStorage (except for onboarding gate, which was later moved to SQLite settings).

Empty Law Library: The shipped .exe contains zero bundled law PDFs. Users must add their own via /add-law.

300-Line Limit: Every file must be ≤ 300 lines. This forces modularity and keeps AI context manageable.

Hardware Gating: Vision and Image Generation are hardware-gated. If a user lacks VRAM, the UI explicitly disables the feature and offers a fallback.

No Hallucinated Comparisons: The plant comparison table is built deterministically from the frontend plant_data payload, never by the AI.

5. Key Lessons from V1.1 (The "Gotchas")
Threading in Python: If a background task (like title generation) is spawned, it must be a daemon thread and it must not block the main stdin loop. Adding time.sleep() in the main loop causes massive UI lag.

Frontend Context Slicing: When clearing context, do not rely on the backend to filter. Slice the messages array in Workspace.tsx before sending it to the sidecar.

Ollama Status Checks: ollama.list() is slow. Use urllib.request to ping /api/tags with a 1-second timeout to check if Ollama is running.

Map Capture: Server-side static tiles look bad. Use html2canvas on the frontend to capture the actual Leaflet map. However, html2canvas misaligns Leaflet polygons, so we temporarily hide the .leaflet-overlay-pane during capture.

Vite Chunk Size: Ignore the Vite chunk warning; it's a desktop app, so 1MB JS is fine. (Silenced via chunkSizeWarningLimit: 1500).

6. The "Nogic-LA" Intelligence Strategy (from Qwen Deep Research)
For V1.3, we decided against fine-tuning (your RTX 5060 8GB cannot handle it without crashing).
Instead, the strategy is:

Data Extraction: Use PyMuPDF to extract text from books into .md files. Feed them to a free AI to extract rules into a CSV (category, topic, rule, unit, source).

Few-Shot Prompting: Create 150 Q&As. Use TF-IDF (scikit-learn) to retrieve the 2 most similar Q&As to the user's prompt and inject them into the context.

Refusal Examples: 40 of the 150 Q&As must be "Strict Refusal" examples to teach the model to say "I don't know" when the answer isn't in the context.

Semantic Caching: Store Q&A pairs in SQLite. If a similar question is asked, return the cached answer instantly to save VRAM and time.