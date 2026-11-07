"""Scheduled local SQLite backups."""

import calendar
import logging
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from db import BACKUPS_DIR, create_database_backup, get_settings, save_setting

logger = logging.getLogger(__name__)

FREQUENCIES = {"off", "daily", "weekly", "monthly"}
MAX_AUTOMATIC_BACKUPS = 5


def _next_month(value: date) -> date:
    month_index = value.month
    year = value.year
    if month_index == 12:
        month_index = 1
        year += 1
    else:
        month_index += 1
    day = min(value.day, calendar.monthrange(year, month_index)[1])
    return date(year, month_index, day)


def is_backup_due(frequency: str, last_backup_date: str, today: date) -> bool:
    if frequency == "off":
        return False
    if frequency not in FREQUENCIES:
        raise ValueError(f"Unknown automatic backup frequency: {frequency}")
    if not last_backup_date:
        return True

    try:
        last_backup = date.fromisoformat(last_backup_date)
    except ValueError:
        logger.warning(
            "Invalid last_auto_backup_date %r; an automatic backup will run.",
            last_backup_date,
        )
        return True

    if frequency == "daily":
        return today >= last_backup + timedelta(days=1)
    if frequency == "weekly":
        return today >= last_backup + timedelta(days=7)
    return today >= _next_month(last_backup)


def _prune_backups() -> None:
    backups = sorted(BACKUPS_DIR.glob("autobackup_*.db"))
    for backup in backups[:-MAX_AUTOMATIC_BACKUPS]:
        try:
            backup.unlink()
        except OSError:
            logger.exception("Could not prune automatic backup %s.", backup)


def check_auto_backup() -> None:
    """Create a due backup and retain at most five automatic copies."""
    try:
        settings = get_settings()
        frequency = settings.get("auto_backup_frequency", "weekly")
        if not isinstance(frequency, str) or frequency not in FREQUENCIES:
            raise ValueError(f"Invalid automatic backup frequency: {frequency!r}")
        if frequency == "off":
            return

        last_backup_date = settings.get("last_auto_backup_date", "")
        if not isinstance(last_backup_date, str):
            last_backup_date = ""
        today = date.today()
        if not is_backup_due(frequency, last_backup_date, today):
            return

        BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        backup_time = datetime.now()
        backup_path = BACKUPS_DIR / f"autobackup_{backup_time:%Y-%m-%d_%H%M}.db"
        while backup_path.exists():
            backup_time += timedelta(minutes=1)
            backup_path = BACKUPS_DIR / f"autobackup_{backup_time:%Y-%m-%d_%H%M}.db"

        create_database_backup(str(backup_path))
        save_setting("last_auto_backup_date", today.isoformat())
        _prune_backups()
        logger.info("Created automatic database backup at %s.", backup_path)
    except (OSError, sqlite3.Error, ValueError):
        logger.exception("Could not complete the automatic database backup.")
