# Nogic — User Guide (v1.2)

## What's New in V1.2

- **Message Editing & Regeneration (Branching):** Edit prompts, regenerate
  answers, and keep alternate conversation branches.
- **Per-Chat Drafts:** Drafts stay with their chat when you switch conversations.
- **Prompt Library:** Prompts can be auto-saved and matched semantically.
- **Global Search:** Search conversations from the sidebar.
- **Law & Plant Library Manager:** Browse and manage indexed laws and plants.
- **Native PDF Viewer:** Open cited law documents inside Nogic.
- **Web Fallback:** Opt in to honest web results marked **Unverified** when
  local data is missing.
- **Semantic Response Caching:** Reuse eligible local answers without losing
  their citations or structured data.
- **Automatic Database Backups:** Create backups manually or schedule daily,
  weekly, or monthly backups.

Nogic is a local-first colleague for landscape architecture. It answers from documents you index yourself and from a verified plant table, and it cites its sources. Nothing leaves your machine unless you turn on Web mode or Web Fallback.

Nogic runs on your computer through [Ollama](https://ollama.com/download). If Ollama is not running, the Models settings page shows `Ollama offline` and chat answers wait until it is available.

## 1. First launch

The first-run wizard asks for four things:

1. Your name : used in the welcome greeting.
2. A check that Ollama is installed and running.
3. A model to use. Vision, Tools, and Thinking pills show what the selected model can do. Image attachments are disabled for text-only models.
4. A note that the app ships without a law library.

Finish the wizard to go to the workspace. Settings → General can change the theme, language, name, and keyboard behaviour later.

## 2. Asking a question

Type in the composer and press Send (or Enter, depending on your General settings).

- **Fast** is the default : short, direct answers.
- **Think** asks the model to reason before answering. The reasoning appears in a collapsible **Reasoning** panel and stays available after the answer ends.
- **DeepThink** runs four passes — plan, draft, critique, revise and shows the current pass in the streaming ticker.
- **Web** performs a DuckDuckGo search and answers from the top three results. Web results do not carry local law citations or plant cards. If the search finds nothing usable, Nogic says so and answers from local data.

Answers about law cite the exact article and PDF page. Click a citation in the source footer to open that law PDF. Answers about plants only use rows from the verified table; if the table has no match, Nogic replies `Not in the table.`

### Message Editing and Branching

Use the message actions to edit a prompt or regenerate an answer. Nogic keeps
the previous response and its sibling branches, so you can navigate with
`< 1 / 2 >` without losing conversation history.

### Per-Chat Drafts

Unsent text is saved per chat. Switch conversations and return later to find
the draft exactly where you left it.

### AI Chat Titles

After the first message and answer in a new chat, Nogic automatically generates a short title from the first message. The title appears in the sidebar and replaces `New Chat`; later messages do not overwrite it.

### Clear Context

Click the eraser icon in the top header to clear the chat's AI context. Nogic keeps the visible conversation history, but wipes the short-term memory sent to the model from that point onward. This releases context-related VRAM while preserving the conversation for reference.

## 3. Library Manager and PDF Viewer

Open Settings → Library to review indexed laws and plants, inspect source
metadata, and remove entries you no longer need. Library changes are local and
do not alter the original files outside Nogic's data folder.

When a cited law source is available, select its citation and choose
**Open at page N**. The native PDF viewer opens the document inside Nogic at
the cited page instead of sending you to an external viewer.

## 4. `/add-law` = add a law PDF

Nogic ships with an empty law library so that every citation comes from a document you chose. To add one:

1. Type `/add-law` in the composer and send it.
2. In the **Add a law** card, click the dashed box and choose a PDF.
3. Enter the law name exactly as it should be cited, for example `Loi xx.xx`.
4. Click **Save**.

Nogic copies the PDF into its local data folder, extracts the articles, and indexes them for search. Citations to this law then open your copy of the PDF.

A PDF that yields no readable articles is rejected, because Nogic cannot cite what it cannot read. Scanned documents without a text layer need OCR before they can be added. Existing law names are never overwritten.

## 5. `/site "location"` = site lookup

Type `/site "city, park, garden, known site and etc..."` (quotes are optional) to look up a site:

1. Nogic geocodes the place through OpenStreetMap Nominatim.
2. It collects short web notes about plants, water, and site history.
3. It returns a map card with the location, coordinates, and notes.

If there is no internet connection or no match, Nogic says so in plain text instead of guessing. The site card is saved with the chat, so it returns when you reopen the conversation.

## 6. The `+` menu skills

The `+` button in the composer opens the **Skills** menu.

### Add File
Attach a PDF, Word document, Excel workbook, or image to your next message. The file is copied into Nogic's local memory folder and its text is read locally. Large documents are processed in parts; the ticker shows `Reading document part X of Y...`. Images are sent to a vision-capable model as a reduced-size copy.

### Generate PDF / Generate Word / Generate Excel
Generate PDF and Generate Word each open a layout submenu: **Default Memo**,
**Client Summary**, **Legal Reference**, or **Checklist**. Choose a layout,
describe the document, then send it. Nogic drafts the content with the local
model and writes the file to:
`%USERPROFILE%\Documents\Nogic Exports`

The layout can also be inferred from your request: checklist and filing-step
requests use Checklist; client summaries use Client Summary; and law or article
requests use Legal Reference. A layout chosen from the menu takes precedence.
The generated-file card shows which layout was used and remains available after
you switch chats or restart the app.

- **Default Memo** = the complete Site Memo with legal, plant, and site data.
- **Client Summary** = a minimalist, plain-language recommendation summary
  with plant and site information but no legal section.
- **Legal Reference** = prominent law and article citations without plant or
  site sections.
- **Checklist** = numbered, checkable items with relevant law and site context.
- **Generate PDF** = a formatted PDF report in the selected layout.
- **Generate Word** = an editable `.docx` document in the selected layout.
- **Generate Excel (Devis)** = a spreadsheet suitable for a quote or estimate.

Document generation uses the model selected in Settings → Models. If the model runs out of memory, Nogic shows a short message instead of leaving the answer blank.

## 7. Other commands

| Command | What it does |
| --- | --- |
| `/help` | Prints the command summary instantly, without calling the model. |
| `/plant "name"` | Looks up a species in the verified table without calling the model. |
| `/add-plant` | Opens a form to add a species with its source URL and verbatim quote. |
| `/add-law` | Opens the law upload card described above. |
| `/site "location"` | Looks up a site and renders a map card. |

## 8. Settings & System Updates

### Settings → Models

Nogic detects your actual hardware (RAM and VRAM) and recommends models that fit. You can pull new models directly from this screen. The **Model Behavior** section provides:

- **Temperature** slider for controlling response variation.
- **Context Window** dropdown for choosing how much conversation the model can consider.
- **Model Deletion** for removing an installed model from Ollama.
- **Unload Model** for releasing the currently loaded model from VRAM without deleting it.

### Settings → General

The **AI Persona** text area lets you define the assistant's preferred role, tone, or working style. Nogic applies this persona to future chats while keeping its source-grounded behavior.

### Plant Comparison

On plant cards, check the boxes for the species you want to compare. Nogic then generates a deterministic side-by-side comparison table from the verified plant data, including each plant's provenance.

### Markdown Export

Open the **Share** menu in a chat and choose **Export as Markdown** to save the current chat history as a `.md` file.

In **Settings → About**, you will find:
- **Help:** Opens this guide inside Nogic.
- **Check for updates:** Nogic checks GitHub for a signed update. If one is available, choose **Download & Install** to install it and restart the app.
- **Report a problem:** Clicking this copies your recent diagnostic logs and hardware specs to your clipboard, then opens a pre-filled GitHub issue page so you can paste the details and tell us what went wrong. (**NOTE** : clean up the logs of any personal information's before sending it, for your own safety.)

## 9. Where your data lives

| Data | Location |
| --- | --- |
| Database (chats, projects, settings) | `%APPDATA%\com.nogic.app\nogic.db` |
| Uploaded and attached files | `%APPDATA%\com.nogic.app\memory\files` |
| Indexed law PDFs | `%APPDATA%\com.nogic.app\data\laws` |
| Generated documents | `%USERPROFILE%\Documents\Nogic Exports` |

Settings → Memory and Settings → Advanced can open these folders. Settings → Advanced also contains **Enable Web Fallback**. When enabled, a law or plant question with no local results is searched on the web; those answers are marked unverified. It also contains **Factory Reset**, which removes the database and memory folder and restores the bundled seed data.

## 10. Privacy

- Chat, retrieval, and document extraction run locally.
- No telemetry is collected.
- The only network calls are: Ollama on your machine, `/site` geocoding via OpenStreetMap, DuckDuckGo searches initiated by Web mode or opted-in Web Fallback, link clicks you make yourself, and checking GitHub for app updates.