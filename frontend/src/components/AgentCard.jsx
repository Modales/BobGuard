import { useReview } from '../state/ReviewContext';
import './AgentCard.css';

const AGENT_CONFIG = {
  security_expert: {
    icon: '🛡️',
    colorVar: '--color-security',
    bgVar: '--color-security-bg',
    glowVar: '--color-security-glow',
    focusLabel: 'Security Analysis',
  },
  performance_guru: {
    icon: '⚡',
    colorVar: '--color-performance',
    bgVar: '--color-performance-bg',
    glowVar: '--color-performance-glow',
    focusLabel: 'Performance Analysis',
  },
  legacy_maintainer: {
    icon: '📚',
    colorVar: '--color-legacy',
    bgVar: '--color-legacy-bg',
    glowVar: '--color-legacy-glow',
    focusLabel: 'Compatibility Analysis',
  },
};

const STATE_DISPLAY = {
  waiting: { label: 'Waiting', statusClass: 'status-waiting' },
  analyzing: { label: 'Analyzing Code...', statusClass: 'status-analyzing' },
  found_issue: { label: 'Issue Found', statusClass: 'status-found-issue' },
  no_issue: { label: 'No Issues', statusClass: 'status-no-issue' },
  reviewing_change: { label: 'Reviewing Patch...', statusClass: 'status-reviewing' },
  agreeing: { label: 'Approved ✓', statusClass: 'status-agreeing' },
  disagreeing: { label: 'Rejected ✗', statusClass: 'status-disagreeing' },
  complete: { label: 'Complete', statusClass: 'status-complete' },
};

export default function AgentCard({ agent }) {
  const { state, currentStage } = useReview();
  const agentState = state.agentStates[agent.id];
  const config = AGENT_CONFIG[agent.id];
  const display = STATE_DISPLAY[agentState] || STATE_DISPLAY.waiting;

  const critique = agent.critiques.find(
    (c) => c.vulnerabilityId === state.selectedVulnerabilityId
  );

  const isActive = !['waiting', 'complete'].includes(agentState) &&
    !['agreeing', 'disagreeing'].includes(agentState);
  const showScore = critique && ['consensus', 'healing', 'completed'].includes(currentStage);
  const showConcerns = critique && ['consensus', 'healing', 'completed'].includes(currentStage);

  return (
    <div
      className={`agent-card ${display.statusClass} ${isActive ? 'active' : ''}`}
      style={{
        '--agent-color': `var(${config.colorVar})`,
        '--agent-bg': `var(${config.bgVar})`,
        '--agent-glow': `var(${config.glowVar})`,
      }}
      id={`agent-card-${agent.id}`}
    >
      {/* Active glow ring */}
      {isActive && <div className="agent-glow-ring" />}

      <div className="agent-header">
        <div className="agent-avatar">
          <span className="agent-icon">{config.icon}</span>
        </div>
        <div className="agent-identity">
          <h3 className="agent-name">{agent.name}</h3>
          <span className="agent-focus">{config.focusLabel}</span>
        </div>
        <div className="agent-weight">
          <span className="weight-label">Weight</span>
          <span className="weight-value">{(agent.weight * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="agent-status">
        <div className={`status-indicator ${display.statusClass}`}>
          {agentState === 'analyzing' || agentState === 'reviewing_change' ? (
            <div className="spinner" />
          ) : null}
          <span className="status-text">{display.label}</span>
        </div>
      </div>

      {showScore && critique && (
        <div className="agent-results" style={{ animation: 'slide-up 0.4s ease forwards' }}>
          <div className="result-score">
            <div className="score-bar-track">
              <div
                className="score-bar-fill"
                style={{ width: `${critique.score * 100}%` }}
              />
            </div>
            <span className="score-value">{(critique.score * 100).toFixed(0)}%</span>
          </div>

          <div className="result-verdict">
            <span className={`verdict-badge verdict-${critique.verdict}`}>
              {critique.verdict.toUpperCase()}
            </span>
          </div>

          {showConcerns && critique.concerns.length > 0 && (
            <div className="result-concerns">
              {critique.concerns.map((concern, i) => (
                <div key={i} className="concern-item">
                  <span className="concern-icon">⚠</span>
                  <span className="concern-text">{concern}</span>
                </div>
              ))}
            </div>
          )}

          {showConcerns && critique.suggestions.length > 0 && (
            <div className="result-suggestions">
              {critique.suggestions.map((suggestion, i) => (
                <div key={i} className="suggestion-item">
                  <span className="suggestion-icon">💡</span>
                  <span className="suggestion-text">{suggestion}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
