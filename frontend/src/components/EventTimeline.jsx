import { useReview } from '../state/ReviewContext';
import './EventTimeline.css';

const TOPIC_ICONS = {
  'audit.started': '🔍',
  'audit.finished': '✅',
  'cve.retrieved': '🛡',
  'refactor.proposed': '⚙️',
  'consensus.reached': '⚖️',
  'healing.finished': '🔧',
  'tests.passed': '✅',
  'tests.failed': '❌',
  'pipeline.complete': '🏁',
};

export default function EventTimeline() {
  const { state, getActiveData } = useReview();
  const data = getActiveData();

  // In live mode during SSE streaming, use sseEvents; otherwise use the data's event_timeline
  const event_timeline = (state.apiMode === 'live' && state.sseEvents.length > 0)
    ? state.sseEvents
    : (data.event_timeline || []);
  const revealIndex = state.timelineRevealIndex;
  const hasEvents = revealIndex >= 0;

  return (
    <div className="event-timeline panel-card" id="event-timeline">
      <div className="timeline-panel-header">
        <div className="timeline-title-group">
          <span className="timeline-title-label">Audit Log</span>
          <h3 className="timeline-heading">Pipeline Events</h3>
        </div>
        <span className="event-count mono">
          {Math.min(revealIndex + 1, event_timeline.length)} / {event_timeline.length}
        </span>
      </div>

      <div className="events-list">
        {!hasEvents ? (
          <div className="events-idle-box">
            <span className="events-idle-dot">•</span>
            <span className="events-idle-msg">Pipeline initialized. Events stream in real-time as review progresses.</span>
          </div>
        ) : (
          event_timeline.map((event, index) => {
            const isRevealed = index <= revealIndex;
            const isLatest = index === revealIndex;
            const icon = TOPIC_ICONS[event.topic] || '•';

            return (
              <div
                key={index}
                className={`event-item ${isRevealed ? 'revealed' : 'hidden'} ${isLatest ? 'latest' : ''} level-${event.level}`}
              >
                <div className="event-dot-area">
                  <div className="event-connector" />
                  <span className="event-dot">{icon}</span>
                </div>
                <div className="event-content">
                  <div className="event-content-top">
                    <span className="event-topic mono">{event.topic}</span>
                    {isLatest && <span className="event-latest-tag">LATEST</span>}
                  </div>
                  <span className="event-message">{event.message}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
