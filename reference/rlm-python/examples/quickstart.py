"""
Quickstart: a needle-in-a-haystack over a long synthetic context.

The root model never reads the haystack directly — it only sees that `context`
is a ~N-character string, then writes REPL code to chunk it and fan `llm_query`
calls across the chunks to find the needle.

Run:
    cp .env.example .env   # add your ANTHROPIC_API_KEY
    uv run python examples/quickstart.py     # or: python examples/quickstart.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

from rlm import RLM  # noqa: E402

load_dotenv()


def build_haystack(n_paragraphs: int = 400) -> str:
    filler = (
        "The quarterly logistics review noted nominal throughput across all "
        "regional distribution hubs, with no material exceptions to report. "
    )
    paragraphs = [f"[Section {i:03d}] {filler}" for i in range(n_paragraphs)]
    # Hide the needle in the middle.
    paragraphs[247] += "Internal note: the access code for the east vault is MAGENTA-7741."
    return "\n\n".join(paragraphs)


def main() -> None:
    context = build_haystack()
    rlm = RLM(max_iterations=12, verbose=True)
    result = rlm.completion(
        context,
        root_prompt="What is the access code for the east vault?",
    )
    print("\n=== FINAL ANSWER ===")
    print(result.response)
    print(f"\n[{result.iterations} turns | {result.usage.calls} model calls | "
          f"{result.usage.input_tokens:,} in / {result.usage.output_tokens:,} out tokens]")


if __name__ == "__main__":
    main()
