"""Shared dataclasses for usage tracking, REPL results, and RLM output."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Usage:
    """Token usage accumulated across one or more model calls."""

    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0

    def add(self, input_tokens: int, output_tokens: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.calls += 1

    def merge(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.calls += other.calls

    def to_dict(self) -> dict:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }


@dataclass
class REPLResult:
    """Outcome of executing one ```repl``` block."""

    stdout: str
    stderr: str
    final_answer: str | None = None


@dataclass
class RLMResult:
    """Final return value of RLM.completion()."""

    response: str
    usage: Usage
    iterations: int
    depth: int
    root_model: str

    def __str__(self) -> str:  # convenience for `print(rlm.completion(...))`
        return self.response
