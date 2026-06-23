"""
Anthropic-backed language-model client.

A thin wrapper over the official `anthropic` SDK exposing a single
`complete(prompt)` method that accepts either a plain string or a list of
message dicts (`[{"role": ..., "content": ...}, ...]`). System messages in the
list are pulled out and passed via the API's top-level `system` parameter, since
the Messages API keeps the system prompt separate from the conversation turns.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from rlm.types import Usage


class LMClient:
    """Stateless-per-call Claude client with cumulative usage tracking.

    Args:
        model: Claude model id (e.g. ``claude-opus-4-8``, ``claude-haiku-4-5``).
        max_tokens: Output-token ceiling per call. Kept at/under ~16K so
            non-streaming requests stay below the SDK's HTTP-timeout guard.
        thinking: Optional Anthropic ``thinking`` config. ``{"type": "adaptive"}``
            lets Claude decide how much to reason — appropriate for the
            orchestrating root model. Leave ``None`` for cheap one-shot sub-calls.
        effort: Optional ``output_config.effort`` (``low``/``medium``/``high``/
            ``max``). Supported on Opus/Sonnet 4.6+, not on Haiku.
        api_key: Overrides ``ANTHROPIC_API_KEY`` from the environment.
    """

    def __init__(
        self,
        model: str = "claude-opus-4-8",
        max_tokens: int = 16000,
        thinking: dict[str, Any] | None = None,
        effort: str | None = None,
        api_key: str | None = None,
    ) -> None:
        import anthropic  # lazy: lets the package import without the SDK present

        self.model = model
        self.max_tokens = max_tokens
        self.thinking = thinking
        self.effort = effort
        self._client = anthropic.Anthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
        self.usage = Usage()
        self._lock = threading.Lock()

    def _split_prompt(
        self, prompt: str | list[dict[str, Any]]
    ) -> tuple[str | None, list[dict[str, Any]]]:
        """Return (system, messages). Hoists any role=system entries to `system`."""
        if isinstance(prompt, str):
            return None, [{"role": "user", "content": prompt}]
        system_parts: list[str] = []
        messages: list[dict[str, Any]] = []
        for msg in prompt:
            if msg.get("role") == "system":
                system_parts.append(str(msg.get("content", "")))
            else:
                messages.append({"role": msg["role"], "content": msg["content"]})
        if not messages:
            # The API requires at least one (user) turn.
            messages = [{"role": "user", "content": ""}]
        return ("\n\n".join(system_parts) or None), messages

    def complete(self, prompt: str | list[dict[str, Any]]) -> str:
        """Run a single completion and return the concatenated text content."""
        system, messages = self._split_prompt(prompt)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": messages,
        }
        if system is not None:
            kwargs["system"] = system
        if self.thinking is not None:
            kwargs["thinking"] = self.thinking
        if self.effort is not None:
            kwargs["output_config"] = {"effort": self.effort}

        response = self._client.messages.create(**kwargs)

        with self._lock:
            self.usage.add(response.usage.input_tokens, response.usage.output_tokens)

        return "".join(block.text for block in response.content if block.type == "text")
