/**
 * Modernization API client for POST /api/v1/modernize.
 *
 * Backend contract (main.py → ModernizationResponse):
 *   Request:  { repo_path: string, target_version: string }
 *   Response: { repo_path, target_version, auditor_source, sandbox_source,
 *               vulnerabilities[], cve_hits[], refactors[], sandbox_report,
 *               roi_summary, pipeline_success, execution_logs[], event_timeline[],
 *               duration_ms }
 *
 * Requires Bearer JWT with role=modernizer.
 */

/**
 * Run the full modernization pipeline.
 *
 * @param {string} repoPath  — repository path to modernize
 * @param {string} targetVersion — e.g. "python3.12"
 * @param {string} token — JWT access token
 * @returns {Promise<object>} — ModernizationResponse
 * @throws {Error} with status-specific messages
 */
export async function runModernize(repoPath, targetVersion, token) {
  const res = await fetch('/api/v1/modernize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      repo_path: repoPath,
      target_version: targetVersion,
    }),
  });

  if (res.status === 401) {
    throw new ModernizeError('Authentication expired — please log in again.', 401);
  }
  if (res.status === 403) {
    const detail = await res.json().catch(() => ({}));
    throw new ModernizeError(
      detail.detail || 'Insufficient permissions to run the modernization pipeline.',
      403
    );
  }
  if (res.status === 422) {
    const detail = await res.json().catch(() => ({}));
    throw new ModernizeError(
      `Validation error: ${JSON.stringify(detail.detail || detail)}`,
      422
    );
  }
  if (!res.ok) {
    throw new ModernizeError(`Server error (HTTP ${res.status})`, res.status);
  }

  return res.json();
}

/**
 * Typed error for modernization API failures.
 */
export class ModernizeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ModernizeError';
    this.status = status;
  }
}
