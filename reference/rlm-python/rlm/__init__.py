"""
Recursive Language Models (RLM) — a from-scratch reimplementation of the method
from https://github.com/alexzhang13/rlm, backed by the Anthropic Claude API.

The core idea: the root model never sees the long context directly. Instead the
context lives as a `context` variable inside a persistent Python REPL. Each turn
the model writes a ```repl``` block; the harness runs it, truncates stdout, and
feeds it back. Inside the REPL the model can fan work out to sub-LLM calls
(`llm_query` / `llm_query_batched`) over chunks of `context`, or spawn recursive
child RLMs (`rlm_query` / `rlm_query_batched`) up to `max_depth`. It submits its
answer by setting `answer["content"]` and `answer["ready"] = True`.
"""

from rlm.client import LMClient
from rlm.rlm import RLM
from rlm.types import RLMResult, Usage

__all__ = ["RLM", "LMClient", "RLMResult", "Usage"]
