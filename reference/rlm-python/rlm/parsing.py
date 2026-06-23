"""Parsing helpers: extract ```repl``` blocks and format a turn for history."""

from __future__ import annotations

import re

from rlm.types import REPLResult

_CODE_BLOCK = re.compile(r"```repl\s*\n(.*?)\n```", re.DOTALL)


def find_code_blocks(text: str) -> list[str]:
    """Return the contents of every ```repl ... ``` block in `text`, in order."""
    return [m.group(1).strip() for m in _CODE_BLOCK.finditer(text)]


def format_repl_output(result: REPLResult, max_chars: int = 20000) -> str:
    """Render one REPL result as the text the model sees next turn.

    Only stdout/stderr are surfaced (a bare last-line expression is discarded,
    matching a real script). Long output is tail-trimmed so the model's own
    context window isn't flooded — the whole point of pushing work into the REPL.
    """
    parts: list[str] = []
    if result.stdout:
        parts.append(result.stdout)
    if result.stderr:
        parts.append(result.stderr)
    out = "\n".join(parts).strip() if parts else "No output"

    if len(out) > max_chars:
        out = out[:max_chars] + f"\n... [+{len(out) - max_chars} chars truncated]"
    return out


def format_turn(
    response: str, results: list[REPLResult], max_chars: int = 20000
) -> list[dict[str, str]]:
    """Two-message shape for the next prompt: the assistant turn, then one user
    message concatenating every executed block's output. Mirrors the reference's
    assistant-then-user-per-turn structure."""
    messages = [{"role": "assistant", "content": response}]
    if not results:
        return messages

    multi = len(results) > 1
    chunks = []
    for i, result in enumerate(results):
        header = f"REPL output (block {i + 1}):" if multi else "REPL output:"
        chunks.append(f"{header}\n{format_repl_output(result, max_chars)}")
    messages.append({"role": "user", "content": "\n\n".join(chunks)})
    return messages
