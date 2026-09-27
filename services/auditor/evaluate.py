"""evaluate.py — evaluate taint_scan.py against the labeled eval corpus.

Runs scan_file() from taint_scan.py against every .py file in eval_corpus/,
compares predictions to labels.json, and writes RESULTS.md.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure taint_scan can be imported from the same directory.
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from taint_scan import scan_file  # noqa: E402

CORPUS_DIR = HERE / "eval_corpus"
LABELS_FILE = CORPUS_DIR / "labels.json"
RESULTS_FILE = HERE / "RESULTS.md"


def run_evaluation() -> None:
    labels: dict[str, str] = json.loads(LABELS_FILE.read_text(encoding="utf-8"))

    tp: list[str] = []
    fp: list[str] = []
    tn: list[str] = []
    fn: list[str] = []

    for filename, true_label in sorted(labels.items()):
        filepath = CORPUS_DIR / filename
        findings = scan_file(filepath)
        predicted = "vulnerable" if findings else "safe"

        if true_label == "vulnerable" and predicted == "vulnerable":
            tp.append(filename)
        elif true_label == "safe" and predicted == "vulnerable":
            fp.append(filename)
        elif true_label == "safe" and predicted == "safe":
            tn.append(filename)
        else:  # true_label == "vulnerable" and predicted == "safe"
            fn.append(filename)

    n_tp, n_fp, n_tn, n_fn = len(tp), len(fp), len(tn), len(fn)

    precision = n_tp / (n_tp + n_fp) if (n_tp + n_fp) > 0 else 0.0
    recall    = n_tp / (n_tp + n_fn) if (n_tp + n_fn) > 0 else 0.0
    f1        = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )

    misclassified = fp + fn

    # ------------------------------------------------------------------
    # Build RESULTS.md
    # ------------------------------------------------------------------
    lines: list[str] = [
        "# Taint-Scan Evaluation Results",
        "",
        "Corpus: `services/auditor/eval_corpus/` — 20 labeled Python files "
        f"({sum(1 for v in labels.values() if v == 'vulnerable')} vulnerable, "
        f"{sum(1 for v in labels.values() if v == 'safe')} safe).",
        "",
        "## Confusion Matrix",
        "",
        "| | Predicted Vulnerable | Predicted Safe |",
        "|---|---|---|",
        f"| **Actually Vulnerable** | TP = {n_tp} | FN = {n_fn} |",
        f"| **Actually Safe**       | FP = {n_fp} | TN = {n_tn} |",
        "",
        "## Metrics",
        "",
        "| Metric    | Value |",
        "|-----------|-------|",
        f"| Precision | {precision:.3f} |",
        f"| Recall    | {recall:.3f} |",
        f"| F1 Score  | {f1:.3f} |",
        "",
    ]

    if misclassified:
        lines += [
            "## Misclassified Files",
            "",
        ]
        for fname in sorted(fp):
            lines.append(f"- `{fname}` — **false positive** (predicted vulnerable, actually safe)")
        for fname in sorted(fn):
            lines.append(f"- `{fname}` — **false negative** (predicted safe, actually vulnerable)")
        lines.append("")
    else:
        lines += [
            "## Misclassified Files",
            "",
            "_None — all 20 files classified correctly._",
            "",
        ]

    RESULTS_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(RESULTS_FILE.read_text(encoding="utf-8"))
    print(f"\n[evaluate.py] Results written to {RESULTS_FILE}")


if __name__ == "__main__":
    run_evaluation()
