# Nogic v1.2.0 — The Grounded Workflow Update

Nogic v1.2.0 makes everyday research faster while keeping its local-first,
source-grounded behaviour explicit.

## What's new

- **Message editing, regeneration, and branching**: Edit a message, regenerate
  an answer, and move between sibling branches without losing history.
- **Per-chat drafts**: Unsent composer text stays with its chat when switching
  conversations.
- **Prompt Library**: Frequently used prompts are auto-saved and matched
  semantically for quick reuse.
- **Full-text global search**: Search across conversations from the sidebar.
- **Law & Plant Library Manager**: Review and manage indexed laws and plants.
- **Semantic Response Caching**: Repeated eligible questions can reuse a
  locally cached, source-complete response.
- **Native PDF Viewer**: Open a citation inside Nogic at the cited page with
  “Open at page N”.
- **Web Fallback**: When local data is missing, opt in to an honest web
  search. Fallback answers are clearly marked with an **Unverified** badge.
- **Automatic Database Backups**: Create manual backups and schedule daily,
  weekly, or monthly backups with retention controls.

## Notes

The native PDF viewer keeps cited documents in the app and opens them at the
relevant page. Web Fallback is deliberately opt-in and never presents web
results as locally verified law or plant data.

## Installation

1. Download the Nogic v1.2.0 installer from the GitHub Releases page.
2. Ensure [Ollama](https://ollama.com) is installed and running.
3. Run the installer and select a local model in Settings → Models.

Existing chats, libraries, settings, and database data are preserved during
the upgrade. The installer is not code-signed, so Windows SmartScreen may
require **More info → Run anyway**.
