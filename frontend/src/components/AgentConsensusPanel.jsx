import { useReview } from '../state/ReviewContext';
import AgentCard from './AgentCard';
import './AgentConsensusPanel.css';

export default function AgentConsensusPanel() {
  const { state, currentStage, getActiveData } = useReview();
  const data = getActiveData();
  const agents = data.agents || [];
  const consensus = data.consensus || [];

  const consensusData = consensus.find(
    (c) => c.vulnerabilityId === state.selectedVulnerabilityId
  );

  const showConsensus = ['consensus', 'healing', 'completed'].includes(currentStage);

  return (
    <div className="agent-consensus-panel">
      {/* Consensus result — prioritized at top when active */}
      {showConsensus && consensusData && (
        <div
          className={`consensus-result panel-card ${consensusData.approved ? 'approved' : 'rejected'}`}
          style={{ animation: 'slide-up 0.4s ease forwards' }}
          id="consensus-result"
        >
          <div className="consensus-header">
            <div className="consensus-title-wrap">
              <span className="consensus-badge-pill">Consensus Outcome</span>
              <h3 className="consensus-title">
                {consensusData.approved ? 'Consensus Approved' : 'Consensus Rejected'}
              </h3>
            </div>
            <div className="consensus-badge-area">
              <span className={`consensus-badge ${consensusData.approved ? 'badge-approved' : 'badge-rejected'}`}>
                {consensusData.approved ? 'APPROVED' : 'REJECTED'}
              </span>
              {consensusData.security_vetoed && (
                <span className="veto-badge">SECURITY VETO</span>
              )}
            </div>
          </div>

          <div className="consensus-scores">
            <div className="score-item">
              <span className="score-label">Consensus Score</span>
              <div className="score-bar-track">
                <div
                  className={`score-bar-fill ${consensusData.consensus_score >= 0.7 ? 'fill-good' : 'fill-bad'}`}
                  style={{ width: `${consensusData.consensus_score * 100}%` }}
                />
              </div>
              <span className="score-number mono">
                {(consensusData.consensus_score * 100).toFixed(1)}%
              </span>
            </div>
            <div className="score-item">
              <span className="score-label">Security Score</span>
              <div className="score-bar-track">
                <div
                  className={`score-bar-fill ${consensusData.security_score >= 0.6 ? 'fill-good' : 'fill-bad'}`}
                  style={{ width: `${consensusData.security_score * 100}%` }}
                />
              </div>
              <span className="score-number mono">
                {(consensusData.security_score * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="consensus-thresholds">
            <span className="threshold-item">
              Min Approval: <strong className="mono">{(consensusData.approval_threshold * 100).toFixed(0)}%</strong>
            </span>
            <span className="threshold-item">
              Veto Threshold: <strong className="mono">{(consensusData.security_veto_threshold * 100).toFixed(0)}%</strong>
            </span>
          </div>

          {/* Agent contribution visualization */}
          <div className="agent-contributions">
            <h4 className="contributions-title">Agent Weighted Impact</h4>
            <div className="contribution-bars">
              {agents.map((agent) => {
                const critique = agent.critiques.find(
                  (c) => c.vulnerabilityId === state.selectedVulnerabilityId
                );
                if (!critique) return null;
                const weightedContrib = critique.score * agent.weight;
                return (
                  <div key={agent.id} className="contribution-row">
                    <span className="contrib-name">{agent.name}</span>
                    <div className="contrib-bar-track">
                      <div
                        className="contrib-bar-fill"
                        style={{
                          width: `${critique.score * 100}%`,
                          opacity: 0.35 + agent.weight,
                        }}
                      />
                      <div
                        className="contrib-weighted"
                        style={{ width: `${weightedContrib * 100}%` }}
                      />
                    </div>
                    <span className="contrib-detail mono">
                      {(critique.score * 100).toFixed(0)}% × {(agent.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Review Agent Personas */}
      <div className="agent-reviewers-section">
        <div className="section-header-row">
          <h3 className="section-title">Review Agent Personas</h3>
          <span className="section-meta">3 Agents Assigned</span>
        </div>
        <div className="agents-stack">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
