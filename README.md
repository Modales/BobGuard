# IBM Bob 2.0 Hackathon — Automated Enterprise Legacy & Security Modernizer

An agentic platform that scans legacy polyglot codebases, retrieves matching
CVEs, refactors with IBM Bob, and only ships patches that survive an AST
safety gate, a three-agent consensus debate, and a self-healing sandbox loop.
Every run is JWT-secured, Prometheus-instrumented, and priced in hours,
dollars, and CO₂e.

**Live docs:** [ARCHITECTURE.md](ARCHITECTURE.md) — auto-generated Mermaid
diagrams + full API/schema reference, always in sync with the code
(`auto_doc_generator.py --check` fails CI if it drifts).

## Quickstart (judge path, ~2 minutes)

```bash
pip install -r services/orchestrator/requirements.txt -r services/auditor/requirements.txt
./demo/verify.sh     # GO/NO-GO checklist: tests, chaos, docs, smoke
./demo/demo.sh       # full end-to-end run against demo/legacy-app
./demo/demo.sh --watch   # same, with the live SSE event stream attached
```

Demo credentials: `admin` / `bob-hackathon-2026` (env-overridable).

## Architecture

```
frontend/                 React 19 + Vite dashboard (Vite build green)
│   └── multi-agent review UI: diff viewer, consensus panel, event timeline
│
services/
├── orchestrator/         FastAPI control plane (port 8000) — 11 subsystems:
│   │                     event bus pub/sub, CVE vector DB (RAG), 3-persona
│   │                     consensus debate with security veto, AST safety gate,
│   │                     self-healing sandbox loop, ROI engine, Prometheus
│   │                     metrics, polyglot parser, JWT zero-trust auth,
│   │                     chaos suite, doc compiler
│   ├── POST /token                     → JWT (OAuth2 password grant)
│   ├── POST /api/v1/modernize   🔒     → full pipeline, consolidated JSON
│   ├── GET  /api/v1/stream-logs        → live SSE bus events
│   ├── GET  /metrics                   → Prometheus scrape endpoint
│   └── tests/                          → 28 pytest tests, all offline
│
├── auditor/              Risk scanner (port 8001): AST taint-flow analysis
│   │                     (sources → sinks with sanitizer tracking) + git
│   │                     churn ranking → per-file risk scores
│   └── POST /scan-repo
│
└── sandbox/              Isolated execution (port 8002, Docker): Python via
                          pytest + JavaScript via Jest, 5s process-group kill,
                          memory caps, peak-RSS metering, PostgreSQL run log
```

The pipeline: **audit → CVE RAG → IBM Bob refactor → language-aware AST gate
→ consensus debate → self-healing tests → ROI report**, coordinated entirely
through an `asyncio.Queue` event bus (see the Mermaid diagram in
ARCHITECTURE.md).

## Why it's enterprise-grade

- **Zero-trust**: the pipeline requires a JWT with the `modernizer` role
  (401 anonymous, 403 wrong role — verified by tests).
- **Agentic safety**: no patch ships without passing a structural AST gate
  (blocks injected `eval`/`exec`/`os.system`, Big-O regressions) and a
  weighted debate where security holds a veto.
- **Resilience**: `chaos_monkey_tester.py` injects Bob timeouts, AST parser
  crashes, sandbox OOMs, and route explosions — 4/4 scenarios degrade
  gracefully with safe JSON 500s, never a hang.
- **Honesty**: every external dependency (auditor, sandbox, LLM, IBM Bob CLI)
  degrades to a deterministic mock, and responses disclose `auditor_source`
  / `sandbox_source` (`live` vs `mock`).

## Team workflow

Everyone works in their own directory on a branch off `main`, PRs when green:

| Directory | Owner | Active work |
| --- | --- | --- |
| `frontend/` | Tiffany | issue #4 — live API wiring (JWT + SSE) |
| `services/auditor/` | Rumman / Muhammed | issue #5 — eval harness + CVE enrichment |
| `services/sandbox/` | Ilyas | issue #6 — portability guards + JS healing + /metrics |
| `services/orchestrator/`, `demo/` | Modales | control plane, demo tooling, verification |

Never edit another owner's directory; shared files (this README, root
config) go through an issue first.
