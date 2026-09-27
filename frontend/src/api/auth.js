/**
 * Authentication API layer for the IBM Bob 2.0 Orchestrator.
 *
 * Backend contract (enterprise_auth.py):
 *   POST /token  (OAuth2 password grant, form-encoded)
 *   Response: { access_token, token_type: "bearer", expires_in }
 *   JWT claims: sub (username), role, iat, exp
 *
 * Token storage: sessionStorage (cleared on tab close).
 * Not production-grade (XSS-accessible), but acceptable for a hackathon demo.
 */

const TOKEN_KEY = 'ibm_bob_token';
const TOKEN_EXPIRY_KEY = 'ibm_bob_token_expiry';

/**
 * Authenticate against POST /token with OAuth2 password grant.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{access_token: string, expires_in: number}>}
 * @throws {Error} with descriptive message on failure
 */
export async function login(username, password) {
  const body = new URLSearchParams({ username, password, grant_type: 'password' });

  let res;
  try {
    res = await fetch('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new Error('Backend server is offline (port 8000). Please click "Continue in Demo Mode" or start the backend service.');
  }

  if (res.status === 401) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || 'Invalid username or password');
  }
  if (!res.ok) {
    throw new Error(`Authentication failed (HTTP ${res.status}): ensure backend is running`);
  }

  const data = await res.json();
  setToken(data.access_token, data.expires_in);
  return data;
}

/**
 * Store the JWT and its computed expiry timestamp.
 */
export function setToken(token, expiresIn) {
  const expiryMs = Date.now() + expiresIn * 1000;
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(expiryMs));
}

/**
 * Retrieve the stored JWT, or null if absent/expired.
 */
export function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (!isTokenValid()) {
    clearToken();
    return null;
  }
  return token;
}

/**
 * Check whether the stored token is still within its expiry window.
 */
export function isTokenValid() {
  const expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiry) return false;
  // 30-second buffer to avoid edge-case expiry during a request
  return Date.now() < Number(expiry) - 30_000;
}

/**
 * Remove the stored token and expiry.
 */
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
}

/**
 * Check if the backend health endpoint is reachable.
 * Used to decide whether to offer live mode or stay in demo mode.
 * @returns {Promise<boolean>}
 */
export async function checkBackendHealth() {
  try {
    const res = await fetch('/health', { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
