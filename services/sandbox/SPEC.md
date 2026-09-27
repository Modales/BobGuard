# Sandbox service — build spec

**Owner:** Ilyas · **Folder:** `services/sandbox/` · **Port:** 8002

## What it does (plain version)

IBM Bob proposes code fixes. Before we trust a fix, we run it.

AI-written code can hang forever, eat all the memory, or try to read secrets.
So we run it inside a locked box with strict time and memory limits.

The sandbox reports what happened: passed or failed, the error, how long it
took, and how much memory it used. Every run is saved to PostgreSQL.

## Where it fits

```
Orchestrator (:8000) ── POST /run-tests ──► Sandbox (:8002) ──► PostgreSQL (sandbox_runs)
        ▲                                       │
        └──── JSON reply (passed, traceback …) ◄┘
```

The orchestrator's self-healing loop (`services/orchestrator/self_healing_loop.py`)
calls the sandbox for every fix that passed the AST gate and the agent debate.
If the run fails, it asks Bob for a new fix and tries again, up to 5 times.

### The most important rule: the silent fallback

The orchestrator quietly switches to a fake "mock" sandbox when **any** of
these happens:

- the sandbox is not running,
- the sandbox answers with an error status (4xx or 5xx),
- the answer takes longer than **10 seconds** (`SANDBOX_TIMEOUT_SECONDS`).

There is no error message. The demo just prints `sandbox=mock` instead of
`sandbox=live`. **Our goal is `sandbox=live`.**

## 1. API contract

### `POST /run-tests`

What the orchestrator sends today. Keep these two fields working exactly as-is:

```json
{ "code": "<full source of one fixed file>", "target_version": "python3.12" }
```

Optional extra fields. The orchestrator doesn't send them yet; Postman and
JavaScript runs use them:

| Field | Meaning | If missing |
| --- | --- | --- |
| `language` | `"python"` or `"javascript"` | Guess from `target_version`: starts with `python` → Python; starts with `node` or `js` → JavaScript; anything else → Python |
| `tests` | Test code: pytest for Python, Jest for JavaScript | See section 2 |

**Reply: always HTTP 200 when the run finished.** That includes failed
tests, timeouts and memory blow-ups. FastAPI already returns 422 for a
malformed request. Return 500 only when the sandbox itself breaks.

```json
{
  "run_id": 42,
  "passed": false,
  "status": "failed",
  "language": "python",
  "traceback": "Traceback (most recent call last):\n  File \"submission.py\", line 4, in <module>\nNameError: name 'undefined_var' is not defined",
  "exit_code": 1,
  "timed_out": false,
  "duration_ms": 380,
  "peak_memory_kb": 21480,
  "tests_total": 0,
  "tests_passed": 0,
  "tests_failed": 0,
  "stdout": "",
  "stderr": "Traceback (most recent call last): ..."
}
```

What the orchestrator relies on:

- **`passed`** (true/false). Required.
- **`traceback`**: Python-style error text for failures. The orchestrator's
  parser looks for `File "…", line N` and a last line like `NameError: message`.
  Run pytest with `--tb=native` so its failures print in this format.
- **`status`**: one of `passed`, `failed`, `timeout`, `memory_exceeded`, `error`.
  - Timeout: the traceback ends with `TimeoutError: execution exceeded 5 seconds`.
  - Out of memory: the traceback ends with `MemoryError: …`. The orchestrator's
    chaos test already expects this.
- **`tests_total`, `tests_passed`, `tests_failed`**: the same names the
  orchestrator's mock uses.
- `run_id` is the database row id, or `null` if the database was down.
- Extra fields are fine. The orchestrator keeps the whole reply under `details`.
- Trim `stdout` and `stderr` to about 10 KB each.

### `GET /health`

Returns `{"status": "ok"}` plus two additive capability fields:

```json
{ "status": "ok", "gnu_time": true, "memory_limit": true }
```

| Field | Meaning |
| --- | --- |
| `gnu_time` | `true` if a GNU `time` binary (`/usr/bin/time` or `gtime`) was found at startup |
| `memory_limit` | `true` if `bash -c 'ulimit -v 262144'` succeeded at startup |

Both probes run once when the server starts.  On platforms where GNU time is
absent, `peak_memory_kb` is always `0`.  On platforms where `ulimit -v` is not
supported, Python runs are launched without the memory cap.

### `GET /metrics`

Returns Prometheus text format metrics with HTTP 200.  No external dependency —
the text is written directly.  If the database is down, returns the `HELP`/`TYPE`
headers with no data lines (still HTTP 200).

```
# HELP sandbox_runs_total Total sandbox runs by language and status.
# TYPE sandbox_runs_total counter
sandbox_runs_total{language="python",status="passed"} 4
sandbox_runs_total{language="javascript",status="failed"} 1
# HELP sandbox_run_duration_ms Summary of sandbox run durations in milliseconds.
# TYPE sandbox_run_duration_ms summary
sandbox_run_duration_ms_count 5
sandbox_run_duration_ms_sum 2341
```

### `GET /runs?limit=20`

The latest rows from the database, newest first. Handy in Postman and for the
dashboard.

## 2. What runs

Each request gets a fresh temporary folder, which is deleted afterwards.
Run **exactly one command** per request, so the whole request stays well
under the orchestrator's 10-second limit.

| Language | Code saved as | Tests saved as | Command |
| --- | --- | --- | --- |
| Python, no tests | `submission.py` | — | `python3 submission.py` |
| Python, with tests | `submission.py` | `test_submission.py` | `python3 -m pytest -q --tb=native` on both files |
| JavaScript, no tests | `submission.js` | — | `node submission.js` |
| JavaScript, with tests | `submission.js` | `submission.test.js` | `<sandbox>/js_runner/node_modules/.bin/jest --rootDir <temp folder> --ci --json --runInBand` |

- "With tests" for Python means: the `tests` field was sent, **or** the code
  itself contains `def test_…` functions.
- Without tests, just running the file is the check. It catches syntax errors,
  missing imports and crashes when the file loads.
- Tests import the code by name: `from submission import slugify` in Python,
  `require("./submission")` in JavaScript.
- Test counts: pytest's built-in `--junitxml=report.xml` gives totals and
  failures. Jest's `--json` output has `numTotalTests`, `numPassedTests` and
  `numFailedTests`.
- Nothing is installed per run (no `pip install`, no `npm install`). That is
  slow and needs the internet.

## 3. Limits: the locked box

| Limit | Python | JavaScript |
| --- | --- | --- |
| Time | Kill after 5 seconds | Same |
| Memory | `ulimit -v 262144` (256 MB) when supported (see cross-platform guard in §1 API) | **No `ulimit -v`** (see trap 1). Use `node --max-old-space-size=256` plus the container's memory limit |
| Processes | Docker's `--pids-limit` stops "fork bombs" (code that copies itself until the machine freezes). **Don't use `ulimit -u`** (see trap 6) | Same |
| Environment | Clean: only `PATH`, `HOME` (the temp folder) and `LANG`. Never pass database settings or other secrets | Same |
| User | A non-root user inside the container | Same |

### Cross-platform notes

- **GNU time detection.** At startup the server tries `/usr/bin/time --version`
  then `gtime --version`.  If either prints output containing `"gnu"` it is used
  to wrap every child command.  Otherwise `peak_memory_kb` is always `0`.
- **`ulimit -v` detection.** At startup the server runs
  `bash -c 'ulimit -v 262144'`. If that exits 0, the Python wrapper includes
  the limit; otherwise it is omitted so Python still runs on macOS and other
  platforms where the syscall is not available.
- **Quoting.** The Python `bash -c` wrapper uses `shlex.quote()` for the Python
  executable path and the JUnit XML path, so paths containing spaces work
  correctly.  The JavaScript commands use argument lists and do not need this.

### Known traps

These were checked on Ilyas's machine (Node 22, Python 3.12).

1. **`ulimit -v` crashes Node.** With a 256 MB or 512 MB cap, Node dies before
   running anything: `Failed to reserve virtual memory for CodeRange`. Node
   reserves a big block of memory addresses when it starts. Python works fine
   under the same cap, including pytest and `import flask`. A 256 MB cap also
   stops a 512 MB allocation with `MemoryError`.
2. **Kill the whole process group on timeout.** `subprocess.run(timeout=…)`
   only kills the program it started directly. Jest workers, and anything the
   test code starts, keep running. Start the child with
   `start_new_session=True` and kill it with `os.killpg(proc.pid, signal.SIGKILL)`.
3. **Set limits with a `ulimit` wrapper, not `preexec_fn`.** For example:
   `bash -c 'ulimit -v 262144; exec python3 submission.py'`. Python's docs
   warn that `preexec_fn` can deadlock in programs that use threads, and a
   FastAPI server does.
4. **Measure memory per run with GNU `time`.** Two approaches that look right
   are wrong:
   - `resource.getrusage(RUSAGE_CHILDREN)` reports the largest child the server
     *ever* ran, not this run.
   - `os.wait4()` has a different problem. A new process starts as a copy of the
     server, so its `ru_maxrss` includes the server's own ~80 MB. Checked: a tiny
     child of a 300 MB parent reports 319,824 KB through `os.wait4()`, but
     9,380 KB through GNU time.

   So wrap each command as `/usr/bin/time -f %M -o peak.txt <command>` and read
   the **last** line of `peak.txt`. When the command fails, GNU time writes a
   `Command exited with non-zero status N` line first. Install the `time`
   package in the Docker image.
5. **The demo code imports Flask.** `demo/legacy-app/app/auth.py` starts with
   `from flask import request`. Pre-install `flask` in the image. Otherwise every
   demo run fails with `ModuleNotFoundError`, and the healing loop can't fix that.
6. **`ulimit -u` blocks every thread.** It counts all processes and threads that
   belong to the same user account, not just the sandbox's. Ilyas's desktop account
   already runs about 2,800. Under `ulimit -u 64`, Node crashes at startup
   (`uv_thread_create` assertion) and Python can't start a thread (both
   checked). Inside Docker it's the same problem if the container user has the
   same user ID as a user on the host. Use Docker's `--pids-limit` instead, and
   give the container user a high user ID such as 10001.
7. **pytest prints failures to stdout, not stderr.** For pytest runs, take the
   `traceback` from stdout, or the orchestrator gets an empty traceback (checked).

## 4. Database logging

- PostgreSQL through SQLAlchemy 2.x with the `psycopg` driver.
- Connection settings come from environment variables (see `.env.example`):
  `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_HOST`, `DB_PORT`.
  Build the URL as `postgresql+psycopg://USER:PASSWORD@HOST:PORT/DB`.
  If `DATABASE_URL` is set, use that instead.
- One table, `sandbox_runs`, created at startup with `Base.metadata.create_all()`.
  No migrations are needed for the hackathon. Columns:
  `id, created_at, language, target_version, status, passed, exit_code,
  timed_out, duration_ms, peak_memory_kb, tests_total, tests_passed,
  tests_failed, error_type, code_sha256, code_bytes`
- Store a hash of the code (`code_sha256`), not the code itself.
- **If the database is down, still return the result**, with `run_id: null`,
  and log a warning. The rest of the project follows the same "never break the
  demo" rule.

### Local database

It's already set up: a Docker container called `bob-sandbox-db`, on the Docker
network `bob-net`. The password is in `services/sandbox/.env`, which git ignores.

- From your computer: `localhost:5433`
- From another container on `bob-net`: `bob-sandbox-db:5432`

```bash
docker start bob-sandbox-db
```

## 5. Docker image

- One image with Python 3.12, Node 22, pytest, Jest and Flask. Suggestion: start
  `FROM python:3.12-slim` and copy Node in from `node:22-bookworm-slim`.
  If `docker images` doesn't list them yet, run `docker pull python:3.12-slim`
  and `docker pull node:22-bookworm-slim` first (one image per command).
- Install Jest from `services/sandbox/js_runner/package.json` at build time
  (`npm ci`), the same copy used locally, so there's no global install.
- Install the `time` package (GNU time, for per-run memory; see trap 4).
- Run uvicorn on port 8002 as a non-root user with a high user ID, such as 10001
  (see trap 6).
- Add a `.dockerignore` containing `.env`, so the database password never ends up
  inside the image, where submitted code could read it.

Build and run it next to the database:

```bash
docker build -t bob-sandbox services/sandbox
docker run --rm --name bob-sandbox --network bob-net -p 127.0.0.1:8002:8002 \
  --memory=1g --pids-limit=256 \
  --env-file services/sandbox/.env -e DB_HOST=bob-sandbox-db -e DB_PORT=5432 \
  bob-sandbox
```

## 6. Done when

Import `postman/sandbox.postman_collection.json` into Postman and click
**Run collection**. Every request has automatic checks.

1. Python code that works → `passed: true`
2. Python `NameError` → `passed: false`, and the traceback mentions `NameError`
3. Python infinite loop → `status: "timeout"`, reply in under 10 s, server still healthy
4. Python memory hog → `status: "memory_exceeded"`
5. Python with pytest tests (2 pass, 1 fail) → `tests_total: 3`, `tests_failed: 1`
6. The demo's `auth.py`, exactly as the orchestrator sends it → `passed: true`
7. JavaScript that works → `passed: true`
8. JavaScript with Jest tests (1 pass, 1 fail) → `passed: false`, `tests_failed: 1`, traceback has a line starting `AssertionError:`
9. JavaScript infinite loop → `status: "timeout"`
10. JavaScript memory hog → `passed: false`
11. `GET /runs` shows the runs above
12. End to end: with the sandbox on port 8002, run
    `PATH="$PWD/.venv/bin:$PATH" bash demo/demo.sh` from the repo root. It should print
    `sandbox=live`. Until modales fixes two orchestrator bugs on `main`, the
    orchestrator can't start on a fresh machine:
    - a syntax error in `services/orchestrator/cross_language_parser.py`, line 113
      (four `"` in a row)
    - `python-multipart` missing from `services/orchestrator/requirements.txt`
13. `GET /metrics` → HTTP 200, body contains `sandbox_runs_total`
14. JavaScript `TypeError` crash → `passed: false`, traceback has a line starting `TypeError:`

## 7. Open questions for modales

- **Language:** the orchestrator sends `target_version: "python3.12"` for every
  file. Today only Python files get this far (the AST gate is Python-only). To test
  JavaScript fixes later, it should also send `language` or the file name.
- **Tests:** the orchestrator sends only the fixed file, no tests. Is a smoke run
  (plus any tests inside the file) enough? Or should it also send the repo's
  matching test file in `tests`?
- **Demo script:** `demo/demo.sh` starts the auditor and orchestrator but not the
  sandbox. It's outside Ilyas's folder. Can modales add the `docker run` line
  from section 5?
- **Bob screenshots:** the rules want a `bob_sessions/` folder in the repo. The
  root belongs to modales. Create it at the root, or does each person keep theirs
  in their own folder?
