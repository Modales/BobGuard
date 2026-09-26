"""
chaos_monkey_tester.py — Resilience Proving Engine
==================================================

IBM Bob 2.0 Hackathon · /services/orchestrator/

Chaos engineering for the demo: this suite deliberately injects catastrophic
failures into the pipeline and proves the orchestrator survives each one —
no hangs, no crashes, errors logged, clients always receive a safe JSON
payload.

Scenarios
---------
1. **IBM Bob API timeout** — the Bob agent coroutine raises
   ``asyncio.TimeoutError`` mid-pipeline. Expected: the refactor degrades to
   ``failed``, the error is logged, and the run still completes.
2. **AST parser fatal exception** — ``verify_refactor`` raises a
   ``RuntimeError`` ("parser exploded"). Expected: refactor rejected at the
   gate with the error recorded as a violation; pipeline completes.
3. **Sandbox memory-limit error** — the sandbox persistently reports
   ``MemoryError`` tracebacks. Expected: the self-healing loop retries to the
   retry budget, exhausts gracefully, and reports failure without hanging.

Plus a transport-level proof: when the route handler itself blows up, the
global exception handler returns HTTP 500 with a JSON body (never a bare
stack trace).

Runnable two ways
-----------------
* Standalone (demo/judges):  ``python chaos_monkey_tester.py``
* pytest (CI):               ``python -m pytest chaos_monkey_tester.py -q``

All scenarios run offline against mocks — no external service required.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import patch

# Make sibling modules importable regardless of invocation directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import main  # noqa: E402  — the orchestrator under test
from self_healing_loop import SandboxResult, self_heal_code  # noqa: E402

logger = logging.getLogger("orchestrator.chaos_monkey_tester")

#: Keep chaos runs fast — the production default (120 s) would make the
#: "never hangs" proof painfully slow on stage.
main.PIPELINE_TIMEOUT_SECONDS = 10.0


# ---------------------------------------------------------------------------
# Result bookkeeping
# ---------------------------------------------------------------------------

class ChaosResult:
    """One scenario's outcome."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.checks: List[str] = []
        self.passed = False
        self.elapsed_s = 0.0

    def check(self, condition: bool, label: str) -> None:
        self.checks.append(("PASS " if condition else "FAIL ") + label)
        if not condition:
            self.passed = False

    def finish(self, elapsed: float) -> None:
        self.elapsed_s = elapsed
        # A scenario passes only if every check passed.
        if not any(c.startswith("FAIL") for c in self.checks):
            self.passed = True


# ---------------------------------------------------------------------------
# Scenario 1 — IBM Bob API timeout
# ---------------------------------------------------------------------------

async def scenario_bob_timeout() -> ChaosResult:
    """Inject: every IBM Bob call raises asyncio.TimeoutError."""
    res = ChaosResult("IBM Bob API timeout")
    started = time.perf_counter()

    async def exploding_bob(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        raise asyncio.TimeoutError("IBM Bob API timed out after 30s (simulated)")

    with patch.object(main, "invoke_ibm_bob_agent", exploding_bob):
        ctx = await main.run_pipeline(main.ModernizationRequest(repo_path="./legacy-app", target_version="python3.12"))

    res.finish(time.perf_counter() - started)
    res.check(ctx.completed.is_set(), "pipeline completed (did not hang)")
    res.check(len(ctx.refactors) >= 1, "refactors recorded despite Bob failure")
    res.check(all(r.status == "failed" for r in ctx.refactors), "all refactors degraded to 'failed'")
    res.check(any("IBM Bob failed" in line for line in ctx.logs), "timeout error was logged")
    res.check(ctx.success is False, "run honestly reports failure")
    res.check(res.elapsed_s < main.PIPELINE_TIMEOUT_SECONDS, f"finished in {res.elapsed_s:.1f}s (no timeout stall)")
    return res


# ---------------------------------------------------------------------------
# Scenario 2 — AST parser fatal exception
# ---------------------------------------------------------------------------

async def scenario_ast_fatal() -> ChaosResult:
    """Inject: the AST gate raises RuntimeError on every patch."""
    res = ChaosResult("AST parser fatal exception")
    started = time.perf_counter()

    def exploding_gate(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("parser exploded: recursion depth catastrophe (simulated)")

    with patch.object(main, "verify_refactor", exploding_gate):
        ctx = await main.run_pipeline(main.ModernizationRequest(repo_path="./legacy-app", target_version="python3.12"))

    res.finish(time.perf_counter() - started)
    res.check(ctx.completed.is_set(), "pipeline completed (did not hang)")
    res.check(
        all(r.status == "rejected_ast_gate" for r in ctx.refactors),
        "all refactors rejected at the gate",
    )
    res.check(
        any("ast_engine_error" in v for r in ctx.refactors for v in r.ast_violations),
        "parser crash recorded as a violation",
    )
    res.check(any("AST gate crashed" in line for line in ctx.logs), "fatal error was logged")
    res.check(ctx.success is False, "run honestly reports failure")
    return res


# ---------------------------------------------------------------------------
# Scenario 3 — Sandbox memory-limit error
# ---------------------------------------------------------------------------

async def scenario_sandbox_memory_limit() -> ChaosResult:
    """Inject: the sandbox always reports a MemoryError traceback."""
    res = ChaosResult("Sandbox memory-limit error")
    started = time.perf_counter()

    memory_traceback = (
        "Traceback (most recent call last):\n"
        '  File "submission.py", line 9, in process\n'
        "    data = load_entire_table()\n"
        "MemoryError: container exceeded 512Mi limit (simulated)\n"
    )

    async def oom_sandbox(*args: Any, **kwargs: Any) -> SandboxResult:
        return SandboxResult(passed=False, traceback=memory_traceback, source="live")

    # Patch the sandbox client INSIDE the healing loop module, then exercise
    # the real self_heal_code logic end to end.
    with patch("self_healing_loop.run_in_sandbox", oom_sandbox):
        # Speed up backoff for the demo: 5 retries with real backoff ~15 s.
        import self_healing_loop as shl
        original_backoff = shl.BACKOFF_BASE_SECONDS
        shl.BACKOFF_BASE_SECONDS = 0.01
        try:
            heal = await self_heal_code("def process():\n    return 42\n", max_retries=5)
        finally:
            shl.BACKOFF_BASE_SECONDS = original_backoff

    res.finish(time.perf_counter() - started)
    res.check(heal.success is False, "healing honestly reports failure")
    res.check(heal.total_attempts == 5, "retry budget fully consumed (5/5)")
    res.check(
        all(a.exception_type == "MemoryError" for a in heal.attempts if not a.sandbox_passed),
        "every attempt parsed the MemoryError traceback",
    )
    res.check(
        any("retry budget exhausted" in a.note for a in heal.attempts),
        "exhaustion logged as the terminal state",
    )
    res.check(res.elapsed_s < 30, f"finished in {res.elapsed_s:.1f}s (no hang)")
    return res


# ---------------------------------------------------------------------------
# Transport-level proof — safe HTTP 500 JSON
# ---------------------------------------------------------------------------

def scenario_http_500_contract() -> ChaosResult:
    """Inject: the route handler itself raises; expect a JSON 500, not a hang."""
    res = ChaosResult("HTTP 500 safe-JSON contract")
    started = time.perf_counter()

    from fastapi.testclient import TestClient
    from enterprise_auth import create_access_token

    async def exploding_pipeline(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("catastrophic unhandled failure (simulated)")

    with TestClient(main.app, raise_server_exceptions=False) as client:
        token = create_access_token("chaos", "modernizer")
        with patch.object(main, "run_pipeline", exploding_pipeline):
            resp = client.post(
                "/api/v1/modernize",
                json={"repo_path": "./legacy-app", "target_version": "python3.12"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )

    res.finish(time.perf_counter() - started)
    res.check(resp.status_code == 500, f"HTTP 500 returned (got {resp.status_code})")
    is_json = resp.headers.get("content-type", "").startswith("application/json")
    res.check(is_json, "content-type is application/json")
    body: Dict[str, Any] = {}
    if is_json:
        body = resp.json()
    res.check(body.get("error") == "internal_error", "payload carries structured error field")
    res.check(body.get("safe") is True, "payload explicitly marked safe")
    res.check("Traceback" not in resp.text, "no stack trace leaked to the client")
    res.check(res.elapsed_s < 15, f"responded in {res.elapsed_s:.1f}s (no hang)")
    return res


# ---------------------------------------------------------------------------
# Runner — standalone report + pytest entry points
# ---------------------------------------------------------------------------

async def run_all_scenarios() -> List[ChaosResult]:
    """Execute every chaos scenario sequentially and collect results."""
    results: List[ChaosResult] = []
    results.append(await scenario_bob_timeout())
    results.append(await scenario_ast_fatal())
    results.append(await scenario_sandbox_memory_limit())
    results.append(scenario_http_500_contract())  # sync (TestClient)
    return results


def print_report(results: List[ChaosResult]) -> bool:
    """Pretty-print the chaos report; return True if everything passed."""
    print("\n" + "=" * 70)
    print("  CHAOS MONKEY REPORT — proving the orchestrator cannot be broken")
    print("=" * 70)
    for r in results:
        verdict = "SURVIVED" if r.passed else "BROKEN"
        print(f"\n  Scenario: {r.name}  —  {verdict}  ({r.elapsed_s:.2f}s)")
        for check in r.checks:
            print(f"    {check}")
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    print("\n" + "-" * 70)
    print(f"  {passed}/{total} scenarios survived.\n")
    return passed == total


# --- pytest adapters ---------------------------------------------------------

def test_bob_timeout() -> None:
    assert asyncio.run(scenario_bob_timeout()).passed


def test_ast_fatal() -> None:
    assert asyncio.run(scenario_ast_fatal()).passed


def test_sandbox_memory_limit() -> None:
    assert asyncio.run(scenario_sandbox_memory_limit()).passed


def test_http_500_contract() -> None:
    assert scenario_http_500_contract().passed


# ---------------------------------------------------------------------------
# Standalone entrypoint: `python chaos_monkey_tester.py`
# ---------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.WARNING)  # keep the stage output clean
    results = asyncio.run(run_all_scenarios())
    raise SystemExit(0 if print_report(results) else 1)
