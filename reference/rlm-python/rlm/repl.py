"""
Persistent in-process Python REPL that holds the context and exposes the sub-LLM
call functions to model-written code.

SECURITY NOTE: like the reference LocalREPL, this executes model-authored Python
in this process. The `_SAFE_BUILTINS` set blocks `eval`/`exec`/`input` but is NOT
a real sandbox — `__import__` and `open` are available, so don't run this against
untrusted context with anything sensitive on the host. For isolation, the method
generalizes to a subprocess/container REPL (out of scope for this reimplementation).
"""

from __future__ import annotations

import builtins as _b
import contextlib
import io
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from rlm.types import REPLResult

# Safe-builtins table: a broad-but-curated allowlist that blocks the dangerous
# entry points (eval/exec/input/compile/globals/locals are simply absent).
_ALLOWED_BUILTINS = [
    "abs", "all", "any", "ascii", "bin", "bool", "bytearray", "bytes", "callable",
    "chr", "complex", "dict", "divmod", "enumerate", "filter", "float", "format",
    "frozenset", "getattr", "hasattr", "hash", "hex", "id", "int", "isinstance",
    "issubclass", "iter", "len", "list", "map", "max", "min", "next", "object",
    "oct", "ord", "pow", "print", "range", "repr", "reversed", "round", "set",
    "setattr", "slice", "sorted", "str", "sum", "tuple", "type", "vars", "zip",
    "open", "__import__", "True", "False", "None", "Exception", "BaseException",
    "ValueError", "TypeError", "KeyError", "IndexError", "AttributeError",
    "RuntimeError", "StopIteration", "ZeroDivisionError", "ArithmeticError",
    "LookupError", "NameError", "ImportError", "AssertionError", "NotImplementedError",
]
_SAFE_BUILTINS = {name: getattr(_b, name) for name in _ALLOWED_BUILTINS if hasattr(_b, name)}


class _AnswerDict(dict):
    """REPL-visible dict where `answer["ready"] = True` captures the final answer."""

    def __init__(self, on_ready: Callable[[str], None]) -> None:
        super().__init__()
        super().__setitem__("content", "")
        super().__setitem__("ready", False)
        self._on_ready = on_ready

    def __setitem__(self, key: Any, value: Any) -> None:
        super().__setitem__(key, value)
        if key == "ready" and value:
            self._on_ready(str(self.get("content", "")))


class LocalREPL:
    """A persistent namespace with `context` plus the sub-LLM call scaffolding."""

    def __init__(
        self,
        context: object,
        llm_query_fn: Callable[[str], str],
        llm_query_batched_fn: Callable[[list[str]], list[str]],
        subcall_fn: Callable[[str], str] | None = None,
    ) -> None:
        self._llm_query_fn = llm_query_fn
        self._llm_query_batched_fn = llm_query_batched_fn
        self._subcall_fn = subcall_fn
        self._final_answer: str | None = None
        self._lock = threading.Lock()

        self.globals: dict[str, Any] = {"__builtins__": dict(_SAFE_BUILTINS), "__name__": "__main__"}
        self.locals: dict[str, Any] = {}
        self.locals["context"] = context
        self._install_scaffold()

    # -- scaffold ---------------------------------------------------------------

    def _capture_answer(self, content: str) -> None:
        self._final_answer = content

    def _show_vars(self) -> str:
        available = {
            k: type(v).__name__
            for k, v in self.locals.items()
            if not k.startswith("_") and k != "answer"
        }
        return f"Available variables: {available}" if available else "No variables created yet."

    def _rlm_query(self, prompt: str) -> str:
        if self._subcall_fn is not None:
            try:
                return self._subcall_fn(prompt)
            except Exception as e:  # noqa: BLE001
                return f"Error: RLM query failed - {e}"
        return self._llm_query_fn(prompt)  # fall back to a plain sub-LLM call

    def _rlm_query_batched(self, prompts: list[str]) -> list[str]:
        if self._subcall_fn is None:
            return self._llm_query_batched_fn(prompts)
        if len(prompts) <= 1:
            return [self._rlm_query(p) for p in prompts]
        results: list[str] = [""] * len(prompts)
        with ThreadPoolExecutor(max_workers=min(4, len(prompts))) as ex:
            futures = {ex.submit(self._rlm_query, p): i for i, p in enumerate(prompts)}
            for fut, i in futures.items():
                results[i] = fut.result()
        return results

    def _install_scaffold(self) -> None:
        self.locals["answer"] = _AnswerDict(on_ready=self._capture_answer)
        self.globals["llm_query"] = self._llm_query_fn
        self.globals["llm_query_batched"] = self._llm_query_batched_fn
        self.globals["rlm_query"] = self._rlm_query
        self.globals["rlm_query_batched"] = self._rlm_query_batched
        self.globals["SHOW_VARS"] = self._show_vars

    def _restore_scaffold(self) -> None:
        """Re-pin reserved names after exec so model overwrites don't persist."""
        cur_answer = self.locals.get("answer")
        if not isinstance(cur_answer, _AnswerDict):
            replacement = _AnswerDict(on_ready=self._capture_answer)
            if isinstance(cur_answer, dict):
                for k, v in cur_answer.items():
                    dict.__setitem__(replacement, k, v)
                if cur_answer.get("ready") and self._final_answer is None:
                    self._final_answer = str(cur_answer.get("content", ""))
            self.locals["answer"] = replacement
        self.globals["llm_query"] = self._llm_query_fn
        self.globals["llm_query_batched"] = self._llm_query_batched_fn
        self.globals["rlm_query"] = self._rlm_query
        self.globals["rlm_query_batched"] = self._rlm_query_batched
        self.globals["SHOW_VARS"] = self._show_vars

    # -- execution --------------------------------------------------------------

    def execute(self, code: str) -> REPLResult:
        """Run one block of model code in the persistent namespace."""
        with self._lock:
            self._final_answer = None
            stdout, stderr = io.StringIO(), io.StringIO()
            combined = {**self.globals, **self.locals}
            try:
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    exec(code, combined, combined)  # noqa: S102 — see module SECURITY NOTE
                err = stderr.getvalue()
            except Exception as e:  # noqa: BLE001
                err = stderr.getvalue() + f"\n{type(e).__name__}: {e}"

            # Persist new user variables back into locals (skip the global scaffold).
            for key, value in combined.items():
                if key not in self.globals and not key.startswith("__"):
                    self.locals[key] = value
            self._restore_scaffold()

            return REPLResult(stdout=stdout.getvalue(), stderr=err, final_answer=self._final_answer)
