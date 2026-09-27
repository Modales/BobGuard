/**
 * SSE client for GET /api/v1/stream-logs.
 *
 * Backend contract (main.py):
 *   Query params: repo_path, target_version
 *   Each SSE frame: data: {"timestamp","topic","level","message","payload"}\n\n
 *
 *   Topics (in order):
 *     client.connected → audit.started → audit.finished → cve.retrieved
 *     → refactor.proposed → consensus.reached → healing.finished
 *     → tests.passed / tests.failed → pipeline.complete → stream.closed
 *
 * This endpoint is NOT JWT-protected (by backend design).
 * It runs its own pipeline instance internally.
 */

import { TOPIC_TO_STAGE } from '../state/dataHelpers';

/**
 * Open an SSE connection to the backend's stream-logs endpoint.
 *
 * @param {string} repoPath
 * @param {string} targetVersion
 * @param {object} callbacks
 * @param {function} callbacks.onEvent  - ({topic, stage, message, payload, timestamp}) => void
 * @param {function} callbacks.onError  - (Error) => void
 * @param {function} callbacks.onComplete - () => void
 * @returns {function} cleanup — call to close the EventSource
 */
export function connectSSE(repoPath, targetVersion, { onEvent, onError, onComplete }) {
  const params = new URLSearchParams({
    repo_path: repoPath,
    target_version: targetVersion,
  });

  const url = `/api/v1/stream-logs?${params}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      const { topic, message, payload, timestamp, level } = frame;

      // Map backend topic to frontend workflow stage
      const stage = TOPIC_TO_STAGE[topic] || null;

      onEvent({ topic, stage, message, payload: payload || {}, timestamp, level });

      // Terminal events
      if (topic === 'pipeline.complete' || topic === 'stream.closed') {
        eventSource.close();
        onComplete();
      }
    } catch (err) {
      // Malformed frame — log but don't crash the connection
      console.warn('[SSE] Failed to parse event frame:', event.data, err);
    }
  };

  eventSource.onerror = (_err) => {
    // EventSource fires onerror on connection loss AND on stream end.
    // readyState 2 = CLOSED (normal end-of-stream or server closed).
    if (eventSource.readyState === EventSource.CLOSED) {
      onComplete();
    } else {
      onError(new Error('SSE connection lost'));
      eventSource.close();
    }
  };

  // Return cleanup function for React useEffect / unmount
  return () => {
    if (eventSource.readyState !== EventSource.CLOSED) {
      eventSource.close();
    }
  };
}
