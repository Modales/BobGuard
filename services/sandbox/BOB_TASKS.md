# Building the sandbox with IBM Bob

You have **40 Bobcoins** (Bob's usage credits), with no refills. So group the
work into a few big Bob tasks instead of many small questions. You can see your
balance under **Settings → General** in Bob.

How to start:

1. Open this repo folder in the Bob IDE (**File → Open Folder**).
2. Open the **IBM Bob** chat panel on the right. If you don't see it, press
   **Ctrl+Alt+B**.
3. Check you're on the hackathon account: **Bob Settings** (bottom-right
   corner) → **General** → `ibm-coding-challenge-…` (us-east). Otherwise Bob
   spends your personal credits.
4. Under the chat box, make sure the mode selector says **Agent**. Bob 2.2
   has three modes: Agent (writes and changes code), Plan and Ask.
5. Give Bob the tasks below one at a time.
6. Bob asks before it edits a file or runs a command. Approve changes inside
   `services/sandbox/`. Reject anything outside it; that's the team rule.

After each task, test it in Postman (`postman/sandbox.postman_collection.json`)
and take the screenshot (see the bottom of this file). If something breaks,
paste the exact error into the **same** Bob task, so Bob keeps the context.

## Task 1: the core endpoint (Python only)

> Read `services/sandbox/SPEC.md` and `services/orchestrator/self_healing_loop.py`.
> Implement `services/sandbox/main.py` as a FastAPI app with `POST /run-tests`
> and `GET /health`, for Python only for now. Follow SPEC sections 1–3 exactly:
> a fresh temp folder per run, one command per request, a 5-second timeout that
> kills the whole process group, the `ulimit` wrapper instead of `preexec_fn`,
> a clean environment for the child, and the JSON reply with the exact field
> names. Always return HTTP 200 for finished runs. Update `requirements.txt`.
> Keep functions small, with clear names. Only create or change files inside
> `services/sandbox/`. Use the existing virtual environment at `.venv`
> (`.venv/bin/python`, `.venv/bin/pip`) for anything you run.

## Task 2: JavaScript and Jest

> Read `services/sandbox/SPEC.md` again (it was updated) and
> `services/sandbox/main.py`. Add JavaScript support, following SPEC sections 2–3:
> - Install Jest locally in `services/sandbox/js_runner/` (its own
>   `package.json`; `node_modules` is git-ignored). Run that Jest by its absolute
>   path with `--rootDir` set to the run's temp folder, plus `--ci --json --runInBand`.
> - Do not use `ulimit -v` for Node (SPEC trap 1). Put
>   `NODE_OPTIONS=--max-old-space-size=256` in the child's environment instead.
> - Fill `tests_total`, `tests_passed` and `tests_failed` from Jest's `--json`
>   output, and use the failing tests' messages as the `traceback`.
> - Also fix `peak_memory_kb` for both languages (SPEC trap 4): `os.wait4()`
>   includes the server's own memory. Wrap every command as
>   `/usr/bin/time -f %M -o <temp folder>/peak.txt <command>` and read the last
>   line of that file.
>
> Keep all 7 Python checks passing. Only create or change files inside
> `services/sandbox/`. Use `.venv` for Python commands.

## Task 3: PostgreSQL logging (already done, skip)

Bob built this during Tasks 1–2: every run is saved to the `sandbox_runs` table,
`GET /runs` lists them, and runs still return (with `run_id: null`) when the
database is down. All three were checked.

## Task 4: the Dockerfile

> Read `services/sandbox/SPEC.md` section 5 and traps 4 and 6. Rewrite
> `services/sandbox/Dockerfile`:
> - Start `FROM python:3.12-slim` and copy Node 22 in from `node:22-bookworm-slim`.
> - Install the `time` package (GNU time), the Python packages from
>   `requirements.txt`, and Jest with `npm ci` inside `js_runner/`.
> - Create a non-root user with user ID 10001 and run as that user.
> - Start uvicorn on 0.0.0.0:8002.
> - Add a `.dockerignore` that excludes `.env`, `node_modules`, `__pycache__`
>   and `bob_sessions`.
>
> Then run `docker build -t bob-sandbox services/sandbox` to check it builds.
> Don't start the container; I'll test it. Only create or change files inside
> `services/sandbox/`.

## Task 5 (if coins remain): security review

> Review `services/sandbox/` as a security expert. Can submitted code escape
> the time or memory limits, read secrets, or crash the server? List the
> issues by severity and fix the serious ones.

This one also makes a good story for the pitch: Bob built the sandbox, then
tried to break it.

## Screenshots (required for the submission)

Every team member must add these to the repo.

1. In Bob's chat, click **Tasks**.
2. Open the task, then click the **task header**. The "task session consumption
   summary" appears.
3. Take a screenshot and save it as a PNG. Name it with the team name, task
   number and a short description, for example
   `teamname_task01_sandbox_core_summary.png`.
4. Put it in the repo's `bob_sessions/` folder. SPEC section 7 asks modales
   where that folder should live.

## Notes for the IBM Bob usage statement

modales needs these for the pitch. Write one or two lines per task as you go.

| Task | What I asked Bob | What Bob produced | What I had to fix |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
