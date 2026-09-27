import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import mockData from '../data/mockData.json';
import { WORKFLOW_STAGES, TOPIC_TO_STAGE, deriveAgentState, computeDiffLines, getLineExplanation } from './dataHelpers';

// ─── API Configuration ───────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEMO_CREDENTIALS = { username: 'admin', password: 'bob-hackathon-2026' };

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  /** Raw data — replaced with live API response once a run completes */
  mockData,

  /** Current workflow stage index in WORKFLOW_STAGES */
  workflowStageIndex: 0,

  /** Per-agent runtime states, keyed by agent id */
  agentStates: {
    security_expert: 'waiting',
    performance_guru: 'waiting',
    legacy_maintainer: 'waiting',
  },

  /** Which vulnerability is currently selected for diff view */
  selectedVulnerabilityId: mockData.vulnerabilities[0]?.id || null,

  /** Selected diff line number (1-indexed), or null */
  selectedDiffLine: null,

  /** Current explanation object for the selected line */
  currentExplanation: null,

  /** Pre-computed diff lines for each vulnerability */
  diffsByVulnerability: {},

  /** Animation progress 0-100 */
  animationProgress: 0,

  /**
   * Whether the timed demo sequence is playing.
   * When live SSE is active this is false — stage advances come from the bus.
   */
  isPlaying: false,

  /** The index into event_timeline that we've revealed so far */
  timelineRevealIndex: -1,

  /**
   * 'idle' | 'connecting' | 'live' | 'demo'
   *  - idle      : nothing running
   *  - connecting: attempting JWT + SSE handshake
   *  - live      : receiving real SSE events from the orchestrator
   *  - demo      : fallback timer-based replay (API unreachable)
   */
  apiMode: 'idle',

  /** Human-readable status shown in the header */
  apiStatus: null,

  /** ROI summary — populated from live API response or kept from mockData */
  roiSummary: mockData.roi_summary ?? null,
};

// Pre-compute diffs from refactor data
mockData.refactors.forEach((refactor) => {
  initialState.diffsByVulnerability[refactor.vulnerabilityId] = computeDiffLines(
    refactor.original_code,
    refactor.refactored_code
  );
});

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reviewReducer(state, action) {
  switch (action.type) {
    case 'START_REVIEW':
      return {
        ...state,
        workflowStageIndex: 1,
        isPlaying: true,
        animationProgress: 0,
        timelineRevealIndex: -1,
        selectedDiffLine: null,
        currentExplanation: null,
        apiMode: 'demo',
        apiStatus: 'Demo mode — orchestrator unreachable',
        agentStates: {
          security_expert: 'waiting',
          performance_guru: 'waiting',
          legacy_maintainer: 'waiting',
        },
      };

    case 'START_LIVE':
      return {
        ...state,
        workflowStageIndex: 1,
        isPlaying: false,
        animationProgress: 0,
        timelineRevealIndex: -1,
        selectedDiffLine: null,
        currentExplanation: null,
        apiMode: 'live',
        apiStatus: 'Connected — live pipeline',
        agentStates: {
          security_expert: 'waiting',
          performance_guru: 'waiting',
          legacy_maintainer: 'waiting',
        },
      };

    case 'SET_CONNECTING':
      return {
        ...state,
        apiMode: 'connecting',
        apiStatus: 'Connecting to orchestrator…',
      };

    case 'SSE_STAGE': {
      // Advance stage based on a live SSE topic
      const targetStage = action.stage;
      const targetIndex = WORKFLOW_STAGES.indexOf(targetStage);
      if (targetIndex <= state.workflowStageIndex) return state;

      const newAgentStates = {};
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === state.selectedVulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, targetStage);
      }
      return {
        ...state,
        workflowStageIndex: targetIndex,
        agentStates: newAgentStates,
      };
    }

    case 'SSE_EVENT': {
      // Append one event entry to the live timeline
      const nextIndex = state.timelineRevealIndex + 1;
      const updatedTimeline = [...state.mockData.event_timeline];
      if (nextIndex >= updatedTimeline.length) {
        updatedTimeline.push(action.event);
      } else {
        updatedTimeline[nextIndex] = action.event;
      }
      return {
        ...state,
        timelineRevealIndex: nextIndex,
        mockData: {
          ...state.mockData,
          event_timeline: updatedTimeline,
        },
      };
    }

    case 'SSE_COMPLETE': {
      // Pipeline finished — merge live ROI + mark completed
      const completedIndex = WORKFLOW_STAGES.indexOf('completed');
      const newAgentStates = {};
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === state.selectedVulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, 'completed');
      }
      return {
        ...state,
        workflowStageIndex: completedIndex,
        isPlaying: false,
        animationProgress: 100,
        apiMode: 'live',
        apiStatus: 'Pipeline complete',
        agentStates: newAgentStates,
        roiSummary: action.roiSummary ?? state.roiSummary,
      };
    }

    case 'ADVANCE_STAGE': {
      const nextIndex = Math.min(state.workflowStageIndex + 1, WORKFLOW_STAGES.length - 1);
      const nextStage = WORKFLOW_STAGES[nextIndex];
      const newAgentStates = {};
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === state.selectedVulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, nextStage);
      }
      return {
        ...state,
        workflowStageIndex: nextIndex,
        agentStates: newAgentStates,
        isPlaying: nextIndex < WORKFLOW_STAGES.length - 1,
      };
    }

    case 'SET_AGENT_STATE':
      return {
        ...state,
        agentStates: {
          ...state.agentStates,
          [action.agentId]: action.agentState,
        },
      };

    case 'SELECT_VULNERABILITY': {
      const newAgentStates = {};
      const stage = WORKFLOW_STAGES[state.workflowStageIndex];
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === action.vulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, stage);
      }
      return {
        ...state,
        selectedVulnerabilityId: action.vulnerabilityId,
        selectedDiffLine: null,
        currentExplanation: null,
        agentStates: newAgentStates,
      };
    }

    case 'SELECT_DIFF_LINE': {
      const diffLines = state.diffsByVulnerability[state.selectedVulnerabilityId] || [];
      const diffLine = diffLines.find((l) => l.lineNumber === action.lineNumber);
      const explanation = getLineExplanation(
        state.mockData.lineExplanations,
        state.selectedVulnerabilityId,
        action.lineNumber,
        diffLine
      );
      return {
        ...state,
        selectedDiffLine: action.lineNumber,
        currentExplanation: explanation,
      };
    }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedDiffLine: null,
        currentExplanation: null,
      };

    case 'TICK_PROGRESS': {
      const newProgress = Math.min(state.animationProgress + action.delta, 100);
      return { ...state, animationProgress: newProgress };
    }

    case 'REVEAL_TIMELINE_EVENT':
      return { ...state, timelineRevealIndex: action.index };

    case 'RESET':
      return {
        ...initialState,
        diffsByVulnerability: state.diffsByVulnerability,
        apiMode: 'idle',
        apiStatus: null,
      };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ReviewContext = createContext(null);

export function ReviewProvider({ children }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);
  const timerRef = useRef(null);
  const sseRef = useRef(null);
  // Cached JWT token — refreshed per run (1-hour TTL is fine for a demo session)
  const tokenRef = useRef(null);

  // ── JWT login ────────────────────────────────────────────────────────────
  async function acquireToken() {
    if (tokenRef.current) return tokenRef.current;
    const body = new URLSearchParams({
      username: DEMO_CREDENTIALS.username,
      password: DEMO_CREDENTIALS.password,
    });
    const res = await fetch(`${API_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`/token ${res.status}`);
    const data = await res.json();
    tokenRef.current = data.access_token;
    return tokenRef.current;
  }

  // ── SSE pipeline connection ──────────────────────────────────────────────
  function openSSE(token) {
    const url = `${API_BASE}/api/v1/stream-logs?repo_path=${encodeURIComponent(
      state.mockData.pipeline.repo_path
    )}&target_version=${encodeURIComponent(state.mockData.pipeline.target_version)}&token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      let frame;
      try { frame = JSON.parse(e.data); } catch { return; }

      // Map SSE topic → workflow stage
      const stage = TOPIC_TO_STAGE[frame.topic];
      if (stage) {
        dispatch({ type: 'SSE_STAGE', stage });
      }

      // Append event entry to the live timeline
      dispatch({
        type: 'SSE_EVENT',
        event: {
          topic: frame.topic ?? 'info',
          message: frame.message ?? '',
          level: frame.level ?? 'info',
        },
      });

      // Pipeline finished
      if (frame.topic === 'pipeline.complete') {
        dispatch({ type: 'SSE_COMPLETE', roiSummary: frame.payload?.roi_summary ?? null });
        es.close();
        sseRef.current = null;
      }
    };

    es.onerror = () => {
      // SSE connection dropped mid-run — keep whatever stage we're at,
      // fall back to timer to finish the sequence
      es.close();
      sseRef.current = null;
      dispatch({ type: 'START_REVIEW' }); // switches to demo/timer mode
    };
  }

  // ── startReview: try live, fall back to demo ─────────────────────────────
  const startReview = useCallback(async () => {
    // Close any open SSE from a previous run
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dispatch({ type: 'RESET' });

    // Small delay to let reset render
    await new Promise((r) => setTimeout(r, 100));

    dispatch({ type: 'SET_CONNECTING' });

    try {
      const token = await acquireToken();
      dispatch({ type: 'START_LIVE' });
      openSSE(token);
    } catch {
      // Orchestrator unreachable — run the deterministic demo instead
      tokenRef.current = null; // clear stale token
      dispatch({ type: 'START_REVIEW' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetReview = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    tokenRef.current = null;
    dispatch({ type: 'RESET' });
  }, []);

  // ── Demo timer: only runs in 'demo' / isPlaying mode ────────────────────
  useEffect(() => {
    if (!state.isPlaying) return;

    const stageTimings = {
      1: 1200,  // scanning
      2: 1000,  // cve_lookup
      3: 1500,  // refactoring
      4: 2000,  // reviewing
      5: 2000,  // debating
      6: 1500,  // consensus
      7: 1200,  // healing
    };
    const delay = stageTimings[state.workflowStageIndex] ?? 1500;

    timerRef.current = setTimeout(() => {
      dispatch({ type: 'ADVANCE_STAGE' });
    }, delay);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state.isPlaying, state.workflowStageIndex]);

  // ── Demo timeline reveal: only in demo mode ──────────────────────────────
  useEffect(() => {
    if (!state.isPlaying) return;

    const totalEvents = state.mockData.event_timeline.length;
    const stageCount = WORKFLOW_STAGES.length - 1;
    const eventsPerStage = Math.ceil(totalEvents / stageCount);
    const targetRevealIndex = Math.min(
      state.workflowStageIndex * eventsPerStage - 1,
      totalEvents - 1
    );

    if (targetRevealIndex > state.timelineRevealIndex) {
      let current = state.timelineRevealIndex + 1;
      const revealNext = () => {
        if (current <= targetRevealIndex) {
          dispatch({ type: 'REVEAL_TIMELINE_EVENT', index: current });
          current++;
          setTimeout(revealNext, 200);
        }
      };
      revealNext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workflowStageIndex, state.isPlaying]); // intentional: staggered inner setTimeout owns timelineRevealIndex progression

  // ── Progress tick (both modes) ───────────────────────────────────────────
  useEffect(() => {
    const stageCount = WORKFLOW_STAGES.length - 1;
    const targetProgress = Math.round((state.workflowStageIndex / stageCount) * 100);

    if (state.animationProgress < targetProgress) {
      const timer = setInterval(() => {
        dispatch({ type: 'TICK_PROGRESS', delta: 2 });
      }, 30);
      return () => clearInterval(timer);
    }
  }, [state.workflowStageIndex, state.animationProgress]);

  const value = {
    state,
    dispatch,
    startReview,
    resetReview,
    currentStage: WORKFLOW_STAGES[state.workflowStageIndex],
    stages: WORKFLOW_STAGES,
  };

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview() {
  const context = useContext(ReviewContext);
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider');
  }
  return context;
}
