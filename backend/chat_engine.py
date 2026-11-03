"""Ollama streaming, thinking extraction, and the DeepThink multi-pass loop."""

import json
import sys
import re
import time
from typing import Any, Callable

import ollama
from db import get_connection

from deep_think_prompts import (
    CRITIQUE_INSTRUCTION,
    DRAFT_INSTRUCTION,
    PLAN_INSTRUCTION,
    REVISE_INSTRUCTION,
)

Emit = Callable[[dict[str, Any]], None]

ANSWER_OPTIONS = {"num_predict": 1024, "temperature": 0.1}
# DeepThink passes must fit both the reasoning stream and the visible text.
# With think=True, a 512/1024 budget was consumed before the answer started.
DEEP_THINK_OPTIONS = {"num_predict": 2048, "temperature": 0.2}
MAX_HELPER_CHARS = 2000
CRASH_NOTICE = "\n[Model crashed due to memory limits. Try switching to Fast mode.]"
TITLE_OPTIONS = {"num_predict": 10, "temperature": 0.0, "num_ctx": 512}
TITLE_TIMEOUT_SECONDS = 10


def _log(message: str) -> None:
    print(f"DeepThink: {message}", file=sys.stderr, flush=True)


def _fallback_title(user_prompt: str) -> str:
    """Return a deterministic title when Ollama cannot answer."""
    return (" ".join(user_prompt.split()[:4]).strip().capitalize() or "New Chat")[:50]


def _title_from_response(response: Any) -> str | None:
    raw_title = (
        response.get("response")
        if hasattr(response, "get")
        else getattr(response, "response", None)
    )
    if not isinstance(raw_title, str):
        return None
    title = raw_title.strip().strip("\"'")
    title = title.replace("\"", "").replace("'", "")
    title = re.sub(r"^(?:Title|Chat title)\s*:\s*", "", title, flags=re.IGNORECASE)
    words = title.split()
    if len(words) > 6:
        title = " ".join(words[:4])
    else:
        title = " ".join(words)
    if not title or "error" in title.lower():
        return None
    return title[:50]


def generate_title_async(
    chat_id: str,
    user_prompt: str,
    model: str,
    keep_alive: str = "5m",
) -> None:
    """Generate an isolated title after Ollama releases the chat context."""
    time.sleep(0.5)
    prompt = (
        "Create a short, 2-4 word title for a chat that starts with this question. "
        "Output ONLY the title text, no quotes, no punctuation, no explanations. "
        f"Question: {user_prompt}"
    )
    new_title = _fallback_title(user_prompt)
    try:
        title_client = ollama.Client(timeout=TITLE_TIMEOUT_SECONDS)
        response = title_client.generate(
            model=model,
            prompt=prompt,
            options=TITLE_OPTIONS,
            keep_alive=keep_alive,
        )
        new_title = _title_from_response(response) or new_title
    except Exception as error:
        _log(f"title generation failed; using prompt fallback: {error}")

    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE chats SET title = ? WHERE id = ? AND title = 'New Chat'",
                (new_title, chat_id),
            )
        print(json.dumps({
            "type": "chat_title_updated",
            "chat_id": chat_id,
            "new_title": new_title,
        }), flush=True)
    except Exception as error:
        _log(f"title persistence failed: {error}")


def _message_field(message: Any, name: str) -> str:
    """Read a field from an Ollama Message object or a plain dict."""
    if hasattr(message, "get"):
        value = message.get(name)
    else:
        value = getattr(message, name, None)
    return value if isinstance(value, str) else ""


def _usage_field(chunk: Any, name: str) -> int | None:
    value = chunk.get(name) if hasattr(chunk, "get") else getattr(chunk, name, None)
    return value if isinstance(value, int) and value >= 0 else None


def _emit_step(emit: Emit, req_id: Any, label: str) -> None:
    emit({"type": "chat_step", "id": req_id, "step": label})


def _emit_thinking(emit: Emit, req_id: Any, content: str) -> None:
    emit({"type": "chat_thinking_chunk", "id": req_id, "content": content})


def _stream_call(
    model: str,
    messages: list[dict[str, Any]],
    think: bool,
    options: dict[str, Any],
    emit: Emit,
    req_id: Any,
    parts: list[str],
    thinking_parts: list[str] | None = None,
    emit_text: bool = True,
    keep_alive: str = "5m",
    usage: dict[str, int] | None = None,
) -> None:
    """Stream one Ollama call, forwarding reasoning and answer text.

    Text is emitted as `chat_chunk` (unless this is a DeepThink helper pass)
    and appended to `parts` as it arrives, so a mid-stream failure keeps
    whatever the user already saw. Reasoning is appended to `thinking_parts`
    when the caller needs it for persistence.
    """
    stream = ollama.chat(
        model=model,
        messages=messages,
        think=think,
        options=options,
        keep_alive=keep_alive,
        stream=True,
    )
    for chunk in stream:
        if usage is not None:
            prompt_tokens = _usage_field(chunk, "prompt_eval_count")
            completion_tokens = _usage_field(chunk, "eval_count")
            if prompt_tokens is not None:
                usage["prompt_tokens"] = prompt_tokens
            if completion_tokens is not None:
                usage["completion_tokens"] = completion_tokens
        message = chunk["message"]
        thinking = _message_field(message, "thinking")
        if thinking:
            _emit_thinking(emit, req_id, thinking)
            if thinking_parts is not None:
                thinking_parts.append(thinking)
        text = _message_field(message, "content")
        if text:
            if emit_text:
                emit({"type": "chat_chunk", "id": req_id, "content": text})
            parts.append(text)


def stream_answer(
    model: str,
    messages: list[dict[str, Any]],
    think: bool,
    emit: Emit,
    req_id: Any,
    prefix: str = "",
    thinking_parts: list[str] | None = None,
    options: dict[str, Any] | None = None,
    emit_notice: bool = True,
    keep_alive: str = "5m",
    usage: dict[str, int] | None = None,
) -> str:
    """Stream one answer, forwarding reasoning as chat_thinking_chunk.

    A `think=True` pass can exhaust GPU memory and kill llama-server. When
    that happens with no text produced yet, retry once with `think=False`.
    If that fails too, the user gets a clean notice instead of a raw crash
    log; the caller still emits `chat_done` afterwards. DeepThink disables
    the notice so it can substitute its draft instead.
    """
    parts: list[str] = []
    if prefix:
        emit({"type": "chat_chunk", "id": req_id, "content": prefix})
        parts.append(prefix)

    attempts = [True, False] if think else [False]
    for index, attempt_think in enumerate(attempts):
        try:
            _stream_call(
                model,
                messages,
                attempt_think,
                options or ANSWER_OPTIONS,
                emit,
                req_id,
                parts,
                thinking_parts,
                keep_alive=keep_alive,
                usage=usage,
            )
            return "".join(parts)
        except Exception as e:
            _log(f"stream failed (think={attempt_think}): {e}")
            # Retry without reasoning only if nothing was streamed yet.
            if index + 1 < len(attempts) and "".join(parts) == prefix:
                continue
            break

    if not emit_notice:
        return "".join(parts)
    emit({"type": "chat_chunk", "id": req_id, "content": CRASH_NOTICE})
    return "".join(parts) + CRASH_NOTICE


def _complete(
    model: str,
    system_prompt: str,
    conversation: list[dict[str, Any]],
    instruction: str,
    emit: Emit,
    req_id: Any,
    think: bool = True,
    thinking_parts: list[str] | None = None,
    options: dict[str, Any] | None = None,
    keep_alive: str = "5m",
    usage: dict[str, int] | None = None,
) -> str:
    """Run one streamed helper pass; failure leaves an empty result.

    Each pass streams its reasoning into the Reasoning panel. If a
    `think=True` pass dies from memory pressure, retry once without
    reasoning so the DeepThink loop can still produce an answer.
    """
    attempts = [True, False] if think else [False]
    for attempt_think in attempts:
        parts: list[str] = []
        try:
            _stream_call(
                model,
                [
                    {"role": "system", "content": system_prompt},
                    *conversation,
                    {"role": "user", "content": instruction},
                ],
                attempt_think,
                {**DEEP_THINK_OPTIONS, **(options or {})},
                emit,
                req_id,
                parts,
                thinking_parts,
                # Plan/draft/critique text is scratch work, not the answer.
                emit_text=False,
                keep_alive=keep_alive,
                usage=None,
            )
            return "".join(parts).strip()
        except Exception as error:
            _log(f"helper pass failed (think={attempt_think}): {error}")
    return ""


def _clip(text: str) -> str:
    return text[:MAX_HELPER_CHARS]


def run_deep_think(
    model: str,
    messages: list[dict[str, Any]],
    emit: Emit,
    req_id: Any,
    prefix: str = "",
    thinking_parts: list[str] | None = None,
    num_predict: int | None = None,
    options: dict[str, Any] | None = None,
    keep_alive: str = "5m",
    usage: dict[str, int] | None = None,
) -> str:
    """Plan -> Draft -> Critique -> Revise, streaming every step.

    All four passes ask for reasoning and get a 2,048-token budget so the
    model can finish thinking and still write the answer. Each one falls
    back to `think=False` automatically when Ollama runs out of memory.
    The loop is defensive: a Revise pass that produces no text returns the
    draft, and an unexpected error still leaves the caller able to emit
    `chat_done`.
    """
    if not messages or messages[0].get("role") != "system":
        raise ValueError("DeepThink needs a system prompt as the first message.")

    system_prompt = messages[0]["content"]
    conversation = messages[1:]

    plan = ""
    draft = ""
    critique = ""
    answer = ""
    try:
        _emit_step(emit, req_id, "planning")
        plan = _complete(
            model,
            system_prompt,
            conversation,
            PLAN_INSTRUCTION,
            emit,
            req_id,
            thinking_parts=thinking_parts,
            options=options,
            keep_alive=keep_alive,
        )

        _emit_step(emit, req_id, "drafting")
        draft = _complete(
            model,
            system_prompt,
            conversation,
            DRAFT_INSTRUCTION.format(plan=_clip(plan) or "No plan produced."),
            emit,
            req_id,
            thinking_parts=thinking_parts,
            options=options,
            keep_alive=keep_alive,
        )

        _emit_step(emit, req_id, "critiquing")
        critique = _complete(
            model,
            system_prompt,
            conversation,
            CRITIQUE_INSTRUCTION.format(
                plan=_clip(plan) or "No plan produced.",
                draft=_clip(draft) or "No draft produced.",
            ),
            emit,
            req_id,
            thinking_parts=thinking_parts,
            options=options,
            keep_alive=keep_alive,
        )

        _emit_step(emit, req_id, "revising")
        revise_messages = [
            *messages,
            {
                "role": "user",
                "content": REVISE_INSTRUCTION.format(
                    plan=_clip(plan) or "No plan produced.",
                    draft=_clip(draft) or "No draft produced.",
                    critique=_clip(critique) or "No critique produced.",
                ),
            },
        ]
        final_options = (
            {**DEEP_THINK_OPTIONS, **(options or {}), "num_predict": num_predict}
            if num_predict is not None
            else {**DEEP_THINK_OPTIONS, **(options or {})}
        )
        answer = stream_answer(
            model=model,
            messages=revise_messages,
            think=True,
            emit=emit,
            req_id=req_id,
            prefix=prefix,
            thinking_parts=thinking_parts,
            options=final_options,
            keep_alive=keep_alive,
            usage=usage,
            # The draft is a better fallback than a crash notice.
            emit_notice=False,
        )
    except Exception as error:
        _log(f"pass failed: {error}")

    # A failed or empty Revise pass must not leave an empty bubble. Ignore the
    # deterministic prefix when deciding whether the model produced anything.
    visible = answer[len(prefix):] if prefix and answer.startswith(prefix) else answer
    if not visible.strip():
        if draft:
            _log("revise produced no answer; streaming the draft")
            if prefix and not answer.startswith(prefix):
                emit({"type": "chat_chunk", "id": req_id, "content": prefix})
            emit({"type": "chat_chunk", "id": req_id, "content": draft})
            answer = f"{prefix}{draft}"
        else:
            if prefix and not answer.startswith(prefix):
                emit({"type": "chat_chunk", "id": req_id, "content": prefix})
            emit({"type": "chat_chunk", "id": req_id, "content": CRASH_NOTICE})
            answer = f"{prefix}{CRASH_NOTICE}"
    return answer
