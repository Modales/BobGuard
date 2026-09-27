import { useState } from 'react';
import { useReview } from '../state/ReviewContext';
import './ROICard.css';

export default function ROICard() {
  const { state, currentStage, getActiveData } = useReview();
  const [showAssumptions, setShowAssumptions] = useState(false);
  const data = getActiveData ? getActiveData() : state.mockData;
  const roi = state.roiSummary || data?.roi_summary;

  if (!roi) return null;

  const isRunning = currentStage !== 'idle' && currentStage !== 'completed';
  const isLive = state.apiMode === 'live';

  if (isRunning) {
    return (
      <div className="roi-card panel-card" id="roi-card">
        <div className="roi-header">
          <div className="roi-title-group">
            <span className="roi-label">Business Value</span>
            <h3 className="roi-heading">ROI Summary</h3>
          </div>
          <span className="roi-source-badge" style={{ background: 'rgba(235, 160, 40, 0.15)', color: '#d29922' }}>
            Calculating…
          </span>
        </div>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', margin: 'var(--space-xs) 0' }}>
          Estimating developer hours saved and carbon reduction across stages…
        </p>
      </div>
    );
  }

  return (
    <div className="roi-card panel-card" id="roi-card" style={{ animation: 'slide-up 0.4s ease forwards' }}>
      <div className="roi-header">
        <div className="roi-title-group">
          <span className="roi-label">Business Value</span>
          <h3 className="roi-heading">ROI Summary</h3>
        </div>
        <span className={`roi-source-badge ${isLive ? 'badge-live' : 'badge-demo'}`}>
          {isLive ? 'LIVE' : 'DEMO'}
        </span>
      </div>

      <div className="roi-metrics">
        <div className="roi-metric">
          <span className="roi-metric-value mono">
            {roi.total_hours_saved.toFixed(1)}
            <span className="roi-metric-unit">h</span>
          </span>
          <span className="roi-metric-label">Hours Saved</span>
        </div>

        <div className="roi-divider" />

        <div className="roi-metric">
          <span className="roi-metric-value mono">
            ${roi.total_cost_saved_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          <span className="roi-metric-label">Cost Saved</span>
        </div>

        <div className="roi-divider" />

        <div className="roi-metric">
          <span className="roi-metric-value mono">
            {roi.total_carbon_kg_co2e_per_year > 0
              ? `${roi.total_carbon_kg_co2e_per_year.toFixed(2)}`
              : '—'}
            {roi.total_carbon_kg_co2e_per_year > 0 && (
              <span className="roi-metric-unit">kg CO₂e/yr</span>
            )}
          </span>
          <span className="roi-metric-label">Carbon Reduced</span>
        </div>
      </div>

      {roi.breakdown && roi.breakdown.length > 0 && (
        <div className="roi-breakdown">
          <h4 className="roi-breakdown-title">Per-File Breakdown</h4>
          <div className="roi-breakdown-rows">
            {roi.breakdown.map((item, i) => (
              <div key={i} className="roi-breakdown-row">
                <div className="roi-breakdown-meta">
                  <span className="roi-file mono">{item.file_hint}</span>
                  {item.severity && (
                    <span className={`roi-severity sev-${item.severity}`}>{item.severity}</span>
                  )}
                </div>
                <div className="roi-breakdown-numbers">
                  <span className="roi-breakdown-stat mono">{item.hours_saved.toFixed(1)}h</span>
                  <span className="roi-breakdown-sep">·</span>
                  <span className="roi-breakdown-stat mono">
                    ${item.cost_saved_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  {item.lines_changed > 0 && (
                    <>
                      <span className="roi-breakdown-sep">·</span>
                      <span className="roi-breakdown-stat mono">{item.lines_changed} lines</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        className="roi-assumptions-toggle"
        onClick={() => setShowAssumptions(!showAssumptions)}
        aria-expanded={showAssumptions}
      >
        {showAssumptions ? '▾' : '▸'} Rate assumptions
      </button>

      {showAssumptions && (
        <div className="roi-assumptions">
          <div className="roi-assumption-row">
            <span>Hourly rate</span>
            <span>${roi.hourly_rate_usd}/hr</span>
          </div>
          {roi.assumptions?.review_overhead_factor != null && (
            <div className="roi-assumption-row">
              <span>Review overhead</span>
              <span>+{(roi.assumptions.review_overhead_factor * 100).toFixed(0)}%</span>
            </div>
          )}
          {roi.assumptions?.hours_per_diff_line != null && (
            <div className="roi-assumption-row">
              <span>Effort per diff line</span>
              <span>{roi.assumptions.hours_per_diff_line}h</span>
            </div>
          )}
        </div>
      )}

      <div className="roi-footer">
        <span className="roi-rate mono">${roi.hourly_rate_usd}/hr blended rate</span>
        <span className="roi-analyzed">
          {roi.refactors_analyzed} refactor{roi.refactors_analyzed !== 1 ? 's' : ''} analyzed
        </span>
      </div>
    </div>
  );
}
