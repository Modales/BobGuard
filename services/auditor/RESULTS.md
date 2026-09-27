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

## Misclassified Files

- `safe_07_whitelist_validated.py` — **false positive** (predicted vulnerable, actually safe)
