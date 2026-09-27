import sys

from rich.console import Console
from rich.syntax import Syntax
from rich.prompt import Confirm
from rich.panel import Panel
from rich.text import Text

console = Console()

BEFORE = """\
import sqlite3

def get_user(username):
    conn = sqlite3.connect("app.db")
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    return cursor.fetchone()
"""

AFTER = """\
import sqlite3

def get_user(username):
    conn = sqlite3.connect("app.db")
    cursor = conn.cursor()
    query = "SELECT * FROM users WHERE username = ?"
    cursor.execute(query, (username,))
    return cursor.fetchone()
"""


def send_rejection_to_orchestrator(diff: dict) -> None:
    console.print(
        "[>>] Rejection sent to orchestrator feedback loop "
        "(mock -- no real network call yet).",
        style="yellow",
    )


def display_diff(before: str, after: str) -> None:
    console.print(
        Panel(
            Text("Security Patch Review", justify="center"),
            style="bold blue",
        )
    )

    console.print("\n[bold red]BEFORE[/bold red] (vulnerable)\n")
    console.print(Syntax(before, "python", theme="monokai", line_numbers=True))

    console.print("\n[bold green]AFTER[/bold green] (fixed - parameterized query)\n")
    console.print(Syntax(after, "python", theme="monokai", line_numbers=True))


def run_approval_flow(before: str, after: str) -> None:
    display_diff(before, after)

    console.print()
    try:
        approved = Confirm.ask("Approve this security patch for deployment? (y/n)")
    except KeyboardInterrupt:
        console.print("\nCancelled.", style="dim")
        sys.exit(0)

    if approved:
        console.print(
            "\n[OK] Patch approved and deployed successfully.",
            style="bold green",
        )
    else:
        send_rejection_to_orchestrator({"before": before, "after": after})


if __name__ == "__main__":
    run_approval_flow(BEFORE, AFTER)
