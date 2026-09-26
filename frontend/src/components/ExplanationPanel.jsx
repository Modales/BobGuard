import { useReview } from '../state/ReviewContext';
import './ExplanationPanel.css';

const AGENT_DISPLAY = {
  security_expert: { name: 'Security Expert', icon: '🛡️', colorClass: 'agent-security' },
  performance_guru: { name: 'Performance Guru', icon: '⚡', colorClass: 'agent-performance' },
  legacy_maintainer: { name: 'Legacy Maintainer', icon: '📚', colorClass: 'agent-legacy' },
};

export default function ExplanationPanel() {
  const { state, dispatch } = useReview();
  const { selectedDiffLine, currentExplanation, selectedVulnerabilityId, mockData } = state;

  if (!selectedDiffLine || !currentExplanation) {
    return (
      <div className="explanation-panel empty" id="explanation-panel">
        <div className="explanation-header">
          <div className="explanation-title-area">
            <h3 className="explanation-title">AI Explanation & Agent Reasoning</h3>
            <span className="explanation-status-pill">Awaiting Selection</span>
          </div>
        </div>

        <div className="empty-state-card">
          <div className="empty-state-icon-box" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <div className="empty-state-text">
            <h4 className="empty-title">Select a changed line in the diff above</h4>
            <p className="empty-desc">
              Click any line marked with <span className="marker-badge marker-add">+</span> or <span className="marker-badge marker-rem">−</span> in the diff viewer to inspect the AI refactoring rationale, multi-agent critique scores, and suggestions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Get consensus for current vulnerability
  const vulnConsensus = mockData.consensus.find((c) => c.vulnerabilityId === selectedVulnerabilityId);
  const consensusScore = currentExplanation.consensus_score !== undefined
    ? currentExplanation.consensus_score
    : (vulnConsensus?.consensus_score || 0);
  const isApproved = currentExplanation.consensus_verdict
    ? currentExplanation.consensus_verdict === 'approve'
    : (vulnConsensus?.approved || false);

  // Agent critiques for this line or fallback from vulnerability
  const agentCritiques = currentExplanation.agent_critiques || {};

  return (
    <div className="explanation-panel has-content" id="explanation-panel" style={{ animation: 'slide-up 0.3s ease forwards' }}>
      <div className="explanation-header">
        <div className="explanation-title-area">
          <h3 className="explanation-title">AI Explanation & Agent Reasoning</h3>
          <span className="explanation-line mono">Line {selectedDiffLine}</span>
          <span className={`consensus-pill ${isApproved ? 'pill-approved' : 'pill-rejected'}`}>
            Consensus: {(consensusScore * 100).toFixed(1)}% {isApproved ? '✓ APPROVED' : '✗ REJECTED'}
          </span>
        </div>
        <button
          className="close-btn"
          onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}
          aria-label="Close explanation"
        >
          ✕
        </button>
      </div>

      <div className="explanation-change">
        <span className="change-label">Change</span>
        <code className="change-content mono">{currentExplanation.content}</code>
      </div>

      <div className="explanation-body">
        <p className="explanation-text">{currentExplanation.explanation}</p>
      </div>

      <div className="explanation-meta">
        <div className="meta-item">
          <span className="meta-label">Category</span>
          <span className={`meta-badge category-${currentExplanation.category}`}>
            {currentExplanation.category}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Severity</span>
          <span className={`meta-badge severity-${currentExplanation.severity}`}>
            {currentExplanation.severity}
          </span>
        </div>
      </div>

      {/* Multi-Agent Reasoning & Confidence Scores */}
      <div className="explanation-reasoning-section">
        <h4 className="reasoning-heading">Multi-Agent Critique & Recommendations</h4>
        <div className="agent-reasoning-grid">
          {Object.entries(AGENT_DISPLAY).map(([agentId, display]) => {
            const critique = agentCritiques[agentId] || (
              mockData.agents.find(a => a.id === agentId)?.critiques.find(c => c.vulnerabilityId === selectedVulnerabilityId)
            );
            if (!critique) return null;

            const score = critique.score;
            const verdict = critique.verdict;
            const reasoning = critique.reasoning || (critique.concerns && critique.concerns[0]) || 'No objections raised.';
            const suggestions = critique.suggestions || [];

            return (
              <div key={agentId} className={`agent-reasoning-card ${display.colorClass}`}>
                <div className="agent-reasoning-header">
                  <div className="agent-reasoning-title">
                    <span className="agent-reasoning-icon">{display.icon}</span>
                    <span className="agent-reasoning-name">{display.name}</span>
                  </div>
                  <div className="agent-reasoning-badges">
                    <span className={`verdict-tag verdict-${verdict}`}>
                      {verdict.toUpperCase()}
                    </span>
                    <span className="confidence-tag mono">
                      {(score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="agent-reasoning-score-bar">
                  <div
                    className="agent-reasoning-score-fill"
                    style={{ width: `${score * 100}%` }}
                  />
                </div>

                <p className="agent-reasoning-text">{reasoning}</p>

                {suggestions.length > 0 && (
                  <div className="agent-suggestions-list">
                    {suggestions.map((sug, idx) => (
                      <div key={idx} className="agent-suggestion-item">
                        <span className="sug-icon">💡</span>
                        <span className="sug-text">{sug}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
