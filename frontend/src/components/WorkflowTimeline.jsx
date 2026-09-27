import { useReview } from '../state/ReviewContext';
import { WORKFLOW_STAGES } from '../state/dataHelpers';
import './WorkflowTimeline.css';

const STAGE_LABELS = {
  idle: 'Ready',
  scanning: 'Scanning',
  cve_lookup: 'CVE Lookup',
  refactoring: 'Refactoring',
  reviewing: 'Reviewing',
  debating: 'Debating',
  consensus: 'Consensus',
  healing: 'Testing',
  completed: 'Complete',
};

const STAGE_ICONS = {
  idle: '○',
  scanning: '🔍',
  cve_lookup: '🛡',
  refactoring: '⚙',
  reviewing: '👁',
  debating: '💬',
  consensus: '⚖',
  healing: '🧪',
  completed: '✓',
};

export default function WorkflowTimeline() {
  const { state } = useReview();
  const currentIndex = state.workflowStageIndex;

  return (
    <div className="workflow-timeline" role="progressbar" aria-valuenow={currentIndex} aria-valuemax={WORKFLOW_STAGES.length - 1}>
      <div className="timeline-track">
        <div
          className="timeline-fill"
          style={{ width: `${(currentIndex / (WORKFLOW_STAGES.length - 1)) * 100}%` }}
        />
      </div>
      <div className="timeline-stages">
        {WORKFLOW_STAGES.map((stage, index) => {
          const isPast = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <div
              key={stage}
              className={`timeline-stage ${isPast ? 'past' : ''} ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''}`}
            >
              <div className="stage-dot">
                <span className="stage-icon">{isPast ? '✓' : STAGE_ICONS[stage]}</span>
                {isCurrent && <div className="stage-pulse" />}
              </div>
              <span className="stage-label">{STAGE_LABELS[stage]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
