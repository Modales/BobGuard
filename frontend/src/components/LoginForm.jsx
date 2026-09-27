import { useState } from 'react';
import { useReview } from '../state/ReviewContext';
import './LoginForm.css';

export default function LoginForm() {
  const { login, dispatch, state } = useReview();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(username, password);
    } catch {
      // Error is already dispatched to state.authError
    }
  };

  const enterDemoMode = () => {
    dispatch({ type: 'SET_API_MODE', mode: 'demo' });
  };

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="5" fill="var(--accent-primary)" />
              <path d="M7 10h14M7 14h14M7 18h10" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="login-title">IBM Bob 2.0</h1>
          <p className="login-subtitle">Multi-Agent Code Review Platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="login-username" className="field-label">Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
              disabled={state.authLoading}
            />
          </div>

          <div className="form-field">
            <label htmlFor="login-password" className="field-label">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={state.authLoading}
            />
          </div>

          {state.authError && (
            <div className="login-error" role="alert">
              {state.authError}
            </div>
          )}

          <button
            type="submit"
            className="btn-login"
            disabled={state.authLoading || !username || !password}
          >
            {state.authLoading ? 'Authenticating…' : 'Sign In'}
          </button>
        </form>

        <div className="login-divider">
          <span>or</span>
        </div>

        <button className="btn-demo" onClick={enterDemoMode}>
          Continue in Demo Mode
        </button>

        {!state.backendAvailable && (
          <p className="login-hint">
            Backend not detected — demo mode uses local sample data.
          </p>
        )}
      </div>
    </div>
  );
}
