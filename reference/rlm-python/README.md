# Recursive Language Models (RLM)

A clean, from-scratch reimplementation of the **RLM** inference method from
[alexzhang13/rlm](https://github.com/alexzhang13/rlm), backed by the **Anthropic
Claude API**.

## The method

A normal completion stuffs the whole context into the model's window. An RLM
doesn't. Instead:

- The context is loaded as a `context` variable inside a **persistent Python REPL**.
- The root model sees only the system prompt + **metadata** about the context
  (its type and character count) — never the raw text.
- Each turn the model writes a ` ```repl ` block. The harness runs it, truncates
  stdout to ~20K chars, and feeds it back. State persists across turns.
- Inside the REPL the model fans work out to **sub-LLM calls** over slices of
  `context`:
  - `llm_query(prompt)` / `llm_query_batched(prompts)` — one-shot completions
    (extraction, summarization, classification) over a chunk.
  - `rlm_query(prompt)` / `rlm_query_batched(prompts)` — **recursive child RLMs**
    with their own REPL, up to `max_depth`; they fall back to `llm_query` at the cap.
- The model submits by setting `answer["content"]` and `answer["ready"] = True`.

This lets a small-window orchestrator reason over context far larger than any
single window, by treating the context as a data structure and delegating the
reading to sub-calls.

## Install

```bash
pip install -e .          # or: uv pip install -e .
cp .env.example .env      # add your ANTHROPIC_API_KEY
```

## Use

```python
from rlm import RLM

rlm = RLM()                                  # root: claude-opus-4-8, sub: claude-haiku-4-5
result = rlm.completion(
    very_long_context,                       # str | list[str] | dict
    root_prompt="What is the access code for the east vault?",
)
print(result.response)
print(result.usage.to_dict())
```

Recursion (children get their own REPL):

```python
rlm = RLM(max_depth=2, max_iterations=20, verbose=True)
```

Run the bundled needle-in-a-haystack demo:

```bash
python examples/quickstart.py
```

## Key parameters (`RLM(...)`)

| Param | Default | Meaning |
|---|---|---|
| `root_model` | `claude-opus-4-8` | Orchestrator (and child RLMs). Uses adaptive thinking. |
| `sub_model` | `claude-haiku-4-5` | Cheap/fast model for `llm_query` sub-calls. |
| `max_depth` | `1` | Recursion cap. `1` = no recursion (`rlm_query` → `llm_query`). |
| `max_iterations` | `20` | REPL turns before a forced best-effort answer. |
| `max_concurrent_subcalls` | `8` | Thread-pool size for batched sub-calls. |
| `orchestrator` | `True` | Append the "delegate, don't solve" prompt addendum. |
| `verbose` | `False` | Print each turn's model output and REPL result. |

## Layout

```
rlm/
  client.py    Anthropic LMClient (str|messages -> text), usage tracking
  repl.py      LocalREPL: context + llm_query/rlm_query scaffolding, answer dict
  prompts.py   system prompt, orchestrator addendum, metadata + per-turn prompts
  parsing.py   find ```repl``` blocks; format a turn (truncated) for history
  rlm.py       the iterate loop + depth-bounded recursion
  types.py     Usage, REPLResult, RLMResult
examples/quickstart.py   needle-in-a-haystack demo
tests/test_smoke.py      offline tests (mock clients, no network)
```

## How this differs from the reference

Faithful to the method; trimmed to its core:

- **Transport.** The reference routes sub-LLM calls through a TCP `LMHandler` so
  code running in an *isolated* sandbox (Docker / Modal / E2B / …) can call back
  to the provider. This implementation ships only the in-process `LocalREPL`, so
  sub-LLM calls are direct Python callbacks — same method, no socket broker.
- **Scope.** Omits the cloud sandbox environments, the RL training harness, the
  trajectory visualizer, and multi-provider routing — none of which are part of
  the inference method itself.
- **Backend.** Anthropic Claude (root reasons with adaptive thinking; sub-calls
  use a cheaper model), rather than the reference's OpenAI default.

> ⚠️ **Security:** `LocalREPL` runs model-authored Python in this process. Builtins
> like `eval`/`exec`/`input` are blocked, but `__import__`/`open` are available —
> this is **not** a sandbox. Don't point it at untrusted context on a sensitive host.
