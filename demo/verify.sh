#!/usr/bin/env bash
#
# verify.sh — pre-stage checklist for the IBM Bob 2.0 demo
# =========================================================
# Runs every automated proof we have, in order, and prints a single
# GO / NO-GO verdict. Run this 10 minutes before judging.
#
#   ./demo/verify.sh
#
# Checks:
#   1. All services compile (syntax)
#   2. Orchestrator test suite (26 tests, offline)
#   3. Chaos suite (4 fault-injection scenarios)
#   4. ARCHITECTURE.md freshness (--check against live code)
#   5. Smoke: orchestrator boots, /token issues a JWT, /modernize returns 200
#
# Exit code 0 = GO. Any failure = NO-GO with the failing step printed.
#
set -uo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${DEMO_DIR}/.." && pwd)"
ORCH="${ROOT}/services/orchestrator"

pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
step() { printf '\033[1;34m[%s]\033[0m %s\n' "$1" "$2"; }
FAILED=0

# --- 1. Compile-check every service -----------------------------------------
step 1/5 "Compile-checking all services"
if python3 -m compileall -q "${ROOT}/services" >/dev/null 2>&1; then
  pass "all Python sources compile"
else
  fail "syntax error in services/ — run: python3 -m compileall services/"
fi

# --- 2. Orchestrator test suite ----------------------------------------------
step 2/5 "Orchestrator test suite"
if (cd "${ORCH}" && python3 -m pytest tests/ -q >/tmp/verify_pytest.log 2>&1); then
  pass "$(tail -1 /tmp/verify_pytest.log | tr -s ' ')"
else
  fail "pytest failed — see /tmp/verify_pytest.log"
fi

# --- 3. Chaos suite -----------------------------------------------------------
step 3/5 "Chaos monkey (fault injection)"
if (cd "${ORCH}" && python3 chaos_monkey_tester.py >/tmp/verify_chaos.log 2>&1); then
  pass "$(grep -E 'scenarios survived' /tmp/verify_chaos.log | tr -s ' ')"
else
  fail "chaos suite failed — see /tmp/verify_chaos.log"
fi

# --- 4. Documentation freshness -------------------------------------------------
step 4/5 "ARCHITECTURE.md freshness"
if (cd "${ORCH}" && python3 auto_doc_generator.py --check >/tmp/verify_docs.log 2>&1); then
  pass "docs match the live code"
else
  fail "ARCHITECTURE.md stale — run: python3 services/orchestrator/auto_doc_generator.py"
fi

# --- 5. Smoke: boot orchestrator, login, run pipeline -----------------------------
step 5/5 "Smoke test (boot + auth + /modernize)"
PORT=8123
(cd "${ORCH}" && PORT=${PORT} python3 main.py >/tmp/verify_server.log 2>&1) &
SERVER_PID=$!
cleanup() { kill ${SERVER_PID} 2>/dev/null; wait ${SERVER_PID} 2>/dev/null; lsof -ti :${PORT} 2>/dev/null | xargs kill 2>/dev/null; sleep 1; }
trap cleanup EXIT

ready=0
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && { ready=1; break; }
  sleep 0.5
done

if [ "${ready}" != "1" ]; then
  fail "orchestrator did not boot — see /tmp/verify_server.log"
else
  TOKEN=$(curl -sf -X POST "http://127.0.0.1:${PORT}/token" \
    -d "username=admin&password=bob-hackathon-2026" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
  if [ -z "${TOKEN}" ]; then
    fail "/token did not return a JWT"
  else
    CODE=$(curl -s -o /tmp/verify_modernize.json -w "%{http_code}" -X POST \
      "http://127.0.0.1:${PORT}/api/v1/modernize" \
      -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
      -d "{\"repo_path\": \"${DEMO_DIR}/legacy-app\", \"target_version\": \"python3.12\"}")
    if [ "${CODE}" = "200" ]; then
      SUCCESS=$(python3 -c "import json; print(json.load(open('/tmp/verify_modernize.json'))['pipeline_success'])" 2>/dev/null)
      pass "pipeline returned 200 (pipeline_success=${SUCCESS})"
    else
      fail "/modernize returned HTTP ${CODE}"
    fi
  fi
fi

# --- Verdict ----------------------------------------------------------------------
echo
if [ "${FAILED}" = "0" ]; then
  printf '\033[1;32m=========================================\033[0m\n'
  printf '\033[1;32m  VERDICT: GO — ship the demo.\033[0m\n'
  printf '\033[1;32m=========================================\033[0m\n'
  exit 0
else
  printf '\033[1;31m=========================================\033[0m\n'
  printf '\033[1;31m  VERDICT: NO-GO — fix the FAIL(s) above.\033[0m\n'
  printf '\033[1;31m=========================================\033[0m\n'
  exit 1
fi
