import json
import logging
import re
import subprocess
import threading
import urllib.request

import ollama
from errors import classify
from usage_stats import run_speed_test

logger = logging.getLogger(__name__)


_OUTPUT_LOCK = threading.Lock()
_PULL_LOCK = threading.Lock()
_ACTIVE_PULLS: dict[str, subprocess.Popen[str]] = {}
_CANCELLED_PULLS: set[str] = set()


def _emit(message: dict[str, object]) -> None:
    with _OUTPUT_LOCK:
        print(json.dumps(message, ensure_ascii=False), flush=True)


def get_ollama_status() -> dict[str, object]:
    try:
        request = urllib.request.Request(
            "http://127.0.0.1:11434/api/tags",
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=1) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                return {
                    "status": "running",
                    "models": [
                        model["name"]
                        for model in data.get("models", [])
                        if isinstance(model, dict) and isinstance(model.get("name"), str)
                    ],
                }
    except Exception:
        pass
    return {"status": "offline", "models": []}


def get_installed_models() -> list[str]:
    try:
        return [model.model for model in ollama.list().models]
    except Exception:
        logger.exception("Failed to fetch installed Ollama models.")
        raise


def delete_model(model_name: object) -> dict[str, bool]:
    if not isinstance(model_name, str) or not model_name.strip():
        raise ValueError("A model name is required to delete a model.")
    try:
        ollama.delete(model_name.strip())
        return {"success": True}
    except Exception:
        logger.exception("Failed to delete Ollama model %s.", model_name)
        raise


def unload_model(model_name: object) -> dict[str, object]:
    if not isinstance(model_name, str) or not model_name.strip():
        return {"success": False, "error": "A model name is required to unload a model."}
    try:
        ollama.generate(model=model_name.strip(), prompt="", keep_alive=0)
        return {"success": True}
    except Exception as error:
        logger.exception("Failed to unload Ollama model %s.", model_name)
        return {"success": False, "error": str(error)}


def get_loaded_models() -> list[str]:
    """Names of the models currently held in memory by Ollama."""
    try:
        response = ollama.ps()
    except Exception:
        logger.exception("Failed to fetch loaded Ollama models.")
        raise
    loaded: list[str] = []
    for entry in getattr(response, "models", None) or []:
        name = getattr(entry, "model", None) or getattr(entry, "name", None)
        if isinstance(name, str) and name.strip():
            loaded.append(name.strip())
    return loaded


def get_app_usage() -> dict[str, object]:
    """Return the loaded Ollama model and its measured VRAM footprint."""
    try:
        response = ollama.ps()
    except Exception:
        logger.exception("Failed to fetch Ollama model usage.")
        raise
    entries = getattr(response, "models", None) or []
    for entry in entries:
        model_name = getattr(entry, "model", None) or getattr(entry, "name", None)
        size_vram = getattr(entry, "size_vram", None)
        if not isinstance(model_name, str) or not isinstance(size_vram, int):
            continue
        size_gb = size_vram / (1024**3)
        return {
            "model_vram": f"{size_gb:.1f} GB",
            "model_vram_gb": size_gb,
            "model_name": model_name,
        }
    return {"model_vram": None, "model_vram_gb": None, "model_name": None}


def get_model_capabilities(model_name: object) -> list[str]:
    """Return Ollama's capability list for a model, e.g. ["completion", "vision"]."""
    if not isinstance(model_name, str) or not model_name.strip():
        return []
    try:
        response = ollama.show(model_name.strip())
        capabilities = getattr(response, "capabilities", None)
        if capabilities is None and hasattr(response, "get"):
            capabilities = response.get("capabilities")
        if not isinstance(capabilities, (list, tuple)):
            return []
        return [
            capability.lower()
            for capability in capabilities
            if isinstance(capability, str) and capability.strip()
        ]
    except Exception:
        logger.exception("Failed to read capabilities for %s.", model_name)
        raise


def model_supports_vision(model_name: str) -> bool:
    return "vision" in get_model_capabilities(model_name)


def _finish_pull(request_id: str, model_name: str, process: subprocess.Popen[str]) -> None:
    try:
        if process.stdout is not None:
            for line in process.stdout:
                status = line.strip()
                if status:
                    _emit({
                        "type": "pull_progress",
                        "id": request_id,
                        "status": status[:160],
                    })
        return_code = process.wait()
        with _PULL_LOCK:
            cancelled = request_id in _CANCELLED_PULLS
        _emit({
            "type": "response",
            "id": request_id,
            "data": {
                "success": return_code == 0 and not cancelled,
                "cancelled": cancelled,
                "model_name": model_name,
            },
        })
    except Exception as error:
        logger.exception("Failed while pulling model %s.", model_name)
        payload = classify(error)
        _emit({
            "type": "error",
            "id": request_id,
            "error": payload["message"],
            "payload": payload,
        })
    finally:
        with _PULL_LOCK:
            _ACTIVE_PULLS.pop(request_id, None)
            _CANCELLED_PULLS.discard(request_id)


def _start_pull(request_id: str, model_name: object) -> None:
    if not isinstance(request_id, str) or not request_id.strip():
        raise ValueError("A request id is required to pull a model.")
    if not isinstance(model_name, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:/-]*", model_name
    ):
        raise ValueError("The model name contains unsupported characters.")

    process = subprocess.Popen(
        ["ollama", "pull", model_name],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",
        text=True,
    )
    with _PULL_LOCK:
        _ACTIVE_PULLS[request_id] = process
    threading.Thread(
        target=_finish_pull,
        args=(request_id, model_name, process),
        daemon=True,
    ).start()


def _cancel_pull(request_id: object) -> bool:
    if not isinstance(request_id, str) or not request_id.strip():
        raise ValueError("The pull request id is required.")
    with _PULL_LOCK:
        process = _ACTIVE_PULLS.get(request_id)
        if process is None or process.poll() is not None:
            return False
        _CANCELLED_PULLS.add(request_id)
        process.terminate()
        return True


def _finish_speed_test(request_id: object, model: str) -> None:
    try:
        _emit({
            "type": "response",
            "id": request_id,
            "data": run_speed_test(model),
        })
    except Exception as error:
        logger.exception("The speed test failed for model %s.", model)
        payload = classify(error)
        _emit({
            "type": "error",
            "id": request_id,
            "error": payload["message"],
            "payload": payload,
        })


def start_speed_test(request_id: object, model: object) -> None:
    """Run the speed test in the background so polling requests still answer."""
    if not isinstance(model, str) or not model.strip():
        raise ValueError("Select a model before running the speed test.")
    threading.Thread(
        target=_finish_speed_test,
        args=(request_id, model.strip()),
        daemon=True,
    ).start()


def handle_model_action(action: str, request: dict[str, object]) -> None:
    request_id = request.get("id")
    if action == "get_ollama_status":
        data = get_ollama_status()
    elif action == "get_installed_models":
        data = get_installed_models()
    elif action == "delete_model":
        data = delete_model(request.get("model_name"))
    elif action == "unload_model":
        data = unload_model(request.get("model_name"))
    elif action == "get_loaded_models":
        data = get_loaded_models()
    elif action == "get_app_usage":
        data = get_app_usage()
    elif action == "get_model_capabilities":
        data = get_model_capabilities(request.get("model_name"))
    elif action == "pull_model":
        _start_pull(request_id, request.get("model_name"))
        return
    elif action == "cancel_pull":
        data = {"success": _cancel_pull(request.get("pull_request_id"))}
    else:
        raise ValueError(f"Unknown model action: {action}")
    _emit({"type": "response", "id": request_id, "data": data})
