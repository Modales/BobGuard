import { useReview } from '../state/ReviewContext';
import './DashboardHeader.css';

const API_MODE_LABELS = {
  idle:       null,
  connecting: { text: 'Connecting…', cls: 'mode-connecting' },
  live:       { text: 'Live API',    cls: 'mode-live' },
  demo:       { text: 'Demo Mode',   cls: 'mode-demo' },
};

export default function DashboardHeader() {
  const { state, startReview, resetReview, currentStage } = useReview();
  const { pipeline } = state.mockData;
  const isIdle = currentStage === 'idle';
  const isCompleted = currentStage === 'completed';
  const modeBadge = API_MODE_LABELS[state.apiMode] ?? null;

  return (
    <header className="dashboard-header">
      <div className="header-left">
        <div className="header-logo">
          <div className="logo-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="5" fill="var(--accent-primary)" />
              <path d="M7 10h14M7 14h14M7 18h10" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-brand">IBM Bob 2.0</span>
            <span className="logo-divider">/</span>
            <span className="logo-subtitle">Multi-Agent Review</span>
          </div>
        </div>
      </div>

      <div className="header-center">
        <div className="pipeline-metadata-group">
          <div className="pipeline-meta-item">
            <span className="meta-k">Repo</span>
            <span className="meta-v mono">{pipeline.repo_path}</span>
          </div>
          <span className="meta-separator">•</span>
          <div className="pipeline-meta-item">
            <span className="meta-k">Target</span>
            <span className="meta-v mono">{pipeline.target_version}</span>
          </div>
          {isCompleted && (
            <>
              <span className="meta-separator">•</span>
              <div className="pipeline-meta-item">
                <span className="meta-k">Duration</span>
                <span className="meta-v mono">{pipeline.duration_ms}ms</span>
              </div>
            </>
          )}
          {modeBadge && (
            <>
              <span className="meta-separator">•</span>
              <span className={`api-mode-badge ${modeBadge.cls}`}>{modeBadge.text}</span>
            </>
          )}
        </div>
      </div>

      <div className="header-right">
        {isIdle ? (
          <button className="btn-primary" onClick={startReview} id="start-review-btn">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
            </svg>
            Start Review
          </button>
        ) : isCompleted ? (
          <button className="btn-secondary" onClick={startReview} id="replay-review-btn">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 1011.5-2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M13 2v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Replay Review
          </button>
        ) : (
          <button className="btn-ghost" onClick={resetReview} id="reset-review-btn">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
            Reset
          </button>
        )}
      </div>
    </header>
  );
}
