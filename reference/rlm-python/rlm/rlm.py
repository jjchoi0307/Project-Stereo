"""
The RLM orchestrator: the iterate loop that drives the root model over a REPL,
plus depth-bounded recursion.

Loop per `completion()` call:
  1. Build [system, user(metadata)].
  2. For each turn up to `max_iterations`:
       a. append a turn prompt,
       b. ask the model,
       c. extract & run every ```repl``` block,
       d. if a block set `answer["ready"]=True`, return its content,
       e. otherwise append (assistant, repl-output) to history and continue.
  3. If turns run out, ask the model once for a best-effort final answer.

`llm_query` always makes a plain sub-LLM call. `rlm_query` spawns a *child* RLM
with its own REPL at depth+1; at `max_depth` it degrades to a plain sub-LLM call.
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from rlm.client import LMClient
from rlm.parsing import find_code_blocks, format_turn
from rlm.prompts import build_initial_messages, build_turn_prompt
from rlm.repl import LocalREPL
from rlm.types import RLMResult, Usage


class RLM:
    """A Recursive Language Model.

    Args:
        root_model: model id for the orchestrating root (and child RLMs).
        sub_model: model id for `llm_query` / `llm_query_batched` sub-calls.
            Defaults to a cheaper, faster model since these calls are numerous.
        max_depth: recursion cap. depth 0 is the root; `rlm_query` spawns depth+1
            until `depth + 1 >= max_depth`, after which it falls back to a plain
            sub-LLM call. `max_depth=1` (default) means no recursion.
        max_iterations: REPL turns before a forced final answer.
        max_concurrent_subcalls: thread pool size for batched calls.
        orchestrator: include the "act as an orchestrator" prompt addendum.
        verbose: print each turn's model output and REPL result.
        api_key: overrides ANTHROPIC_API_KEY.
        depth: internal — current recursion depth (set when spawning children).
        root_client / sub_client: internal — reused clients for usage accounting.
    """

    def __init__(
        self,
        root_model: str = "claude-opus-4-8",
        sub_model: str = "claude-haiku-4-5",
        max_depth: int = 1,
        max_iterations: int = 20,
        max_concurrent_subcalls: int = 8,
        orchestrator: bool = True,
        verbose: bool = False,
        api_key: str | None = None,
        on_turn: Callable[[dict], None] | None = None,
        *,
        depth: int = 0,
        root_client: LMClient | None = None,
        sub_client: LMClient | None = None,
    ) -> None:
        self.root_model = root_model
        self.sub_model = sub_model
        self.max_depth = max_depth
        self.max_iterations = max_iterations
        self.max_concurrent_subcalls = max_concurrent_subcalls
        self.orchestrator = orchestrator
        self.verbose = verbose
        self.depth = depth
        self.api_key = api_key
        # Fired once per turn with a JSON-able event dict (depth, iteration,
        # response, blocks). Used by the web UI to show the live trajectory.
        self.on_turn = on_turn

        # The root client reasons (adaptive thinking); the sub client is a plain
        # one-shot extractor. Clients are shared across a tree so usage rolls up.
        self.root_client = root_client or LMClient(
            model=root_model, thinking={"type": "adaptive"}, api_key=api_key
        )
        self.sub_client = sub_client or LMClient(
            model=sub_model, max_tokens=8000, api_key=api_key
        )

    # -- sub-LLM call functions handed to the REPL ------------------------------

    def _llm_query(self, prompt: str) -> str:
        try:
            return self.sub_client.complete(prompt)
        except Exception as e:  # noqa: BLE001
            return f"Error: LM query failed - {e}"

    def _llm_query_batched(self, prompts: list[str]) -> list[str]:
        if not prompts:
            return []
        results: list[str] = [""] * len(prompts)
        workers = min(self.max_concurrent_subcalls, len(prompts))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(self._llm_query, p): i for i, p in enumerate(prompts)}
            for fut, i in futures.items():
                results[i] = fut.result()
        return results

    def _subcall(self, prompt: str) -> str:
        """Handle `rlm_query`: spawn a child RLM, or a plain sub-LLM at max depth."""
        next_depth = self.depth + 1
        if next_depth >= self.max_depth:
            return self._llm_query(prompt)
        child = RLM(
            root_model=self.root_model,
            sub_model=self.sub_model,
            max_depth=self.max_depth,
            max_iterations=self.max_iterations,
            max_concurrent_subcalls=self.max_concurrent_subcalls,
            orchestrator=self.orchestrator,
            verbose=False,
            on_turn=self.on_turn,  # children stream their turns too (with depth)
            depth=next_depth,
            root_client=self.root_client,  # share clients → unified usage + reuse
            sub_client=self.sub_client,
        )
        # The child's "context" is the prompt itself; no separate root question.
        return child.completion(prompt).response

    def _make_repl(self, context: object) -> LocalREPL:
        subcall = self._subcall if self.max_depth > 1 else None
        return LocalREPL(
            context=context,
            llm_query_fn=self._llm_query,
            llm_query_batched_fn=self._llm_query_batched,
            subcall_fn=subcall,
        )

    # -- main loop --------------------------------------------------------------

    def completion(self, context: object, root_prompt: str | None = None) -> RLMResult:
        """Run the RLM over `context`.

        Args:
            context: the (potentially huge) data the model works over via the REPL.
            root_prompt: a short question shown directly to the root model. Common
                usage: `rlm.completion(big_document, root_prompt="Who is the CFO?")`.
        """
        repl = self._make_repl(context)
        messages = build_initial_messages(context, root_prompt, self.orchestrator)
        best_partial = ""

        for i in range(self.max_iterations):
            messages.append(build_turn_prompt(i, self.max_iterations))
            response = self.root_client.complete(messages)
            if response.strip():
                best_partial = response

            code_blocks = find_code_blocks(response)
            results = [repl.execute(code) for code in code_blocks]

            if self.verbose:
                self._print_turn(i, response, results)
            if self.on_turn is not None:
                self._emit_turn(i, response, code_blocks, results)

            final_answer = next(
                (r.final_answer for r in results if r.final_answer is not None), None
            )
            if final_answer is not None:
                return self._result(final_answer, i + 1)

            messages.extend(format_turn(response, results))

        # Out of turns: ask once for a best-effort answer from what's accumulated.
        final = self._forced_answer(messages) or best_partial
        return self._result(final, self.max_iterations)

    def _forced_answer(self, messages: list[dict[str, Any]]) -> str:
        prompt = messages + [
            {
                "role": "user",
                "content": "You are out of turns. Provide your best final answer "
                "to the original query now, based on everything above.",
            }
        ]
        try:
            return self.root_client.complete(prompt)
        except Exception:  # noqa: BLE001
            return ""

    # -- helpers ----------------------------------------------------------------

    def _result(self, response: str, iterations: int) -> RLMResult:
        usage = Usage()
        usage.merge(self.root_client.usage)
        if self.sub_client is not self.root_client:
            usage.merge(self.sub_client.usage)
        return RLMResult(
            response=response,
            usage=usage,
            iterations=iterations,
            depth=self.depth,
            root_model=self.root_model,
        )

    def _emit_turn(self, i: int, response: str, code_blocks, results) -> None:
        try:
            self.on_turn(
                {
                    "depth": self.depth,
                    "iteration": i + 1,
                    "max_iterations": self.max_iterations,
                    "response": response,
                    "blocks": [
                        {
                            "code": code,
                            "stdout": r.stdout,
                            "stderr": r.stderr,
                            "final_answer": r.final_answer,
                        }
                        for code, r in zip(code_blocks, results)
                    ],
                }
            )
        except Exception:  # noqa: BLE001 — a UI callback must never break the run
            pass

    def _print_turn(self, i: int, response: str, results) -> None:
        pad = "  " * self.depth
        print(f"\n{pad}── turn {i + 1} (depth {self.depth}) ──")
        print(pad + response.strip().replace("\n", "\n" + pad))
        for j, r in enumerate(results):
            out = (r.stdout + r.stderr).strip()
            if out:
                shown = out[:800] + (" …" if len(out) > 800 else "")
                print(f"{pad}[repl {j + 1}] {shown}".replace("\n", "\n" + pad))
