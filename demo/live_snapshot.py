"""
live_snapshot.py — record a REAL pipeline run as a frontend fixture
====================================================================

IBM Bob 2.0 Hackathon · /demo/

Runs the actual orchestrator pipeline (in-process, mock fallbacks so it works
offline) against ``demo/legacy-app`` and writes the verbatim
``ModernizationResponse`` to ``demo/snapshots/latest_run.json``.

Purpose: this is the **contract fixture** for the frontend. Tiffany's live
integration (issue #4) can diff her parsing code against a byte-exact real
response instead of guessing shapes from docs.

Usage:
    python demo/live_snapshot.py            # writes demo/snapshots/latest_run.json
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCH = ROOT / "services" / "orchestrator"
sys.path.insert(0, str(ORCH))

import main  # noqa: E402  — orchestrator modules import cleanly standalone


async def record() -> Path:
    # Relative path keeps the fixture portable across machines/checkouts.
    os.chdir(ROOT)
    request = main.ModernizationRequest(
        repo_path="./demo/legacy-app",
        target_version="python3.12",
    )
    ctx = await main.run_pipeline(request)

    # Build the exact ModernizationResponse payload the endpoint returns.
    payload = {
        "repo_path": request.repo_path,
        "target_version": request.target_version,
        "auditor_source": ctx.auditor_source,
        "sandbox_source": ctx.sandbox_source,
        "vulnerabilities": [v.model_dump() for v in ctx.vulnerabilities],
        "cve_hits": [
            {"cve_id": h.cve.cve_id, "package": h.cve.package, "severity": h.cve.severity,
             "score": h.score, "fixed_version": h.cve.fixed_version}
            for h in ctx.cve_hits
        ],
        "refactors": [r.model_dump() for r in ctx.refactors],
        "sandbox_report": ctx.sandbox_report,
        "pipeline_success": ctx.success,
        "execution_logs": ctx.logs,
        "event_timeline": ctx.timeline,
    }

    out = ROOT / "demo" / "snapshots" / "latest_run.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":  # pragma: no cover
    path = asyncio.run(record())
    size = path.stat().st_size
    print(f"Wrote {path} ({size} bytes) — real pipeline fixture for frontend integration.")
