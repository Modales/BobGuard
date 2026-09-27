"""Sandbox service — IBM Bob 2.0 hackathon. Owner: Ilyas.

POST /run-tests  — execute untrusted code in a locked temp folder.
GET  /health     — liveness probe.
GET  /runs       — recent runs from the database.
GET  /metrics    — Prometheus text metrics.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, DateTime, Integer, String, create_engine, func, text
from sqlalchemy.orm import DeclarativeBase, Session

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sandbox")

# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

def _build_db_url() -> Optional[str]:
    if url := os.getenv("DATABASE_URL"):
        return url
    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    db = os.getenv("POSTGRES_DB")
    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT", "5432")
    if user and password and db and host:
        return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{db}"
    return None


class _Base(DeclarativeBase):
    pass


class SandboxRun(_Base):
    __tablename__ = "sandbox_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    language = Column(String)
    target_version = Column(String)
    status = Column(String)
    passed = Column(Boolean)
    exit_code = Column(Integer)
    timed_out = Column(Boolean)
    duration_ms = Column(Integer)
    peak_memory_kb = Column(Integer)
    tests_total = Column(Integer)
    tests_passed = Column(Integer)
    tests_failed = Column(Integer)
    error_type = Column(String)
    code_sha256 = Column(String)
    code_bytes = Column(Integer)


_engine = None

def _get_engine():
    global _engine
    if _engine is None:
        url = _build_db_url()
        if url:
            try:
                _engine = create_engine(url, pool_pre_ping=True)
                _Base.metadata.create_all(_engine)
            except Exception as exc:
                logger.warning("DB setup failed: %s", exc)
                _engine = None
    return _engine


def _save_run(row_data: dict) -> Optional[int]:
    """Persist a run row; returns the new id, or None on failure."""
    engine = _get_engine()
    if engine is None:
        return None
    try:
        with Session(engine) as session:
            row = SandboxRun(**row_data)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row.id
    except Exception as exc:
        logger.warning("DB write failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="IBM Bob Sandbox", version="0.1.0")

# ---------------------------------------------------------------------------
# Cross-platform capability probes (run once at startup)
# ---------------------------------------------------------------------------

def _probe_gnu_time() -> Optional[str]:
    """Return the path to GNU time if available, else None."""
    for candidate in ("/usr/bin/time", "gtime"):
        try:
            result = subprocess.run(
                [candidate, "--version"],
                capture_output=True, text=True, timeout=5,
            )
            # GNU time prints version info to stderr
            combined = (result.stdout + result.stderr).lower()
            if "gnu" in combined:
                return candidate
        except Exception:
            pass
    return None


def _probe_ulimit_v() -> bool:
    """Return True if 'ulimit -v 262144' is accepted by bash."""
    try:
        result = subprocess.run(
            ["bash", "-c", "ulimit -v 262144"],
            capture_output=True, timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


# Probe results cached at module level; populated at startup.
_GNU_TIME_BIN: Optional[str] = None   # path to GNU time, or None
_ULIMIT_V_OK: bool = False             # whether ulimit -v works


@app.on_event("startup")
def _startup() -> None:
    global _GNU_TIME_BIN, _ULIMIT_V_OK
    _get_engine()
    _GNU_TIME_BIN = _probe_gnu_time()
    _ULIMIT_V_OK = _probe_ulimit_v()
    logger.info(
        "Capability probes: gnu_time=%s ulimit_v=%s",
        _GNU_TIME_BIN or "disabled",
        _ULIMIT_V_OK,
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gnu_time": _GNU_TIME_BIN is not None,
        "memory_limit": _ULIMIT_V_OK,
    }


@app.get("/runs")
def get_runs(limit: int = 20):
    engine = _get_engine()
    if engine is None:
        return []
    try:
        with Session(engine) as session:
            rows = (
                session.query(SandboxRun)
                .order_by(SandboxRun.id.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": r.id,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "language": r.language,
                    "target_version": r.target_version,
                    "status": r.status,
                    "passed": r.passed,
                    "exit_code": r.exit_code,
                    "timed_out": r.timed_out,
                    "duration_ms": r.duration_ms,
                    "peak_memory_kb": r.peak_memory_kb,
                    "tests_total": r.tests_total,
                    "tests_passed": r.tests_passed,
                    "tests_failed": r.tests_failed,
                    "error_type": r.error_type,
                    "code_sha256": r.code_sha256,
                    "code_bytes": r.code_bytes,
                }
                for r in rows
            ]
    except Exception as exc:
        logger.warning("DB read failed: %s", exc)
        return []


@app.get("/metrics", response_class=PlainTextResponse)
def get_metrics() -> str:
    """Prometheus text format metrics — no external dependency.

    Exposes:
      sandbox_runs_total{language, status}  — counter per (language, status)
      sandbox_run_duration_ms_count         — total number of finished runs
      sandbox_run_duration_ms_sum           — sum of duration_ms across all runs
    """
    engine = _get_engine()
    lines: list[str] = []

    lines.append("# HELP sandbox_runs_total Total sandbox runs by language and status.")
    lines.append("# TYPE sandbox_runs_total counter")
    lines.append("# HELP sandbox_run_duration_ms Summary of sandbox run durations in milliseconds.")
    lines.append("# TYPE sandbox_run_duration_ms summary")

    try:
        if engine is None:
            raise RuntimeError("no engine")
        with Session(engine) as session:
            # Aggregate counts per (language, status).
            rows = (
                session.query(
                    SandboxRun.language,
                    SandboxRun.status,
                    func.count(SandboxRun.id).label("cnt"),
                )
                .group_by(SandboxRun.language, SandboxRun.status)
                .all()
            )
            for row in rows:
                lang = row.language or "unknown"
                status = row.status or "unknown"
                lines.append(
                    f'sandbox_runs_total{{language="{lang}",status="{status}"}} {row.cnt}'
                )

            # Duration summary aggregates.
            agg = session.query(
                func.count(SandboxRun.id).label("cnt"),
                func.sum(SandboxRun.duration_ms).label("total_ms"),
            ).one()
            count_val = agg.cnt or 0
            sum_val = agg.total_ms or 0
            lines.append(f"sandbox_run_duration_ms_count {count_val}")
            lines.append(f"sandbox_run_duration_ms_sum {sum_val}")
    except Exception as exc:
        logger.warning("Metrics DB query failed: %s", exc)
        # Return valid (empty) metrics page rather than an error.

    lines.append("")  # trailing newline
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class RunRequest(BaseModel):
    code: str
    target_version: str = "python3.12"
    language: Optional[str] = None
    tests: Optional[str] = None


class RunResponse(BaseModel):
    run_id: Optional[int]
    passed: bool
    status: str
    language: str
    traceback: Optional[str]
    exit_code: Optional[int]
    timed_out: bool
    duration_ms: int
    peak_memory_kb: int
    tests_total: int
    tests_passed: int
    tests_failed: int
    stdout: str
    stderr: str


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------

def _detect_language(req: RunRequest) -> str:
    if req.language:
        return req.language.lower()
    tv = req.target_version.lower()
    if tv.startswith("python"):
        return "python"
    if tv.startswith("node") or tv.startswith("js"):
        return "javascript"
    return "python"


def _has_inline_tests(code: str) -> bool:
    """True when the Python source defines at least one test_ function."""
    return "def test_" in code


# ---------------------------------------------------------------------------
# Process execution
# ---------------------------------------------------------------------------

_MAX_OUTPUT_BYTES = 10 * 1024  # 10 KB

# Clean environment: only PATH, HOME, LANG.
_CLEAN_ENV_BASE = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "en_US.UTF-8",
}

TIMEOUT_SECONDS = 5

# Resolve the Python interpreter once at import time so the ulimit wrapper
# can use absolute paths regardless of what PATH looks like in the child env.
_PYTHON_EXE = os.path.abspath(sys.executable)

# Absolute path to the Jest binary installed in js_runner/.
_JS_RUNNER_DIR = os.path.join(os.path.dirname(__file__), "js_runner")
_JEST_BIN = os.path.join(_JS_RUNNER_DIR, "node_modules", ".bin", "jest")


def _wrap_with_gnu_time(inner_cmd: list[str], peak_file: str) -> list[str]:
    """Wrap a command list with GNU time if available; otherwise return as-is."""
    if _GNU_TIME_BIN:
        return [_GNU_TIME_BIN, "-f", "%M", "-o", peak_file] + inner_cmd
    return inner_cmd


def _read_peak_kb(peak_file: str) -> int:
    """Read peak RSS in KB from a GNU time output file.

    GNU time writes 'Command exited with non-zero status N\\nNNN' on failure,
    so we always read the *last* non-empty line.
    """
    try:
        lines = Path(peak_file).read_text().strip().splitlines()
        for line in reversed(lines):
            line = line.strip()
            if line.isdigit():
                return int(line)
    except Exception:
        pass
    return 0


def _build_python_command(workdir: str, has_tests: bool, has_test_file: bool = False) -> list[str]:
    """Return the argv list for the Python run (without the GNU time wrapper).

    Uses shlex.quote() for every value inserted into the bash -c string so
    paths with spaces don't break the command (GitHub issue #6, item 2).
    Only adds 'ulimit -v 262144' when the startup probe confirmed it works.
    """
    exe_q = shlex.quote(_PYTHON_EXE)
    ulimit_prefix = "ulimit -v 262144; " if _ULIMIT_V_OK else ""
    if has_tests:
        junit_path = os.path.join(workdir, "report.xml")
        junit_q = shlex.quote(junit_path)
        if has_test_file:
            inner = (
                f"{ulimit_prefix}exec {exe_q} -m pytest -q --tb=native "
                f"--junitxml={junit_q} submission.py test_submission.py"
            )
        else:
            inner = (
                f"{ulimit_prefix}exec {exe_q} -m pytest -q --tb=native "
                f"--junitxml={junit_q} submission.py"
            )
    else:
        inner = f"{ulimit_prefix}exec {exe_q} submission.py"
    return ["bash", "-c", inner]


def _build_js_command(workdir: str, has_tests: bool) -> list[str]:
    """Return the argv list for the JavaScript run (without the GNU time wrapper).

    Memory limit: NODE_OPTIONS=--max-old-space-size=256 (not ulimit -v, SPEC trap 1).
    The env is set in _run_subprocess via extra_env.
    """
    if has_tests:
        return [
            _JEST_BIN,
            "--rootDir", workdir,
            "--ci",
            "--json",
            "--runInBand",
        ]
    else:
        return ["node", os.path.join(workdir, "submission.js")]


def _drain_pipe(pipe, buf: list) -> None:
    """Read an entire pipe into buf[0]; run in a background thread."""
    buf[0] = pipe.read()


def _run_subprocess(
    cmd: list[str],
    workdir: str,
    extra_env: Optional[dict] = None,
) -> tuple[int, str, str, float, int, bool]:
    """
    Run cmd in workdir with a 5-second timeout, killing the full process group.

    When GNU time is available, wraps the command to measure peak RSS accurately
    (SPEC trap 4). When unavailable, peak_memory_kb is reported as 0.

    Returns (exit_code, stdout, stderr, duration_ms, peak_memory_kb, timed_out).
    """
    env = {**_CLEAN_ENV_BASE, "HOME": workdir}
    if extra_env:
        env.update(extra_env)

    peak_file = os.path.join(workdir, "peak.txt")
    timed_cmd = _wrap_with_gnu_time(cmd, peak_file)

    start = time.monotonic()
    proc = subprocess.Popen(
        timed_cmd,
        cwd=workdir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )

    # Drain pipes in background threads so the child never blocks on a full
    # pipe buffer, and so we can reap it ourselves with os.wait4().
    stdout_buf: list = [b""]
    stderr_buf: list = [b""]
    t_out = threading.Thread(target=_drain_pipe, args=(proc.stdout, stdout_buf), daemon=True)
    t_err = threading.Thread(target=_drain_pipe, args=(proc.stderr, stderr_buf), daemon=True)
    t_out.start()
    t_err.start()

    # Poll with WNOHANG until the child exits or the deadline passes.
    deadline = start + TIMEOUT_SECONDS
    timed_out = False
    wait_status = None

    while True:
        try:
            pid, ws, _ru = os.wait4(proc.pid, os.WNOHANG)
        except ChildProcessError:
            break
        if pid != 0:
            wait_status = ws
            break
        if time.monotonic() >= deadline:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                _, wait_status, _ru = os.wait4(proc.pid, 0)
            except ChildProcessError:
                pass
            break
        time.sleep(0.02)

    duration_ms = int((time.monotonic() - start) * 1000)

    t_out.join(timeout=2)
    t_err.join(timeout=2)

    if wait_status is not None:
        exit_code = os.waitstatus_to_exitcode(wait_status)
        proc.returncode = exit_code
    else:
        exit_code = proc.returncode or -1

    # Read peak RSS from GNU time output file (SPEC trap 4).
    # If GNU time was not available, _wrap_with_gnu_time returned the command
    # unchanged and peak.txt was never written, so _read_peak_kb returns 0.
    peak_kb = _read_peak_kb(peak_file) if _GNU_TIME_BIN else 0

    stdout = stdout_buf[0].decode(errors="replace")[:_MAX_OUTPUT_BYTES]
    stderr = stderr_buf[0].decode(errors="replace")[:_MAX_OUTPUT_BYTES]

    return exit_code, stdout, stderr, duration_ms, peak_kb, timed_out


# ---------------------------------------------------------------------------
# JUnit XML parsing (Python / pytest)
# ---------------------------------------------------------------------------

def _parse_junit(xml_path: str) -> tuple[int, int, int]:
    """Return (total, passed, failed) from a pytest --junitxml report."""
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        suite = root if root.tag == "testsuite" else root.find("testsuite")
        if suite is None:
            return 0, 0, 0
        total = int(suite.get("tests", 0))
        failures = int(suite.get("failures", 0))
        errors = int(suite.get("errors", 0))
        failed = failures + errors
        passed = max(0, total - failed)
        return total, passed, failed
    except Exception:
        return 0, 0, 0


# ---------------------------------------------------------------------------
# Jest JSON parsing (JavaScript)
# ---------------------------------------------------------------------------

# Strips ANSI colour escape sequences from a string.
_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(text: str) -> str:
    return _ANSI_ESCAPE_RE.sub("", text)


# Matches a JS error name at the START of a line (column 0), e.g.:
#   TypeError: cannot read properties of undefined
#   Error: expect(received).toBe(expected)
#   AssertionError: …
_JS_ERROR_AT_COL0_RE = re.compile(
    r"^([A-Za-z_][\w.]*Error[^\n]*)", re.MULTILINE
)


def _jest_traceback_from_message(msg: str) -> str:
    """Convert a single Jest failureMessage into a healing-loop-compatible traceback.

    The orchestrator's _TB_ERROR_RE only recognises lines that START at column 0
    and whose name ends with Error/Exception/etc.  Jest's failureMessages already
    contain such lines for named errors (TypeError, ReferenceError, …), but for
    a plain expect() failure Jest produces lines like:

        Error: expect(received).toBe(expected)

    which IS column-0 but has a bare "Error" name that _TB_ERROR_RE skips because
    its pattern requires at least one word-char prefix before "Error".

    Strategy:
    1. Strip ANSI colour codes.
    2. Keep the message as-is (it may already have a good error line).
    3. If the message does NOT already end with a column-0 error line matching
       _TB_ERROR_RE, append one:
       - If the first column-0 "…Error: …" line exists, use it.
       - Otherwise synthesise "AssertionError: <first line of message>".
    """
    # _TB_ERROR_RE from self_healing_loop.py — must match what the orchestrator uses.
    _orch_re = re.compile(
        r"^([A-Za-z_][\w\.]*(?:Error|Exception|Exit|Warning|Interrupt))\b",
        re.MULTILINE,
    )

    clean = _strip_ansi(msg).rstrip()

    # Check whether the last non-empty line already satisfies _TB_ERROR_RE.
    lines = clean.splitlines()
    last_non_empty = next((l for l in reversed(lines) if l.strip()), "")
    if _orch_re.match(last_non_empty):
        return clean

    # Find the first column-0 JS error line in the message.
    col0_match = _JS_ERROR_AT_COL0_RE.search(clean)
    if col0_match:
        return clean + "\n" + col0_match.group(1)

    # Synthesise an AssertionError from the first line of the message.
    first_line = lines[0].strip() if lines else "test failed"
    # Jest often starts failure messages with a bare "Error: " prefix that is
    # not a named error type; strip it so we get a clean message.
    first_line = re.sub(r"^Error:\s*", "", first_line)
    # Truncate to avoid absurdly long single lines.
    if len(first_line) > 200:
        first_line = first_line[:200] + "…"
    return clean + "\nAssertionError: " + first_line


def _parse_jest_json(stdout: str) -> tuple[int, int, int, Optional[str]]:
    """Parse Jest's --json output.

    Returns (tests_total, tests_passed, tests_failed, traceback).
    The traceback is built from failing test assertion messages and is
    guaranteed to end with a column-0 line recognised by the orchestrator's
    _TB_ERROR_RE (e.g. "TypeError: …" or "AssertionError: …").
    """
    # Jest --json prints the JSON result to stdout.  Find the JSON object.
    # Sometimes there's extra non-JSON text before it (e.g. from console.log).
    try:
        # Try to find the outermost JSON object.
        start = stdout.find("{")
        if start == -1:
            return 0, 0, 0, None
        data = json.loads(stdout[start:])
    except json.JSONDecodeError:
        # Try to find the last complete JSON object in the output.
        try:
            # Walk backwards looking for a valid JSON blob.
            for i in range(len(stdout) - 1, -1, -1):
                if stdout[i] == "}":
                    try:
                        data = json.loads(stdout[stdout.find("{", 0, i + 1):i + 1])
                        break
                    except json.JSONDecodeError:
                        continue
            else:
                return 0, 0, 0, None
        except Exception:
            return 0, 0, 0, None

    total = data.get("numTotalTests", 0)
    passed = data.get("numPassedTests", 0)
    failed = data.get("numFailedTests", 0)

    # Collect failure messages for the traceback.
    messages: list[str] = []
    for suite in data.get("testResults", []):
        for result in suite.get("assertionResults", []):
            if result.get("status") == "failed":
                title = result.get("fullName") or result.get("title", "")
                for msg in result.get("failureMessages", []):
                    tb_block = _jest_traceback_from_message(msg)
                    messages.append(f"FAIL {title}\n{tb_block}")

    traceback = "\n\n".join(messages) if messages else None
    return total, passed, failed, traceback


# ---------------------------------------------------------------------------
# Result interpretation
# ---------------------------------------------------------------------------

# Matches "SomethingError: message" or "SomethingException: …" anywhere in text.
_ERROR_LINE_RE = re.compile(
    r"^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Warning|Interrupt))\b.*$",
    re.MULTILINE,
)


def _extract_error_type(text: str) -> Optional[str]:
    """Return the exception class name from the last matching error line."""
    matches = _ERROR_LINE_RE.findall(text)
    return matches[-1] if matches else None


def _classify_result(
    exit_code: int,
    stdout: str,
    stderr: str,
    timed_out: bool,
    is_pytest: bool,
    tests_total: int,
    tests_failed: int,
    language: str = "python",
) -> tuple[bool, str, Optional[str]]:
    """Return (passed, status, traceback)."""
    if timed_out:
        tb = (
            'Traceback (most recent call last):\n'
            '  File "submission.py", line 1, in <module>\n'
            'TimeoutError: execution exceeded 5 seconds\n'
        )
        return False, "timeout", tb

    # Memory limit exceeded.
    # Python: ulimit -v causes MemoryError or "Cannot allocate memory" in stderr.
    # JavaScript: Node OOM produces a recognisable message in stderr.
    oom_signals = ("MemoryError", "Cannot allocate memory", "JavaScript heap out of memory")
    if exit_code != 0 and any(s in stderr for s in oom_signals):
        tb = stderr or "MemoryError: virtual memory limit exceeded\n"
        return False, "memory_exceeded", tb
    if exit_code != 0 and "Killed" in stderr and "memory" in stderr.lower():
        tb = stderr or "MemoryError: virtual memory limit exceeded\n"
        return False, "memory_exceeded", tb

    if exit_code == 0:
        if (is_pytest or language == "javascript") and tests_failed > 0:
            return False, "failed", stdout or None
        return True, "passed", None

    if is_pytest:
        # pytest prints failure tracebacks to stdout (SPEC trap 7).
        tb = stdout.strip() or stderr.strip() or None
    else:
        tb = stderr.strip() or stdout.strip() or None
    return False, "failed", tb


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

@app.post("/run-tests", response_model=RunResponse)
def run_tests(req: RunRequest) -> RunResponse:
    language = _detect_language(req)
    has_test_file = bool(req.tests)
    has_tests = has_test_file or (language == "python" and _has_inline_tests(req.code))

    workdir = tempfile.mkdtemp(prefix="sandbox_")
    try:
        extra_env: Optional[dict] = None

        if language == "javascript":
            # Write source files for JavaScript.
            with open(os.path.join(workdir, "submission.js"), "w") as f:
                f.write(req.code)
            if has_test_file:
                with open(os.path.join(workdir, "submission.test.js"), "w") as f:
                    f.write(req.tests)
            # Jest requires a package.json (or jest config) in the rootDir.
            with open(os.path.join(workdir, "package.json"), "w") as f:
                f.write('{"private":true}\n')
            # Memory limit via NODE_OPTIONS instead of ulimit -v (SPEC trap 1).
            extra_env = {"NODE_OPTIONS": "--max-old-space-size=256"}
            cmd = _build_js_command(workdir, has_tests)
        else:
            # Write source files for Python.
            with open(os.path.join(workdir, "submission.py"), "w") as f:
                f.write(req.code)
            if has_test_file:
                with open(os.path.join(workdir, "test_submission.py"), "w") as f:
                    f.write(req.tests)
            cmd = _build_python_command(workdir, has_tests, has_test_file=has_test_file)

        exit_code, stdout, stderr, duration_ms, peak_memory_kb, timed_out = _run_subprocess(
            cmd, workdir, extra_env=extra_env
        )

        # Parse test counts.
        tests_total = tests_passed = tests_failed = 0
        jest_traceback: Optional[str] = None

        if language == "javascript" and has_tests:
            tests_total, tests_passed, tests_failed, jest_traceback = _parse_jest_json(stdout)
        elif language == "python" and has_tests:
            junit_path = os.path.join(workdir, "report.xml")
            if os.path.exists(junit_path):
                tests_total, tests_passed, tests_failed = _parse_junit(junit_path)

        is_pytest = language == "python" and has_tests
        passed, status, traceback = _classify_result(
            exit_code, stdout, stderr, timed_out, is_pytest, tests_total, tests_failed,
            language=language,
        )

        # For Jest runs use the structured failure messages as the traceback.
        if language == "javascript" and jest_traceback and not timed_out:
            traceback = jest_traceback
        # For plain node crashes, ensure the traceback ends with a column-0
        # error line so the orchestrator's _TB_ERROR_RE can parse it.
        elif language == "javascript" and not has_tests and traceback and not timed_out:
            traceback = _jest_traceback_from_message(traceback)

        run_id = _save_run(
            dict(
                language=language,
                target_version=req.target_version,
                status=status,
                passed=passed,
                exit_code=exit_code,
                timed_out=timed_out,
                duration_ms=duration_ms,
                peak_memory_kb=peak_memory_kb,
                tests_total=tests_total,
                tests_passed=tests_passed,
                tests_failed=tests_failed,
                error_type=_extract_error_type(traceback) if traceback else None,
                code_sha256=hashlib.sha256(req.code.encode()).hexdigest(),
                code_bytes=len(req.code.encode()),
            )
        )

        return RunResponse(
            run_id=run_id,
            passed=passed,
            status=status,
            language=language,
            traceback=traceback,
            exit_code=exit_code,
            timed_out=timed_out,
            duration_ms=duration_ms,
            peak_memory_kb=peak_memory_kb,
            tests_total=tests_total,
            tests_passed=tests_passed,
            tests_failed=tests_failed,
            stdout=stdout,
            stderr=stderr,
        )

    finally:
        shutil.rmtree(workdir, ignore_errors=True)
