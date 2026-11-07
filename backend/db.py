# backend/db.py
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from runtime_paths import APP_DATA_ROOT, DATA_DIR, IS_FROZEN
from source_dedup import deduplicate_sources, preferred_law_name

# For development, we'll save the database in the backend folder.
if IS_FROZEN:
    DB_PATH = os.path.join(
        os.getenv("APPDATA"), "com.nogic.app", "nogic.db"
    )
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "nogic.db")

BACKUPS_DIR = APP_DATA_ROOT / "backups"
COUNTRY_HASH_MIGRATION_KEY = "law_country_hash_migration_v1"


def law_article_hash(content: str, country: str) -> str:
    normalized = " ".join(content.split())
    return hashlib.sha256(
        f"{country}\0{normalized}".encode("utf-8")
    ).hexdigest()


@contextmanager
def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    except BaseException:
        conn.rollback()
        raise
    else:
        conn.commit()
    finally:
        conn.close()


def create_database_backup(target_path: str) -> None:
    if not target_path.strip():
        raise ValueError("A backup target path is required.")

    database_path = Path(DB_PATH)
    if not database_path.is_file():
        raise FileNotFoundError(f"The Nogic database does not exist: {database_path}")

    target = Path(target_path).expanduser()
    if target.resolve() == database_path.resolve():
        raise ValueError("The backup target cannot be the live database.")
    output_path = (
        target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        if target.exists()
        else target
    )

    try:
        connection = sqlite3.connect(str(database_path))
        try:
            connection.execute("VACUUM INTO ?", (str(output_path),))
        finally:
            connection.close()
        if output_path != target:
            os.replace(output_path, target)
    except BaseException:
        output_path.unlink(missing_ok=True)
        raise


def restore_database_from(source_path: str) -> None:
    if not source_path.strip():
        raise ValueError("A database backup path is required.")

    source = Path(source_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"The database backup does not exist: {source}")

    source_connection = sqlite3.connect(str(source))
    try:
        result = source_connection.execute("PRAGMA quick_check").fetchone()
        if result is None or result[0] != "ok":
            raise ValueError("The selected file is not a valid SQLite database.")
    finally:
        source_connection.close()

    pre_restore_backup = (
        Path(tempfile.gettempdir()) / f"nogic_pre_restore_{uuid4().hex}.db"
    )
    create_database_backup(str(pre_restore_backup))

    database_path = Path(DB_PATH)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    staged_database = database_path.with_name(
        f".{database_path.name}.{uuid4().hex}.restore"
    )
    try:
        shutil.copy2(source, staged_database)
        staged_connection = sqlite3.connect(str(staged_database))
        try:
            result = staged_connection.execute("PRAGMA quick_check").fetchone()
            if result is None or result[0] != "ok":
                raise ValueError("The selected file is not a valid SQLite database.")
        finally:
            staged_connection.close()

        os.replace(staged_database, database_path)
        for suffix in ("-wal", "-shm"):
            Path(f"{database_path}{suffix}").unlink(missing_ok=True)
    finally:
        staged_database.unlink(missing_ok=True)


def init_db():
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                context_start_id TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                plant_data TEXT,
                site_data TEXT,
                web_sources TEXT,
                thinking TEXT,
                attachments TEXT,
                file_path TEXT,
                file_size INTEGER,
                file_type TEXT,
                template_type TEXT,
                skill TEXT,
                unverified_web INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                parent_id TEXT,
                FOREIGN KEY (chat_id) REFERENCES chats(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                message_id UNINDEXED,
                chat_id UNINDEXED,
                content
            );

            CREATE TRIGGER IF NOT EXISTS messages_fts_insert
            AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts (message_id, chat_id, content)
                VALUES (NEW.id, NEW.chat_id, NEW.content);
            END;

            CREATE TRIGGER IF NOT EXISTS messages_fts_update
            AFTER UPDATE ON messages BEGIN
                DELETE FROM messages_fts WHERE message_id = OLD.id;
                INSERT INTO messages_fts (message_id, chat_id, content)
                VALUES (NEW.id, NEW.chat_id, NEW.content);
            END;

            CREATE TRIGGER IF NOT EXISTS messages_fts_delete
            AFTER DELETE ON messages BEGIN
                DELETE FROM messages_fts WHERE message_id = OLD.id;
            END;

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS prompt_library (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                embedding TEXT,
                usage_count INTEGER NOT NULL DEFAULT 0,
                auto_saved INTEGER NOT NULL DEFAULT 0
            );

            DROP TABLE IF EXISTS semantic_cache;

            CREATE TABLE IF NOT EXISTS semantic_cache (
                id TEXT PRIMARY KEY,
                question_text TEXT NOT NULL,
                embedding TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS law_article_hashes (
                content_hash TEXT PRIMARY KEY,
                law_name TEXT NOT NULL,
                article_num TEXT NOT NULL,
                page_num INTEGER NOT NULL,
                country TEXT NOT NULL DEFAULT 'MA'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS law_articles USING fts5(
                law_name,
                article_num,
                content,
                page_num UNINDEXED,
                sub_law UNINDEXED,
                country UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );
        """)
        fts_count = conn.execute(
            "SELECT count(*) FROM messages_fts"
        ).fetchone()[0]
        if fts_count == 0:
            conn.execute(
                "INSERT INTO messages_fts (message_id, chat_id, content) "
                "SELECT id, chat_id, content FROM messages"
            )
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('modelKeepAlive', '5m') "
            "ON CONFLICT(key) DO NOTHING"
        )
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO NOTHING",
            (
                ("auto_save_prompts", "true"),
                ("semantic_auto_save", "false"),
                ("seen_autosave_tip", "false"),
                ("auto_backup_frequency", "weekly"),
                ("last_auto_backup_date", ""),
                ("web_fallback_enabled", "false"),
            ),
        )

        prompt_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(prompt_library)")
        }
        if "embedding" not in prompt_columns:
            conn.execute("ALTER TABLE prompt_library ADD COLUMN embedding TEXT")
        if "usage_count" not in prompt_columns:
            conn.execute(
                "ALTER TABLE prompt_library "
                "ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0"
            )
        if "auto_saved" not in prompt_columns:
            conn.execute(
                "ALTER TABLE prompt_library "
                "ADD COLUMN auto_saved INTEGER NOT NULL DEFAULT 0"
            )

        # FTS5 virtual tables cannot be altered in place, so rebuild when a
        # schema is missing either metadata column.
        law_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(law_articles)")
        }
        if law_columns and not {"sub_law", "country"}.issubset(law_columns):
            legacy_sub_law = "sub_law" if "sub_law" in law_columns else "NULL"
            legacy_country = "country" if "country" in law_columns else "'MA'"
            conn.execute("ALTER TABLE law_articles RENAME TO law_articles_legacy")
            conn.execute(
                """
                CREATE VIRTUAL TABLE law_articles USING fts5(
                    law_name,
                    article_num,
                    content,
                    page_num UNINDEXED,
                    sub_law UNINDEXED,
                    country UNINDEXED,
                    tokenize='unicode61 remove_diacritics 2'
                )
                """
            )
            conn.execute(
                "INSERT INTO law_articles "
                "(law_name, article_num, content, page_num, sub_law, country) "
                "SELECT law_name, article_num, content, page_num, "
                f"{legacy_sub_law}, {legacy_country} "
                "FROM law_articles_legacy"
            )
            conn.execute("DROP TABLE law_articles_legacy")

        hash_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(law_article_hashes)")
        }
        if "country" not in hash_columns:
            conn.execute(
                "ALTER TABLE law_article_hashes "
                "ADD COLUMN country TEXT NOT NULL DEFAULT 'MA'"
            )
        conn.execute(
            "UPDATE law_articles SET country = 'MA' "
            "WHERE country IS NULL OR country = ''"
        )
        hash_migration = conn.execute(
            "SELECT 1 FROM settings WHERE key = ?",
            (COUNTRY_HASH_MIGRATION_KEY,),
        ).fetchone()
        if not hash_migration:
            law_rows = conn.execute(
                "SELECT law_name, article_num, content, page_num, country "
                "FROM law_articles"
            ).fetchall()
            conn.execute("DELETE FROM law_article_hashes")
            for law_row in law_rows:
                country = law_row["country"] or "MA"
                conn.execute(
                    "INSERT OR IGNORE INTO law_article_hashes "
                    "(content_hash, law_name, article_num, page_num, country) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        law_article_hash(law_row["content"], country),
                        law_row["law_name"],
                        law_row["article_num"],
                        law_row["page_num"],
                        country,
                    ),
                )
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, 'done') "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (COUNTRY_HASH_MIGRATION_KEY,),
            )

        message_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(messages)")
        }
        added_parent_id = "parent_id" not in message_columns
        if added_parent_id:
            conn.execute("ALTER TABLE messages ADD COLUMN parent_id TEXT")
            legacy_chats = conn.execute(
                "SELECT DISTINCT chat_id FROM messages"
            ).fetchall()
            for legacy_chat in legacy_chats:
                legacy_messages = conn.execute(
                    "SELECT id FROM messages WHERE chat_id = ? "
                    "ORDER BY created_at ASC, rowid ASC",
                    (legacy_chat["chat_id"],),
                ).fetchall()
                previous_id = None
                for legacy_message in legacy_messages:
                    conn.execute(
                        "UPDATE messages SET parent_id = ? WHERE id = ?",
                        (previous_id, legacy_message["id"]),
                    )
                    previous_id = legacy_message["id"]
        if "sources" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN sources TEXT")
        if "plant_data" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN plant_data TEXT")
        if "site_data" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN site_data TEXT")
        if "web_sources" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN web_sources TEXT")
        if "thinking" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN thinking TEXT")
        if "attachments" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT")
        if "file_path" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN file_path TEXT")
        if "file_size" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN file_size INTEGER")
        if "file_type" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN file_type TEXT")
        if "template_type" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN template_type TEXT")
        if "skill" not in message_columns:
            conn.execute("ALTER TABLE messages ADD COLUMN skill TEXT")
        if "unverified_web" not in message_columns:
            conn.execute(
                "ALTER TABLE messages "
                "ADD COLUMN unverified_web INTEGER NOT NULL DEFAULT 0"
            )
        project_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(projects)")
        }
        if "is_pinned" not in project_columns:
            conn.execute(
                "ALTER TABLE projects ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
            )
        chat_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(chats)")
        }
        chat_schema = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chats'"
        ).fetchone()
        if (
            chat_schema
            and chat_schema["sql"]
            and "PROJECT_ID TEXT NOT NULL" in chat_schema["sql"].upper()
        ):
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("ALTER TABLE chats RENAME TO chats_legacy")
            conn.execute(
                """
                CREATE TABLE chats (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                )
                """
            )
            conn.execute(
                "INSERT INTO chats (id, project_id, title, created_at, is_pinned) "
                "SELECT id, project_id, title, created_at, is_pinned FROM chats_legacy"
            )
            conn.execute("DROP TABLE chats_legacy")
            conn.execute("PRAGMA foreign_keys = ON")
            chat_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(chats)")
            }
        if "is_pinned" not in chat_columns:
            conn.execute(
                "ALTER TABLE chats ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
            )
        if "context_start_id" not in chat_columns:
            conn.execute("ALTER TABLE chats ADD COLUMN context_start_id TEXT")

def save_message(
    chat_id,
    role,
    content,
    sources=None,
    plant_data=None,
    site_data=None,
    thinking=None,
    attachments=None,
    file_path=None,
    web_sources=None,
    file_size=None,
    file_type=None,
    skill=None,
    message_id=None,
    parent_id=None,
    template_type=None,
    unverified_web=False,
):
    # Keep empty reasoning as NULL so old and non-reasoning messages stay light.
    thinking_text = thinking if isinstance(thinking, str) and thinking.strip() else None
    stored_file_path = file_path if isinstance(file_path, str) and file_path.strip() else None
    stored_file_size = (
        file_size
        if isinstance(file_size, int) and not isinstance(file_size, bool) and file_size >= 0
        else None
    )
    stored_file_type = file_type if isinstance(file_type, str) and file_type.strip() else None
    stored_template_type = (
        template_type
        if isinstance(template_type, str) and template_type.strip()
        else None
    )
    stored_skill = skill if isinstance(skill, str) and skill.strip() else None
    stored_unverified_web = 1 if unverified_web is True else 0
    stored_message_id = message_id or uuid4().hex
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO messages "
            "(id, chat_id, role, content, sources, plant_data, site_data, web_sources, "
            "thinking, attachments, file_path, file_size, file_type, skill, "
            "template_type, unverified_web, created_at, parent_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                stored_message_id,
                chat_id,
                role,
                content,
                json.dumps(sources) if sources is not None else None,
                json.dumps(plant_data) if plant_data is not None else None,
                json.dumps(site_data) if site_data is not None else None,
                json.dumps(web_sources) if web_sources is not None else None,
                thinking_text,
                json.dumps(attachments) if attachments is not None else None,
                stored_file_path,
                stored_file_size,
                stored_file_type,
                stored_skill,
                stored_template_type,
                stored_unverified_web,
                datetime.now().isoformat(),
                parent_id,
            ),
        )
    return stored_message_id


def insert_message(conn, chat_id, role, content, message_id=None, parent_id=None):
    """Insert a plain branch message using the caller's transaction."""
    stored_message_id = message_id or uuid4().hex
    conn.execute(
        "INSERT INTO messages (id, chat_id, role, content, created_at, parent_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            stored_message_id,
            chat_id,
            role,
            content,
            datetime.now().isoformat(),
            parent_id,
        ),
    )
    return stored_message_id


def get_settings():
    """Return the persisted General preferences as a flat key/value object."""
    with get_connection() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


def save_setting(key, value):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def get_all_cache_embeddings() -> list[dict[str, str]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, question_text, embedding, payload_json "
            "FROM semantic_cache ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def insert_cache_entry(
    id: str,
    question: str,
    embedding: list[float],
    payload_json: str,
) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO semantic_cache "
            "(id, question_text, embedding, payload_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                id,
                question,
                json.dumps(embedding),
                payload_json,
                datetime.now().isoformat(),
            ),
        )


def clear_semantic_cache() -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM semantic_cache")


def count_law_articles():
    with get_connection() as conn:
        row = conn.execute(
            "SELECT count(*) AS article_count, count(DISTINCT law_name) AS law_count "
            "FROM law_articles"
        ).fetchone()
    return {"article_count": row["article_count"], "law_count": row["law_count"]}


def get_laws_metadata() -> list[dict[str, str | int]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT law_name AS name, country, count(*) AS article_count "
            "FROM law_articles "
            "GROUP BY law_name, country "
            "ORDER BY law_name COLLATE NOCASE, country"
        ).fetchall()
    return [dict(row) for row in rows]


def delete_law(law_name: str, country: str | None) -> None:
    from law_ingest import law_filename_from_name, normalize_country_code

    if not isinstance(law_name, str) or not law_name.strip():
        raise ValueError("The law name is required.")
    country_code = normalize_country_code(country)
    filename = law_filename_from_name(law_name.strip(), country_code)
    law_directory = DATA_DIR / "laws"
    stem = Path(filename).stem
    filenames = {
        f"{stem}{suffix}{language}.pdf"
        for suffix in ("", "-", "_")
        for language in ("fr", "ar")
    }
    filenames.add(filename)
    if country_code == "MA":
        legacy_stem = stem.replace("Law_MA_", "Law_", 1)
        filenames.update(
            f"{legacy_stem}{suffix}{language}.pdf"
            for suffix in ("", "-", "_")
            for language in ("fr", "ar")
        )
        filenames.add(f"{legacy_stem}.pdf")

    with get_connection() as conn:
        conn.execute(
            "DELETE FROM law_articles WHERE law_name = ? AND country = ?",
            (law_name.strip(), country_code),
        )
        conn.execute(
            "DELETE FROM law_article_hashes WHERE law_name = ? AND country = ?",
            (law_name.strip(), country_code),
        )
        for candidate in filenames:
            (law_directory / candidate).unlink(missing_ok=True)


def get_plants_metadata() -> list[dict[str, Any]]:
    from plant_search import load_plants

    return load_plants()


def delete_plant(plant_id: str) -> None:
    if not isinstance(plant_id, str) or not plant_id.strip():
        raise ValueError("The plant ID is required.")
    plant_id = plant_id.strip()

    from import_plants import save_plants
    from plant_search import load_plants

    plants = load_plants()
    remaining = [plant for plant in plants if plant["id"] != plant_id]
    if len(remaining) == len(plants):
        raise ValueError(f"No plant found with ID {plant_id}.")
    save_plants(remaining)


def create_chat(project_id=None, title="New Chat"):
    chat = {
        "id": str(uuid4()),
        "project_id": project_id,
        "title": title,
        "created_at": datetime.now().isoformat(),
        "is_pinned": False,
    }
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO chats (id, project_id, title, created_at, is_pinned) "
            "VALUES (?, ?, ?, ?, 0)",
            (chat["id"], chat["project_id"], chat["title"], chat["created_at"]),
        )
    return chat


def create_project(name, chat_ids=None):
    project = {
        "id": str(uuid4()),
        "name": name,
        "created_at": datetime.now().isoformat(),
        "is_pinned": False,
    }
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, created_at, is_pinned) VALUES (?, ?, ?, 0)",
            (project["id"], project["name"], project["created_at"]),
        )
        if chat_ids:
            placeholders = ",".join("?" for _ in chat_ids)
            conn.execute(
                f"UPDATE chats SET project_id = ? WHERE id IN ({placeholders})",
                (project["id"], *chat_ids),
            )
    return project


def add_chat_to_project(chat_id, project_id):
    with get_connection() as conn:
        project = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if project is None:
            raise ValueError("The requested project was not found.")
        result = conn.execute(
            "UPDATE chats SET project_id = ? WHERE id = ?",
            (project_id, chat_id),
        )
    if result.rowcount != 1:
        raise ValueError("The requested chat was not found.")
    return True


def set_chat_pinned(chat_id, is_pinned):
    with get_connection() as conn:
        result = conn.execute(
            "UPDATE chats SET is_pinned = ? WHERE id = ?",
            (1 if is_pinned else 0, chat_id),
        )
    return result.rowcount == 1


def clear_chat_context(chat_id):
    """Set the visible latest message as the start of the new AI context."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM messages WHERE chat_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (chat_id,),
        ).fetchone()
        result = conn.execute(
            "UPDATE chats SET context_start_id = ? WHERE id = ?",
            (row["id"] if row else None, chat_id),
        )
    return result.rowcount == 1


def set_project_pinned(project_id, is_pinned):
    with get_connection() as conn:
        result = conn.execute(
            "UPDATE projects SET is_pinned = ? WHERE id = ?",
            (1 if is_pinned else 0, project_id),
        )
    return result.rowcount == 1


def rename_chat(chat_id, new_title):
    with get_connection() as conn:
        result = conn.execute(
            "UPDATE chats SET title = ? WHERE id = ?",
            (new_title, chat_id),
        )
    return result.rowcount == 1


def rename_project(project_id, new_name):
    with get_connection() as conn:
        result = conn.execute(
            "UPDATE projects SET name = ? WHERE id = ?",
            (new_name, project_id),
        )
    return result.rowcount == 1


def delete_project(project_id):
    with get_connection() as conn:
        conn.execute("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ?)", (project_id,))
        conn.execute("DELETE FROM chats WHERE project_id = ?", (project_id,))
        result = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return result.rowcount == 1

def get_messages(chat_id):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, chat_id, role, content, sources, plant_data, site_data, "
            "web_sources, thinking, "
            "attachments, file_path, file_size, file_type, skill, template_type, created_at, "
            "parent_id, unverified_web "
            "FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC",
            (chat_id,),
        ).fetchall()
    messages = []
    for row in rows:
        message = dict(row)
        message["sources"] = json.loads(message["sources"]) if message["sources"] else []
        message["plant_data"] = (
            json.loads(message["plant_data"]) if message["plant_data"] else []
        )
        message["site_data"] = (
            json.loads(message["site_data"]) if message["site_data"] else None
        )
        message["web_sources"] = (
            json.loads(message["web_sources"]) if message["web_sources"] else []
        )
        # Always a string: the frontend validator rejects null.
        message["thinking"] = message["thinking"] or ""
        message["attachments"] = (
            json.loads(message["attachments"]) if message["attachments"] else []
        )
        # Always a string: the frontend validator rejects null.
        message["file_path"] = message["file_path"] or ""
        message["unverified_web"] = bool(message["unverified_web"])
        messages.append(message)
    return messages


def build_active_branch(chat_id, active_leaf_id=None):
    """Return one message path from the chat root through the selected leaf."""
    messages = get_messages(chat_id)
    messages_by_id = {message["id"]: message for message in messages}
    if active_leaf_id is not None and active_leaf_id not in messages_by_id:
        print(
            f"WARNING: active_leaf_id {active_leaf_id} not found in DB. "
            "Falling back to latest message.",
            file=sys.stderr,
        )
        active_leaf_id = None

    if active_leaf_id is None:
        with get_connection() as conn:
            latest_message = conn.execute(
                "SELECT id FROM messages WHERE chat_id = ? "
                "ORDER BY created_at DESC, rowid DESC LIMIT 1",
                (chat_id,),
            ).fetchone()
        if latest_message is None:
            return []
        active_leaf_id = latest_message["id"]

    branch = []
    visited = set()
    current_id = active_leaf_id
    while current_id is not None:
        if current_id in visited:
            raise ValueError("The message history contains a parent cycle.")
        visited.add(current_id)
        current_message = messages_by_id.get(current_id)
        if current_message is None:
            raise ValueError("The message history references a missing parent.")
        branch.append(current_message)
        current_id = current_message["parent_id"]

    branch.reverse()
    return branch

STEM_SUFFIXES = ("ements", "ement", "ations", "ation", "es", "s", "e", "x")
# Terms present in more than this share of the corpus carry little
# discriminative signal and dilute the BM25 ranking (e.g. "autorisation").
MAX_TERM_DF_RATIO = 0.10
MIN_QUERY_TERMS = 3
# Table-of-contents entries are indexed as short heading-only chunks. They
# match a query's generic nouns but carry no rule text, so they are skipped.
MIN_ARTICLE_LENGTH = 80
# Long chunks (some recueil articles exceed 10k characters) can fill the
# model's context window and leave no room for the answer.
MAX_ARTICLE_CHARS = 2000


def _stem(word):
    """Strip a common French suffix so FTS5 prefix matching handles plurals
    and inflections ("jointes" -> "joint", "documents" -> "document")."""
    for suffix in STEM_SUFFIXES:
        if word.endswith(suffix):
            candidate = word[: len(word) - len(suffix)]
            if len(candidate) >= 5:
                return candidate
    return word


def _match_term(word):
    stem = _stem(word)
    return f'"{stem}"*' if stem != word else f'"{word}"'


def _document_frequency(conn, word):
    return conn.execute(
        "SELECT count(*) FROM law_articles WHERE law_articles MATCH ?",
        (_match_term(word),),
    ).fetchone()[0]


def search_law(query, limit=8):
    print(f"SEARCH QUERY: {query}", file=sys.stderr, flush=True)
    stop_words = {
        "a", "about", "an", "and", "are", "as", "at", "be", "by", "for",
        "from", "how", "i", "in", "is", "it", "of", "on", "or", "that",
        "the", "this", "to", "what", "when", "where", "which", "who",
        "why", "with", "au", "aux", "avec", "ce", "ces", "dans", "de",
        "des", "du", "elle", "en", "et", "eux", "il", "je", "la", "le",
        "les", "leur", "lui", "ma", "mais", "me", "meme", "mes", "moi",
        "mon", "ne", "nos", "notre", "nous", "on", "ou", "par", "pas",
        "pour", "qu", "que", "qui", "sa", "se", "ses", "son", "sur", "ta",
        "te", "tes", "toi", "ton", "tu", "un", "une", "vos", "votre",
        "vous",
    }
    normalized_query = "".join(
        character
        for character in unicodedata.normalize("NFD", query)
        if unicodedata.category(character) != "Mn"
    )
    words = re.sub(r"[^\w\s]", " ", normalized_query).split()
    words = [
        word
        for word in words
        if word.casefold() not in stop_words and len(word) > 1
    ]
    if not words:
        return []
    unique_words = list(dict.fromkeys(word.casefold() for word in words))
    with get_connection() as conn:
        total = conn.execute("SELECT count(*) FROM law_articles").fetchone()[0]
        frequencies = sorted(
            ((_document_frequency(conn, word), word) for word in unique_words),
            key=lambda item: item[0],
        )
        if total:
            selected = [
                word for frequency, word in frequencies
                if frequency / total <= MAX_TERM_DF_RATIO
            ]
        else:
            selected = []
        if len(selected) < MIN_QUERY_TERMS:
            selected = [word for _, word in frequencies[:MIN_QUERY_TERMS]]
        dropped = [word for _, word in frequencies if word not in selected]
        if dropped:
            print(f"DROPPED TERMS: {' '.join(dropped)}", file=sys.stderr, flush=True)
        match_query = " OR ".join(_match_term(word) for word in selected)
        rows = conn.execute(
            "SELECT law_name, article_num, content, page_num, sub_law, country, "
            "rank AS bm25_score "
            "FROM law_articles WHERE law_articles MATCH ? "
            "AND length(content) >= ? ORDER BY rank LIMIT ?",
            (match_query, MIN_ARTICLE_LENGTH, limit),
        ).fetchall()
    results = [dict(row) for row in rows]
    print(f"FOUND ARTICLES: {len(results)}", file=sys.stderr, flush=True)
    return results

def law_display_name(source):
    """Prefer the most informative Latin law name when an Arabic alias exists."""
    return preferred_law_name(source)


def format_law_results(results):
    formatted = []
    for article in deduplicate_sources(results):
        law_name = re.sub(r"\s*\([^)]*\)", "", law_display_name(article)).strip()
        content = article["content"].strip()
        if len(content) > MAX_ARTICLE_CHARS:
            content = content[:MAX_ARTICLE_CHARS].rstrip() + " […]"
        formatted.append(
            f"{law_name}, article {article['article_num']} "
            f"(page {article['page_num']}):\n{content}"
        )
    return "\n\n".join(formatted)