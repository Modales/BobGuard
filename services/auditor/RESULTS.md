# Taint-Scan Evaluation Results

Corpus: `services/auditor/eval_corpus/` — 20 labeled Python files (10 vulnerable, 10 safe).

## Confusion Matrix

| | Predicted Vulnerable | Predicted Safe |
|---|---|---|
| **Actually Vulnerable** | TP = 10 | FN = 0 |
| **Actually Safe**       | FP = 1 | TN = 9 |

## Metrics

| Metric    | Value |
|-----------|-------|
| Precision | 0.909 |
| Recall    | 1.000 |
| F1 Score  | 0.952 |

## Findings by CWE Category

| CWE ID | Short Name | Findings |
|--------|------------|----------|
| CWE-78 | OS Command Injection | 4 |
| CWE-89 | SQL Injection | 5 |
| CWE-95 | Improper Neutralization of Directives in Dynamically Evaluated Code (Eval Injection) | 2 |

## Misclassified Files

- `safe_07_whitelist_validated.py` — **false positive** (predicted vulnerable, actually safe)
