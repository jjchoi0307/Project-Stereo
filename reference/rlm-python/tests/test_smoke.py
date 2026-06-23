"""
Offline smoke tests — exercise parsing, the REPL, and the full RLM loop with
mock clients (no network). Run: python tests/test_smoke.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rlm.parsing import find_code_blocks, format_turn  # noqa: E402
from rlm.repl import LocalREPL  # noqa: E402
from rlm.rlm import RLM  # noqa: E402
from rlm.types import Usage  # noqa: E402


class MockClient:
    """Returns scripted responses in order; the last one repeats if exhausted."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.usage = Usage()
        self._i = 0

    def complete(self, prompt):
        resp = self.responses[min(self._i, len(self.responses) - 1)]
        self._i += 1
        self.usage.add(10, 5)
        return resp


def test_find_code_blocks():
    text = "plan\n```repl\nprint(1)\n```\nmore\n```repl\nx = 2\n```"
    blocks = find_code_blocks(text)
    assert blocks == ["print(1)", "x = 2"], blocks
    print("ok: find_code_blocks")


def test_repl_basic_and_answer():
    calls = []
    repl = LocalREPL(
        context="hello world",
        llm_query_fn=lambda p: calls.append(p) or "STUB",
        llm_query_batched_fn=lambda ps: ["STUB"] * len(ps),
    )
    r1 = repl.execute("print(len(context)); buf = llm_query('q')")
    assert "11" in r1.stdout, r1.stdout
    assert calls == ["q"], calls
    assert r1.final_answer is None

    # Persistence across turns + answer submission.
    r2 = repl.execute("print(buf)\nanswer['content'] = 'DONE'\nanswer['ready'] = True")
    assert "STUB" in r2.stdout, r2.stdout
    assert r2.final_answer == "DONE", r2.final_answer
    print("ok: repl basic + answer capture")


def test_repl_error_is_captured():
    repl = LocalREPL("ctx", lambda p: "", lambda ps: [])
    r = repl.execute("print(1/0)")
    assert "ZeroDivisionError" in r.stderr, r.stderr
    print("ok: repl error capture")


def test_format_turn_truncation():
    from rlm.types import REPLResult

    big = REPLResult(stdout="A" * 50000, stderr="")
    msgs = format_turn("resp", [big], max_chars=100)
    assert msgs[0] == {"role": "assistant", "content": "resp"}
    assert "truncated" in msgs[1]["content"]
    print("ok: format_turn truncation")


def test_full_loop_with_mock():
    root = MockClient([
        "Let me look.\n```repl\nprint(context[:5])\n```",
        "Found it.\n```repl\nanswer['content'] = 'forty-two'\nanswer['ready'] = True\n```",
    ])
    sub = MockClient(["unused"])
    rlm = RLM(max_iterations=5, root_client=root, sub_client=sub)
    result = rlm.completion("the answer is hidden", root_prompt="what is it?")
    assert result.response == "forty-two", result.response
    assert result.iterations == 2, result.iterations
    assert result.usage.calls == 2, result.usage.to_dict()
    print("ok: full loop reaches answer")


def test_forced_answer_when_out_of_turns():
    # Never submits an answer → loop exhausts → forced answer call.
    root = MockClient(["thinking...\n```repl\nprint('still working')\n```", "FORCED FINAL"])
    rlm = RLM(max_iterations=1, root_client=root, sub_client=MockClient(["x"]))
    result = rlm.completion("ctx")
    assert result.response == "FORCED FINAL", result.response
    print("ok: forced answer on timeout")


def test_recursion_falls_back_at_max_depth():
    # max_depth=1 → rlm_query should fall back to llm_query (the sub client).
    repl_calls = []
    rlm = RLM(
        max_depth=1,
        root_client=MockClient(["x"]),
        sub_client=MockClient(["SUBRESULT"]),
    )
    repl = rlm._make_repl("ctx")
    out = repl.execute("print(rlm_query('solve this'))")
    assert "SUBRESULT" in out.stdout, out.stdout
    print("ok: rlm_query falls back to sub-LLM at max_depth")


if __name__ == "__main__":
    test_find_code_blocks()
    test_repl_basic_and_answer()
    test_repl_error_is_captured()
    test_format_turn_truncation()
    test_full_loop_with_mock()
    test_forced_answer_when_out_of_turns()
    test_recursion_falls_back_at_max_depth()
    print("\nAll smoke tests passed.")
