import base64
import binascii
import html
import json
import logging
import math
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import traceback
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import httpx
import log_setup
import ollama
import session_logger
from auto_backup import check_auto_backup
from chat_engine import generate_title_async
from chat_modes import get_chat_modes
from chat_pipeline import run_chat
from db import (
    DB_PATH,
    add_chat_to_project,
    build_active_branch,
    clear_chat_context,
    clear_semantic_cache,
    count_law_articles,
    create_database_backup,
    delete_law,
    delete_plant,
    get_all_cache_embeddings,
    get_connection,
    get_laws_metadata,
    get_messages,
    get_plants_metadata,
    get_settings,
    init_db,
    insert_cache_entry,
    insert_message,
    rename_chat,
    rename_project,
    restore_database_from,
    save_message,
    save_setting,
    set_chat_pinned,
    set_project_pinned,
)
from db import (
    create_chat as persist_chat,
)
from db import (
    create_project as persist_project,
)
from db import (
    delete_project as remove_project,
)
from document_processor import process_attachments
from errors import classify
from export_engine import export_chat_docx, export_chat_excel, export_chat_pdf
from intent import classify_intent
from law_ingest import (
    TESSERACT_DLL_ERROR_MESSAGE,
    TesseractDependencyError,
    backfill_recueil_sub_laws,
    warn_if_tesseract_missing,
)
from law_pdf import get_law_pdf_path

# Re-exported for backend/test_evals.py, which imports these from main.
from law_prompts import build_law_system_prompt  # noqa: F401
from law_query import get_law_sources  # noqa: F401
from law_upload import NO_EXTRACTABLE_LAW_TEXT, add_law
from memo_templates import get_template_type
from model_actions import handle_model_action, start_speed_test
from plant_search import search_plants
from plant_upload import add_plant
from runtime_paths import (
    APP_DATA_ROOT,
    BUNDLED_DATA_DIR,
    DATA_DIR,
    IS_FROZEN,
    prepare_runtime_data,
)
from site_search import fetch_site_context, search_location
from system_actions import (
    check_tesseract,
    download_portable_tesseract,
    remove_tesseract,
)
from tier_config import budget_for_hardware

logger = logging.getLogger(__name__)


def emit_error(request_id: object, error: Exception) -> dict[str, object]:
    logger.error(
        "Sidecar request failed: %s",
        error,
        exc_info=(type(error), error, error.__traceback__),
    )
    payload = classify(error)
    error_message = {
        "type": "error",
        "id": request_id,
        "error": payload["message"],
        "payload": payload,
    }
    if isinstance(error, ValueError) and str(error) == NO_EXTRACTABLE_LAW_TEXT:
        error_message["userMessage"] = NO_EXTRACTABLE_LAW_TEXT
    elif isinstance(error, TesseractDependencyError):
        payload["message"] = TESSERACT_DLL_ERROR_MESSAGE
        error_message["error"] = TESSERACT_DLL_ERROR_MESSAGE
        error_message["userMessage"] = TESSERACT_DLL_ERROR_MESSAGE
    elif isinstance(error, ValueError) and (
        str(error) == "Could not find a user prompt to regenerate from."
        or "already exists in the library." in str(error)
    ):
        payload["message"] = str(error)
        error_message["error"] = str(error)
        error_message["userMessage"] = str(error)
    print(json.dumps(error_message), flush=True)
    return payload


def memory_files_directory() -> Path:
    directory = APP_DATA_ROOT / "memory" / "files"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def get_saved_files() -> list[dict[str, object]]:
    files = []
    for path in memory_files_directory().iterdir():
        if not path.is_file():
            continue
        stat = path.stat()
        files.append({
            "name": path.name,
            "size": stat.st_size,
            "type": path.suffix.removeprefix(".").upper() or "FILE",
            "date": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return sorted(files, key=lambda item: str(item["date"]), reverse=True)


def save_prompt(prompt_id: str, title: str, content: str) -> dict[str, object]:
    if not isinstance(prompt_id, str) or not prompt_id.strip():
        raise ValueError("The prompt ID must be a non-empty string.")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("The prompt title must be a non-empty string.")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("The prompt content must be a non-empty string.")

    with get_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO prompt_library (id, title, content, created_at) "
            "VALUES (?, ?, ?, ?)",
            (prompt_id.strip(), title.strip(), content, datetime.now().isoformat()),
        )
    return {"success": True, "id": prompt_id.strip()}


def get_prompts() -> list[dict[str, object]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, content, created_at, auto_saved, usage_count "
            "FROM prompt_library "
            "ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "content": row["content"],
            "created_at": row["created_at"],
            "auto_saved": bool(row["auto_saved"]),
            "usage_count": int(row["usage_count"]),
        }
        for row in rows
    ]


def search_messages(query: str) -> list[dict[str, str]]:
    if not isinstance(query, str):
        raise TypeError("The search query must be a non-empty string.")

    safe_query = re.sub(r"[^\w\s]", "", query)
    words = safe_query.split()
    if not words:
        return []
    fts_query = " ".join([*words[:-1], f"{words[-1]}*"])

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                m.chat_id,
                c.title AS chat_title,
                snippet(messages_fts, 2, '<b>', '</b>', '...', 10) AS snippet
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.message_id
            JOIN chats c ON c.id = m.chat_id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT 20
            """,
            (fts_query,),
        ).fetchall()

    results = []
    for row in rows:
        escaped_snippet = html.escape(row["snippet"], quote=True)
        safe_snippet = escaped_snippet.replace("&lt;b&gt;", "<b>").replace(
            "&lt;/b&gt;", "</b>"
        )
        results.append({
            "chat_id": row["chat_id"],
            "chat_title": row["chat_title"],
            "snippet": safe_snippet,
        })
    return results


def delete_prompt(prompt_id: str) -> dict[str, object]:
    if not isinstance(prompt_id, str) or not prompt_id.strip():
        raise ValueError("The prompt ID must be a non-empty string.")
    with get_connection() as conn:
        conn.execute("DELETE FROM prompt_library WHERE id = ?", (prompt_id.strip(),))
    return {"success": True, "id": prompt_id.strip()}


def check_embedding_model() -> dict[str, bool]:
    models = ollama.list().models
    installed = any(
        (
            (
                model.get("model") or model.get("name")
                if isinstance(model, dict)
                else getattr(model, "model", None) or getattr(model, "name", None)
            )
            or ""
        ).split(":")[0]
        == "nomic-embed-text"
        for model in models
    )
    return {"installed": installed}


def get_embedding(text: str) -> list[float]:
    response = ollama.embeddings(model="nomic-embed-text", prompt=text)
    embedding = (
        response.get("embedding")
        if isinstance(response, dict)
        else getattr(response, "embedding", None)
    )
    if not isinstance(embedding, list) or not embedding or any(
        not isinstance(value, (int, float)) or isinstance(value, bool)
        for value in embedding
    ):
        raise TypeError("Ollama returned an invalid embedding.")
    result = [float(value) for value in embedding]
    if any(not math.isfinite(value) for value in result):
        raise ValueError("Ollama returned a non-finite embedding.")
    return result


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def find_cached_payload(question: str) -> tuple[str | None, list[float] | None]:
    if not check_embedding_model()["installed"]:
        return None, None

    embedding = get_embedding(question)
    best_payload_json = None
    best_similarity = 0.93
    for entry in get_all_cache_embeddings():
        try:
            cached_embedding = json.loads(entry["embedding"])
        except (TypeError, json.JSONDecodeError):
            logger.warning(
                "Ignoring invalid semantic-cache embedding for entry %s.",
                entry["id"],
            )
            continue
        if not isinstance(cached_embedding, list) or any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            for value in cached_embedding
        ):
            logger.warning(
                "Ignoring invalid semantic-cache embedding for entry %s.",
                entry["id"],
            )
            continue
        similarity = _cosine_similarity(
            embedding, [float(value) for value in cached_embedding]
        )
        if (
            similarity > best_similarity
            and isinstance(entry["payload_json"], str)
            and entry["payload_json"].strip()
        ):
            best_similarity = similarity
            best_payload_json = entry["payload_json"]
    return best_payload_json, embedding


def _prompt_title(content: str) -> str:
    title = " ".join(content.split())
    return title[:120] or "Frequent prompt"


def auto_save_prompt_if_needed(
    content: str,
    *,
    auto_save: bool,
    semantic_auto_save: bool,
    model_installed: bool,
) -> None:
    if not auto_save:
        return

    with get_connection() as conn:
        recent_count = conn.execute(
            "SELECT count(*) FROM ("
            "SELECT content FROM messages WHERE role = 'user' "
            "ORDER BY created_at DESC, id DESC LIMIT 100"
            ") WHERE content = ?",
            (content,),
        ).fetchone()[0]
        existing = conn.execute(
            "SELECT id FROM prompt_library WHERE content = ? LIMIT 1",
            (content,),
        ).fetchone()
        if recent_count >= 3 and existing is None:
            conn.execute(
                "INSERT INTO prompt_library "
                "(id, title, content, created_at, auto_saved) "
                "VALUES (?, ?, ?, ?, 1)",
                (uuid4().hex, _prompt_title(content), content, datetime.now().isoformat()),
            )

    try:
        if not semantic_auto_save or not model_installed:
            return

        embedding = get_embedding(content)
        embedding_json = json.dumps(embedding)
        with get_connection() as conn:
            exact_prompt = conn.execute(
                "SELECT id, embedding FROM prompt_library WHERE content = ? LIMIT 1",
                (content,),
            ).fetchone()
            if exact_prompt is not None and exact_prompt["embedding"] is None:
                conn.execute(
                    "UPDATE prompt_library SET embedding = ? WHERE id = ?",
                    (embedding_json, exact_prompt["id"]),
                )

            best_match_id = None
            best_similarity = 0.0
            rows = conn.execute(
                "SELECT id, embedding FROM prompt_library WHERE embedding IS NOT NULL"
            ).fetchall()
            for row in rows:
                try:
                    saved_embedding = json.loads(row["embedding"])
                except (TypeError, json.JSONDecodeError):
                    logger.warning("Ignoring an invalid prompt-library embedding.")
                    continue
                if not isinstance(saved_embedding, list) or any(
                    not isinstance(value, (int, float))
                    or isinstance(value, bool)
                    or not math.isfinite(value)
                    for value in saved_embedding
                ):
                    logger.warning("Ignoring an invalid prompt-library embedding.")
                    continue
                similarity = _cosine_similarity(embedding, saved_embedding)
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match_id = row["id"]

            if best_match_id is not None and best_similarity > 0.85:
                conn.execute(
                    "UPDATE prompt_library SET usage_count = usage_count + 1 "
                    "WHERE id = ?",
                    (best_match_id,),
                )
            if best_similarity > 0.85 and exact_prompt is None:
                new_prompt = content
                score = best_similarity
                prompt_id = uuid4().hex
                print(
                    f"DEBUG SEMANTIC: Attempting to save '{new_prompt}' "
                    f"with score {score}",
                    file=sys.stderr,
                )
                cursor = conn.execute(
                    "INSERT INTO prompt_library "
                    "(id, title, content, created_at, embedding, auto_saved) "
                    "VALUES (?, ?, ?, ?, ?, 1)",
                    (
                        prompt_id,
                        _prompt_title(new_prompt),
                        new_prompt,
                        datetime.now().isoformat(),
                        embedding_json,
                    ),
                )
                print(
                    "DEBUG SEMANTIC: SQLite rowcount after insert: "
                    f"{cursor.rowcount}",
                    file=sys.stderr,
                )
                conn.commit()
    except Exception as e:  # noqa: BLE001
        print(f"Could not complete semantic prompt auto-save: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


def _require_temp_source(source: Path) -> Path:
    """Resolve `source` and refuse anything outside the system temp directory."""
    resolved = source.resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    try:
        resolved.relative_to(temp_root)
    except ValueError:
        raise ValueError(
            "Only files staged in the system temporary directory can be saved."
        ) from None
    return resolved


def save_memory_file(file_path: str) -> dict[str, object]:
    try:
        source = Path(file_path).expanduser()
        if not source.is_file():
            raise ValueError(f"File not found: {file_path}")
        source = _require_temp_source(source)
        destination = memory_files_directory() / source.name
        shutil.copy2(source, destination)
        return {
            "name": destination.name,
            "size": destination.stat().st_size,
            "type": destination.suffix.removeprefix(".").upper() or "FILE",
            "date": datetime.fromtimestamp(destination.stat().st_mtime).isoformat(timespec="seconds"),
        }
    except Exception:
        logger.exception("Could not save the requested memory file.")
        raise


def resolve_chat_model(request: dict[str, object]) -> str:
    """Pick the model for a chat request without silently assuming a default."""
    requested = request.get("model")
    if isinstance(requested, str) and requested.strip():
        return requested.strip()

    saved = get_settings().get("activeModel")
    if isinstance(saved, str) and saved.strip():
        return saved.strip()

    try:
        installed = ollama.list().models
    except Exception:
        logger.exception("Could not list installed Ollama models.")
        installed = []

    for entry in installed:
        name = getattr(entry, "model", None)
        if isinstance(name, str) and name.strip():
            return name.strip()

    raise ValueError("No model is selected. Choose a model in Settings.")


def factory_reset() -> None:
    if Path(DB_PATH).exists():
        Path(DB_PATH).unlink(missing_ok=True)
    memory_directory = APP_DATA_ROOT / "memory"
    if memory_directory.exists():
        shutil.rmtree(memory_directory)

    if IS_FROZEN:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        runtime_laws = DATA_DIR / "laws"
        if runtime_laws.exists():
            shutil.rmtree(runtime_laws)
        bundled_laws = BUNDLED_DATA_DIR / "laws"
        if bundled_laws.exists():
            shutil.copytree(bundled_laws, runtime_laws)
        bundled_plants = BUNDLED_DATA_DIR / "plants.json"
        runtime_plants = DATA_DIR / "plants.json"
        if runtime_plants.exists():
            runtime_plants.unlink()
        if bundled_plants.exists():
            shutil.copy2(bundled_plants, runtime_plants)


def backup_database(target_path: str) -> dict[str, bool]:
    create_database_backup(target_path)
    return {"success": True}


def restore_database(source_path: str) -> dict[str, bool]:
    restore_database_from(source_path)
    return {"success": True}


def main():
    # Tauri writes UTF-8 to the sidecar's stdin. Windows otherwise decodes the
    # pipe with the legacy ANSI code page, turning "câprier" into "cÃ¢prier".
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    log_setup.init()
    prepare_runtime_data()
    warn_if_tesseract_missing()
    init_db()
    backfill_recueil_sub_laws()
    # Ensure the memory directory exists so "Open folder" in Settings never
    # fails with a missing-directory OS error. Tauri's appDataDir() resolves to
    # %APPDATA%\com.nogic.app (the bundle identifier), so create that exact
    # folder tree rather than a separate ~/.nogic one.
    os.makedirs(APP_DATA_ROOT / "memory", exist_ok=True)
    threading.Thread(
        target=check_auto_backup,
        name="auto-backup-check",
        daemon=True,
    ).start()
    print(json.dumps({
        "type": "status",
        "message": "Starting Ollama check...",
    }), flush=True)
    try:
        ollama.list()
    except Exception:
        logger.exception("Initial Ollama check failed.")
    print(json.dumps({"type": "status", "message": "Python sidecar ready"}), flush=True)

    for line in sys.stdin:
        action = "unknown"
        req: dict[str, object] = {}
        req_id: object = None
        try:
            req = json.loads(line)
            action = req.get("action")
            req_id = req.get("id")

            if action == "ping":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"message": "pong"},
                }), flush=True)

            elif action == "check_embedding_model":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": check_embedding_model(),
                }), flush=True)

            elif action == "check_tesseract":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": check_tesseract(),
                }), flush=True)

            elif action == "download_portable_tesseract":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": download_portable_tesseract(),
                }), flush=True)

            elif action == "remove_tesseract":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": remove_tesseract(),
                }), flush=True)

            elif action == "get_projects":
                with get_connection() as conn:
                    rows = conn.execute(
                        "SELECT id, name, created_at, is_pinned FROM projects "
                        "ORDER BY is_pinned DESC, created_at DESC"
                    ).fetchall()
                projects = [
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "date": row["created_at"],
                        "is_pinned": bool(row["is_pinned"]),
                    }
                    for row in rows
                ]
                print(json.dumps({
                    "type": "projects",
                    "id": req_id,
                    "data": projects
                }), flush=True)

            elif action == "get_saved_files":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_saved_files(),
                }), flush=True)

            elif action == "save_prompt":
                prompt_id = req.get("prompt_id")
                title = req.get("title")
                content = req.get("content")
                if (
                    not isinstance(prompt_id, str)
                    or not isinstance(title, str)
                    or not isinstance(content, str)
                ):
                    raise ValueError("The prompt ID, title, and content are required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": save_prompt(prompt_id, title, content),
                }), flush=True)

            elif action == "get_prompts":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_prompts(),
                }), flush=True)

            elif action == "delete_prompt":
                prompt_id = req.get("prompt_id")
                if not isinstance(prompt_id, str):
                    raise ValueError("The prompt ID is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": delete_prompt(prompt_id),
                }), flush=True)

            elif action == "get_settings":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_settings(),
                }), flush=True)

            elif action == "get_diagnostics":
                app_version = req.get("app_version")
                hardware = req.get("hardware")
                if not isinstance(app_version, str) or not app_version.strip():
                    raise ValueError("The app version is required.")
                if not isinstance(hardware, dict):
                    raise ValueError("Hardware information is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": session_logger.get_diagnostics(
                        app_version.strip(), hardware
                    ),
                }), flush=True)

            elif action == "save_setting":
                key = req.get("key")
                value = req.get("value")
                if not isinstance(key, str) or not key.strip():
                    raise ValueError("The setting key must be a non-empty string.")
                if not isinstance(value, str):
                    raise ValueError("The setting value must be a string.")
                save_setting(key.strip(), value)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "key": key.strip()},
                }), flush=True)

            elif action == "get_law_status":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": count_law_articles(),
                }), flush=True)

            elif action == "get_law_pdf_path":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_law_pdf_path(
                        req.get("law_name"),
                        req.get("country"),
                    ),
                }), flush=True)

            elif action == "get_library_laws":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_laws_metadata(),
                }), flush=True)

            elif action == "delete_library_law":
                law_name = req.get("law_name")
                country = req.get("country")
                delete_law(law_name, country)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True},
                }), flush=True)

            elif action == "get_library_plants":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_plants_metadata(),
                }), flush=True)

            elif action == "delete_library_plant":
                plant_id = req.get("plant_id")
                delete_plant(plant_id)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True},
                }), flush=True)

            elif action == "clear_law_library":
                with get_connection() as conn:
                    conn.execute("DELETE FROM law_articles")
                    conn.execute("DELETE FROM law_article_hashes")
                laws_directory = DATA_DIR / "laws"
                if laws_directory.exists():
                    for law_file in laws_directory.glob("*.pdf"):
                        law_file.unlink()
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True},
                }), flush=True)

            elif action == "clear_semantic_cache":
                clear_semantic_cache()
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True},
                }), flush=True)

            elif action == "backup_database":
                target_path = req.get("target_path")
                if not isinstance(target_path, str) or not target_path.strip():
                    raise ValueError("A backup target path is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": backup_database(target_path),
                }), flush=True)

            elif action == "restore_database":
                source_path = req.get("source_path")
                if not isinstance(source_path, str) or not source_path.strip():
                    raise ValueError("A database backup path is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": restore_database(source_path),
                }), flush=True)

            elif action == "save_memory_file":
                file_path = req.get("file_path")
                if not isinstance(file_path, str) or not file_path.strip():
                    raise ValueError("The file path is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": save_memory_file(file_path),
                }), flush=True)

            elif action == "delete_memory":
                categories = req.get("categories")
                if (
                    not isinstance(categories, list)
                    or not all(isinstance(category, str) for category in categories)
                ):
                    raise ValueError("The categories value must be a list of strings.")
                selected = set(categories)
                unknown = selected - {"files", "chats"}
                if unknown:
                    raise ValueError(f"Unknown memory categories: {', '.join(sorted(unknown))}")
                if "files" in selected:
                    files_directory = memory_files_directory()
                    for path in files_directory.iterdir():
                        if path.is_file():
                            path.unlink()
                        elif path.is_dir():
                            shutil.rmtree(path)
                if "chats" in selected:
                    with get_connection() as conn:
                        conn.execute("DELETE FROM messages")
                        conn.execute("DELETE FROM chats")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "categories": sorted(selected)},
                }), flush=True)

            elif action == "factory_reset":
                factory_reset()
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True},
                }), flush=True)

            elif action == "get_chats":
                with get_connection() as conn:
                    rows = conn.execute(
                        "SELECT id, title, project_id, created_at, is_pinned FROM chats "
                        "ORDER BY is_pinned DESC, created_at DESC"
                    ).fetchall()
                chats = [
                    {
                        "id": row["id"],
                        "title": row["title"],
                        "project_id": row["project_id"],
                        "created_at": row["created_at"],
                        "is_pinned": bool(row["is_pinned"]),
                    }
                    for row in rows
                ]
                print(json.dumps({
                    "type": "chats",
                    "id": req_id,
                    "data": chats
                }), flush=True)

            elif action == "search_messages":
                query = req.get("query")
                if not isinstance(query, str) or not query.strip():
                    raise ValueError("The search query must be a non-empty string.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": search_messages(query),
                }), flush=True)

            elif action == "delete_chat":
                chat_id = req.get("chat_id")
                if not isinstance(chat_id, str):
                    raise ValueError("The chat_id must be a string.")
                with get_connection() as conn:
                    conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
                    conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "chat_id": chat_id},
                }), flush=True)

            elif action in ("pin_chat", "pin_project"):
                item_id = req.get("chat_id" if action == "pin_chat" else "project_id")
                is_pinned = req.get("is_pinned")
                if not isinstance(item_id, str) or not item_id.strip():
                    raise ValueError("The item id must be a non-empty string.")
                if not isinstance(is_pinned, bool):
                    raise ValueError("The is_pinned value must be boolean.")
                updated = (
                    set_chat_pinned(item_id, is_pinned)
                    if action == "pin_chat"
                    else set_project_pinned(item_id, is_pinned)
                )
                if not updated:
                    raise ValueError("The requested item was not found.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "is_pinned": is_pinned},
                }), flush=True)

            elif action in ("rename_chat", "rename_project"):
                item_id = req.get("chat_id" if action == "rename_chat" else "project_id")
                field_name = "new_title" if action == "rename_chat" else "new_name"
                new_name = req.get(field_name)
                if not isinstance(item_id, str) or not item_id.strip():
                    raise ValueError("The item id must be a non-empty string.")
                if not isinstance(new_name, str) or not new_name.strip():
                    raise ValueError("The new name must be a non-empty string.")
                renamed = (
                    rename_chat(item_id, new_name.strip())
                    if action == "rename_chat"
                    else rename_project(item_id, new_name.strip())
                )
                if not renamed:
                    raise ValueError("The requested item was not found.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {
                        "success": True,
                        "chat_id" if action == "rename_chat" else "project_id": item_id,
                        "new_title" if action == "rename_chat" else "new_name": new_name.strip(),
                    },
                }), flush=True)

            elif action == "delete_project":
                project_id = req.get("project_id")
                if not isinstance(project_id, str) or not project_id.strip():
                    raise ValueError("The project_id must be a non-empty string.")
                if not remove_project(project_id):
                    raise ValueError("The requested project was not found.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "project_id": project_id},
                }), flush=True)

            elif action == "create_project":
                name = req.get("name")
                chat_ids = req.get("chat_ids", [])
                if not isinstance(name, str) or not name.strip():
                    raise ValueError("The project name must be a non-empty string.")
                if (
                    not isinstance(chat_ids, list)
                    or not all(isinstance(chat_id, str) for chat_id in chat_ids)
                ):
                    raise ValueError("The chat_ids value must be a list of strings.")
                project = persist_project(name.strip(), chat_ids)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {
                        "id": project["id"],
                        "name": project["name"],
                        "date": project["created_at"],
                        "is_pinned": project["is_pinned"],
                    },
                }), flush=True)

            elif action == "add_chat_to_project":
                chat_id = req.get("chat_id")
                project_id = req.get("project_id")
                if not isinstance(chat_id, str) or not chat_id.strip():
                    raise ValueError("The chat_id must be a non-empty string.")
                if not isinstance(project_id, str) or not project_id.strip():
                    raise ValueError("The project_id must be a non-empty string.")
                add_chat_to_project(chat_id, project_id)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {"success": True, "chat_id": chat_id, "project_id": project_id},
                }), flush=True)

            elif action in ("export_pdf", "export_word"):
                chat_id = req.get("chat_id")
                if not isinstance(chat_id, str) or not chat_id.strip():
                    raise ValueError("The chat_id must be a non-empty string.")
                template_type = get_template_type(req.get("template_type"))
                map_image = req.get("map_image")
                map_capture_path = None
                if map_image is not None:
                    if not isinstance(map_image, str) or not map_image.startswith(
                        "data:image/"
                    ):
                        raise ValueError("The map_image must be a base64 image data URL.")
                    try:
                        encoded = map_image.split(",", 1)[1]
                        image_bytes = base64.b64decode(encoded, validate=True)
                    except (IndexError, ValueError, binascii.Error) as error:
                        raise ValueError("The map_image is not valid base64.") from error
                    if not image_bytes:
                        raise ValueError("The map_image is empty.")
                    map_capture_path = str(
                        Path(tempfile.gettempdir()) / "map_capture.jpg"
                    )
                    Path(map_capture_path).write_bytes(image_bytes)
                try:
                    file_path = (
                        export_chat_pdf(
                            chat_id,
                            map_image_path=map_capture_path,
                            template_type=template_type,
                        )
                        if action == "export_pdf"
                        else export_chat_docx(
                            chat_id,
                            map_image_path=map_capture_path,
                            template_type=template_type,
                        )
                    )
                finally:
                    if map_capture_path:
                        Path(map_capture_path).unlink(missing_ok=True)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {
                        "success": True,
                        "chat_id": chat_id,
                        "format": "pdf" if action == "export_pdf" else "word",
                        "template_type": template_type,
                        "file_path": file_path,
                    },
                }), flush=True)

            elif action == "generate_report":
                chat_id = req.get("chat_id")
                fmt = req.get("format")
                if not isinstance(chat_id, str) or not chat_id.strip():
                    raise ValueError("The chat_id must be a non-empty string.")
                if fmt not in ("pdf", "word", "excel"):
                    raise ValueError("The format must be one of: pdf, word, excel.")
                template_type = get_template_type(req.get("template_type"))
                if fmt == "pdf":
                    file_path = export_chat_pdf(
                        chat_id, template_type=template_type
                    )
                elif fmt == "word":
                    file_path = export_chat_docx(
                        chat_id, template_type=template_type
                    )
                else:
                    file_path = export_chat_excel(chat_id)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": {
                        "success": True,
                        "chat_id": chat_id,
                        "format": fmt,
                        "template_type": template_type,
                        "file_path": file_path,
                    },
                }), flush=True)

            elif action == "add_law":
                file_path = req.get("file_path")
                raw_law_name = req.get("law_name")
                country = req.get("country", "MA")
                if not isinstance(file_path, str) or not file_path.strip():
                    raise ValueError("The PDF file path is required.")
                if not isinstance(raw_law_name, str):
                    raise ValueError("The law name is required.")
                if not isinstance(country, str):
                    raise ValueError("The country code is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": add_law(file_path, raw_law_name, country),
                }), flush=True)

            elif action == "add_plant":
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": add_plant(
                        latin_name=req.get("latin_name"),
                        common_name=req.get("common_name"),
                        water_need=req.get("water_need"),
                        sun_exposure=req.get("sun_exposure"),
                        source_name=req.get("source_name"),
                        source_url=req.get("source_url"),
                        source_quote=req.get("source_quote"),
                    ),
                }), flush=True)

            elif action == "search_plants":
                query = req.get("query", req.get("name"))
                if not isinstance(query, str) or not query.strip():
                    raise ValueError("The plant name is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": search_plants(query.strip(), strict=True),
                }), flush=True)

            elif action == "/site" or action == "site_lookup":
                location = req.get("query") or req.get("location") or req.get("name")
                if not isinstance(location, str):
                    raise ValueError("The location query is required.")
                location = location.strip()
                if not location:
                    raise ValueError("The location query is required.")
                print(json.dumps({"type": "chat_step", "id": req_id, "step": "searching OpenStreetMap · reading the web · drafting"}), flush=True)
                os_result = search_location(location)
                if os_result.get("error") == "no_internet":
                    print(json.dumps({"type": "response", "id": req_id, "data": {"error": "no_internet"}}), flush=True)
                    continue
                if os_result.get("error") in {"no_match", "no_internet"}:
                    print(json.dumps({"type": "response", "id": req_id, "data": {"error": "no_match"}}), flush=True)
                    continue
                context = fetch_site_context(os_result["display_name"])
                payload = {
                    "display_name": os_result["display_name"],
                    "lat": os_result["lat"],
                    "lon": os_result["lon"],
                    "type": os_result.get("type", "site"),
                    "boundingbox": os_result.get("boundingbox"),
                    "geojson": os_result.get("geojson"),
                    "plants": context.get("plants", ""),
                    "water": context.get("water", ""),
                    "notes": context.get("notes", ""),
                }
                print(json.dumps({
                    "type": "chat_done",
                    "id": req_id,
                    "site_data": payload,
                    "content": "Here is the site information:",
                    "sources": [],
                    "plant_data": [],
                    "thinking": "",
                }), flush=True)
                continue

            elif action in (
                "get_ollama_status",
                "get_installed_models",
                "delete_model",
                "get_loaded_models",
                "get_app_usage",
                "get_model_capabilities",
                "pull_model",
                "cancel_pull",
            ):
                handle_model_action(action, req)

            elif action == "run_speed_test":
                start_speed_test(req_id, resolve_chat_model(req))

            elif action == "create_chat":
                project_id = req.get("project_id")
                if project_id is not None:
                    if not isinstance(project_id, str) or not project_id.strip():
                        raise ValueError("The project_id must be a non-empty string or null.")
                    with get_connection() as conn:
                        project = conn.execute(
                            "SELECT id FROM projects WHERE id = ?", (project_id,)
                        ).fetchone()
                    if project is None:
                        raise ValueError("The requested project was not found.")
                chat = persist_chat(project_id, "New Chat")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": chat,
                }), flush=True)

            elif action == "get_history":
                chat_id = req.get("chat_id", "chat_1")
                if not isinstance(chat_id, str):
                    raise ValueError("The chat_id must be a string.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": get_messages(chat_id),
                }), flush=True)

            elif action == "clear_context":
                chat_id = req.get("chat_id")
                if not isinstance(chat_id, str) or not chat_id.strip():
                    raise ValueError("The chat_id must be a non-empty string.")
                if not clear_chat_context(chat_id):
                    raise ValueError("The requested chat no longer exists.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": True,
                }), flush=True)

            elif action == "check_file_exists":
                file_path = req.get("file_path")
                if not isinstance(file_path, str) or not file_path.strip():
                    raise ValueError("A file_path is required.")
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": Path(file_path).expanduser().is_file(),
                }), flush=True)

            elif action == "save_generated_file":
                file_path = req.get("file_path")
                destination_path = req.get("destination_path")
                if not isinstance(file_path, str) or not file_path.strip():
                    raise ValueError("A generated file path is required.")
                if not isinstance(destination_path, str) or not destination_path.strip():
                    raise ValueError("A destination path is required.")
                source = Path(file_path).expanduser()
                destination = Path(destination_path).expanduser()
                if not source.is_file():
                    raise FileNotFoundError(f"The generated file no longer exists: {file_path}")
                shutil.copy2(source, destination)
                print(json.dumps({
                    "type": "response",
                    "id": req_id,
                    "data": str(destination),
                }), flush=True)

            elif action in {
                "chat",
                "edit_message_and_regenerate",
                "regenerate_message",
            }:
                chat_id = req.get("chat_id", "chat_1")
                if not isinstance(chat_id, str):
                    raise ValueError("The chat_id must be a string.")
                skip_save_user = False
                branch_messages = None
                user_parent_id = None
                assistant_parent_id = None
                if action == "edit_message_and_regenerate":
                    message_id = req.get("message_id")
                    new_content = req.get("new_content")
                    if (
                        not isinstance(message_id, str)
                        or not message_id.strip()
                        or not isinstance(new_content, str)
                        or not new_content.strip()
                    ):
                        raise ValueError("A message_id and non-empty new_content are required.")
                    with get_connection() as conn:
                        target = conn.execute(
                            "SELECT role, parent_id FROM messages "
                            "WHERE chat_id = ? AND id = ?",
                            (chat_id, message_id),
                        ).fetchone()
                        if target is None or target["role"] != "user":
                            print(json.dumps({
                                "type": "error",
                                "id": req_id,
                                "payload": {
                                    "bucket": "db",
                                    "user_message": (
                                        "Only user messages can be edited. "
                                        "Please refresh the chat and try again."
                                    ),
                                },
                            }), flush=True)
                            continue
                        edited_message_id = insert_message(
                            conn,
                            chat_id,
                            "user",
                            new_content.strip(),
                            parent_id=target["parent_id"],
                        )
                    branch_messages = build_active_branch(chat_id, edited_message_id)
                    assistant_parent_id = edited_message_id
                    skip_save_user = True
                elif action == "regenerate_message":
                    message_id = req.get("message_id")
                    if not isinstance(message_id, str) or not message_id.strip():
                        raise ValueError("A message_id is required.")
                    print(
                        f"DEBUG REGEN: Looking for assistant ID -> {message_id}",
                        file=sys.stderr,
                        flush=True,
                    )
                    with get_connection() as conn:
                        target = conn.execute(
                            "SELECT id, parent_id FROM messages "
                            "WHERE id = ? AND chat_id = ? AND role = 'assistant'",
                            (message_id, chat_id),
                        ).fetchone()
                    if target is None:
                        print(json.dumps({
                            "type": "error",
                            "id": req_id,
                            "payload": {
                                "bucket": "db",
                                "user_message": (
                                    "Could not find the message to regenerate. "
                                    "Please refresh the chat."
                                ),
                            },
                        }), flush=True)
                        continue
                    assistant_parent_id = target["parent_id"]
                    branch_messages = (
                        build_active_branch(chat_id, assistant_parent_id)
                        if assistant_parent_id is not None
                        else []
                    )
                    if not branch_messages or branch_messages[-1]["role"] != "user":
                        print(json.dumps({
                            "type": "error",
                            "id": req_id,
                            "payload": {
                                "bucket": "db",
                                "user_message": (
                                    "Could not find a user prompt to regenerate from."
                                ),
                            },
                        }), flush=True)
                        continue
                    skip_save_user = True
                model = resolve_chat_model(req)
                modes = get_chat_modes(req)
                temperature = req.get("temperature", 0.1)
                num_ctx = req.get("num_ctx", 4096)
                persona = req.get("persona", "")
                keep_alive = req.get("keep_alive", "5m")
                if (
                    not isinstance(temperature, (int, float))
                    or isinstance(temperature, bool)
                    or not 0 <= temperature <= 1
                ):
                    raise ValueError("Temperature must be between 0 and 1.")
                if (
                    not isinstance(num_ctx, int)
                    or num_ctx not in {2048, 4096, 8192, 16384}
                ):
                    raise ValueError("Context window must be 2048, 4096, 8192, or 16384.")
                if not isinstance(persona, str):
                    raise ValueError("Persona must be a string.")
                if keep_alive not in {"5m", "30m", "1h", "-1", "0"}:
                    raise ValueError("Keep-alive must be 5m, 30m, 1h, -1, or 0.")
                tier, budget = budget_for_hardware(req.get("hardware"))
                logger.info("Chat request using hardware tier %s", tier)
                if branch_messages is None:
                    request_messages = req.get("messages", [])
                    if not isinstance(request_messages, list):
                        raise ValueError("Chat messages must be a list.")
                    request_user_index = next(
                        (
                            index
                            for index in range(len(request_messages) - 1, -1, -1)
                            if isinstance(request_messages[index], dict)
                            and request_messages[index].get("role") == "user"
                        ),
                        None,
                    )
                    if request_user_index is None:
                        raise ValueError("Chat request must include a user message.")
                    user_message = request_messages[request_user_index]
                    previous_message = next(
                        (
                            message
                            for message in reversed(request_messages[:request_user_index])
                            if isinstance(message, dict)
                            and isinstance(message.get("id"), str)
                        ),
                        None,
                    )
                    active_leaf_id = (
                        previous_message["id"] if previous_message is not None else None
                    )
                    try:
                        messages = build_active_branch(chat_id, active_leaf_id)
                    except Exception as e:
                        logger.warning(
                            "Could not build the requested active branch for chat %s: %s. "
                            "Retrying from the latest message.",
                            chat_id,
                            e,
                            exc_info=True,
                        )
                        messages = build_active_branch(chat_id, None)
                    branch_positions = {
                        message["id"]: index for index, message in enumerate(messages)
                    }
                    request_start_id = next(
                        (
                            message["id"]
                            for message in request_messages[:request_user_index]
                            if isinstance(message, dict)
                            and message.get("id") in branch_positions
                        ),
                        None,
                    )
                    if request_start_id is not None:
                        messages = messages[branch_positions[request_start_id]:]
                    messages.append(user_message)
                    user_parent_id = messages[-2]["id"] if len(messages) > 1 else None
                else:
                    messages = branch_messages
                user_message = next(
                    (
                        message for message in reversed(messages)
                        if message.get("role") == "user"
                    ),
                    None,
                )
                if user_message is None or not isinstance(user_message.get("content"), str):
                    raise ValueError("Chat request must include a user message.")
                user_message_content = user_message["content"]
                raw_skill = req.get("skill")
                if raw_skill is not None and raw_skill not in {"pdf", "word", "excel"}:
                    raise ValueError("The skill must be one of: pdf, word, excel.")
                skill = raw_skill if isinstance(raw_skill, str) else None
                raw_template_type = req.get("template_type")
                template_type = (
                    get_template_type(raw_template_type)
                    if raw_template_type is not None
                    else None
                )
                if template_type is not None and skill not in {"pdf", "word"}:
                    raise ValueError(
                        "A memo template can only be selected for PDF or Word."
                    )
                web_fallback_enabled = (
                    get_settings().get("web_fallback_enabled", "false") == "true"
                )
                cache_lookup_allowed = (
                    action == "chat"
                    and not user_message_content.lstrip().startswith("/")
                    and not modes.get("web", False)
                    and skill is None
                    and not req.get("attachments")
                    and not (
                        web_fallback_enabled
                        and classify_intent(user_message_content) in {"law", "plant"}
                    )
                )
                cached_data: dict[str, object] | None = None
                cache_embedding = None
                if cache_lookup_allowed:
                    try:
                        cached_payload_json, cache_embedding = find_cached_payload(
                            user_message_content
                        )
                        if cached_payload_json is not None:
                            try:
                                parsed_cache_payload = json.loads(cached_payload_json)
                            except json.JSONDecodeError:
                                logger.warning(
                                    "Ignoring invalid semantic-cache payload.",
                                    exc_info=True,
                                )
                            else:
                                if (
                                    isinstance(parsed_cache_payload, dict)
                                    and isinstance(
                                        parsed_cache_payload.get("content"), str
                                    )
                                ):
                                    cached_data = parsed_cache_payload
                                else:
                                    logger.warning(
                                        "Ignoring malformed semantic-cache payload."
                                    )
                    except Exception:
                        logger.exception("Could not check the semantic response cache.")
                saved_attachments, document_chunks, image_attachments = process_attachments(
                    req.get("attachments"), memory_files_directory()
                )
                prompt_content = user_message_content
                with get_connection() as conn:
                    chat = conn.execute(
                        "SELECT title FROM chats WHERE id = ?",
                        (chat_id,),
                    ).fetchone()
                    if chat is None:
                        raise ValueError("The requested chat no longer exists. Start a new chat.")
                    chat_title = str(chat["title"])
                    should_generate_title = chat["title"] == "New Chat"
                if not skip_save_user:
                    assistant_parent_id = save_message(
                        chat_id,
                        "user",
                        user_message_content,
                        attachments=saved_attachments,
                        skill=skill,
                        template_type=template_type,
                        message_id=(
                            req.get("user_message_id")
                            if isinstance(req.get("user_message_id"), str)
                            else None
                        ),
                        parent_id=user_parent_id,
                    )
                    if cached_data is not None:
                        cached_content = cached_data["content"]
                        cached_sources = cached_data.get("sources", [])
                        cached_plant_data = cached_data.get("plant_data", [])
                        cached_site_data = cached_data.get("site_data")
                        cached_thinking = cached_data.get("thinking", "")
                        persisted_cache_message_id = uuid4().hex
                        try:
                            save_message(
                                chat_id,
                                "assistant",
                                cached_content,
                                cached_sources,
                                cached_plant_data,
                                cached_site_data,
                                thinking=cached_thinking,
                                message_id=persisted_cache_message_id,
                                parent_id=assistant_parent_id,
                            )
                        except Exception:
                            persisted_cache_message_id = None
                            logger.exception(
                                "Failed to save the cached assistant message."
                            )
                        print(
                            json.dumps({"type": "chat_start", "id": req_id}),
                            flush=True,
                        )
                        print(json.dumps({
                            "type": "chat_chunk",
                            "id": req_id,
                            "content": cached_content,
                        }), flush=True)
                        print(json.dumps({
                            "type": "chat_done",
                            "id": req_id,
                            "message_id": persisted_cache_message_id,
                            "content": cached_content,
                            "thinking": cached_thinking,
                            "sources": cached_sources,
                            "plant_data": cached_plant_data,
                            "site_data": cached_site_data,
                            "web_sources": [],
                            "attachments": [],
                            "cached": True,
                        }), flush=True)
                        if should_generate_title:
                            threading.Thread(
                                target=generate_title_async,
                                args=(
                                    chat_id,
                                    user_message_content,
                                    model,
                                    keep_alive,
                                ),
                                daemon=True,
                            ).start()
                        continue
                    try:
                        settings = get_settings()
                        auto_save = settings.get("auto_save_prompts", "true") == "true"
                        semantic_auto_save = (
                            settings.get("semantic_auto_save", "false") == "true"
                        )
                        model_installed = False
                        if auto_save and semantic_auto_save:
                            try:
                                model_installed = check_embedding_model()["installed"]
                            except (
                                httpx.HTTPError,
                                ollama.ResponseError,
                                ConnectionError,
                                TimeoutError,
                                TypeError,
                                ValueError,
                            ):
                                logger.exception(
                                    "Could not check whether the embeddings model is installed."
                                )
                        print(
                            f"DEBUG SEMANTIC: auto_save={auto_save}, "
                            f"semantic={semantic_auto_save}, "
                            f"model_installed={model_installed}",
                            file=sys.stderr,
                            flush=True,
                        )
                        auto_save_prompt_if_needed(
                            user_message_content,
                            auto_save=auto_save,
                            semantic_auto_save=semantic_auto_save,
                            model_installed=model_installed,
                        )
                    except sqlite3.Error:
                        logger.exception("Could not auto-save a frequent prompt.")

                print(json.dumps({"type": "chat_start", "id": req_id}), flush=True)

                thinking_parts: list[str] = []
                result = {
                    "answer": "",
                    "sources": [],
                    "plant_data": [],
                    "site_data": None,
                    "web_sources": [],
                    "thinking": "",
                    "generated_template_type": template_type,
                }
                persisted_message_id = None
                generation_succeeded = False
                try:
                    print(
                        f"DEBUG: Triggering generation with messages: "
                        f"{[m['role'] for m in messages]}",
                        file=sys.stderr,
                        flush=True,
                    )
                    result = run_chat(
                        model=model,
                        question=prompt_content,
                        messages=[
                            {
                                **message,
                                "content": (
                                    prompt_content
                                    if message is user_message
                                    else message.get("content", "")
                                ),
                            }
                            for message in messages
                        ],
                        modes=modes,
                        attachments=saved_attachments,
                        document_chunks=document_chunks,
                        image_attachments=image_attachments,
                        emit=lambda event: print(json.dumps(event), flush=True),
                        req_id=req_id,
                        thinking_parts=thinking_parts,
                        skill=skill,
                        template_type=template_type,
                        max_law_articles=budget["max_law_articles"],
                        max_plants=budget["max_plants"],
                        num_predict=budget["num_predict"],
                        extractive=budget["extractive"],
                        title=chat_title,
                        temperature=float(temperature),
                        num_ctx=num_ctx,
                        persona=persona,
                        keep_alive=keep_alive,
                    )
                    generation_succeeded = True
                except Exception as error:  # noqa: BLE001
                    payload = emit_error(req_id, error)
                    # Keep the bubble consistent with what the frontend shows.
                    if not result["answer"]:
                        result["answer"] = str(payload["message"])
                finally:
                    # `chat_done` is the frontend's completion signal and drives
                    # the final message render. It must be sent even when the
                    # multi-pass loop (or persistence) fails.
                    result["thinking"] = (
                        result.get("thinking") or "".join(thinking_parts)
                    )
                    try:
                        persisted_message_id = uuid4().hex
                        save_message(
                            chat_id,
                            "assistant",
                            result["answer"],
                            result["sources"],
                            result["plant_data"],
                            result.get("site_data"),
                            thinking=result["thinking"],
                            file_path=result.get("generated_file_path"),
                            web_sources=result.get("web_sources", []),
                            file_size=result.get("generated_file_size"),
                            file_type=result.get("generated_file_type"),
                            template_type=result.get("generated_template_type"),
                            unverified_web=result.get("unverified_web") is True,
                            message_id=persisted_message_id,
                            parent_id=assistant_parent_id,
                        )
                    except Exception:
                        persisted_message_id = None
                        logger.exception("Failed to save the assistant message.")
                    if (
                        generation_succeeded
                        and persisted_message_id is not None
                        and cache_lookup_allowed
                        and result.get("unverified_web") is not True
                        and result["answer"].strip()
                    ):
                        try:
                            if (
                                cache_embedding is None
                                and check_embedding_model()["installed"]
                            ):
                                cache_embedding = get_embedding(
                                    user_message_content
                                )
                            if cache_embedding is not None:
                                cache_payload = {
                                    "content": result["answer"],
                                    "sources": result["sources"],
                                    "plant_data": result["plant_data"],
                                    "site_data": result.get("site_data"),
                                    "thinking": result["thinking"],
                                }
                                insert_cache_entry(
                                    uuid4().hex,
                                    user_message_content,
                                    cache_embedding,
                                    json.dumps(cache_payload),
                                )
                        except Exception:
                            logger.exception(
                                "Could not save the successful answer to semantic cache."
                            )
                    print(json.dumps({
                        "type": "chat_done",
                        "id": req_id,
                        "message_id": persisted_message_id,
                        # The full accumulated answer. The frontend uses it to
                        # replace the streaming placeholder, so a dropped or
                        # empty chunk can never leave an empty bubble.
                        "content": result["answer"],
                        "thinking": result["thinking"],
                        "sources": result["sources"],
                        "plant_data": result["plant_data"],
                        "site_data": result.get("site_data"),
                        "web_sources": result.get("web_sources", []),
                        "attachments": saved_attachments,
                        "file_path": result.get("generated_file_path"),
                        "file_size": result.get("generated_file_size"),
                        "file_type": result.get("generated_file_type"),
                        "template_type": result.get("generated_template_type"),
                        "usage": result.get("usage"),
                        **(
                            {"unverified_web": True}
                            if result.get("unverified_web") is True
                            else {}
                        ),
                    }), flush=True)
                    if should_generate_title:
                        threading.Thread(
                            target=generate_title_async,
                            args=(chat_id, user_message_content, model, keep_alive),
                            daemon=True,
                        ).start()

        except Exception as error:  # noqa: BLE001
            emit_error(req_id, error)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(
            f"FATAL SIDECAR CRASH: {traceback.format_exc()}",
            file=sys.stderr,
            flush=True,
        )
        logger.critical("Sidecar stopped after an unhandled exception: %s", error)
