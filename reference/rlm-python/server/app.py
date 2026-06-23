"""
Minimal local web server for the RLM — dependency-free (stdlib http.server).

    python server/app.py            # serves http://127.0.0.1:8000

Endpoints:
    GET  /                 -> the single-page UI
    GET  /health           -> {"ok": true}
    POST /api/complete      -> run the RLM, return {answer, usage, iterations, trajectory}

The request body is JSON: {context, question, max_iterations?, max_depth?}.
Each run is synchronous (it calls the Claude API); the per-turn trajectory is
captured via the RLM's on_turn callback and returned alongside the answer.
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

from rlm import RLM  # noqa: E402

load_dotenv(ROOT / ".env")

INDEX_HTML = (Path(__file__).resolve().parent / "index.html").read_text()
HOST, PORT = "127.0.0.1", 8000


def run_completion(payload: dict) -> dict:
    context = payload.get("context", "")
    question = (payload.get("question") or "").strip() or None
    max_iterations = int(payload.get("max_iterations") or 12)
    max_depth = int(payload.get("max_depth") or 1)

    trajectory: list[dict] = []
    rlm = RLM(
        max_iterations=max_iterations,
        max_depth=max_depth,
        on_turn=trajectory.append,
    )
    result = rlm.completion(context, root_prompt=question)
    return {
        "answer": result.response,
        "iterations": result.iterations,
        "usage": result.usage.to_dict(),
        "root_model": result.root_model,
        "trajectory": trajectory,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send(200, INDEX_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/complete":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return
        if not payload.get("context"):
            self._json(400, {"error": "`context` is required"})
            return
        try:
            self._json(200, run_completion(payload))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        sys.stderr.write(f"[rlm-server] {fmt % args}\n")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"RLM server running at http://{HOST}:{PORT}  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
