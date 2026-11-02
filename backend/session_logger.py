import platform
from collections import deque
from datetime import datetime
import logging
import re

from log_setup import log_directory, today_log_path


_ERROR_LOG_PATTERN = re.compile(
    r"^\S+\s+\S+\s+(?P<level>WARNING|ERROR)\s+(?P<logger>[^:]+):"
)
_EXCLUDED_LOGGERS = {"httpx", "httpcore"}
_MAX_RECENT_ERRORS = 5


def init() -> None:
    log_directory().mkdir(parents=True, exist_ok=True)


def log(message: str) -> None:
    timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
    logging.getLogger("session_logger").error("[%s] %s", timestamp, message.rstrip())


def _recent_errors(lines: list[str]) -> list[str]:
    errors: deque[str] = deque(maxlen=_MAX_RECENT_ERRORS)
    for line in lines:
        match = _ERROR_LOG_PATTERN.match(line)
        if match is None:
            continue
        logger_name = match.group("logger").strip()
        if logger_name in _EXCLUDED_LOGGERS:
            continue
        errors.append(line.rstrip("\n"))
    return list(errors)


def get_diagnostics(app_version: str, hardware: dict[str, object]) -> str:
    try:
        def format_gb(value: object) -> str:
            return (
                f"{value:.1f} GB"
                if isinstance(value, (int, float))
                else "Not detected"
            )

        from db import get_settings

        diagnostics = [
            "Nogic Diagnostics",
            f"OS: {platform.platform()}",
            f"App version: {app_version}",
        ]
        active_model = get_settings().get("activeModel") or "Not selected"
        diagnostics.append(f"Active model: {active_model}")
        diagnostics.append(f"VRAM: {format_gb(hardware.get('vram_gb'))}")
        diagnostics.append(f"RAM: {format_gb(hardware.get('total_ram_gb'))}")
        log_file = today_log_path()
        if log_file.is_file():
            with log_file.open(encoding="utf-8", errors="replace") as stream:
                log_lines = _recent_errors(list(stream))
            diagnostics.extend(
                ["Sidecar log (last 5 errors):", *(log_lines or ["No recent errors."])]
            )
        else:
            diagnostics.append("No recent errors.")
        return "\n".join(diagnostics)
    except Exception as error:
        return (
            "Diagnostics partially unavailable. Version: 1.0.1. "
            f"Error: {error}"
        )
